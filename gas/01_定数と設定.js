/**
 * タダサポ管理システム - Backend Logic (v1.14.0)
 *
 * 概要:
 * - Google Spreadsheets をデータベースとして利用
 * - Google Calendar API / Gmail API / Zoom API と連携
 * - 設定値は「設定」シートから読み込み（ハードコード不要）
 *
 * ファイル構成（v1.14.0〜 役割別に分割。ADR-016。GAS では全ファイルが同じグローバル空間を共有する）:
 *   00_管理者メニュー  GAS エディタから手で実行する関数だけ（実行プルダウン用）
 *   01_定数と設定      シート名・列定義（IDX）・スクリプトプロパティ・設定シート・秘密情報 ← 本ファイル
 *   02_認証と共通      03_完成品  04_初期データ  05_案件操作  06_メール  07_日程と会議
 *   08_記録            09_管理者操作  10_移行と案件キー  11_廃止機能
 * トップレベルの定数はリテラルだけで初期化する（ファイルの読込順に依存しないため）。
 */

// ======================================================================
// v1.13.0: 本番の識別子・秘密情報はスクリプトプロパティで管理する（ADR-014）
//   GAS エディタ「プロジェクトの設定 → スクリプト プロパティ」に設定する。
//   - SPREADSHEET_ID: タダサポDB のスプレッドシートID（URL の /d/ と /edit の間）
//   - Zoom 連携の秘密情報（SECRET_SETTING_KEYS_）: 管理画面から書込専用で設定
//   コード・ドキュメント・GitHub に実値を書かない（AI_RULES.md グランドルール3）。
// ======================================================================
const SCRIPT_PROP_SPREADSHEET_ID_ = 'SPREADSHEET_ID';

/**
 * 秘密情報として扱う設定キー。値はスクリプトプロパティに保存し、画面・監査ログ・シートに出さない。
 * 組織内で編集可能な「設定」シートに置くと、組織内の誰でも読めてしまうため（v1.13.0）。
 * ZOOM_FIXED_URL は ?pwd= でパスコードを含むため秘密扱い。ZOOM_FIXED_ID（会議ID）は秘密ではない。
 */
const SECRET_SETTING_KEYS_ = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_FIXED_URL', 'ZOOM_FIXED_PASS'];

// ======================================================================
// シート名・列定義
// ======================================================================
const SHEET_NAMES = {
  SETTINGS: '設定',
  CASES: '案件リスト',
  CASES_OVERRIDE: '案件補正',  // 管理者による案件情報手動補正（案件リストのIMPORTRANGEを保護するため分離）
  CASES_MANUAL: '案件手動追加', // 管理者がアプリから手動追加した案件（案件リストとは別シートで整合性を保護）
  RECORDS: 'サポート記録',
  STAFF: 'タダメンマスタ',
  EMAIL_HISTORY: 'メール履歴',
  EMAIL_DRAFTS: 'メール下書き',  // v1.11.0: 送信前メール一時保存（担当者ごと）
  EMAIL_SCHEDULED: '予約送信キュー',  // v1.12.1: 予約送信は廃止。既存キューの無効化確認用に参照のみ残す
  AUDIT_LOG: '監査ログ',
  ANNUAL_ADJUST: '年間利用補正',  // v1.12.4: 管理者による年度利用回数の手動補正（メール+年度ごとの補正量）
  CASE_KEY_MAP: '案件キーマップ',  // S1 Stage1: 案件の不変サロゲートID(case_id)と自然キーの対応表（参照整合性をコードで強制）
  CHAT_LINKS: 'チャット連携'  // v1.12.13: 申込通知チャットのスレッド対応表（回答スプシから IMPORTRANGE・書き込み禁止）
};

// S1 Stage1: 案件キーマップシートの列定義（A:案件ID, B:種別, C:自然キー_正準化, D:正規化メール, E:作成日時）
const CASE_KEY_MAP_COL = { CASE_ID: 0, SOURCE_TYPE: 1, NATURAL_KEY: 2, EMAIL_NORM: 3, CREATED_AT: 4 };

const IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  // 案件補正シートは案件リストと同じ列構造（PK=A列、値が空の列は「補正なし」を意味する）
  CASES_OVERRIDE: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5, METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10, EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14, CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16, TOOLS: 17, SUB_STAFF: 18 },
  STAFF: { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3, RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 },
  // v1.11.0: メール下書きシート（複合キー: CASE_ID + STAFF_EMAIL + MODE + THREAD_ID）
  DRAFT: { DRAFT_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, MODE: 3, THREAD_ID: 4, SUBJECT: 5, BODY: 6, CC: 7, BCC: 8, TOOLS: 9, UPDATED_AT: 10 },
  // v1.12.1: 予約送信キューは廃止済み。既存行を disabled に更新する後方互換用
  SCHEDULED: { QUEUE_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, MODE: 4, THREAD_ID: 5, SUBJECT: 6, BODY: 7, CC: 8, BCC: 9, TOOLS: 10, SEND_AT: 11, STATUS: 12, ERROR: 13, CREATED_AT: 14, SENT_AT: 15 },
  // v1.12.4: 年間利用補正シート（メール+年度ごとの利用回数補正量。EMAILは正規化して保存）
  ANNUAL_ADJUST: { EMAIL: 0, FISCAL_YEAR: 1, ADJUSTMENT: 2, UPDATED_BY: 3, UPDATED_AT: 4 },
  // v1.12.13: チャット連携シート（申込通知 bot が回答スプシに記録 → IMPORTRANGE で取込。参照のみ）
  CHAT_LINK: { SUBMITTED_AT: 0, EMAIL: 1, THREAD_NAME: 2, MESSAGE_NAME: 3, RECORDED_AT: 4 }
};

// ======================================================================
// 設定読み込み（「設定」シートから全設定値を取得しキャッシュ）
// ======================================================================
let _settingsCache = null;
let _spreadsheetCache = null;
let _scriptPropsCache = null;

/**
 * スクリプトプロパティを一括取得（実行コンテキスト内キャッシュ）。
 * getProperties() は1回の呼び出しで全件返すため、キーごとの getProperty() より速い。
 */
function getScriptProps_() {
  if (_scriptPropsCache) return _scriptPropsCache;
  _scriptPropsCache = PropertiesService.getScriptProperties().getProperties() || {};
  return _scriptPropsCache;
}

/**
 * SPREADSHEET_ID プロパティの値を ID に正規化する（純粋関数・v1.13.0）。
 * スプレッドシートの URL（…/spreadsheets/d/<ID>/edit…）が貼られても ID を取り出す。
 * 空なら ''、ID の形でなければ null を返す。
 */
function normalizeSpreadsheetId_(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  let m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

function getSpreadsheetId_() {
  let id = normalizeSpreadsheetId_(getScriptProps_()[SCRIPT_PROP_SPREADSHEET_ID_]);
  if (id === '') {
    throw new Error('スクリプトプロパティ SPREADSHEET_ID が未設定です。GAS エディタ「プロジェクトの設定 → スクリプト プロパティ」にタダサポDBのスプレッドシートIDを設定してください（RUNBOOK §3）。');
  }
  if (id === null) {
    throw new Error('スクリプトプロパティ SPREADSHEET_ID の値がスプレッドシートIDの形ではありません。URL の /d/ と /edit の間の部分だけを入力してください（RUNBOOK §3）。');
  }
  return id;
}

/**
 * スプレッドシートを取得（実行コンテキスト内キャッシュ）
 * 同一リクエスト内では SpreadsheetApp.openById() を1回だけ呼ぶ
 */
function getSpreadsheet_() {
  if (_spreadsheetCache) return _spreadsheetCache;
  _spreadsheetCache = SpreadsheetApp.openById(getSpreadsheetId_());
  return _spreadsheetCache;
}

// ======================================================================
// v1.13.0: 秘密情報（書込専用・スクリプトプロパティ）— ADR-014
// ======================================================================
function isSecretSettingKey_(key) {
  return SECRET_SETTING_KEYS_.indexOf(key) !== -1;
}

/**
 * 秘密情報を取得する。スクリプトプロパティを優先し、未移行の間だけ「設定」シートの旧値を使う
 * （移行前の本番を止めないための後方互換。管理画面に「シートに残存」と警告を出す）。
 */
function getSecret_(key) {
  let v = String(getScriptProps_()[key] || '').trim();
  if (v) return v;
  let legacy = loadSettings_()[key];
  return legacy ? String(legacy).trim() : '';
}

/**
 * 各秘密情報の保存場所:
 *   'property' | 'sheet'（平文で残存・要移行） | 'property+sheet'（同じ値が両方にある・移行でシートを消す）
 *   | 'conflict'（プロパティとシートで値が異なる・移行では消さない。管理者が正しい値を入力して保存する） | 'none'
 */
function getSecretStatus_() {
  let props = getScriptProps_();
  let settings = loadSettings_();
  let out = {};
  SECRET_SETTING_KEYS_.forEach(function(k) {
    let p = String(props[k] || '').trim();
    let s = String(settings[k] || '').trim();
    if (p && s) out[k] = (p === s) ? 'property+sheet' : 'conflict';
    else if (p) out[k] = 'property';
    else out[k] = s ? 'sheet' : 'none';
  });
  return out;
}

function setSecret_(key, value) {
  let props = PropertiesService.getScriptProperties();
  if (value === null) props.deleteProperty(key);
  else props.setProperty(key, String(value).trim());
  _scriptPropsCache = null;
  if (key.indexOf('ZOOM_') === 0) clearZoomTokenCache_();
}

/** 「設定」シート上の秘密情報セルを空にする（平文を残さない） */
function blankSecretCellsInSheet_(keys) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) return [];
  let data = sheet.getDataRange().getValues();
  let blanked = [];
  for (let i = 1; i < data.length; i++) {
    let k = String(data[i][0]).trim();
    if (keys.indexOf(k) === -1) continue;
    if (String(data[i][2] || '').trim()) {
      sheet.getRange(i + 1, 3).setValue('');
      blanked.push(k);
    }
    // 旧行の入力例・説明を「シートに入力しない」案内に置き換える（v1.13.0）
    sheet.getRange(i + 1, 4, 1, 2).setValues([[
      '（管理画面の設定管理から入力）',
      'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'
    ]]);
  }
  _settingsCache = null;
  return blanked;
}

/**
 * 監査ログの JSON セル1つから秘密情報を伏せ字にする（v1.13.0）。純粋関数。
 * - JSON オブジェクトなら、秘密情報キーの値だけを '[REDACTED]' にする（'(設定済み)' 等の状態表記は残す）
 * - JSON でない・オブジェクトでない場合は、既知の秘密値（8文字以上）を部分一致で伏せる
 * 返り値は書き換え後の文字列（変化なしなら元の文字列）。
 */
function redactAuditCell_(cell, secretKeys, secretValues) {
  let text = String(cell == null ? '' : cell);
  if (!text) return text;
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { obj = null; }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    let changed = false;
    secretKeys.forEach(function(k) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
      let v = obj[k];
      if (v === '' || v === null || v === '[REDACTED]' || /^\(.*\)$/.test(String(v))) return;
      obj[k] = '[REDACTED]';
      changed = true;
    });
    return changed ? JSON.stringify(obj) : text;
  }
  let next = text;
  (secretValues || []).forEach(function(v) {
    if (v && String(v).length >= 8) next = next.split(String(v)).join('[REDACTED]');
  });
  return next;
}

/**
 * 監査ログに平文で残った秘密情報を [REDACTED] に置き換える（v1.13.0 以前の設定変更で記録されたもの）。
 * 置換したセル数だけを返し、値そのものは返さない。
 */
function redactSecretsInAuditLog_(secretValues) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.AUDIT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  let range = sheet.getRange(2, 7, sheet.getLastRow() - 1, 2); // beforeJson / afterJson
  let data = range.getValues();
  let changed = 0;
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < 2; j++) {
      let cell = String(data[i][j] || '');
      let next = redactAuditCell_(cell, SECRET_SETTING_KEYS_, secretValues);
      if (next !== cell) { data[i][j] = next; changed++; }
    }
  }
  if (changed) range.setValues(data);
  return changed;
}

/**
 * 秘密情報の移行計画を立てる（純粋関数・v1.13.0）。本物の値を絶対に失わないことを最優先にする。
 *   シート空                      → 何もしない
 *   プロパティ空                  → move（プロパティへコピーし、シートを空にする）
 *   プロパティ＝シート            → blank（プロパティは既に同じ値。シートだけ空にする）
 *   プロパティ≠シート（食い違い） → conflict（どちらが正しいか機械では決めない。両方残し、管理者に知らせる）
 * 返り値: { move: [key], blank: [key], conflict: [key] }（move のキーは blank にも含める）
 */
function planSecretMigration_(sheetVals, propVals, keys) {
  let out = { move: [], blank: [], conflict: [] };
  keys.forEach(function(k) {
    let s = String((sheetVals || {})[k] == null ? '' : sheetVals[k]).trim();
    let p = String((propVals || {})[k] == null ? '' : propVals[k]).trim();
    if (!s) return;
    if (!p) { out.move.push(k); out.blank.push(k); return; }
    if (p === s) { out.blank.push(k); return; }
    out.conflict.push(k);
  });
  return out;
}

/**
 * 秘密情報を「設定」シートからスクリプトプロパティへ移す（管理者が設定管理画面から実行）。
 * - 計画は planSecretMigration_ に従う。プロパティとシートの値が食い違うキーは何も消さずに残し、
 *   管理者に知らせる（ダミー値などがプロパティに先に入っていても、シートの本物の値を失わない）
 * - 空にしたキーだけ、過去の監査ログの平文を [REDACTED] にする
 * - 監査ログにはキー名と件数だけを記録する（値は記録しない）
 * 冪等: 何度実行しても結果は同じ。
 */
function migrateSecretsToProperties() { return runWrite_(migrateSecretsToPropertiesImpl_, arguments); }
function migrateSecretsToPropertiesImpl_() {
  let actor = requireAdmin_();
  return withScriptLock_(function() {
    let settings = loadSettings_();
    let plan = planSecretMigration_(settings, getScriptProps_(), SECRET_SETTING_KEYS_);
    let redactValues = plan.blank.map(function(k) { return String(settings[k] || '').trim(); });
    plan.move.forEach(function(k) { setSecret_(k, String(settings[k]).trim()); });
    let blanked = plan.blank.length ? blankSecretCellsInSheet_(plan.blank) : [];
    let redacted = redactSecretsInAuditLog_(redactValues);
    appendAuditLog_(actor, 'migrate_secrets', 'settings', 'secrets', null,
      { moved: plan.move, blanked: blanked, conflicts: plan.conflict, auditCellsRedacted: redacted });
    return { moved: plan.move, blanked: blanked, conflicts: plan.conflict, auditCellsRedacted: redacted, status: getSecretStatus_() };
  });
}

/**
 * 「設定」シートから全設定をKey-Valueで読み込む
 * A列=設定キー, B列=項目名（表示用）, C列=設定値, D列=入力例, E列=説明
 * カテゴリ行（キーが # で始まる行）はスキップする
 */
function loadSettings_() {
  if (_settingsCache) return _settingsCache;

  let data = readSheetValues_(SHEET_NAMES.SETTINGS); // v1.14.0: 一括読込の値があればそれを使う
  if (!data) {
    throw new Error('「設定」シートが見つかりません。GASエディタで setupSettingsSheet 関数を実行してください。');
  }

  let settings = {};
  for (let i = 1; i < data.length; i++) {
    let key = String(data[i][0]).trim();
    if (!key || key.charAt(0) === '#') continue;
    let val = String(data[i][2]).trim(); // C列（3列目）が設定値
    settings[key] = val;
  }

  _settingsCache = settings;
  return settings;
}

/**
 * 設定値を取得（キーが無い場合はデフォルト値を返す）
 */
function getSetting_(key, defaultValue) {
  if (isSecretSettingKey_(key)) {
    let secret = getSecret_(key);
    return secret || (defaultValue || '');
  }
  let settings = loadSettings_();
  let val = settings[key];
  return (val !== undefined && val !== '') ? val : (defaultValue || '');
}

function saveSetting_(key, value) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) return;
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      sheet.getRange(i + 1, 3).setValue(value);
      _settingsCache = null;
      return;
    }
  }
  // キーが無ければ新規追加
  sheet.appendRow([key, '', value]);
  _settingsCache = null;
}

/**
 * ADMIN_EMAILS をカンマ区切りで配列として取得
 */
function getAdminEmails_() {
  let raw = getSetting_('ADMIN_EMAILS', '');
  if (!raw) return [];
  return raw.split(',').map(function(e) { return e.trim().toLowerCase(); });
}

/**
 * MAIL_FORCE_CC の設定値（空欄ならnull）を返す。
 */
function getForcedCc_() {
  let raw = getSetting_('MAIL_FORCE_CC', '').trim();
  return raw ? raw : null;
}

/**
 * MAIL_DRY_RUN の設定値を bool として返す。
 * true / 1 / yes / on を有効として扱う。
 */
function isMailDryRun_() {
  let raw = String(getSetting_('MAIL_DRY_RUN', '') || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** 正の整数に解釈できればその値、できなければ既定値（純粋関数。v1.14.0 で設定読込から分離） */
function parsePositiveIntegerOrDefault_(raw, defaultValue) {
  let num = Number(String(raw == null ? '' : raw).trim());
  if (!isFinite(num)) return Number(defaultValue);
  let intNum = Math.floor(num);
  return intNum > 0 ? intNum : Number(defaultValue);
}

function parsePositiveIntegerSetting_(key, defaultValue) {
  return parsePositiveIntegerOrDefault_(getSetting_(key, String(defaultValue)), defaultValue);
}

function getAnnualUsageLimit_() {
  return parsePositiveIntegerSetting_('ANNUAL_USAGE_LIMIT', 10);
}

function getCaseUsageLimit_() {
  return parsePositiveIntegerSetting_('CASE_USAGE_LIMIT', 3);
}

function parseNullablePositiveInteger_(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  let num = Number(value);
  if (!isFinite(num)) throw new Error('上限値は1以上の整数で入力してください。');
  let intNum = Math.floor(num);
  if (intNum < 1) throw new Error('上限値は1以上の整数で入力してください。');
  return intNum;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
