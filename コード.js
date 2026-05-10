/**
 * タダサポ管理システム - Backend Logic (v1.12.0)
 *
 * 概要:
 * - Google Spreadsheets をデータベースとして利用
 * - Google Calendar API / Gmail API / Zoom API と連携
 * - 設定値は「設定」シートから読み込み（ハードコード不要）
 */

// ======================================================================
// ★ デプロイ時にここだけ書き換えてください
// スプレッドシートURLの /d/ と /edit の間の文字列がIDです
// 例: https://docs.google.com/spreadsheets/d/【ここがID】/edit
// ======================================================================
var SPREADSHEET_ID = '1hllLdETiK0sk0xW_y0V6vOmnlK7kIkHBjntYiCTom4w';

// ======================================================================
// シート名・列定義
// ======================================================================
var SHEET_NAMES = {
  SETTINGS: '設定',
  CASES: '案件リスト',
  CASES_OVERRIDE: '案件補正',  // 管理者による案件情報手動補正（案件リストのIMPORTRANGEを保護するため分離）
  CASES_MANUAL: '案件手動追加', // 管理者がアプリから手動追加した案件（案件リストとは別シートで整合性を保護）
  RECORDS: 'サポート記録',
  STAFF: 'タダメンマスタ',
  EMAIL_HISTORY: 'メール履歴',
  EMAIL_DRAFTS: 'メール下書き',  // v1.11.0: 送信前メール一時保存（担当者ごと）
  EMAIL_SCHEDULED: '予約送信キュー',  // v1.11.0: 予約送信メールのキュー
  AUDIT_LOG: '監査ログ'
};

var IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  // 案件補正シートは案件リストと同じ列構造（PK=A列、値が空の列は「補正なし」を意味する）
  CASES_OVERRIDE: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5, METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10, EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14, CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16, TOOLS: 17, SUB_STAFF: 18 },
  STAFF: { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3, RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 },
  // v1.11.0: メール下書きシート（複合キー: CASE_ID + STAFF_EMAIL + MODE + THREAD_ID）
  DRAFT: { DRAFT_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, MODE: 3, THREAD_ID: 4, SUBJECT: 5, BODY: 6, CC: 7, BCC: 8, TOOLS: 9, UPDATED_AT: 10 },
  // v1.11.0: 予約送信キュー（PK: QUEUE_ID）
  SCHEDULED: { QUEUE_ID: 0, CASE_ID: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, MODE: 4, THREAD_ID: 5, SUBJECT: 6, BODY: 7, CC: 8, BCC: 9, TOOLS: 10, SEND_AT: 11, STATUS: 12, ERROR: 13, CREATED_AT: 14, SENT_AT: 15 }
};

// ======================================================================
// 設定読み込み（「設定」シートから全設定値を取得しキャッシュ）
// ======================================================================
var _settingsCache = null;
var _spreadsheetCache = null;

/**
 * スプレッドシートを取得（実行コンテキスト内キャッシュ）
 * 同一リクエスト内では SpreadsheetApp.openById() を1回だけ呼ぶ
 */
function getSpreadsheet_() {
  if (_spreadsheetCache) return _spreadsheetCache;
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID が未設定です。コード.js 先頭の SPREADSHEET_ID にスプレッドシートIDを入力してください。');
  }
  _spreadsheetCache = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _spreadsheetCache;
}

/**
 * 「設定」シートから全設定をKey-Valueで読み込む
 * A列=設定キー, B列=項目名（表示用）, C列=設定値, D列=入力例, E列=説明
 * カテゴリ行（キーが # で始まる行）はスキップする
 */
function loadSettings_() {
  if (_settingsCache) return _settingsCache;

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    throw new Error('「設定」シートが見つかりません。GASエディタで setupSettingsSheet 関数を実行してください。');
  }

  let data = sheet.getDataRange().getValues();
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

function parsePositiveIntegerSetting_(key, defaultValue) {
  let raw = String(getSetting_(key, String(defaultValue)) || '').trim();
  let num = Number(raw);
  if (!isFinite(num)) return Number(defaultValue);
  let intNum = Math.floor(num);
  return intNum > 0 ? intNum : Number(defaultValue);
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

// ── 日程・カレンダー関連の設定ヘルパー（v1.11.7）─────────────
function getScheduleBufferMin_() {
  let raw = String(getSetting_('SCHEDULE_BUFFER_MIN', '30') || '').trim();
  let num = Number(raw);
  if (!isFinite(num) || num < 0) return 30;
  return Math.floor(num);
}

function getTeamCalendarId_() {
  let id = String(getSetting_('TEAM_CALENDAR_ID', '') || '').trim();
  if (id) return id;
  let fallback = String(getSetting_('SHARED_CALENDAR_ID', '') || '').trim();
  return fallback || '';
}

function parseDisplayCalendarsJson_(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(String(raw)); } catch (e) { return []; }
  if (!Array.isArray(parsed)) return [];
  let result = [];
  for (let i = 0; i < parsed.length; i++) {
    let item = parsed[i] || {};
    let name = String(item.name || '').trim();
    let id = String(item.id || '').trim();
    if (id) result.push({ name: name || id, id: id });
  }
  return result;
}

function getDisplayCalendars_() {
  return parseDisplayCalendarsJson_(getSetting_('DISPLAY_CALENDARS_JSON', ''));
}

function parseBoolean_(v, defaultValue) {
  if (v === true || v === false) return v;
  let raw = String(v || '').trim().toLowerCase();
  if (!raw) return !!defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * スプレッドシートへの書き込み前にユーザー入力を無害化する（数式インジェクション防止）。
 * Google Sheets は '=' '+' '-' '@' で始まる文字列を数式・特殊値として評価するため、
 * 先頭にアポストロフィを付与してテキストとして強制解釈させる。
 * 参考: OWASP A03:2025, Google Sheets formula injection best practices
 */
function sanitizeForSheet_(value) {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  // 数式インジェクションを引き起こす先頭文字を無害化
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function getStaffRoleByEmail_(email) {
  let target = normalizeEmail_(email);
  if (!target) return null;

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    if (em !== target) continue;
    let active = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (!active) return null;
    let role = String(data[i][IDX.STAFF.ROLE] || '').trim().toLowerCase();
    return role || 'staff';
  }
  return null;
}

function isAdminEmail_(email) {
  let role = getStaffRoleByEmail_(email);
  if (role === 'admin') return true;
  let adminEmails = getAdminEmails_();
  return adminEmails.indexOf(normalizeEmail_(email)) !== -1;
}

function getActor_() {
  let actorEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!actorEmail) {
    throw new Error('ユーザー情報の取得に失敗しました。');
  }
  // Staffシート1回読みで name + role を同時取得
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  let staffName = null;
  let staffRole = null;
  if (sheet && sheet.getLastRow() > 1) {
    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      let em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
      if (em !== actorEmail) continue;
      let active = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
      if (!active) continue;
      staffName = data[i][IDX.STAFF.NAME];
      staffRole = String(data[i][IDX.STAFF.ROLE] || '').trim().toLowerCase() || 'staff';
      break;
    }
  }
  if (!staffName) {
    throw new Error('アクセス権限がありません。');
  }
  // 旧管理者メールリストとのフォールバック
  if (staffRole !== 'admin') {
    let adminEmails = getAdminEmails_();
    if (adminEmails.indexOf(actorEmail) !== -1) staffRole = 'admin';
  }
  return {
    name: staffName,
    email: actorEmail,
    role: staffRole,
    isAdmin: staffRole === 'admin'
  };
}

function requireAdmin_() {
  let actor = getActor_();
  if (!actor.isAdmin) {
    throw new Error('管理者権限が必要です。');
  }
  return actor;
}

function getCaseRecordRowIndex_(caseId) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) return i + 1;
  }
  return -1;
}

function ensureCaseEditableByActor_(caseId, actor, allowUnassigned) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let rowIndex = getCaseRecordRowIndex_(caseId);
  if (rowIndex === -1) return true;

  let row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  let staffEmail = normalizeEmail_(row[IDX.RECORDS.STAFF_EMAIL]);
  if (!staffEmail && allowUnassigned) return true;
  if (actor.isAdmin) return true;
  if (staffEmail && staffEmail === normalizeEmail_(actor.email)) return true;
  // サブ担当も操作可能（OJT用）
  let subStaffJson = row[IDX.RECORDS.SUB_STAFF] ? String(row[IDX.RECORDS.SUB_STAFF]) : '[]';
  let subStaff = [];
  try { subStaff = JSON.parse(subStaffJson); } catch(e) {}
  if (subStaff.some(function(s) { return normalizeEmail_(s.email) === normalizeEmail_(actor.email); })) return true;
  throw new Error('この案件を操作する権限がありません。');
}

function getOrCreateAuditLogSheet_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.AUDIT_LOG);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET_NAMES.AUDIT_LOG);
  sheet.getRange(1, 1, 1, 8).setValues([[
    'timestamp', 'actorEmail', 'actorName', 'action', 'targetType', 'targetId', 'beforeJson', 'afterJson'
  ]]);
  sheet.setFrozenRows(1);
  return sheet;
}

function appendAuditLog_(actor, action, targetType, targetId, beforeObj, afterObj) {
  try {
    let sheet = getOrCreateAuditLogSheet_();
    sheet.appendRow([
      new Date(),
      actor && actor.email ? actor.email : '',
      actor && actor.name ? actor.name : '',
      action || '',
      targetType || '',
      String(targetId || ''),
      beforeObj ? JSON.stringify(beforeObj) : '',
      afterObj ? JSON.stringify(afterObj) : ''
    ]);
  } catch (e) {
    Logger.log('audit log failed: ' + e.message);
  }
}

// ======================================================================
// Webアプリ エントリポイント
// ======================================================================
function doGet() {
  let html = HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('タダサポ管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // 初期データをHTMLに埋め込み（google.script.run の往復を1回削減）
  try {
    let data = getInitialData();
    let json = JSON.stringify(data).replace(/<\//g, '<\\/');
    html.append('<script>window.__INITIAL_DATA__=' + json + ';</script>');
  } catch (e) {
    // 認証エラー等: 埋め込みスキップ（フロントで再取得しエラー表示）
  }

  return html;
}

// ======================================================================
// 初期データ取得
// ======================================================================
function getInitialData() {
  ensureAttachmentSchema_();

  let userEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  let staff = getStaffByEmail(userEmail);

  if (!staff) {
    throw new Error('アクセス権限がありません。管理者によりタダメンマスタへの登録が必要です。');
  }

  let role = getStaffRoleByEmail_(userEmail) || (isAdminEmail_(userEmail) ? 'admin' : 'staff');
  let isAdmin = role === 'admin';
  let cases = getAllCasesJoined();
  let masters = getMasters();
  // v1.11.0: 下書きを持つ案件IDの一覧（バッジ表示用）
  let draftCaseIds = listDraftCaseIdsForUser_(userEmail);
  // v1.11.0: 予約送信のペンディング案件IDの一覧（バッジ表示用）
  let scheduledCaseIds = listScheduledCaseIdsForUser_(userEmail);

  return {
    user: { name: staff.name, email: userEmail, isAdmin: isAdmin, role: role },
    cases: cases,
    masters: masters,
    draftCaseIds: draftCaseIds,
    scheduledCaseIds: scheduledCaseIds,
    forcedCc: getForcedCc_() || ''
  };
}

// ======================================================================
// 年度計算
// ======================================================================
function getFiscalYear(dateObj) {
  let d = new Date(dateObj);
  if (isNaN(d.getTime())) return 0;
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

// ======================================================================
// データ結合取得
// ======================================================================
function getAllCasesJoined() {
  let ss = getSpreadsheet_();
  // スプレッドシートのタイムゾーンを取得（dateLabel の整形に使用）
  let ssTimeZone = ss.getSpreadsheetTimeZone();
  let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);

  let caseData = caseSheet.getDataRange().getValues();
  let recordData = recordSheet.getDataRange().getValues();

  // 手動追加案件シートを読み込み、案件リストとマージ（ヘッダ行を除いた行配列を結合）
  let manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  let manualRows = (manualSheet && manualSheet.getLastRow() > 1)
    ? manualSheet.getDataRange().getValues().slice(1)
    : [];
  let allCaseRows = caseData.slice(1).concat(manualRows);

  // 削除済み案件を除外
  let deletedRaw = getSetting_('DELETED_CASE_IDS', '');
  if (deletedRaw) {
    let deletedSet = {};
    deletedRaw.split(',').forEach(function(id) { if (id) deletedSet[id.trim()] = true; });
    allCaseRows = allCaseRows.filter(function(r) { return !deletedSet[String(r[IDX.CASES.PK])]; });
  }

  // 案件補正マップを読み込む（管理者が修正した値を案件リストに上書き表示するため）
  let overrideMap = getCasesOverrideMap_(ss);

  // メール履歴を読み込み
  let emailMap = {};
  let emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (emailSheet && emailSheet.getLastRow() > 1) {
    let emailData = emailSheet.getDataRange().getValues();
    for (let ei = 1; ei < emailData.length; ei++) {
      let eCaseId = String(emailData[ei][IDX.EMAIL.CASE_ID]);
      if (!emailMap[eCaseId]) emailMap[eCaseId] = [];
      emailMap[eCaseId].push({
        sendDate: emailData[ei][IDX.EMAIL.SEND_DATE] ? new Date(emailData[ei][IDX.EMAIL.SEND_DATE]).toISOString() : null,
        senderName: String(emailData[ei][IDX.EMAIL.SENDER_NAME]),
        subject: String(emailData[ei][IDX.EMAIL.SUBJECT]),
        body: String(emailData[ei][IDX.EMAIL.BODY])
      });
    }
  }

  let recordMap = {};
  let fiscalYearCounts = {};

  for (let i = 1; i < recordData.length; i++) {
    let r = recordData[i];
    let historyStr = r[IDX.RECORDS.HISTORY] ? String(r[IDX.RECORDS.HISTORY]) : '[]';
    let parsedHistory = [];
    try { parsedHistory = JSON.parse(historyStr); } catch(e) { parsedHistory = []; }
    let attachmentsStr = r[IDX.RECORDS.ATTACHMENTS] ? String(r[IDX.RECORDS.ATTACHMENTS]) : '[]';
    let parsedAttachments = [];
    try { parsedAttachments = JSON.parse(attachmentsStr); } catch(e) { parsedAttachments = []; }
    let toolsStr = r[IDX.RECORDS.TOOLS] ? String(r[IDX.RECORDS.TOOLS]) : '[]';
    let parsedTools = [];
    try { parsedTools = JSON.parse(toolsStr); } catch(e) { parsedTools = []; }
    let subStaffStr = r[IDX.RECORDS.SUB_STAFF] ? String(r[IDX.RECORDS.SUB_STAFF]) : '[]';
    let parsedSubStaff = [];
    try { parsedSubStaff = JSON.parse(subStaffStr); } catch(e) { parsedSubStaff = []; }
    recordMap[String(r[IDX.RECORDS.FK])] = {
      status: r[IDX.RECORDS.STATUS],
      staffEmail: r[IDX.RECORDS.STAFF_EMAIL],
      staffName: r[IDX.RECORDS.STAFF_NAME],
      scheduledDateTime: r[IDX.RECORDS.DATE] ? new Date(r[IDX.RECORDS.DATE]).toISOString() : null,
      supportCount: r[IDX.RECORDS.COUNT],
      method: r[IDX.RECORDS.METHOD],
      businessType: r[IDX.RECORDS.BUSINESS],
      content: r[IDX.RECORDS.CONTENT],
      remarks: r[IDX.RECORDS.REMARKS],
      meetUrl: r[IDX.RECORDS.MEET_URL],
      eventId: r[IDX.RECORDS.EVENT_ID],
      threadId: r[IDX.RECORDS.THREAD_ID] || null,
      caseLimitOverride: (function(v) {
        let n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.CASE_LIMIT_OVERRIDE]),
      annualLimitOverride: (function(v) {
        let n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE]),
      supportHistory: parsedHistory,
      attachments: parsedAttachments,
      tools: parsedTools,
      subStaff: parsedSubStaff
    };
  }

  for (let j = 0; j < allCaseRows.length; j++) {
    let c = allCaseRows[j];
    let ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    // 補正シートにメールアドレスの補正があればそちらを使う（年度集計の正確性のため）
    let ovr = overrideMap[ts] || {};
    let email = ovr.email !== null && ovr.email !== undefined ? ovr.email : String(c[IDX.CASES.EMAIL]);
    let record = recordMap[ts] || { status: 'unhandled' };
    if (record.status === 'inProgress' || record.status === 'completed') {
      let fy = getFiscalYear(ts);
      let key = email + '_' + fy;
      fiscalYearCounts[key] = (fiscalYearCounts[key] || 0) + (Number(record.supportCount) || 1);
    }
  }

  let joinedCases = [];
  let seenPks = {};
  for (let j = 0; j < allCaseRows.length; j++) {
    let c = allCaseRows[j];
    let ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    if (seenPks[ts]) continue; // 重複PKをスキップ
    seenPks[ts] = true;
    let record = recordMap[ts] || { status: 'unhandled', supportCount: 1 };
    // 案件補正マップを適用（補正値が存在する場合は上書き、null は補正なし）
    let ovr = overrideMap[ts] || {};
    let email       = ovr.email         !== null && ovr.email         !== undefined ? ovr.email         : String(c[IDX.CASES.EMAIL]);
    let officeName  = ovr.officeName    !== null && ovr.officeName    !== undefined ? ovr.officeName    : c[IDX.CASES.OFFICE];
    let reqName     = ovr.requesterName !== null && ovr.requesterName !== undefined ? ovr.requesterName : c[IDX.CASES.NAME];
    let details     = ovr.details       !== null && ovr.details       !== undefined ? ovr.details       : c[IDX.CASES.DETAILS];
    let prefecture  = ovr.prefecture    !== null && ovr.prefecture    !== undefined ? ovr.prefecture    : (c[IDX.CASES.PREFECTURE] || null);
    let serviceType = ovr.serviceType   !== null && ovr.serviceType   !== undefined ? ovr.serviceType   : c[IDX.CASES.SERVICE];
    let fy = getFiscalYear(ts);
    let count = fiscalYearCounts[email + '_' + fy] || 0;
    // タイムスタンプをJST日付文字列に変換
    // c[IDX.CASES.PK] は GAS が Sheet から読んだ Date オブジェクトのため、
    // String() → new Date() の往復変換を避けて直接 formatDate に渡す
    let pkRaw = c[IDX.CASES.PK];
    let pkDate;
    if (pkRaw && typeof pkRaw.getTime === 'function') {
      pkDate = pkRaw;
    } else if (typeof pkRaw === 'string' && pkRaw.indexOf('manual_') === 0) {
      // 手動追加案件: "manual_" + エポックミリ秒 から日付を復元
      let epoch = Number(pkRaw.replace('manual_', ''));
      pkDate = isFinite(epoch) ? new Date(epoch) : new Date(NaN);
    } else {
      pkDate = new Date(pkRaw);
    }
    let dateLabel = isNaN(pkDate.getTime()) ? '' : Utilities.formatDate(pkDate, ssTimeZone, 'yyyy/MM/dd');

    joinedCases.push({
      id: ts, timestamp: ts, dateLabel: dateLabel, email: email,
      officeName: officeName, requesterName: reqName,
      details: details, serviceType: serviceType,
      prefecture: prefecture,
      hasOverride: Object.keys(ovr).some(function(k) { return ovr[k] !== null; }),
      status: record.status, staffEmail: record.staffEmail, staffName: record.staffName,
      scheduledDateTime: record.scheduledDateTime, supportCount: record.supportCount,
      method: record.method, businessType: record.businessType,
      content: record.content, remarks: record.remarks,
      meetUrl: record.meetUrl, eventId: record.eventId,
      threadId: record.threadId || null,
      caseLimitOverride: record.caseLimitOverride || null,
      annualLimitOverride: record.annualLimitOverride || null,
      supportHistory: record.supportHistory || [],
      attachments: record.attachments || [],
      tools: record.tools || [],
      subStaff: record.subStaff || [],
      currentFiscalYearCount: count,
      emails: emailMap[ts] || []
    });
  }

  return joinedCases.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

// ======================================================================
// 案件アサイン
// ======================================================================
function assignCase(caseId, user, tools) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();

  let toolsVal = Array.isArray(tools) && tools.length > 0 ? JSON.stringify(tools) : '[]';

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    sheet.appendRow([
      caseId, 'inProgress', actor.email, actor.name,
      null, 1, null, null, null, null, null, null, null, null, '[]', '', '', toolsVal, '[]'
    ]);
  } else {
    let before = {
      status: String(data[rowIndex - 1][IDX.RECORDS.STATUS] || ''),
      staffEmail: String(data[rowIndex - 1][IDX.RECORDS.STAFF_EMAIL] || ''),
      staffName: String(data[rowIndex - 1][IDX.RECORDS.STAFF_NAME] || '')
    };
    sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('inProgress');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(actor.email);
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(actor.name);
    if (toolsVal !== '[]') {
      sheet.getRange(rowIndex, IDX.RECORDS.TOOLS + 1).setValue(toolsVal);
    }
    appendAuditLog_(actor, 'assign_case', 'case', caseId, before, {
      status: 'inProgress',
      staffEmail: actor.email,
      staffName: actor.name
    });
  }
  return;
}

// ======================================================================
// 案件再開（完了 → 対応中、回数インクリメント）
// ======================================================================

/**
 * 完了済み案件を再開する。supportCount を +1 し、ステータスを inProgress に変更。
 * 日程・URL・記録をリセットし、次回対応の準備を行う。
 * supportCount >= 3 の場合はエラー。
 */
function reopenCase(caseId, user) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = data[rowIndex - 1];
  let currentCount = Number(row[IDX.RECORDS.COUNT]) || 1;
  let caseLimit = parseNullablePositiveInteger_(row[IDX.RECORDS.CASE_LIMIT_OVERRIDE]) || getCaseUsageLimit_();
  if (currentCount >= caseLimit) throw new Error('この案件は対応上限（' + caseLimit + '回）に達しているため再開できません。');

  // 現在の回の記録を履歴に保存
  let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  let history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }
  history.push({
    round: currentCount,
    scheduledDateTime: row[IDX.RECORDS.DATE] ? new Date(row[IDX.RECORDS.DATE]).toISOString() : null,
    method: row[IDX.RECORDS.METHOD] || null,
    content: row[IDX.RECORDS.CONTENT] || null,
    remarks: row[IDX.RECORDS.REMARKS] || null,
    meetUrl: row[IDX.RECORDS.MEET_URL] || null,
    attachments: (function() {
      let a = row[IDX.RECORDS.ATTACHMENTS] ? String(row[IDX.RECORDS.ATTACHMENTS]) : '[]';
      try { return JSON.parse(a); } catch(e) { return []; }
    })(),
    tools: (function() {
      let t = row[IDX.RECORDS.TOOLS] ? String(row[IDX.RECORDS.TOOLS]) : '[]';
      try { return JSON.parse(t); } catch(e) { return []; }
    })(),
    staffName: row[IDX.RECORDS.STAFF_NAME] || null,
    staffEmail: row[IDX.RECORDS.STAFF_EMAIL] || null
  });
  // STATUS(1)～ATTACHMENTS(14) を一括書き込み
  let newRow = [];
  newRow[IDX.RECORDS.STATUS] = 'inProgress';
  newRow[IDX.RECORDS.COUNT] = currentCount + 1;
  newRow[IDX.RECORDS.DATE] = null;
  newRow[IDX.RECORDS.METHOD] = null;
  newRow[IDX.RECORDS.CONTENT] = null;
  newRow[IDX.RECORDS.REMARKS] = null;
  newRow[IDX.RECORDS.HISTORY] = JSON.stringify(history);
  newRow[IDX.RECORDS.EVENT_ID] = null;
  newRow[IDX.RECORDS.MEET_URL] = null;
  newRow[IDX.RECORDS.ATTACHMENTS] = '[]';
  // STAFF_EMAIL(2), STAFF_NAME(3), BUSINESS(7) は既存値を保持
  newRow[IDX.RECORDS.STAFF_EMAIL] = row[IDX.RECORDS.STAFF_EMAIL];
  newRow[IDX.RECORDS.STAFF_NAME] = row[IDX.RECORDS.STAFF_NAME];
  newRow[IDX.RECORDS.BUSINESS] = row[IDX.RECORDS.BUSINESS];
  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1, 1, IDX.RECORDS.ATTACHMENTS - IDX.RECORDS.STATUS + 1)
    .setValues([newRow.slice(IDX.RECORDS.STATUS, IDX.RECORDS.ATTACHMENTS + 1)]);
  appendAuditLog_(actor, 'reopen_case', 'case', caseId, { supportCount: currentCount }, { supportCount: currentCount + 1, status: 'inProgress' });
  return;
}

/**
 * 間違って開始した現在の回（2回目以降）を取り消し、前回の完了状態に戻す。
 * supportCount が1の場合はエラー（1回目は取り消せない）。
 * 担当者本人・サブ担当・管理者が実行可能。
 */
function rollbackCurrentRound(caseId) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = data[rowIndex - 1];
  let currentCount = Number(row[IDX.RECORDS.COUNT]) || 1;
  if (currentCount <= 1) throw new Error('1回目の対応は取り消せません。');

  // 履歴から直前の回を復元
  let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  let history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }
  if (history.length === 0) throw new Error('復元する履歴がありません。');

  let prev = history.pop(); // 直前の回のデータ

  // レコードを前回の完了状態に復元
  let restoreRow = [];
  restoreRow[IDX.RECORDS.STATUS] = 'completed';
  restoreRow[IDX.RECORDS.STAFF_EMAIL] = prev.staffEmail || row[IDX.RECORDS.STAFF_EMAIL];
  restoreRow[IDX.RECORDS.STAFF_NAME] = prev.staffName || row[IDX.RECORDS.STAFF_NAME];
  restoreRow[IDX.RECORDS.DATE] = prev.scheduledDateTime ? new Date(prev.scheduledDateTime) : null;
  restoreRow[IDX.RECORDS.COUNT] = currentCount - 1;
  restoreRow[IDX.RECORDS.METHOD] = prev.method || null;
  restoreRow[IDX.RECORDS.BUSINESS] = row[IDX.RECORDS.BUSINESS]; // 業種は現在値を保持
  restoreRow[IDX.RECORDS.CONTENT] = prev.content || null;
  restoreRow[IDX.RECORDS.REMARKS] = prev.remarks || null;
  restoreRow[IDX.RECORDS.HISTORY] = JSON.stringify(history);
  restoreRow[IDX.RECORDS.EVENT_ID] = null; // カレンダーイベントは復元不可
  restoreRow[IDX.RECORDS.MEET_URL] = prev.meetUrl || null;
  restoreRow[IDX.RECORDS.ATTACHMENTS] = prev.attachments ? JSON.stringify(prev.attachments) : '[]';

  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1, 1, IDX.RECORDS.ATTACHMENTS - IDX.RECORDS.STATUS + 1)
    .setValues([restoreRow.slice(IDX.RECORDS.STATUS, IDX.RECORDS.ATTACHMENTS + 1)]);

  appendAuditLog_(actor, 'rollback_round', 'case', caseId, { supportCount: currentCount, status: 'inProgress' }, { supportCount: currentCount - 1, status: 'completed' });
  return;
}

// ======================================================================
// 案件キャンセル（担当者・サブ担当・管理者が実行可能）
// ======================================================================

/**
 * 案件をキャンセルする。担当者本人・サブ担当・管理者が実行可能。
 * 未アサインの案件は管理者のみキャンセル可能。
 */
function cancelCase(caseId) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let rowIndex = getCaseRecordRowIndex_(caseId);
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  let before = { status: String(row[IDX.RECORDS.STATUS] || '') };

  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('cancelled');
  appendAuditLog_(actor, 'cancel_case', 'case', caseId, before, { status: 'cancelled' });
  return;
}

// スキーマバージョン: マイグレーション追加時にインクリメントする
// v1.11.7 で 6 に更新（addScheduleZoomSettings を自動実行）
var SCHEMA_VERSION_ = '6';

function ensureAttachmentSchema_() {
  // CacheService でスキーマ確認済みなら全スキップ（6時間有効）
  try {
    let cache = CacheService.getScriptCache();
    if (cache.get('schema_v') === SCHEMA_VERSION_) return;
  } catch (e) { /* CacheService 利用不可の場合はフォールスルー */ }

  try {
    ensureAdminSchema_();
    addForcedCcSetting();
    addMailDryRunSetting();
    addUsageLimitSettings();
    addAttachmentFolderSetting();
    addAttachmentsColumnToRecords();
    addCaseLimitOverrideColumnsToRecords();
    addToolsColumnToRecords();
    addSubStaffColumnToRecords();
    addMissingEmailSettings_();
    addScheduleZoomSettings();  // v1.11.7: 日程・Zoom予約関連の設定キー追加
  } catch (e) {
    throw new Error('添付機能の初期化に失敗しました。管理者に連絡してください。詳細: ' + e.message);
  }

  // 全マイグレーション成功後にキャッシュ（21600秒 = 6時間）
  try {
    CacheService.getScriptCache().put('schema_v', SCHEMA_VERSION_, 21600);
  } catch (e) { /* キャッシュ保存失敗は無視 */ }
}

/**
 * 設定シートに不足しているメール設定行を追加する。
 * MAIL_DECLINED_SUBJECT / MAIL_DECLINED_BODY / MAIL_INITIAL_INCLUDE_DETAILS / MAIL_NEW_BODY
 * が存在しない場合のみ追加する。
 */
function addMissingEmailSettings_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) return;

  let data = sheet.getDataRange().getValues();
  let existingKeys = {};
  for (let i = 0; i < data.length; i++) {
    existingKeys[String(data[i][0]).trim()] = true;
  }

  let toAdd = [];
  if (!existingKeys['MAIL_INITIAL_INCLUDE_DETAILS']) {
    toAdd.push(['MAIL_INITIAL_INCLUDE_DETAILS', '初回メールに相談内容を含める', 'true', 'true / false', '初回メール本文に相談内容ブロックを含めるか（true=含める）']);
  }
  if (!existingKeys['MAIL_DECLINED_SUBJECT']) {
    toAdd.push(['MAIL_DECLINED_SUBJECT', '回数超過メール件名', 'タダサポ｜ご利用回数上限のお知らせ', '', '回数超過時に送信するメールの件名']);
  }
  if (!existingKeys['MAIL_DECLINED_BODY']) {
    toAdd.push(['MAIL_DECLINED_BODY', '回数超過メール本文', '{{名前}} 様\n\nいつもタダサポをご利用いただきありがとうございます。\n\n誠に恐れ入りますが、{{事業所名}} 様の今年度のご利用回数が上限（10回）に達しております。\nそのため、今回のご相談につきましては対応を見送らせていただくこととなりました。\n\n大変申し訳ございませんが、何卒ご理解くださいますようお願い申し上げます。\n次年度のご利用をお待ちしております。', '', '回数超過時のメール本文テンプレート。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['MAIL_NEW_BODY']) {
    toAdd.push(['MAIL_NEW_BODY', '新規メール本文テンプレート', '{{名前}} 様\n\n\n\n{{担当者名}}', '', '「新規メール送信」時の初期本文。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['MAIL_NEW_SUBJECT']) {
    toAdd.push(['MAIL_NEW_SUBJECT', '新規メール件名テンプレート', '', '', '「新規メール送信」時の初期件名。空欄の場合は件名欄が空で表示されます。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['MAIL_SCHEDULE_SUBJECT']) {
    toAdd.push(['MAIL_SCHEDULE_SUBJECT', '日程確定メール件名', 'タダサポ｜サポート日程のご連絡', '', '日程確定時に送信するメールの件名。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['MAIL_SCHEDULE_BODY']) {
    toAdd.push(['MAIL_SCHEDULE_BODY', '日程確定メール本文', '{{名前}} 様\n\nいつもお世話になっております。\nタダサポ担当の{{担当者���}}です。\n\nサポート日程が決まりましたのでご連絡い��します。\n\n----------------\n【サポート日程】\n日時：{{日程}}\n方法：{{対応方法}}\n{{URL}}\n----------------\n\n当日はどうぞよろしく��願いいたします。\nご不明な点がございましたらお気軽にご連絡ください。', '', '日程確定時のメール本文テンプレー���。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}} {{日程}} {{対応方��}} {{URL}}']);
  }
  if (!existingKeys['SUPPORT_TOOLS']) {
    toAdd.push(['SUPPORT_TOOLS', '対応ツール一覧', 'Word・Excel,Windows（基本操作）,LINEWORKS,Google（基本操作）,Google Workspace,AI（ChatGPT、Gemini 他）,ケアプランデータ連携システム,介護ソフト,その他', '', 'カン��区切りで管理。フォームの対応ツー���選択肢に使用']);
  }

  if (!toAdd.length) return;

  let lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, toAdd.length, 5).setValues(toAdd);
  // 値列（C列）を編集可能な黄色スタイルに
  for (let j = 0; j < toAdd.length; j++) {
    let r = lastRow + 1 + j;
    sheet.getRange(r, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
    sheet.getRange(r, 1).setFontColor('#9ca3af').setFontSize(8);
    sheet.getRange(r, 2).setFontWeight('bold').setFontColor('#1e293b');
    sheet.getRange(r, 5).setFontColor('#64748b').setFontSize(9);
    sheet.setRowHeight(r, 40);
  }
  Logger.log('不足していたメール設定行を追加しました: ' + toAdd.map(function(r) { return r[0]; }).join(', '));
}

// ======================================================================
// 回数超過 → 対応不可（メール送信 + ステータス変更）
// ======================================================================

/**
 * 年間利用回数超過のため案件を対応不可にする。
 * 回数超過メールを送信し、ステータスを rejected に変更する。
 */
function declineCase(caseId, user, subject, body, cc, bcc) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  let recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    // レコードが無い場合は新規作成
    sheet.appendRow([
      caseId, 'rejected', actor.email, actor.name,
      null, 1, null, null, null, null, null, null, null, null, '[]', '', '', '[]', '[]'
    ]);
    appendAuditLog_(actor, 'decline_case', 'case', caseId, null, {
      status: 'rejected',
      staffEmail: actor.email,
      staffName: actor.name
    });
  } else {
    let before = {
      status: String(data[rowIndex - 1][IDX.RECORDS.STATUS] || ''),
      staffEmail: String(data[rowIndex - 1][IDX.RECORDS.STAFF_EMAIL] || ''),
      staffName: String(data[rowIndex - 1][IDX.RECORDS.STAFF_NAME] || '')
    };
    sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('rejected');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(actor.email);
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(actor.name);
    appendAuditLog_(actor, 'decline_case', 'case', caseId, before, {
      status: 'rejected',
      staffEmail: actor.email,
      staffName: actor.name
    });
  }

  // メール送信
  let result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);
  storeThreadId_(caseId, result.threadId);
  recordEmail_(caseId, actor, recipientEmail, subject, body);
  return { threadId: result.threadId };
}

// ======================================================================
// メール履歴シート管理
// ======================================================================

/**
 * 「メール履歴」シートを取得（無ければ自動作成）
 */
function getOrCreateEmailHistorySheet_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAMES.EMAIL_HISTORY);
  let headers = ['案件ID', '送信日時', '送信者メール', '送信者名', '宛先メール', '件名', '本文'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダースタイル
  let headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#0d9488').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  headerRange.setFontFamily('Noto Sans JP');
  sheet.setFrozenRows(1);
  sheet.setTabColor('#14b8a6');

  // 列幅
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 200);
  sheet.setColumnWidth(6, 300);
  sheet.setColumnWidth(7, 400);

  return sheet;
}

/**
 * メール送信履歴を記録する（内部ヘルパー）
 */
function recordEmail_(caseId, user, recipientEmail, subject, body) {
  let sheet = getOrCreateEmailHistorySheet_();
  sheet.appendRow([
    caseId,
    new Date(),
    user.email,
    user.name,
    recipientEmail,
    subject,
    body
  ]);
}

/**
 * 案件の宛先メールアドレスを取得する（内部ヘルパー）
 * 案件補正シートにメールアドレスの補正がある場合はそちらを優先する。
 */
function getRecipientEmail_(caseId) {
  let ss = getSpreadsheet_();
  // 案件補正シートのメール補正を優先チェック
  let overrideMap = getCasesOverrideMap_(ss);
  let ovr = overrideMap[String(caseId)];
  if (ovr && ovr.email !== null) return ovr.email;

  // 案件リストをチェック
  let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  let caseData = caseSheet.getDataRange().getValues();
  for (let i = 1; i < caseData.length; i++) {
    if (String(caseData[i][IDX.CASES.PK]) === String(caseId)) {
      return String(caseData[i][IDX.CASES.EMAIL]);
    }
  }

  // 手動追加案件シートもチェック（案件リストに存在しない manual_xxx 案件に対応）
  let manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  if (manualSheet && manualSheet.getLastRow() > 1) {
    let manualData = manualSheet.getDataRange().getValues();
    for (let j = 1; j < manualData.length; j++) {
      if (String(manualData[j][IDX.CASES.PK]) === String(caseId)) {
        return String(manualData[j][IDX.CASES.EMAIL]);
      }
    }
  }

  return null;
}

// ======================================================================
// Gmail API スレッド機能
// ※ 前提: GASエディタ → サービス → Gmail API (v1) を有効化すること
// ======================================================================

/**
 * Gmail API でメールを送信する（スレッド対応）
 * @param {string} to - 宛先メールアドレス
 * @param {string} subject - 件名
 * @param {string} body - 本文
 * @param {string|null} threadId - 既存スレッドに追加する場合のスレッドID
 * @param {string|null} inReplyTo - In-Reply-To ヘッダ用 Message-ID
 * @returns {{ messageId: string, threadId: string }}
 */
function sendInThread_(to, subject, body, threadId, inReplyTo, optionalCc, optionalBcc) {
  let encodedSubject = '=?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=';
  let forceCc = getForcedCc_();

  // 設定の必須CCと任意CCをマージ
  let ccParts = [];
  if (forceCc) ccParts.push(forceCc);
  if (optionalCc) ccParts.push(optionalCc);
  let mergedCc = ccParts.length > 0 ? ccParts.join(', ') : null;

  let headers = [
    'MIME-Version: 1.0',
    'To: ' + to,
    'Subject: ' + encodedSubject,
    'Content-Type: text/plain; charset=UTF-8'
  ];
  if (mergedCc) headers.push('Cc: ' + mergedCc);
  if (optionalBcc) headers.push('Bcc: ' + optionalBcc);

  if (inReplyTo) {
    headers.push('In-Reply-To: ' + inReplyTo);
    headers.push('References: ' + inReplyTo);
  }

  let rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;
  let encoded = Utilities.base64EncodeWebSafe(rawMessage, Utilities.Charset.UTF_8);

  let request = { raw: encoded };
  if (threadId) request.threadId = threadId;

  if (isMailDryRun_()) {
    let stamp = String(new Date().getTime());
    Logger.log('[MAIL_DRY_RUN] send skipped. to=%s cc=%s bcc=%s subject=%s threadId=%s', to, mergedCc || '', optionalBcc || '', subject, threadId || '');
    return {
      messageId: 'dryrun-msg-' + stamp,
      threadId: threadId || ('dryrun-thread-' + stamp),
      dryRun: true,
      to: to,
      cc: mergedCc || null,
      bcc: optionalBcc || null
    };
  }

  let result = Gmail.Users.Messages.send(request, 'me');
  return { messageId: result.id, threadId: result.threadId, dryRun: false, to: to, cc: mergedCc || null, bcc: optionalBcc || null };
}

/**
 * テスト用: ドライラン送信でCCが付与されるかを確認する。
 * 送信先は .invalid ドメインを使用する。
 */
function verifyCcDryRun() {
  if (!isMailDryRun_()) {
    throw new Error('MAIL_DRY_RUN が有効ではありません。テスト時のみ true にしてください。');
  }
  let forceCc = getForcedCc_();
  if (!forceCc) {
    throw new Error('MAIL_FORCE_CC が未設定です。CC確認のため設定してください。');
  }

  let result = sendInThread_(
    'dry-run-check@example.invalid',
    '[DRY RUN] CC確認',
    'This is a dry-run verification mail.',
    null,
    null
  );

  return {
    ok: !!(result && result.dryRun && result.cc),
    dryRun: !!(result && result.dryRun),
    cc: result ? result.cc : null,
    to: result ? result.to : null,
    messageId: result ? result.messageId : null,
    threadId: result ? result.threadId : null
  };
}

/**
 * スレッド内の最後のメッセージの Message-ID を取得する
 */
function getLastMessageId_(threadId) {
  try {
    let thread = Gmail.Users.Threads.get('me', threadId, { format: 'metadata', metadataHeaders: ['Message-Id'] });
    let messages = thread.messages;
    if (!messages || messages.length === 0) return null;
    let lastMsg = messages[messages.length - 1];
    let hdrs = lastMsg.payload.headers;
    for (let i = 0; i < hdrs.length; i++) {
      if (hdrs[i].name.toLowerCase() === 'message-id') return hdrs[i].value;
    }
  } catch(e) { /* ignore */ }
  return null;
}

/**
 * Gmail メッセージの payload からプレーンテキスト本文を抽出する
 * Gmail APIはBase64urlをパディングなしで返すため、標準Base64に変換してからデコードする
 */
function getPlainTextBody_(payload) {
  if (payload.body && payload.body.data &&
      (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
    try {
      // Base64URL → 標準 Base64 変換（- を +、_ を / に置換）してからパディング補完
      let data = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      while (data.length % 4 !== 0) data += '=';
      let bytes = Utilities.base64Decode(data);
      let text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
      // HTML の場合はタグを除去してプレーンテキスト化
      if (payload.mimeType === 'text/html') {
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<br\s*\/?>/gi, '\n')
                   .replace(/<\/p>/gi, '\n')
                   .replace(/<[^>]+>/g, '')
                   .replace(/&nbsp;/g, ' ')
                   .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
                   .replace(/\n{3,}/g, '\n\n').trim();
      }
      return text;
    } catch(e) {
      return '';
    }
  }
  if (payload.parts) {
    // text/plain を優先して再帰探索
    for (let i = 0; i < payload.parts.length; i++) {
      if (payload.parts[i].mimeType === 'text/plain') {
        let r = getPlainTextBody_(payload.parts[i]);
        if (r) return r;
      }
    }
    // text/plain が見つからなければ再帰（HTML含む）
    for (let j = 0; j < payload.parts.length; j++) {
      let result = getPlainTextBody_(payload.parts[j]);
      if (result) return result;
    }
  }
  return '';
}

/**
 * 案件の全スレッドIDをサポート記録から取得する（カンマ区切りで複数保存）
 */
function getThreadIdsForCase_(caseId) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      let raw = String(data[i][IDX.RECORDS.THREAD_ID] || '');
      if (!raw) return [];
      return raw.split(',').filter(function(t) { return t.trim(); });
    }
  }
  return [];
}

/**
 * 案件にスレッドIDを追記する（カンマ区切りで末尾に追加）
 */
function storeThreadId_(caseId, threadId) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      let existing = String(data[i][IDX.RECORDS.THREAD_ID] || '');
      let newVal = existing ? existing + ',' + threadId : threadId;
      sheet.getRange(i + 1, IDX.RECORDS.THREAD_ID + 1).setValue(newVal);
      return;
    }
  }
}

/**
 * 全スタッフのメールアドレスをリストで取得する
 */
function getAllStaffEmails_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  let data = sheet.getDataRange().getValues();
  let emails = [];
  for (let i = 1; i < data.length; i++) {
    let isActive = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (isActive && data[i][IDX.STAFF.EMAIL]) {
      emails.push(String(data[i][IDX.STAFF.EMAIL]).toLowerCase());
    }
  }
  return emails;
}

// ======================================================================
// 案件アサイン + 初回メール送信（スレッド開始）
// ======================================================================

/**
 * 案件を担当し、初回メールを送信する。
 * Gmail API でスレッドIDを取得し、サポート記録に保存する。
 */
function assignAndSendEmail(caseId, user, subject, body, cc, bcc, tools) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  let recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  assignCase(caseId, actor, tools);

  // Gmail API で送信（新規スレッド開始）
  let result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);

  // スレッドIDを保存
  storeThreadId_(caseId, result.threadId);

  // メール履歴にも記録（バックアップ）
  recordEmail_(caseId, actor, recipientEmail, subject, body);
  return { threadId: result.threadId };
}

// ======================================================================
// 新規メール送信（新しいスレッドを立てる）
// ======================================================================

/**
 * 案件に対して新規メールを送信する（新しいスレッドを作成）。
 * 「メール送信」ボタンから呼ばれる。
 */
function sendNewCaseEmail(caseId, user, subject, body, cc, bcc) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  let result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);
  storeThreadId_(caseId, result.threadId);
  recordEmail_(caseId, actor, recipientEmail, subject, body);
  return { threadId: result.threadId };
}

// ======================================================================
// スレッド返信（既存スレッドに返信する）
// ======================================================================

/**
 * 案件の既存スレッドに返信する。
 * threadIdを指定して呼ばれる。
 */
function sendCaseEmail(caseId, user, subject, body, threadId, cc, bcc) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  let inReplyTo = null;
  if (threadId) {
    inReplyTo = getLastMessageId_(threadId);
  }

  let result = sendInThread_(recipientEmail, subject, body, threadId || null, inReplyTo, cc || null, bcc || null);

  // threadId未指定の場合は新規スレッドとして保存
  if (!threadId && result.threadId) {
    storeThreadId_(caseId, result.threadId);
  }

  recordEmail_(caseId, actor, recipientEmail, subject, body);
  return { threadId: threadId || result.threadId };
}

// ======================================================================
// スレッド内メッセージ読み込み（送受信含む）
// ======================================================================

/**
 * 案件の全Gmailスレッドのメッセージを取得する。
 * 複数スレッドをグループ化して返す。
 * 戻り値: [{ threadId, subject, messages: [{ sendDate, senderName, fromEmail, subject, body, isStaff }] }]
 */
function getThreadMessages(caseId) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let threadIds = getThreadIdsForCase_(caseId);

  // スレッドIDが無い場合はメール履歴シートから返す（フォールバック）
  if (!threadIds.length) {
    let ss = getSpreadsheet_();
    let emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
    if (!emailSheet || emailSheet.getLastRow() <= 1) return [];

    let emailData = emailSheet.getDataRange().getValues();
    let fallbackMsgs = [];
    for (let i = 1; i < emailData.length; i++) {
      if (String(emailData[i][IDX.EMAIL.CASE_ID]) === String(caseId)) {
        fallbackMsgs.push({
          sendDate: emailData[i][IDX.EMAIL.SEND_DATE] ? new Date(emailData[i][IDX.EMAIL.SEND_DATE]).toISOString() : null,
          senderName: String(emailData[i][IDX.EMAIL.SENDER_NAME]),
          subject: String(emailData[i][IDX.EMAIL.SUBJECT]),
          body: String(emailData[i][IDX.EMAIL.BODY]),
          isStaff: true
        });
      }
    }
    if (!fallbackMsgs.length) return [];
    return [{ threadId: null, subject: fallbackMsgs[0].subject, messages: fallbackMsgs }];
  }

  // GmailApp でスレッドを取得（base64デコード不要、.getPlainBody() で直接取得）
  let staffEmails = getAllStaffEmails_();
  let threads = [];

  for (let t = 0; t < threadIds.length; t++) {
    try {
      let thread = GmailApp.getThreadById(threadIds[t]);
      if (!thread) continue;
      let gmailMsgs = thread.getMessages();

      let parsed = gmailMsgs.map(function(msg) {
        let from = msg.getFrom();
        let fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1] : from;
        let isStaff = staffEmails.indexOf(fromEmail.toLowerCase()) !== -1;
        let senderName = from.match(/^(.+?)\s*</) ? from.match(/^(.+?)\s*</)[1].replace(/"/g, '').trim() : fromEmail;
        return {
          sendDate: msg.getDate().toISOString(),
          senderName: senderName,
          fromEmail: fromEmail,
          subject: msg.getSubject(),
          body: msg.getPlainBody() || '',
          isStaff: isStaff
        };
      });

      threads.push({
        threadId: threadIds[t],
        subject: parsed.length > 0 ? parsed[0].subject : '',
        messages: parsed
      });
    } catch(e) {
      console.error('スレッド読み込みエラー (' + threadIds[t] + '): ' + e.message);
    }
  }

  // 最新スレッドが先頭に来るようにソート
  threads.sort(function(a, b) {
    let aDate = a.messages.length ? new Date(a.messages[a.messages.length - 1].sendDate) : 0;
    let bDate = b.messages.length ? new Date(b.messages[b.messages.length - 1].sendDate) : 0;
    return bDate - aDate;
  });

  return threads;
}

// ======================================================================
// Zoom API
// ======================================================================
function getZoomAccessToken_() {
  let accountId = getSetting_('ZOOM_ACCOUNT_ID');
  let clientId = getSetting_('ZOOM_CLIENT_ID');
  let clientSecret = getSetting_('ZOOM_CLIENT_SECRET');

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom API の設定が不足しています。「設定」シートに ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET を入力してください。');
  }

  let credentials = Utilities.base64Encode(clientId + ':' + clientSecret);
  let response = UrlFetchApp.fetch('https://zoom.us/oauth/token', {
    method: 'post',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: 'grant_type=account_credentials&account_id=' + accountId,
    muteHttpExceptions: true
  });

  let result = JSON.parse(response.getContentText());
  if (result.access_token) return result.access_token;
  throw new Error('Zoom認証エラー: ' + (result.reason || response.getContentText()));
}

function createZoomMeeting(title, startTime, durationMinutes) {
  let token = getZoomAccessToken_();
  let startISO = Utilities.formatDate(new Date(startTime), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");

  let response = UrlFetchApp.fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      topic: title, type: 2, start_time: startISO,
      duration: durationMinutes || 60, timezone: 'Asia/Tokyo',
      settings: { join_before_host: true, waiting_room: false, auto_recording: 'none' }
    }),
    muteHttpExceptions: true
  });

  let result = JSON.parse(response.getContentText());
  if (result.join_url) return { joinUrl: result.join_url, meetingId: String(result.id) };
  throw new Error('Zoom会議作成エラー: ' + (result.message || response.getContentText()));
}

// ======================================================================
// Google Meet カレンダー予定作成
// ======================================================================
/**
 * Google Calendar + Google Meet イベント作成
 * Calendar Advanced Service (Events.insert) でイベントと Meet を同時作成する。
 * conferenceDataVersion: 1 を指定することで、Google Meet が自動発行される。
 */
function createGoogleMeetEvent(title, startTime, description, durationMinutes) {
  let start = new Date(startTime);
  let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
  let end = new Date(start.getTime() + dur * 60 * 1000);
  let apiCalId = getApiCalendarId_();

  // アプリURLをdescriptionに追記
  let appUrl = ScriptApp.getService().getUrl();
  let descWithApp = (description || '') + (appUrl ? '\n\nタダサポ管理: ' + appUrl : '');

  // Calendar Advanced Service で直接イベント+Meet を作成
  let eventResource = {
    summary: title,
    description: descWithApp,
    start: {
      dateTime: Utilities.formatDate(start, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: Utilities.formatDate(end, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"),
      timeZone: 'Asia/Tokyo'
    },
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  };

  try {
    let created = Calendar.Events.insert(eventResource, apiCalId, { conferenceDataVersion: 1 });
    let meetUrl = '';
    if (created.conferenceData && created.conferenceData.entryPoints) {
      let videoEntry = created.conferenceData.entryPoints.find(function(ep) { return ep.entryPointType === 'video'; });
      if (videoEntry) meetUrl = videoEntry.uri;
    }
    if (meetUrl) {
      // descriptionにもMeet URLを記載（カレンダーの説明欄からもアクセス可能に）
      Calendar.Events.patch({
        description: 'Google Meet URL: ' + meetUrl + '\n\n' + (description || '') + (appUrl ? '\n\nタダサポ管理: ' + appUrl : '')
      }, apiCalId, created.id);
      console.log('Google Meet作成成功: ' + meetUrl + ' eventId=' + created.id);
    } else {
      console.warn('conferenceData.entryPoints にvideoが見つかりません eventId=' + created.id);
    }
    return { meetUrl: meetUrl, eventId: created.id };
  } catch(e) {
    console.error('Calendar Events.insert エラー: ' + e.message + ' (apiCalId=' + apiCalId + ')');
    // フォールバック: CalendarApp でイベントだけ作成（Meetなし）
    try {
      let sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
      let cal = (sharedCalId && sharedCalId !== 'primary') ? CalendarApp.getCalendarById(sharedCalId) : null;
      if (!cal) cal = CalendarApp.getDefaultCalendar();
      let fallback = cal.createEvent(title, start, end, { description: descWithApp });
      console.log('フォールバック: CalendarAppでイベント作成 eventId=' + fallback.getId());
      return { meetUrl: '', eventId: fallback.getId() };
    } catch(e2) {
      console.error('CalendarApp フォールバックも失敗: ' + e2.message);
      return { meetUrl: '', eventId: '' };
    }
  }
}

// ======================================================================
// 日程の確定・変更：空き状況取得 ＆ 重複検知（v1.11.7）
// ======================================================================
/**
 * 2つの時間帯が重なるか判定する（端点接触は重なり扱いにしない）
 * pure: テスト容易。境界値: aEnd === bStart の場合は false
 */
function eventsOverlap_(aStart, aEnd, bStart, bEnd) {
  let as = (aStart instanceof Date) ? aStart.getTime() : new Date(aStart).getTime();
  let ae = (aEnd instanceof Date) ? aEnd.getTime() : new Date(aEnd).getTime();
  let bs = (bStart instanceof Date) ? bStart.getTime() : new Date(bStart).getTime();
  let be = (bEnd instanceof Date) ? bEnd.getTime() : new Date(bEnd).getTime();
  return as < be && ae > bs;
}

/**
 * 開始時刻と継続分から「バッファ込み占有時間帯」を返す。pure。
 * 戻り値: { start: Date, end: Date }
 */
function computeBufferedWindow_(start, durationMin, bufferMin) {
  let s = (start instanceof Date) ? new Date(start.getTime()) : new Date(start);
  let dur = Math.max(0, Number(durationMin) || 0);
  let buf = Math.max(0, Number(bufferMin) || 0);
  let plain = new Date(s.getTime() + dur * 60000);
  return {
    start: new Date(s.getTime() - buf * 60000),
    end: new Date(plain.getTime() + buf * 60000),
    plainStart: s,
    plainEnd: plain
  };
}

/**
 * 期間内のチームカレンダー＋表示専用カレンダーのイベントを返す。
 * 日程確定モーダル内のカレンダーUI（Phase3）で利用。
 * @param {string} rangeStartIso ISO日時
 * @param {string} rangeEndIso   ISO日時
 * @returns {{events: Array, settings: {bufferMin: number, teamCalendarId: string, displayCalendars: Array}}}
 */
function getScheduleAvailability(rangeStartIso, rangeEndIso) {
  ensureAdminSchema_();
  let start = rangeStartIso ? new Date(rangeStartIso) : new Date();
  let end = rangeEndIso ? new Date(rangeEndIso) : new Date(start.getTime() + 30 * 24 * 3600 * 1000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('期間の指定が不正です。');
  }

  let teamId = getTeamCalendarId_();
  let displays = getDisplayCalendars_();
  let bufferMin = getScheduleBufferMin_();

  let result = { events: [], errors: [], settings: { bufferMin: bufferMin, teamCalendarId: teamId, displayCalendars: displays } };

  let fetchFrom = function(calendarId, label, isEditable) {
    if (!calendarId) return [];
    let cal;
    try { cal = CalendarApp.getCalendarById(calendarId); } catch (e) { cal = null; }
    if (!cal) {
      result.errors.push((label || calendarId) + ' にアクセスできませんでした');
      return [];
    }
    let events;
    try { events = cal.getEvents(start, end); } catch (e) {
      result.errors.push((label || calendarId) + ' のイベント取得に失敗しました');
      return [];
    }
    let mapped = [];
    for (let i = 0; i < events.length; i++) {
      let ev = events[i];
      mapped.push({
        id: ev.getId(),
        calendarId: calendarId,
        calendarName: label || calendarId,
        title: ev.getTitle() || '(無題)',
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        isEditable: !!isEditable
      });
    }
    return mapped;
  };

  if (teamId) result.events.push.apply(result.events, fetchFrom(teamId, 'チームカレンダー', true));
  for (let i = 0; i < displays.length; i++) {
    result.events.push.apply(result.events, fetchFrom(displays[i].id, displays[i].name, false));
  }
  return result;
}

/**
 * 指定日時帯がチーム＋表示専用カレンダーと重複していないか判定する。
 * バッファ込みで判定し、重複があれば一覧を返す。
 * @param {string} startIso             希望開始時刻（ISO）
 * @param {number} durationMin          希望継続時間（分）
 * @param {string} [excludeEventId]     除外したいイベントID（編集中の自分自身）
 * @returns {{hasConflict: boolean, conflicts: Array, bufferMin: number}}
 */
function checkScheduleConflict(startIso, durationMin, excludeEventId) {
  if (!startIso) throw new Error('開始日時が必要です。');
  let bufferMin = getScheduleBufferMin_();
  let win = computeBufferedWindow_(new Date(startIso), durationMin, bufferMin);
  if (isNaN(win.start.getTime()) || isNaN(win.end.getTime())) {
    throw new Error('日時のパースに失敗しました。');
  }

  let teamId = getTeamCalendarId_();
  let displays = getDisplayCalendars_();
  let allCals = [];
  if (teamId) allCals.push({ id: teamId, name: 'チームカレンダー' });
  for (let i = 0; i < displays.length; i++) allCals.push({ id: displays[i].id, name: displays[i].name });

  let exclude = String(excludeEventId || '');
  let conflicts = [];

  for (let c = 0; c < allCals.length; c++) {
    let cal;
    try { cal = CalendarApp.getCalendarById(allCals[c].id); } catch (e) { cal = null; }
    if (!cal) continue;
    let events;
    try { events = cal.getEvents(win.start, win.end); } catch (e) { continue; }
    for (let i = 0; i < events.length; i++) {
      let ev = events[i];
      if (exclude && ev.getId() === exclude) continue;
      let evWin = computeBufferedWindow_(ev.getStartTime(), Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60000), bufferMin);
      if (eventsOverlap_(win.start, win.end, evWin.start, evWin.end)) {
        conflicts.push({
          calendarName: allCals[c].name,
          title: ev.getTitle() || '(無題)',
          start: ev.getStartTime().toISOString(),
          end: ev.getEndTime().toISOString()
        });
      }
    }
  }

  return { hasConflict: conflicts.length > 0, conflicts: conflicts, bufferMin: bufferMin };
}

/**
 * チームカレンダー（TEAM_CALENDAR_ID）にイベントを作成する。
 * v1.11.8: method=Zoom 時の強制登録に使用。フォールバックで SHARED_CALENDAR_ID 経由。
 * @returns {{eventId: string|null, calendarId: string|null}}
 */
function createTeamCalendarEvent_(title, startTime, durationMinutes, description) {
  let teamId = getTeamCalendarId_();
  if (!teamId) {
    console.warn('TEAM_CALENDAR_ID 未設定のためチームカレンダー登録をスキップ');
    return { eventId: null, calendarId: null };
  }
  let cal;
  try { cal = CalendarApp.getCalendarById(teamId); } catch (e) { cal = null; }
  if (!cal) {
    console.error('チームカレンダーにアクセスできません: ' + teamId);
    return { eventId: null, calendarId: null };
  }
  let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
  let start = new Date(startTime);
  let end = new Date(start.getTime() + dur * 60 * 1000);
  try {
    let event = cal.createEvent(title, start, end, { description: String(description || '') });
    return { eventId: event.getId(), calendarId: teamId };
  } catch (e) {
    console.error('チームカレンダーイベント作成失敗: ' + e.message);
    return { eventId: null, calendarId: null };
  }
}

/**
 * 重複検知のエラーメッセージを組み立てる
 */
function formatScheduleConflictMessage_(conflictResult) {
  let lines = conflictResult.conflicts.map(function(c) {
    let s = new Date(c.start);
    let e = new Date(c.end);
    let m = (s.getMonth() + 1);
    let d = s.getDate();
    let hh = String(s.getHours()).padStart(2, '0');
    let mm = String(s.getMinutes()).padStart(2, '0');
    let eh = String(e.getHours()).padStart(2, '0');
    let em = String(e.getMinutes()).padStart(2, '0');
    return '・[' + c.calendarName + '] ' + c.title + '（' + m + '/' + d + ' ' + hh + ':' + mm + '〜' + eh + ':' + em + '）';
  });
  return 'スケジュール重複：以下の予定と被っています（前後' + conflictResult.bufferMin + '分のバッファを含む）。\n' + lines.join('\n');
}

// ======================================================================
// 既存カレンダーイベントの日時を更新
// ======================================================================
function getApiCalendarId_() {
  let sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
  return (sharedCalId && sharedCalId !== 'primary') ? sharedCalId : 'primary';
}

function updateCalendarEventDateTime_(eventId, newStartTime, durationMinutes) {
  if (!eventId) return;
  try {
    let apiCalId = getApiCalendarId_();
    let cleanId = String(eventId).replace('@google.com', '');
    let start = new Date(newStartTime);
    let dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
    let end = new Date(start.getTime() + dur * 60 * 1000);
    Calendar.Events.patch({
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() }
    }, apiCalId, cleanId);
    console.log('カレンダーイベント日時更新成功: eventId=' + cleanId);
  } catch(e) {
    console.error('カレンダーイベント日時更新エラー: ' + e.message + ' (eventId=' + eventId + ')');
  }
}

// ======================================================================
// 既存カレンダーイベントのdescriptionを更新
// ======================================================================
function updateCalendarEventDescription_(eventId, newDescription) {
  if (!eventId) return;
  try {
    let apiCalId = getApiCalendarId_();
    let cleanId = String(eventId).replace('@google.com', '');
    Calendar.Events.patch({ description: newDescription }, apiCalId, cleanId);
    console.log('カレンダーイベント説明更新成功: eventId=' + cleanId);
  } catch(e) {
    console.error('カレンダーイベント説明更新エラー: ' + e.message + ' (eventId=' + eventId + ')');
  }
}

function parseJsonArray_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    let parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function buildKeepAttachmentIdMap_(keepAttachmentIds) {
  let map = {};
  (keepAttachmentIds || []).forEach(function(id) {
    let key = String(id || '').trim();
    if (key) map[key] = true;
  });
  return map;
}

function getAttachmentFolder_() {
  let folderId = getSetting_('ATTACHMENT_FOLDER_ID', '');
  if (!folderId) throw new Error('添付ファイル保存先が未設定です。設定シートの ATTACHMENT_FOLDER_ID を入力してください。');
  try {
    return DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('ATTACHMENT_FOLDER_ID が無効です。設定シートを確認してください。');
  }
}

function saveNewAttachments_(caseId, user, newAttachments) {
  let files = newAttachments || [];
  if (!files.length) return [];

  let folder = getAttachmentFolder_();
  let uploaded = [];
  for (let i = 0; i < files.length; i++) {
    let f = files[i] || {};
    let fileName = String(f.name || ('attachment_' + (i + 1)));
    let mimeType = String(f.mimeType || 'application/octet-stream');
    let base64Data = String(f.base64Data || '');
    if (!base64Data) continue;

    let blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    let file = folder.createFile(blob);
    uploaded.push({
      fileId: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      mimeType: mimeType,
      size: Number(f.size) || file.getSize() || 0,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user && user.email ? user.email : ''
    });
  }
  return uploaded;
}

function trashRemovedAttachments_(existingAttachments, keepIdMap) {
  (existingAttachments || []).forEach(function(att) {
    let fileId = String(att && att.fileId ? att.fileId : '');
    if (!fileId || keepIdMap[fileId]) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (e) {
      // 既に削除済み・権限なしは無視して更新を継続
    }
  });
}

// ======================================================================
// サポート記録の更新（方法別: Meet / Zoom / その他）
// ======================================================================
function updateSupportRecord(recordData) {
  let actor = getActor_();
  ensureCaseEditableByActor_(recordData.timestamp, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(recordData.timestamp)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    // 管理者が unhandled 案件の日時を設定する場合など、レコード行が未作成のケースに対応
    if (!actor.isAdmin) throw new Error('レコードが見つかりません ID: ' + recordData.timestamp);
    rowIndex = ensureRecordRowForCase_(sheet, recordData.timestamp);
    // 行を新規作成したので data を再取得
    data = sheet.getDataRange().getValues();
  }

  let before = {
    status: data[rowIndex - 1][IDX.RECORDS.STATUS],
    scheduledDateTime: data[rowIndex - 1][IDX.RECORDS.DATE],
    method: data[rowIndex - 1][IDX.RECORDS.METHOD],
    content: data[rowIndex - 1][IDX.RECORDS.CONTENT]
  };

  let currentMeetUrl = data[rowIndex - 1][IDX.RECORDS.MEET_URL];
  let currentAttachments = parseJsonArray_(data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS]);
  let eventTitle = '【タダサポ】' + recordData.officeName + ' 様';

  // サーバー生成データを追跡
  let newMeetUrl = null;
  let newEventId = null;

  let currentEventId = data[rowIndex - 1][IDX.RECORDS.EVENT_ID];

  // v1.11.9-r2: 重複検知は方法=Zoom 時のみ実行（Zoom以外はチェックなし）
  // skipConflictCheck=true でバイパス可能。
  let needsConflictCheck = recordData.scheduledDateTime && !currentMeetUrl && recordData.method === 'Zoom';
  if (needsConflictCheck && !recordData.skipConflictCheck) {
    let confDur = (recordData.duration && Number(recordData.duration) > 0) ? Number(recordData.duration) : 60;
    let conflictResult = checkScheduleConflict(recordData.scheduledDateTime, confDur, currentEventId || null);
    if (conflictResult.hasConflict) {
      throw new Error(formatScheduleConflictMessage_(conflictResult));
    }
  }

  if (recordData.scheduledDateTime && !currentMeetUrl) {
    if (recordData.method === 'Zoom') {
      // v1.11.8: チームカレンダーへ強制登録 + 個人カレンダーは useCalendar に従う
      // v1.12.0: zoomMode = 'new'（既定 / 新規発行）または 'fixed'（固定ZoomID使用）
      let zDur = (recordData.duration && Number(recordData.duration) > 0) ? Number(recordData.duration) : 60;
      let zStart = new Date(recordData.scheduledDateTime);
      let appUrl = ScriptApp.getService().getUrl() || '';
      let zoomMode = String(recordData.zoomMode || 'new').toLowerCase();

      if (zoomMode === 'fixed') {
        // 固定Zoom: ZOOM_FIXED_URL を使用（API 呼び出しなし）
        let fixedUrl = String(getSetting_('ZOOM_FIXED_URL', '') || '').trim();
        let fixedId = String(getSetting_('ZOOM_FIXED_ID', '') || '').trim();
        let fixedPass = String(getSetting_('ZOOM_FIXED_PASS', '') || '').trim();
        if (fixedUrl) {
          newMeetUrl = fixedUrl;
        } else {
          throw new Error('「いつものタダスクID」が設定されていません。設定シートの ZOOM_FIXED_URL を入力するか、新規発行モードに切替えてください。');
        }
        // ID/PASS は description に追記
        var fixedExtra = [];
        if (fixedId) fixedExtra.push('ID: ' + fixedId);
        if (fixedPass) fixedExtra.push('PASS: ' + fixedPass);
        var fixedSuffix = fixedExtra.length ? '（' + fixedExtra.join(' / ') + '）' : '';
        var fixedHeader = '【いつものタダスクID】 ' + fixedUrl + fixedSuffix + '\n\n';
        // zDesc は下で組み立てるので、ここで先行ヘッダだけ保持
        var zoomLeadingDesc = fixedHeader;
      } else {
        // 新規発行: 既存ロジック維持
        try {
          let zoomResult = createZoomMeeting(eventTitle, recordData.scheduledDateTime, zDur);
          newMeetUrl = zoomResult.joinUrl;
        } catch(e) { console.error('Zoom会議作成エラー（カレンダーのみ作成します）: ' + e.message); }
        var zoomLeadingDesc = newMeetUrl ? 'Zoom URL: ' + newMeetUrl + '\n\n' : '';
      }

      let zDesc = zoomLeadingDesc +
                  (recordData.details || '') +
                  (appUrl ? '\n\nタダサポ管理: ' + appUrl : '');

      // チームカレンダーへ強制登録（重複防止のため必須）
      let teamEvent = createTeamCalendarEvent_(eventTitle, zStart, zDur, zDesc);
      if (teamEvent.eventId) {
        newEventId = teamEvent.eventId;
      } else {
        // チームカレンダー未設定/アクセス不可時は SHARED_CALENDAR_ID にフォールバック
        try {
          let zSharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
          let zCalFb = (zSharedCalId && zSharedCalId !== 'primary') ? CalendarApp.getCalendarById(zSharedCalId) : null;
          if (!zCalFb) zCalFb = CalendarApp.getDefaultCalendar();
          let zEnd = new Date(zStart.getTime() + zDur * 60 * 1000);
          let zEvent = zCalFb.createEvent(eventTitle, zStart, zEnd, { description: zDesc });
          newEventId = zEvent.getId();
        } catch(e) { console.error('Zoom用フォールバックカレンダー作成エラー: ' + e.message); }
      }

      // useCalendar=true の場合、個人/共有カレンダー（SHARED_CALENDAR_ID）にも追加登録
      // ただし TEAM_CALENDAR_ID と同一の場合は二重登録を避けるためスキップ
      if (!recordData.skipCalendar) {
        try {
          let teamId = getTeamCalendarId_();
          let zSharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
          let zCal = (zSharedCalId && zSharedCalId !== 'primary') ? CalendarApp.getCalendarById(zSharedCalId) : null;
          if (!zCal) zCal = CalendarApp.getDefaultCalendar();
          let personalCalId = zCal ? zCal.getId() : '';
          if (zCal && personalCalId && personalCalId !== teamId) {
            let zEnd = new Date(zStart.getTime() + zDur * 60 * 1000);
            zCal.createEvent(eventTitle, zStart, zEnd, { description: zDesc });
            // eventId はチーム側を維持（更新時の追跡対象）
          }
        } catch(e) { console.error('個人カレンダー登録エラー: ' + e.message); }
      }
    } else if (recordData.method === 'GoogleMeet' && !recordData.skipCalendar) {
      try {
        let meetResult = createGoogleMeetEvent(eventTitle, recordData.scheduledDateTime, recordData.details, recordData.duration);
        newEventId = meetResult.eventId;
        newMeetUrl = meetResult.meetUrl;
      } catch(e) { console.error('Google Meet作成エラー: ' + e.message); }
    }
  } else if (recordData.scheduledDateTime && currentEventId && !recordData.skipCalendar) {
    // 既存カレンダーイベントの日時を更新
    updateCalendarEventDateTime_(currentEventId, recordData.scheduledDateTime, recordData.duration);
  }

  // 添付ファイル処理（バッチ書き込みの前に解決）
  let finalAttachments = null;
  let attachmentsValue = data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS];
  let hasAttachmentUpdate = recordData.keepAttachmentIds !== undefined || recordData.newAttachments !== undefined;
  if (hasAttachmentUpdate) {
    let keepIds = Array.isArray(recordData.keepAttachmentIds)
      ? recordData.keepAttachmentIds
      : currentAttachments.map(function(a) { return a.fileId; });
    let keepIdMap = buildKeepAttachmentIdMap_(keepIds);
    let keptAttachments = currentAttachments.filter(function(a) {
      return !!(a && a.fileId && keepIdMap[String(a.fileId)]);
    });
    let uploadedAttachments = saveNewAttachments_(recordData.timestamp, recordData.user || null, recordData.newAttachments || []);
    let mergedAttachments = keptAttachments.concat(uploadedAttachments);

    if (mergedAttachments.length > 5) {
      throw new Error('添付ファイルは1回の報告につき最大5件です。');
    }

    trashRemovedAttachments_(currentAttachments, keepIdMap);
    attachmentsValue = JSON.stringify(mergedAttachments);
    finalAttachments = mergedAttachments;
  }

  // STATUS(1)～TOOLS(17) を一括書き込み（既存値を保持しつつ変更箇所を上書き）
  let curRow = data[rowIndex - 1];
  let batchRow = [
    recordData.status,                                                          // STATUS(1)
    curRow[IDX.RECORDS.STAFF_EMAIL],                                            // STAFF_EMAIL(2)
    curRow[IDX.RECORDS.STAFF_NAME],                                             // STAFF_NAME(3)
    recordData.scheduledDateTime ? new Date(recordData.scheduledDateTime) : null, // DATE(4)
    curRow[IDX.RECORDS.COUNT],                                                  // COUNT(5)
    recordData.method,                                                          // METHOD(6)
    curRow[IDX.RECORDS.BUSINESS],                                               // BUSINESS(7)
    sanitizeForSheet_(recordData.content),                                      // CONTENT(8)
    curRow[IDX.RECORDS.REMARKS],                                                // REMARKS(9)
    curRow[IDX.RECORDS.HISTORY],                                                // HISTORY(10)
    newEventId || curRow[IDX.RECORDS.EVENT_ID],                                 // EVENT_ID(11)
    newMeetUrl || curRow[IDX.RECORDS.MEET_URL],                                 // MEET_URL(12)
    curRow[IDX.RECORDS.THREAD_ID],                                              // THREAD_ID(13)
    attachmentsValue,                                                           // ATTACHMENTS(14)
    curRow[IDX.RECORDS.CASE_LIMIT_OVERRIDE],                                    // CASE_LIMIT_OVERRIDE(15)
    curRow[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE],                                  // ANNUAL_LIMIT_OVERRIDE(16)
    recordData.tools !== undefined ? (Array.isArray(recordData.tools) ? JSON.stringify(recordData.tools) : '[]') : curRow[IDX.RECORDS.TOOLS]  // TOOLS(17)
  ];
  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1, 1, batchRow.length).setValues([batchRow]);

  // ── 都道府県・サービス種別の案件情報更新（完了報告時など） ──
  let hasCaseInfoUpdate = (recordData.prefecture !== undefined && recordData.prefecture !== null) ||
                          (recordData.serviceType !== undefined && recordData.serviceType !== null);
  if (hasCaseInfoUpdate) {
    let caseId = recordData.timestamp;
    let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
    let caseRowIdx = getCaseRowIndex_(caseSheet, caseId);
    let isManual = false;
    let manualSh = null;
    let manualRowIdx = -1;
    if (caseRowIdx === -1) {
      manualSh = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
      if (manualSh) manualRowIdx = getCaseRowIndex_(manualSh, caseId);
      if (manualRowIdx !== -1) isManual = true;
    }
    if (isManual && manualSh) {
      // 手動案件: CASES_MANUAL シートに直接書き込み
      if (recordData.prefecture !== undefined && recordData.prefecture !== null) {
        manualSh.getRange(manualRowIdx, IDX.CASES.PREFECTURE + 1).setValue(sanitizeForSheet_(String(recordData.prefecture).trim()));
      }
      if (recordData.serviceType !== undefined && recordData.serviceType !== null) {
        manualSh.getRange(manualRowIdx, IDX.CASES.SERVICE + 1).setValue(sanitizeForSheet_(String(recordData.serviceType).trim()));
      }
    } else if (caseRowIdx !== -1) {
      // 通常案件: 案件補正シートに書き込み
      let ovrSheet = ensureCasesOverrideSheet_(ss);
      let ovrRowIdx = getOrCreateOverrideRowIndex_(ovrSheet, caseId);
      if (recordData.prefecture !== undefined && recordData.prefecture !== null) {
        ovrSheet.getRange(ovrRowIdx, IDX.CASES_OVERRIDE.PREFECTURE + 1).setValue(sanitizeForSheet_(String(recordData.prefecture).trim()));
      }
      if (recordData.serviceType !== undefined && recordData.serviceType !== null) {
        ovrSheet.getRange(ovrRowIdx, IDX.CASES_OVERRIDE.SERVICE + 1).setValue(sanitizeForSheet_(String(recordData.serviceType).trim()));
      }
    }
  }

  appendAuditLog_(actor, 'update_support_record', 'case', recordData.timestamp, before, {
    status: recordData.status,
    scheduledDateTime: recordData.scheduledDateTime || null,
    method: recordData.method || null
  });
  return { meetUrl: newMeetUrl, eventId: newEventId, attachments: finalAttachments };
}

// ======================================================================
// マスタデータ
// ======================================================================
function getStaffByEmail(email) {
  let normalized = normalizeEmail_(email);
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  let data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    let staffEmail = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    let isActive = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (isActive && staffEmail === normalized) {
      return { name: data[i][IDX.STAFF.NAME], email: normalized };
    }
  }
  return null;
}

function getMasters() {
  let zoomEnabled = !!getSetting_('ZOOM_ACCOUNT_ID');
  let zoomFixedConfigured = !!getSetting_('ZOOM_FIXED_URL'); // v1.12.0: 固定ID使用可能フラグ
  let attachmentFolderConfigured = !!getSetting_('ATTACHMENT_FOLDER_ID');
  let methods = ['GoogleMeet', 'メール等', '電話等', '対面'];
  if (zoomEnabled) methods.splice(1, 0, 'Zoom');
  let allStaff = [];
  try {
    let ss = getSpreadsheet_();
    let staffSheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (staffSheet && staffSheet.getLastRow() > 1) {
      let rows = staffSheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        let em = normalizeEmail_(rows[i][IDX.STAFF.EMAIL]);
        if (!em) continue;
        let active = parseBoolean_(rows[i][IDX.STAFF.IS_ACTIVE], true);
        if (!active) continue;
        allStaff.push({
          name: String(rows[i][IDX.STAFF.NAME] || ''),
          email: em,
          role: String(rows[i][IDX.STAFF.ROLE] || 'staff').toLowerCase()
        });
      }
    }
  } catch (e) {
    allStaff = [];
  }

  return {
    methods: methods,
    businessTypes: ['訪問介護', '通所介護', '居宅介護支援', '福祉用具貸与', '小規模多機能', '有料老人ホーム', 'その他'],
    prefectures: [
      '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
      '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
      '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
      '静岡県', '愛知県', '三重県',
      '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
      '鳥取県', '島根県', '岡山県', '広島県', '山口県',
      '徳島県', '香川県', '愛媛県', '高知県',
      '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
      'その他'
    ],
    allStaff: allStaff,
    spreadsheetUrl: getSpreadsheet_().getUrl(),
    limits: {
      annual: getAnnualUsageLimit_(),
      caseSupport: getCaseUsageLimit_()
    },
    attachmentFolderConfigured: attachmentFolderConfigured,
    zoomFixedConfigured: zoomFixedConfigured,
    supportTools: (function() {
      let raw = getSetting_('SUPPORT_TOOLS', '');
      if (!raw) return null; // nullのときフロントエンドでデフォルトにフォールバック
      return raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    })(),
    toolMonthlyLimits: (function() {
      let raw = getSetting_('TOOL_MONTHLY_LIMITS', '');
      if (!raw) return {};
      let result = {};
      raw.split(',').forEach(function(pair) {
        let parts = pair.split(':');
        if (parts.length === 2) {
          let name = parts[0].trim();
          let limit = parseInt(parts[1].trim(), 10);
          if (name && !isNaN(limit) && limit > 0) result[name] = limit;
        }
      });
      return result;
    })(),
    emailTemplates: {
      initialSubject: getSetting_('MAIL_INITIAL_SUBJECT', 'タダサポ｜ご相談を承りました'),
      initialBody: getSetting_('MAIL_INITIAL_BODY', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\n以下の内容で受付いたしました。\n\n----------------\n【ご相談内容】\n{{相談内容}}\n----------------\n\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。'),
      includeDetails: getSetting_('MAIL_INITIAL_INCLUDE_DETAILS', 'true'),
      declinedSubject: getSetting_('MAIL_DECLINED_SUBJECT', 'タダサポ｜ご利用回数上限のお知らせ'),
      declinedBody: getSetting_('MAIL_DECLINED_BODY', '{{名前}} 様\n\nいつもタダサポをご利用いただきありがとうございます。\n\n誠に恐れ入りますが、{{事業所名}} 様の今年度のご利用回数が上限（10回）に達しております。\nそのため、今回のご相談につきましては対応を見送らせていただくこととなりました。\n\n大変申し訳ございませんが、何卒ご理解くださいますようお願い申し上げます。\n次年度のご利用をお待ちしております。'),
      newSubject: getSetting_('MAIL_NEW_SUBJECT', ''),
      newBody: getSetting_('MAIL_NEW_BODY', '{{名前}} 様\n\n\n\n{{担当者名}}'),
      scheduleSubject: getSetting_('MAIL_SCHEDULE_SUBJECT', 'タダサポ｜サポート日程のご連絡'),
      scheduleBody: getSetting_('MAIL_SCHEDULE_BODY', '{{名前}} 様\n\nいつもお世話になっており���す。\nタダサポ担当���{{担当者名}}です。\n\nサポ��ト日程が決まり��したのでご連絡いたしま���。\n\n----------------\n【���ポート日程】\n日時：{{日程}}\n方法：{{対応方法}}\n{{URL}}\n----------------\n\n当日はどうぞよろしくお願いいたします。\nご不明な点がございましたらお気軽にご連絡ください。')
    }
  };
}

function getEditableSettingsKeys_() {
  return [
    'MAIL_FORCE_CC',
    'ANNUAL_USAGE_LIMIT',
    'CASE_USAGE_LIMIT',
    'MAIL_INITIAL_SUBJECT',
    'MAIL_INITIAL_BODY',
    'MAIL_INITIAL_INCLUDE_DETAILS',
    'MAIL_DECLINED_SUBJECT',
    'MAIL_DECLINED_BODY',
    'MAIL_NEW_SUBJECT',
    'MAIL_NEW_BODY',
    'MAIL_SCHEDULE_SUBJECT',
    'MAIL_SCHEDULE_BODY',
    'SHARED_CALENDAR_ID',
    'ATTACHMENT_FOLDER_ID',
    'ZOOM_ACCOUNT_ID',
    'ZOOM_CLIENT_ID',
    'ZOOM_CLIENT_SECRET',
    'ZOOM_FIXED_URL',
    'ZOOM_FIXED_ID',
    'ZOOM_FIXED_PASS',
    'TEAM_CALENDAR_ID',
    'DISPLAY_CALENDARS_JSON',
    'SCHEDULE_BUFFER_MIN',
    'SUPPORT_TOOLS',
    'TOOL_MONTHLY_LIMITS'
  ];
}

function ensureStaffAdminSchema_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet) return;
  let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  let roleHeader = String(headers[IDX.STAFF.ROLE] || '').trim();
  let activeHeader = String(headers[IDX.STAFF.IS_ACTIVE] || '').trim();

  if (sheet.getLastColumn() < 5) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), 5 - sheet.getLastColumn());
  }
  if (!roleHeader) sheet.getRange(1, IDX.STAFF.ROLE + 1).setValue('ROLE');
  if (!activeHeader) sheet.getRange(1, IDX.STAFF.IS_ACTIVE + 1).setValue('IS_ACTIVE');

  if (sheet.getLastRow() > 1) {
    let roleRange = sheet.getRange(2, IDX.STAFF.ROLE + 1, sheet.getLastRow() - 1, 1);
    let activeRange = sheet.getRange(2, IDX.STAFF.IS_ACTIVE + 1, sheet.getLastRow() - 1, 1);
    let roleValues = roleRange.getValues();
    let activeValues = activeRange.getValues();
    for (let i = 0; i < roleValues.length; i++) {
      if (!String(roleValues[i][0] || '').trim()) roleValues[i][0] = 'staff';
      if (String(activeValues[i][0] || '').trim() === '') activeValues[i][0] = 'true';
    }
    roleRange.setValues(roleValues);
    activeRange.setValues(activeValues);
  }
}

function migrateAdminEmailsToStaffRoles_() {
  let adminMap = {};
  getAdminEmails_().forEach(function(e) { adminMap[normalizeEmail_(e)] = true; });
  if (!Object.keys(adminMap).length) return;

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return;
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    if (!em) continue;
    if (adminMap[em]) {
      sheet.getRange(i + 1, IDX.STAFF.ROLE + 1).setValue('admin');
    }
  }
}

function ensureAdminSchema_() {
  // CacheService でスキーマ確認済みならスキップ
  try {
    if (CacheService.getScriptCache().get('schema_v') === SCHEMA_VERSION_) return;
  } catch (e) { /* フォールスルー */ }
  ensureStaffAdminSchema_();
  migrateAdminEmailsToStaffRoles_();
  getOrCreateAuditLogSheet_();
}

function listStaffMembers_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  let data = sheet.getDataRange().getValues();
  let out = [];
  for (let i = 1; i < data.length; i++) {
    let em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    if (!em) continue;
    out.push({
      rowIndex: i + 1,
      name: String(data[i][IDX.STAFF.NAME] || ''),
      email: em,
      role: String(data[i][IDX.STAFF.ROLE] || 'staff').trim().toLowerCase() || 'staff',
      isActive: parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true)
    });
  }
  return out;
}

function getAdminPanelData() {
  requireAdmin_();
  ensureAdminSchema_();

  let settings = loadSettings_();
  let allowed = getEditableSettingsKeys_();
  let filteredSettings = {};
  for (let i = 0; i < allowed.length; i++) {
    filteredSettings[allowed[i]] = settings[allowed[i]] || '';
  }

  let auditSheet = getOrCreateAuditLogSheet_();
  let logs = [];
  if (auditSheet.getLastRow() > 1) {
    let data = auditSheet.getRange(2, 1, Math.min(100, auditSheet.getLastRow() - 1), 8).getValues();
    for (let j = 0; j < data.length; j++) {
      logs.push({
        timestamp: data[j][0] ? new Date(data[j][0]).toISOString() : null,
        actorEmail: String(data[j][1] || ''),
        actorName: String(data[j][2] || ''),
        action: String(data[j][3] || ''),
        targetType: String(data[j][4] || ''),
        targetId: String(data[j][5] || '')
      });
    }
    logs.reverse();
  }

  return {
    staffMembers: listStaffMembers_(),
    settings: filteredSettings,
    auditLogs: logs
  };
}

function upsertStaffMember(payload) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  if (!payload) throw new Error('payload が必要です。');

  let email = normalizeEmail_(payload.email);
  let name = String(payload.name || '').trim();
  let role = String(payload.role || 'staff').trim().toLowerCase();
  let hasIsActive = Object.prototype.hasOwnProperty.call(payload, 'isActive');
  let isActive = hasIsActive ? parseBoolean_(payload.isActive, true) : null;

  if (!email) throw new Error('メールアドレスは必須です。');
  if (role !== 'admin' && role !== 'staff') throw new Error('role は admin または staff を指定してください。');

  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet) throw new Error('スタッフシートが見つかりません。');
    let data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let before = null;
    for (let i = 1; i < data.length; i++) {
      if (normalizeEmail_(data[i][IDX.STAFF.EMAIL]) === email) {
        rowIndex = i + 1;
        before = {
          name: String(data[i][IDX.STAFF.NAME] || ''),
          email: email,
          role: String(data[i][IDX.STAFF.ROLE] || 'staff').toLowerCase(),
          isActive: parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true)
        };
        break;
      }
    }

    if (rowIndex === -1) {
      throw new Error('新規メンバー追加はできません。既存メンバーの権限のみ変更できます。');
    }

    if (!name) name = String(data[rowIndex - 1][IDX.STAFF.NAME] || '');
    if (!hasIsActive) {
      isActive = parseBoolean_(data[rowIndex - 1][IDX.STAFF.IS_ACTIVE], true);
    }
    sheet.getRange(rowIndex, IDX.STAFF.ROLE + 1).setValue(role);
    sheet.getRange(rowIndex, IDX.STAFF.IS_ACTIVE + 1).setValue(String(isActive));
    _settingsCache = null;
    appendAuditLog_(actor, 'upsert_staff', 'staff', email, before, {
      name: name,
      email: email,
      role: role,
      isActive: isActive
    });
  } finally {
    lock.releaseLock();
  }

  return listStaffMembers_();
}

function deactivateStaffMember(email) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  let target = normalizeEmail_(email);
  if (!target) throw new Error('email が必要です。');

  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet || sheet.getLastRow() <= 1) return listStaffMembers_();
    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (normalizeEmail_(data[i][IDX.STAFF.EMAIL]) === target) {
        let before = {
          name: String(data[i][IDX.STAFF.NAME] || ''),
          email: target,
          role: String(data[i][IDX.STAFF.ROLE] || 'staff').toLowerCase(),
          isActive: parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true)
        };
        sheet.getRange(i + 1, IDX.STAFF.IS_ACTIVE + 1).setValue('false');
        appendAuditLog_(actor, 'deactivate_staff', 'staff', target, before, {
          name: before.name,
          email: target,
          role: before.role,
          isActive: false
        });
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
  return listStaffMembers_();
}

// 設定キーの日本語項目名マップ（appendRow フォールバック時に使用）
var SETTINGS_LABEL_MAP_ = {
  ANNUAL_USAGE_LIMIT:          '年度利用回数上限',
  CASE_USAGE_LIMIT:            '案件ごとの対応上限',
  MAIL_FORCE_CC:               '通常CCメールアドレス',
  MAIL_INITIAL_SUBJECT:        '初回メール件名',
  MAIL_INITIAL_BODY:           '初回メール本文',
  MAIL_INITIAL_INCLUDE_DETAILS:'初回メールに相談内容を含める',
  MAIL_NEW_BODY:               '新規メール本文テンプレート',
  MAIL_DECLINED_SUBJECT:       '回数超過メール件名',
  MAIL_DECLINED_BODY:          '回数超過メール本文',
  SHARED_CALENDAR_ID:          '共有カレンダーID',
  ATTACHMENT_FOLDER_ID:        '添付保存先フォルダID',
  ZOOM_ACCOUNT_ID:             'Zoom Account ID',
  ZOOM_CLIENT_ID:              'Zoom Client ID',
  ZOOM_CLIENT_SECRET:          'Zoom Client Secret',
  ZOOM_FIXED_URL:              '固定Zoom URL（いつものタダスクID）',
  ZOOM_FIXED_ID:               '固定Zoom ID',
  ZOOM_FIXED_PASS:             '固定Zoomパスコード',
  TEAM_CALENDAR_ID:            'チームカレンダーID（書込先）',
  DISPLAY_CALENDARS_JSON:      '表示専用カレンダー（JSON）',
  SCHEDULE_BUFFER_MIN:         '予約前後インターバル（分）',
  SUPPORT_TOOLS:               '対応ツール一覧'
};

function updateSettingsAdmin(patch) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  if (!patch || typeof patch !== 'object') throw new Error('patch が必要です。');

  let allowMap = {};
  getEditableSettingsKeys_().forEach(function(k) { allowMap[k] = true; });

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) throw new Error('設定シートが見つかりません。');
  let data = sheet.getDataRange().getValues();

  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let before = {};
    let after = {};
    Object.keys(patch).forEach(function(key) {
      if (!allowMap[key]) throw new Error('更新不可の設定キーです: ' + key);
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === key) {
          before[key] = String(data[i][2] || '');
          sheet.getRange(i + 1, 3).setValue(sanitizeForSheet_(String(patch[key] || '')));
          after[key] = String(patch[key] || '');
          found = true;
          break;
        }
      }
      if (!found) {
        // シートに行がない場合は末尾に追加して保存
        let newVal = sanitizeForSheet_(String(patch[key] || ''));
        let label = SETTINGS_LABEL_MAP_[key] || key;
        let newRow = sheet.getLastRow() + 1;
        sheet.appendRow([key, label, newVal, '', '']);
        // 他の設定行と同じ書式を適用
        sheet.getRange(newRow, 1).setFontColor('#9ca3af').setFontSize(8);
        sheet.getRange(newRow, 2).setFontWeight('bold').setFontColor('#1e293b');
        sheet.getRange(newRow, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
        sheet.setRowHeight(newRow, 40);
        before[key] = '';
        after[key] = newVal;
      }
    });
    _settingsCache = null;
    appendAuditLog_(actor, 'update_settings', 'settings', 'settings', before, after);
  } finally {
    lock.releaseLock();
  }

  let settings = loadSettings_();
  let out = {};
  getEditableSettingsKeys_().forEach(function(key) { out[key] = settings[key] || ''; });
  return out;
}

function reassignCaseAdmin(caseId, staffEmail) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  let targetEmail = normalizeEmail_(staffEmail);
  let isUnassign  = !targetEmail;

  let targetStaff = null;
  if (!isUnassign) {
    targetStaff = getStaffByEmail(targetEmail);
    if (!targetStaff) throw new Error('対象スタッフが見つかりません。');
  }

  let ss     = getSpreadsheet_();
  let sheet  = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let rowIndex = getCaseRecordRowIndex_(caseId);

  // ── 担当解除（staffEmail が空） ──────────────────────────
  if (isUnassign) {
    if (rowIndex === -1) return; // レコードなし = 元々 unhandled
    let currentRow = sheet.getRange(rowIndex, 1, 1, IDX.RECORDS.SUB_STAFF + 1).getValues()[0];
    let fromStatus = String(currentRow[IDX.RECORDS.STATUS] || 'unhandled');
    let before     = {
      status:     fromStatus,
      staffEmail: String(currentRow[IDX.RECORDS.STAFF_EMAIL] || ''),
      staffName:  String(currentRow[IDX.RECORDS.STAFF_NAME]  || '')
    };
    // adminTransitionStatus_ で → unhandled（全フィールドクリア）
    let result = adminTransitionStatus_(sheet, rowIndex, fromStatus, 'unhandled', actor);
    appendAuditLog_(actor, 'unassign_case', 'case', caseId, before, {
      status: result.status, staffEmail: result.staffEmail
    });
    return result;
  }

  // ── 担当者変更（staffEmail が非空） ──────────────────────
  if (rowIndex === -1) {
    // レコード行なし → 新規作成して inProgress にする（unhandled 案件へのアサイン）
    sheet.appendRow([
      caseId, 'inProgress', targetEmail, targetStaff.name,
      null, 1, null, null, null, null, '[]', null, null, null, '[]', '', '', '[]', '[]'
    ]);
    appendAuditLog_(actor, 'reassign_case', 'case', caseId, null, {
      status: 'inProgress', staffEmail: targetEmail, staffName: targetStaff.name
    });
    return {
      status: 'inProgress', staffEmail: targetEmail, staffName: targetStaff.name,
      supportCount: 1, scheduledDateTime: null, content: null, remarks: null,
      meetUrl: null, eventId: null, attachments: [], tools: [], subStaff: [],
      caseLimitOverride: null, supportHistory: []
    };
  }

  let currentRow = sheet.getRange(rowIndex, 1, 1, IDX.RECORDS.SUB_STAFF + 1).getValues()[0];
  let fromStatus  = String(currentRow[IDX.RECORDS.STATUS] || 'unhandled');
  let before      = {
    status:     fromStatus,
    staffEmail: String(currentRow[IDX.RECORDS.STAFF_EMAIL] || ''),
    staffName:  String(currentRow[IDX.RECORDS.STAFF_NAME]  || '')
  };

  let updates = {};
  updates[IDX.RECORDS.STAFF_EMAIL] = targetEmail;
  updates[IDX.RECORDS.STAFF_NAME]  = targetStaff.name;

  // STATUS の変更ルール:
  //   unhandled → inProgress（担当が付いたので対応中に）
  //   それ以外 → STATUS は変更しない（担当者変更のみ）
  if (fromStatus === 'unhandled') {
    updates[IDX.RECORDS.STATUS] = 'inProgress';
  }

  applyWriteUpdates_(sheet, rowIndex, updates);
  let result = buildTransitionResult_(currentRow, updates, null);

  appendAuditLog_(actor, 'reassign_case', 'case', caseId, before, {
    status: result.status, staffEmail: targetEmail, staffName: targetStaff.name
  });
  return result;
}

// ======================================================================
// 設定シート修復ヘルパー（手動実行用）
// ======================================================================

/**
 * 設定シートのB列（項目名）がキー名のままになっている行を修正し、
 * 書式も他の行に合わせて整える。
 * GASエディタからこの関数を手動実行してください。
 */
function fixSettingsSheet() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) { Logger.log('設定シートが見つかりません。'); return; }

  let data = sheet.getDataRange().getValues();
  let fixed = [];

  for (let i = 1; i < data.length; i++) {
    let key   = String(data[i][0]).trim();
    let label = String(data[i][1]).trim();
    let row   = i + 1;

    // B列がキー名と同じ（壊れた状態）なら正しい日本語名に修正
    if (key && label === key && SETTINGS_LABEL_MAP_[key]) {
      sheet.getRange(row, 2).setValue(SETTINGS_LABEL_MAP_[key]);
      fixed.push(key + ' → ' + SETTINGS_LABEL_MAP_[key]);
    }

    // 書式が未設定の行（背景色なし）にも書式を適用
    let bg = sheet.getRange(row, 3).getBackground();
    if (bg === '#ffffff' || bg === null) {
      sheet.getRange(row, 1).setFontColor('#9ca3af').setFontSize(8);
      sheet.getRange(row, 2).setFontWeight('bold').setFontColor('#1e293b');
      sheet.getRange(row, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
      sheet.setRowHeight(row, 40);
    }
  }

  if (fixed.length) {
    Logger.log('修正した項目名: ' + fixed.join(', '));
  } else {
    Logger.log('修正が必要な行はありませんでした。');
  }
}

// ======================================================================
// 設定シート初期化ヘルパー（初回セットアップ用に手動実行）
// ======================================================================

/**
 * GASエディタからこの関数を実行すると「設定」シートが自動作成されます。
 * 既に存在する場合はスキップします。
 *
 * シート構造:
 *   A列 = 設定キー（システム参照用・編集不可）
 *   B列 = 項目名（日本語表示）
 *   C列 = 設定値 ← ここに入力してください
 *   D列 = 入力例
 *   E列 = 説明・注意事項
 */
function normalizeAdminCaseStatus_(status) {
  let normalized = String(status || '').trim();
  if (normalized === 'unhandled' || normalized === 'inProgress' || normalized === 'completed' || normalized === 'rejected' || normalized === 'cancelled') {
    return normalized;
  }
  throw new Error('status は unhandled / inProgress / completed / rejected / cancelled を指定してください。');
}

function getCaseRowIndex_(sheet, caseId) {
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.CASES.PK]) === String(caseId)) return i + 1;
  }
  return -1;
}

// ======================================================================
// 案件補正シート ヘルパー
// 「案件リスト」はIMPORTRANGEで保護するため、管理者による案件情報の手動補正は
// 別シート「案件補正」に書き込み、getAllCasesJoined でマージして表示する。
// ======================================================================

/**
 * 「案件補正」シートを取得する。存在しなければ作成してヘッダを設定する。
 */
function ensureCasesOverrideSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.CASES_OVERRIDE);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'PK', 'メールアドレス', '介護事業所名', 'お名前', '困りごと詳細', '都道府県', 'サービス種別'
    ]]);
  }
  return sheet;
}

/**
 * 案件補正シートを読み込み、{ caseId: { email, officeName, ... } } 形式のマップを返す。
 * 値が空文字のフィールドは null として返す（「補正なし」扱い）。
 */
function getCasesOverrideMap_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
  if (!sheet || sheet.getLastRow() < 2) return {};
  let data = sheet.getDataRange().getValues();
  let map = {};
  for (let i = 1; i < data.length; i++) {
    let pk = String(data[i][IDX.CASES_OVERRIDE.PK]);
    if (!pk) continue;
    map[pk] = {
      email:         data[i][IDX.CASES_OVERRIDE.EMAIL]      !== '' ? String(data[i][IDX.CASES_OVERRIDE.EMAIL])      : null,
      officeName:    data[i][IDX.CASES_OVERRIDE.OFFICE]     !== '' ? String(data[i][IDX.CASES_OVERRIDE.OFFICE])     : null,
      requesterName: data[i][IDX.CASES_OVERRIDE.NAME]       !== '' ? String(data[i][IDX.CASES_OVERRIDE.NAME])       : null,
      details:       data[i][IDX.CASES_OVERRIDE.DETAILS]    !== '' ? String(data[i][IDX.CASES_OVERRIDE.DETAILS])    : null,
      prefecture:    data[i][IDX.CASES_OVERRIDE.PREFECTURE] !== '' ? String(data[i][IDX.CASES_OVERRIDE.PREFECTURE]) : null,
      serviceType:   data[i][IDX.CASES_OVERRIDE.SERVICE]    !== '' ? String(data[i][IDX.CASES_OVERRIDE.SERVICE])    : null
    };
  }
  return map;
}

/**
 * 案件補正シートで caseId に対応する行番号を返す。
 * 該当行がなければ PK だけセットした新規行を追加してその行番号を返す。
 */
function getOrCreateOverrideRowIndex_(sheet, caseId) {
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.CASES_OVERRIDE.PK]) === String(caseId)) return i + 1;
  }
  sheet.appendRow([caseId, '', '', '', '', '', '']);
  return sheet.getLastRow();
}

// ======================================================================
// 案件手動追加シート ヘルパー
// 管理者がアプリから直接登録する案件を保存するシート。
// 「案件リスト」はIMPORTRANGE保護のため書き込み不可なため分離。
// PKは "manual_" + UNIXミリ秒 で衝突ゼロを保証。
// ======================================================================

/**
 * 「案件手動追加」シートを取得する。存在しなければ作成してヘッダを設定する。
 */
function ensureCasesManualSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.CASES_MANUAL);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'PK', 'メールアドレス', '介護事業所名', 'お名前', '困りごと詳細', '都道府県', 'サービス種別'
    ]]);
  }
  return sheet;
}

/**
 * 管理者が新規案件を手動追加する。
 * PKは "manual_" + UNIXミリ秒 で生成するため重複は発生しない。
 */
function addManualCase(payload) {
  let actor = requireAdmin_();
  if (!payload.email)         throw new Error('メールアドレスは必須です。');
  if (!payload.officeName)    throw new Error('介護事業所名は必須です。');
  if (!payload.requesterName) throw new Error('お名前は必須です。');
  if (!payload.details)       throw new Error('困りごと詳細は必須です。');

  let ss = getSpreadsheet_();
  let sheet = ensureCasesManualSheet_(ss);

  // 申込日が指定されていればそのエポックミリ秒をPKに使用（月間カウントに反映）
  let baseTime;
  if (payload.applicationDate) {
    // "yyyy-MM-dd" → JST正午で生成（日付ずれ防止）
    baseTime = new Date(payload.applicationDate + 'T12:00:00+09:00').getTime();
  } else {
    baseTime = new Date().getTime();
  }
  let pk = 'manual_' + baseTime;
  sheet.appendRow([
    pk,
    payload.email,
    sanitizeForSheet_(String(payload.officeName)),
    sanitizeForSheet_(String(payload.requesterName)),
    sanitizeForSheet_(String(payload.details)),
    sanitizeForSheet_(String(payload.prefecture || '')),
    sanitizeForSheet_(String(payload.serviceType || ''))
  ]);

  appendAuditLog_(actor, 'add_manual_case', 'case', pk, null, {
    email: payload.email,
    officeName: payload.officeName,
    requesterName: payload.requesterName
  });

  return { pk: pk };
}

function ensureRecordRowForCase_(sheet, caseId) {
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) return i + 1;
  }
  sheet.appendRow([
    caseId, 'unhandled', '', '',
    null, 1, null, null, null, null, '[]', null, null, null, '[]', '', '', '[]', '[]'
  ]);
  return sheet.getLastRow();
}

// サブ担当更新（メイン担当者 or 管理者のみ）
function updateSubStaff(caseId, subStaffArray) {
  let actor = getActor_();
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let rowIndex = getCaseRecordRowIndex_(caseId);
  if (rowIndex === -1) throw new Error('案件が見つかりません: ' + caseId);

  let row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  let staffEmail = normalizeEmail_(row[IDX.RECORDS.STAFF_EMAIL]);
  let isMainStaff = staffEmail && staffEmail === normalizeEmail_(actor.email);
  if (!actor.isAdmin && !isMainStaff) throw new Error('サブ担当を設定する権限がありません。');

  let MAX_SUB_STAFF = 1;
  if (Array.isArray(subStaffArray) && subStaffArray.length > MAX_SUB_STAFF) {
    throw new Error('サブ担当は最大' + MAX_SUB_STAFF + '名までです。');
  }
  let validated = [];
  if (Array.isArray(subStaffArray)) {
    let staffSheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    let staffData = staffSheet.getDataRange().getValues();
    let staffMap = {};
    for (let i = 1; i < staffData.length; i++) {
      let e = normalizeEmail_(staffData[i][IDX.STAFF.EMAIL]);
      if (e) staffMap[e] = String(staffData[i][IDX.STAFF.NAME]);
    }
    for (let j = 0; j < subStaffArray.length; j++) {
      let email = normalizeEmail_(subStaffArray[j].email);
      if (email && staffMap[email]) {
        validated.push({ email: email, name: staffMap[email] });
      }
    }
  }

  let before = row[IDX.RECORDS.SUB_STAFF] ? String(row[IDX.RECORDS.SUB_STAFF]) : '[]';
  sheet.getRange(rowIndex, IDX.RECORDS.SUB_STAFF + 1).setValue(JSON.stringify(validated));
  appendAuditLog_(actor, 'update_sub_staff', 'case', caseId, { subStaff: before }, { subStaff: JSON.stringify(validated) });
  return { subStaff: validated };
}

// ======================================================================
// Meet/Zoom URL の更新
// ======================================================================

/**
 * 案件のMeet/Zoom URLを更新する。カレンダーイベントのdescriptionも同期更新。
 * @param {string} caseId - 案件ID
 * @param {string} newUrl - 新しいURL（空文字で削除）
 * @returns {object} { meetUrl }
 */
function updateMeetUrl(caseId, newUrl) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = data[rowIndex - 1];
  let beforeUrl = row[IDX.RECORDS.MEET_URL] || '';
  let eventId = row[IDX.RECORDS.EVENT_ID];
  let url = (newUrl || '').trim();

  // MEET_URL 列を更新
  sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(url);

  // カレンダーイベントのdescription + conferenceData（「Meetに参加する」ボタン）を更新
  if (eventId) {
    try {
      let apiCalId = getApiCalendarId_();
      let cleanId = String(eventId).replace('@google.com', '');
      let event = Calendar.Events.get(apiCalId, cleanId);
      let existingDesc = event.description || '';

      // 既存のURL行（"...URL: http..."）を除去
      let urlLinePattern = /^(Google Meet URL|Zoom URL|URL)\s*[:：]\s*https?:\/\/\S+\s*/gm;
      let stripped = existingDesc.replace(urlLinePattern, '');
      stripped = stripped.replace(/^\n+/, '');

      // 新しいURL行を先頭に挿入
      let newDesc;
      if (url) {
        let label = url.indexOf('zoom.us') !== -1 ? 'Zoom URL' : url.indexOf('meet.google') !== -1 ? 'Google Meet URL' : 'URL';
        newDesc = label + ': ' + url + (stripped ? '\n\n' + stripped : '');
      } else {
        newDesc = stripped;
      }

      // patch用オブジェクトを構築
      let patchBody = { description: newDesc };

      // 「Google Meetに参加する」ボタン（conferenceData）の更新
      let isMeetUrl = url && url.indexOf('meet.google.com/') !== -1;
      if (isMeetUrl) {
        // Meet URLからミーティングコードを抽出（例: abc-defg-hij）
        let meetCode = url.replace(/.*meet\.google\.com\//, '').replace(/[?#].*$/, '');
        patchBody.conferenceData = {
          conferenceId: meetCode,
          conferenceSolution: {
            key: { type: 'hangoutsMeet' },
            name: 'Google Meet'
          },
          entryPoints: [
            { entryPointType: 'video', uri: url, label: meetCode }
          ]
        };
      } else if (event.conferenceData) {
        // Meet以外のURL or URL削除 → conferenceDataをクリア（古いボタンが残らないように）
        patchBody.conferenceData = null;
      }

      Calendar.Events.patch(patchBody, apiCalId, cleanId, { conferenceDataVersion: 1 });
      console.log('カレンダーイベント更新成功: eventId=' + cleanId + ' url=' + url);
    } catch (e) {
      console.error('カレンダーURL差し替えエラー: ' + e.message + ' (eventId=' + eventId + ')');
    }
  }

  appendAuditLog_(actor, 'update_meet_url', 'case', caseId, { meetUrl: beforeUrl }, { meetUrl: url });
  return { meetUrl: url };
}

// ======================================================================
// 過去の対応記録（supportHistory）の編集
// ======================================================================

/**
 * supportHistory 配列内の指定 roundIndex の記録を更新する。
 * 編集可能フィールド: scheduledDateTime, method, content, remarks, tools
 * @param {string} caseId - 案件ID
 * @param {number} roundIndex - 履歴配列内のインデックス（0始まり）
 * @param {object} patch - 更新するフィールド
 * @returns {object} 更新後の supportHistory 配列
 */
function updateSupportHistory(caseId, roundIndex, patch) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  let row = data[rowIndex - 1];
  let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  let history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }

  let idx = Number(roundIndex);
  if (!isFinite(idx) || idx < 0 || idx >= history.length) {
    throw new Error('指定された履歴インデックスが範囲外です: ' + roundIndex);
  }

  let before = JSON.parse(JSON.stringify(history[idx]));

  // 編集可能フィールドのみ更新
  if (patch.hasOwnProperty('scheduledDateTime')) {
    history[idx].scheduledDateTime = patch.scheduledDateTime || null;
  }
  if (patch.hasOwnProperty('method')) {
    history[idx].method = patch.method || null;
  }
  if (patch.hasOwnProperty('content')) {
    history[idx].content = patch.content || null;
  }
  if (patch.hasOwnProperty('remarks')) {
    history[idx].remarks = patch.remarks || null;
  }
  if (patch.hasOwnProperty('tools')) {
    history[idx].tools = Array.isArray(patch.tools) ? patch.tools : [];
  }

  sheet.getRange(rowIndex, IDX.RECORDS.HISTORY + 1).setValue(JSON.stringify(history));
  appendAuditLog_(actor, 'update_support_history', 'case', caseId, { roundIndex: idx, before: before }, { roundIndex: idx, after: history[idx] });
  return { supportHistory: history };
}

// ======================================================================
// 管理者ステータス遷移 — 統一ゲートキーパー (v1.11.5)
// すべての管理者経由の STATUS 変更はこの関数を通す。
// fromStatus × toStatus の組み合わせに応じた正しい DB 操作を実行する。
// ======================================================================

/**
 * 現在回のフィールドを HISTORY JSON エントリとして構築する（まだ書き込まない）。
 */
function buildHistoryEntry_(row) {
  return {
    round:             Number(row[IDX.RECORDS.COUNT]) || 1,
    scheduledDateTime: row[IDX.RECORDS.DATE] ? new Date(row[IDX.RECORDS.DATE]).toISOString() : null,
    method:            row[IDX.RECORDS.METHOD]  || null,
    content:           row[IDX.RECORDS.CONTENT] || null,
    remarks:           row[IDX.RECORDS.REMARKS] || null,
    meetUrl:           row[IDX.RECORDS.MEET_URL] || null,
    attachments:       parseJsonArray_(row[IDX.RECORDS.ATTACHMENTS]),
    tools:             parseJsonArray_(row[IDX.RECORDS.TOOLS]),
    staffName:         row[IDX.RECORDS.STAFF_NAME]  || null,
    staffEmail:        row[IDX.RECORDS.STAFF_EMAIL] || null
  };
}

/**
 * updates オブジェクト（{IDX番号: 値}）を一括で書き込む。
 */
function applyWriteUpdates_(recordSheet, rowIndex, updates) {
  let keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i++) {
    let idx = Number(keys[i]);
    let val = updates[idx];
    // null は GAS の setValue で空欄（クリア）になる
    recordSheet.getRange(rowIndex, idx + 1).setValue(val);
  }
}

/**
 * adminTransitionStatus_ の戻り値（楽観的更新用フィールドサマリ）を構築する。
 */
function buildTransitionResult_(row, updates, newHistoryArray) {
  function v(idx) {
    return updates.hasOwnProperty(String(idx)) ? updates[idx] : row[idx];
  }
  let rawDate = v(IDX.RECORDS.DATE);
  let historyParsed = updates.hasOwnProperty(String(IDX.RECORDS.HISTORY))
    ? (newHistoryArray || [])
    : parseJsonArray_(row[IDX.RECORDS.HISTORY]);
  let rawOverride = v(IDX.RECORDS.CASE_LIMIT_OVERRIDE);
  let parsedOverride = (rawOverride !== '' && rawOverride !== null &&
                        rawOverride !== undefined && !isNaN(Number(rawOverride)))
    ? Number(rawOverride) : null;
  return {
    status:            v(IDX.RECORDS.STATUS) || 'unhandled',
    staffEmail:        v(IDX.RECORDS.STAFF_EMAIL) || '',
    staffName:         v(IDX.RECORDS.STAFF_NAME)  || '',
    supportCount:      Number(v(IDX.RECORDS.COUNT)) || 1,
    scheduledDateTime: (rawDate && rawDate !== '') ? new Date(rawDate).toISOString() : null,
    method:            v(IDX.RECORDS.METHOD)      || null,
    content:           v(IDX.RECORDS.CONTENT)     || null,
    remarks:           v(IDX.RECORDS.REMARKS)     || null,
    meetUrl:           v(IDX.RECORDS.MEET_URL)    || null,
    eventId:           v(IDX.RECORDS.EVENT_ID)    || null,
    attachments:       parseJsonArray_(v(IDX.RECORDS.ATTACHMENTS)),
    tools:             parseJsonArray_(v(IDX.RECORDS.TOOLS)),
    subStaff:          parseJsonArray_(v(IDX.RECORDS.SUB_STAFF)),
    caseLimitOverride: parsedOverride,
    supportHistory:    historyParsed
  };
}

/**
 * 管理者によるステータス遷移 — 全経路の統一実装。
 * 設計書 §3 の遷移マトリックスに基づき、fromStatus × toStatus に応じた
 * DB 操作セットを実行する。
 *
 * @param {Sheet}  recordSheet  サポート記録シート
 * @param {number} rowIndex     対象行番号（1始まり）
 * @param {string} fromStatus   現在のステータス
 * @param {string} toStatus     変更後のステータス
 * @param {Object} actor        requireAdmin_() の戻り値
 * @param {Object} [options]
 *   @param {string} [options.staffEmail]  遷移時に使用する担当者メール
 *   @param {string} [options.staffName]   遷移時に使用する担当者名
 * @returns {Object} 変更後のフィールドサマリ（楽観的更新用）
 */
function adminTransitionStatus_(recordSheet, rowIndex, fromStatus, toStatus, actor, options) {
  options = options || {};
  let row = recordSheet.getRange(rowIndex, 1, 1, IDX.RECORDS.SUB_STAFF + 1).getValues()[0];

  if (fromStatus === toStatus) {
    return buildTransitionResult_(row, {}, null);
  }

  let updates = {};       // { '列インデックス(文字列)': 値 }
  let newHistoryArray = null;

  // ── 共通操作: resetToUnhandled ──────────────────────────────
  function applyResetToUnhandled() {
    updates[IDX.RECORDS.STATUS]      = 'unhandled';
    updates[IDX.RECORDS.STAFF_EMAIL] = '';
    updates[IDX.RECORDS.STAFF_NAME]  = '';
    updates[IDX.RECORDS.COUNT]       = 1;
    updates[IDX.RECORDS.DATE]        = null;
    updates[IDX.RECORDS.METHOD]      = null;
    updates[IDX.RECORDS.CONTENT]     = null;
    updates[IDX.RECORDS.REMARKS]     = null;
    updates[IDX.RECORDS.EVENT_ID]    = null;
    updates[IDX.RECORDS.MEET_URL]    = null;
    updates[IDX.RECORDS.ATTACHMENTS] = '[]';
    updates[IDX.RECORDS.TOOLS]       = '[]';
    updates[IDX.RECORDS.SUB_STAFF]   = '[]';
    // BUSINESS / THREAD_ID / HISTORY / CASE_LIMIT_OVERRIDE / ANNUAL_LIMIT_OVERRIDE は保持
  }

  // ── 共通操作: staff を options または既存値から設定 ─────────
  function applyStaff() {
    if (options.staffEmail) {
      updates[IDX.RECORDS.STAFF_EMAIL] = options.staffEmail;
      updates[IDX.RECORDS.STAFF_NAME]  = options.staffName || '';
    }
    // staffEmail が options にも行にもない場合、空のまま（管理者強制、監査ログで追跡）
  }

  // ── FROM: unhandled ──────────────────────────────────────────
  if (fromStatus === 'unhandled') {
    if (toStatus === 'inProgress') {
      applyStaff();
      updates[IDX.RECORDS.STATUS] = 'inProgress';
    } else if (toStatus === 'completed') {
      applyStaff();
      updates[IDX.RECORDS.STATUS] = 'completed';
    } else if (toStatus === 'cancelled' || toStatus === 'rejected') {
      applyStaff();
      updates[IDX.RECORDS.STATUS] = toStatus;
    }
  }

  // ── FROM: inProgress ─────────────────────────────────────────
  else if (fromStatus === 'inProgress') {
    if (toStatus === 'completed') {
      updates[IDX.RECORDS.STATUS] = 'completed';
    } else if (toStatus === 'unhandled') {
      applyResetToUnhandled();
    } else if (toStatus === 'cancelled' || toStatus === 'rejected') {
      updates[IDX.RECORDS.STATUS] = toStatus;
    }
  }

  // ── FROM: completed ★最重要 ──────────────────────────────────
  else if (fromStatus === 'completed') {
    if (toStatus === 'inProgress') {
      // reopenForAdmin: HISTORY保存 + supportCount+1 + フィールドクリア + 上限自動補正
      let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
      let history = [];
      try { history = JSON.parse(historyJson); } catch(e) { history = []; }
      history.push(buildHistoryEntry_(row));
      newHistoryArray = history;

      let currentCount = Number(row[IDX.RECORDS.COUNT]) || 1;
      let newCount     = currentCount + 1;

      // 上限超過チェック → caseLimitOverride を自動 +1
      let rawOverride = row[IDX.RECORDS.CASE_LIMIT_OVERRIDE];
      let parsedOverride = (rawOverride !== '' && rawOverride !== null &&
                            rawOverride !== undefined && !isNaN(Number(rawOverride)))
        ? Number(rawOverride) : null;
      let currentLimit = parsedOverride || getCaseUsageLimit_();
      if (newCount > currentLimit) {
        updates[IDX.RECORDS.CASE_LIMIT_OVERRIDE] = newCount; // 上限を自動調整
      }

      updates[IDX.RECORDS.STATUS]      = 'inProgress';
      updates[IDX.RECORDS.COUNT]       = newCount;
      updates[IDX.RECORDS.HISTORY]     = JSON.stringify(history);
      updates[IDX.RECORDS.DATE]        = null;
      updates[IDX.RECORDS.METHOD]      = null;
      updates[IDX.RECORDS.CONTENT]     = null;
      updates[IDX.RECORDS.REMARKS]     = null;
      updates[IDX.RECORDS.EVENT_ID]    = null;
      updates[IDX.RECORDS.MEET_URL]    = null;
      updates[IDX.RECORDS.ATTACHMENTS] = '[]';
      // STAFF / BUSINESS / TOOLS / SUB_STAFF は保持

    } else if (toStatus === 'unhandled') {
      // 現在回を HISTORY に保存してから全クリア
      let historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
      let history = [];
      try { history = JSON.parse(historyJson); } catch(e) { history = []; }
      history.push(buildHistoryEntry_(row));
      newHistoryArray = history;

      applyResetToUnhandled();
      updates[IDX.RECORDS.HISTORY] = JSON.stringify(history); // HISTORY は上書き（保存済み）

    } else if (toStatus === 'cancelled' || toStatus === 'rejected') {
      updates[IDX.RECORDS.STATUS] = toStatus;
    }
  }

  // ── FROM: cancelled ──────────────────────────────────────────
  else if (fromStatus === 'cancelled') {
    if (toStatus === 'unhandled') {
      applyResetToUnhandled();
    } else if (toStatus === 'inProgress') {
      // 既存スタッフを優先、なければ options から
      let staffEmail = options.staffEmail || String(row[IDX.RECORDS.STAFF_EMAIL] || '');
      let staffName  = options.staffName  || String(row[IDX.RECORDS.STAFF_NAME]  || '');
      updates[IDX.RECORDS.STATUS]      = 'inProgress';
      updates[IDX.RECORDS.STAFF_EMAIL] = staffEmail;
      updates[IDX.RECORDS.STAFF_NAME]  = staffName;
    } else if (toStatus === 'completed' || toStatus === 'rejected') {
      updates[IDX.RECORDS.STATUS] = toStatus;
    }
  }

  // ── FROM: rejected ───────────────────────────────────────────
  else if (fromStatus === 'rejected') {
    if (toStatus === 'unhandled') {
      applyResetToUnhandled();
    } else if (toStatus === 'inProgress') {
      applyStaff();
      updates[IDX.RECORDS.STATUS] = 'inProgress';
    } else if (toStatus === 'completed' || toStatus === 'cancelled') {
      updates[IDX.RECORDS.STATUS] = toStatus;
    }
  }

  // ── DB 書き込み ───────────────────────────────────────────────
  applyWriteUpdates_(recordSheet, rowIndex, updates);

  return buildTransitionResult_(row, updates, newHistoryArray);
}

// ======================================================================
// setCaseStatusAdmin — adminTransitionStatus_ へ委譲
// ======================================================================
function setCaseStatusAdmin(caseId, status) {
  let actor = requireAdmin_();
  ensureAdminSchema_();

  let toStatus = normalizeAdminCaseStatus_(status);
  let ss = getSpreadsheet_();
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!recordSheet) throw new Error('サポート記録シートが見つかりません。');

  let rowIndex = ensureRecordRowForCase_(recordSheet, caseId);
  let currentRow = recordSheet.getRange(rowIndex, 1, 1, IDX.RECORDS.SUB_STAFF + 1).getValues()[0];
  let fromStatus = normalizeAdminCaseStatus_(currentRow[IDX.RECORDS.STATUS] || 'unhandled');

  let before = {
    status:     fromStatus,
    staffEmail: String(currentRow[IDX.RECORDS.STAFF_EMAIL] || ''),
    staffName:  String(currentRow[IDX.RECORDS.STAFF_NAME]  || ''),
    supportCount: Number(currentRow[IDX.RECORDS.COUNT]) || 1
  };

  let result = adminTransitionStatus_(recordSheet, rowIndex, fromStatus, toStatus, actor);

  appendAuditLog_(actor, 'admin_set_case_status', 'case', caseId, before, {
    status: toStatus,
    supportCount: result.supportCount,
    caseLimitOverride: result.caseLimitOverride
  });

  return result;
}

function deleteCaseAdmin(caseId) {
  let actor = requireAdmin_();
  let ss = getSpreadsheet_();

  // 案件情報を記録（監査ログ用）
  let before = { caseId: String(caseId) };

  // 1. RECORDS シートから行を削除 + 添付ファイルをゴミ箱に移動
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (recordSheet && recordSheet.getLastRow() > 1) {
    let recData = recordSheet.getDataRange().getValues();
    for (let i = recData.length - 1; i >= 1; i--) {
      if (String(recData[i][IDX.RECORDS.FK]) === String(caseId)) {
        // 添付ファイルをゴミ箱へ
        let attachments = parseJsonArray_(recData[i][IDX.RECORDS.ATTACHMENTS]);
        attachments.forEach(function(att) {
          try { if (att && att.fileId) DriveApp.getFileById(att.fileId).setTrashed(true); } catch(e) {}
        });
        before.status = String(recData[i][IDX.RECORDS.STATUS] || '');
        before.staffEmail = String(recData[i][IDX.RECORDS.STAFF_EMAIL] || '');
        recordSheet.deleteRow(i + 1);
        break;
      }
    }
  }

  // 2. CASES_MANUAL シートから行を削除（手動追加案件の場合）
  let manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  let isManualCase = false;
  if (manualSheet && manualSheet.getLastRow() > 1) {
    let manualData = manualSheet.getDataRange().getValues();
    for (let j = manualData.length - 1; j >= 1; j--) {
      if (String(manualData[j][0]) === String(caseId)) {
        before.officeName = String(manualData[j][IDX.CASES.OFFICE] || '');
        before.email = String(manualData[j][IDX.CASES.EMAIL] || '');
        manualSheet.deleteRow(j + 1);
        isManualCase = true;
        break;
      }
    }
  }

  // 3. CASES_OVERRIDE シートから補正行を削除
  let overrideSheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
  if (overrideSheet && overrideSheet.getLastRow() > 1) {
    let ovrData = overrideSheet.getDataRange().getValues();
    for (let k = ovrData.length - 1; k >= 1; k--) {
      if (String(ovrData[k][0]) === String(caseId)) {
        overrideSheet.deleteRow(k + 1);
        break;
      }
    }
  }

  // 4. EMAIL_HISTORY シートから関連行を削除（下から上へ）
  let emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (emailSheet && emailSheet.getLastRow() > 1) {
    let emailData = emailSheet.getDataRange().getValues();
    for (let m = emailData.length - 1; m >= 1; m--) {
      if (String(emailData[m][IDX.EMAIL.CASE_ID]) === String(caseId)) {
        emailSheet.deleteRow(m + 1);
      }
    }
  }

  // 5. 通常案件（IMPORTRANGE）の場合は削除済みリストに追加
  if (!isManualCase) {
    let deletedRaw = getSetting_('DELETED_CASE_IDS', '');
    let deletedList = deletedRaw ? deletedRaw.split(',') : [];
    if (deletedList.indexOf(String(caseId)) === -1) {
      deletedList.push(String(caseId));
      saveSetting_('DELETED_CASE_IDS', deletedList.join(','));
    }
  }

  appendAuditLog_(actor, 'admin_delete_case', 'case', caseId, before, { deleted: true });
  return;
}

function updateCaseDataAdmin(caseId, payload) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  if (!payload || typeof payload !== 'object') throw new Error('payload が不正です。');

  let casePatch = payload.casePatch || payload.case || {};
  let recordPatch = payload.recordPatch || payload.record || {};
  if (typeof casePatch !== 'object' || typeof recordPatch !== 'object') throw new Error('casePatch / recordPatch が不正です。');

  let ss = getSpreadsheet_();
  let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!caseSheet || !recordSheet) throw new Error('必要なシートが見つかりません。');

  // 案件の存在確認: まずCASESシート、なければCASES_MANUALシートを検索
  let caseRowIndex = getCaseRowIndex_(caseSheet, caseId);
  let isManualCase = false;
  let manualSheet = null;
  let manualRowIndex = -1;
  if (caseRowIndex === -1) {
    manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
    if (manualSheet) manualRowIndex = getCaseRowIndex_(manualSheet, caseId);
    if (manualRowIndex === -1) throw new Error('案件が見つかりません: ' + caseId);
    isManualCase = true;
  }

  // 案件補正シートを取得（通常案件のcasePatch書き込み先）
  let overrideSheet = ensureCasesOverrideSheet_(ss);

  let lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let actualCaseSheet = isManualCase ? manualSheet : caseSheet;
    let actualCaseRowIndex = isManualCase ? manualRowIndex : caseRowIndex;
    let beforeCaseRow = actualCaseSheet.getRange(actualCaseRowIndex, 1, 1, actualCaseSheet.getLastColumn()).getValues()[0];
    let recordRowIndex = ensureRecordRowForCase_(recordSheet, caseId);
    let beforeRecordRow = recordSheet.getRange(recordRowIndex, 1, 1, recordSheet.getLastColumn()).getValues()[0];

    // ─── casePatch: 案件情報の書き込み ───
    // 手動案件 → CASES_MANUAL シートに直接書き込み
    // 通常案件 → IMPORTRANGE保護のため「案件補正」シートに書き込み
    if (Object.prototype.hasOwnProperty.call(casePatch, 'email') ||
        Object.prototype.hasOwnProperty.call(casePatch, 'officeName') ||
        Object.prototype.hasOwnProperty.call(casePatch, 'requesterName') ||
        Object.prototype.hasOwnProperty.call(casePatch, 'details') ||
        Object.prototype.hasOwnProperty.call(casePatch, 'prefecture') ||
        Object.prototype.hasOwnProperty.call(casePatch, 'serviceType')) {
      if (isManualCase) {
        // 手動案件: CASES_MANUAL シートに直接書き込み
        if (Object.prototype.hasOwnProperty.call(casePatch, 'email')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.EMAIL + 1).setValue(String(casePatch.email || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'officeName')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.OFFICE + 1).setValue(sanitizeForSheet_(String(casePatch.officeName || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'requesterName')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.NAME + 1).setValue(sanitizeForSheet_(String(casePatch.requesterName || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'details')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.DETAILS + 1).setValue(sanitizeForSheet_(String(casePatch.details || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'prefecture')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.PREFECTURE + 1).setValue(sanitizeForSheet_(String(casePatch.prefecture || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'serviceType')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.SERVICE + 1).setValue(sanitizeForSheet_(String(casePatch.serviceType || '').trim()));
        }
      } else {
        // 通常案件: 案件補正シートに書き込み
        let overrideRowIndex = getOrCreateOverrideRowIndex_(overrideSheet, caseId);
        if (Object.prototype.hasOwnProperty.call(casePatch, 'email')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.EMAIL + 1).setValue(String(casePatch.email || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'officeName')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.OFFICE + 1).setValue(sanitizeForSheet_(String(casePatch.officeName || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'requesterName')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.NAME + 1).setValue(sanitizeForSheet_(String(casePatch.requesterName || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'details')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.DETAILS + 1).setValue(sanitizeForSheet_(String(casePatch.details || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'prefecture')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.PREFECTURE + 1).setValue(sanitizeForSheet_(String(casePatch.prefecture || '').trim()));
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'serviceType')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.SERVICE + 1).setValue(sanitizeForSheet_(String(casePatch.serviceType || '').trim()));
        }
      }
    }

    // ── STATUS: 遷移ロジック経由で変更（直接書き込み禁止） ──
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'status')) {
      let currentRow2 = recordSheet.getRange(recordRowIndex, 1, 1, IDX.RECORDS.SUB_STAFF + 1).getValues()[0];
      let fromStatus2  = String(currentRow2[IDX.RECORDS.STATUS] || 'unhandled');
      let toStatus2    = normalizeAdminCaseStatus_(recordPatch.status);
      if (fromStatus2 !== toStatus2) {
        let staffOpts = {};
        if (recordPatch.staffEmail) staffOpts.staffEmail = normalizeEmail_(recordPatch.staffEmail);
        if (recordPatch.staffName)  staffOpts.staffName  = String(recordPatch.staffName).trim();
        adminTransitionStatus_(recordSheet, recordRowIndex, fromStatus2, toStatus2, actor, staffOpts);
        // 遷移関数が STAFF_EMAIL / STAFF_NAME も書き込むため、後続の個別書き込みはスキップ
        // （staffEmail / staffName キーは以降処理しない）
        delete recordPatch.staffEmail;
        delete recordPatch.staffName;
      }
    }
    // staffEmail: 遷移以外の単純な担当者変更
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'staffEmail')) {
      let targetEmail = normalizeEmail_(recordPatch.staffEmail);
      let staff = targetEmail ? getStaffByEmail(targetEmail) : null;
      if (targetEmail && !staff) throw new Error('存在しないスタッフです: ' + targetEmail);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(targetEmail);
      if (!Object.prototype.hasOwnProperty.call(recordPatch, 'staffName')) {
        recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(staff ? staff.name : '');
      }
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'staffName')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(String(recordPatch.staffName || '').trim());
    }
    // scheduledDateTime: null の場合はフロントエンドから除外される（空欄時は payload に含めない設計）
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'scheduledDateTime')) {
      let dt = recordPatch.scheduledDateTime;
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.DATE + 1).setValue(dt ? new Date(dt) : null);
    }
    // supportCount: HISTORY との整合性をチェック
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'supportCount')) {
      let count = Number(recordPatch.supportCount);
      if (!isFinite(count) || count < 1) throw new Error('supportCount は1以上の数値を指定してください。');
      let newCount  = Math.floor(count);
      let historyJson2 = beforeRecordRow[IDX.RECORDS.HISTORY] ? String(beforeRecordRow[IDX.RECORDS.HISTORY]) : '[]';
      let historyArr2  = [];
      try { historyArr2 = JSON.parse(historyJson2); } catch(e) { historyArr2 = []; }
      // 整合性チェック: 新 supportCount は HISTORY エントリ数 +1 であるべき
      let expectedCount = historyArr2.length + 1;
      if (newCount !== expectedCount) {
        // 不整合は禁止せず監査ログに警告として記録
        appendAuditLog_(actor, 'admin_supportcount_mismatch', 'case', caseId,
          { historyEntries: historyArr2.length, expectedCount: expectedCount },
          { newSupportCount: newCount }
        );
      }
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.COUNT + 1).setValue(newCount);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'caseLimitOverride')) {
      let caseOverride = parseNullablePositiveInteger_(recordPatch.caseLimitOverride);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.CASE_LIMIT_OVERRIDE + 1).setValue(caseOverride === null ? '' : caseOverride);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'annualLimitOverride')) {
      let annualOverride = parseNullablePositiveInteger_(recordPatch.annualLimitOverride);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1).setValue(annualOverride === null ? '' : annualOverride);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'method')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.METHOD + 1).setValue(String(recordPatch.method || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'businessType')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.BUSINESS + 1).setValue(String(recordPatch.businessType || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'content')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.CONTENT + 1).setValue(sanitizeForSheet_(String(recordPatch.content || '').trim()));
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'remarks')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.REMARKS + 1).setValue(sanitizeForSheet_(String(recordPatch.remarks || '').trim()));
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'eventId')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.EVENT_ID + 1).setValue(String(recordPatch.eventId || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'meetUrl')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.MEET_URL + 1).setValue(String(recordPatch.meetUrl || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'threadId')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.THREAD_ID + 1).setValue(String(recordPatch.threadId || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'tools')) {
      let toolsVal = Array.isArray(recordPatch.tools) ? JSON.stringify(recordPatch.tools) : '[]';
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.TOOLS + 1).setValue(toolsVal);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'subStaff')) {
      let subStaffVal = Array.isArray(recordPatch.subStaff) ? JSON.stringify(recordPatch.subStaff) : '[]';
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.SUB_STAFF + 1).setValue(subStaffVal);
    }

    appendAuditLog_(actor, 'admin_update_case_data', 'case', caseId, {
      caseRow: {
        email: String(beforeCaseRow[IDX.CASES.EMAIL] || ''),
        officeName: String(beforeCaseRow[IDX.CASES.OFFICE] || ''),
        requesterName: String(beforeCaseRow[IDX.CASES.NAME] || ''),
        details: String(beforeCaseRow[IDX.CASES.DETAILS] || ''),
        prefecture: String(beforeCaseRow[IDX.CASES.PREFECTURE] || ''),
        serviceType: String(beforeCaseRow[IDX.CASES.SERVICE] || ''),
      },
      recordRow: {
        status: String(beforeRecordRow[IDX.RECORDS.STATUS] || ''),
        staffEmail: String(beforeRecordRow[IDX.RECORDS.STAFF_EMAIL] || ''),
        staffName: String(beforeRecordRow[IDX.RECORDS.STAFF_NAME] || ''),
        supportCount: Number(beforeRecordRow[IDX.RECORDS.COUNT]) || 1,
        caseLimitOverride: Number(beforeRecordRow[IDX.RECORDS.CASE_LIMIT_OVERRIDE]) || null,
        annualLimitOverride: Number(beforeRecordRow[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE]) || null
      }
    }, {
      casePatch: casePatch,
      recordPatch: recordPatch
    });
  } finally {
    lock.releaseLock();
  }
  return;
}

function setupSettingsSheet() {
  let ss = getSpreadsheet_();
  let existing = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (existing) {
    Logger.log('「設定」シートは既に存在します。');
    return;
  }

  let sheet = ss.insertSheet(SHEET_NAMES.SETTINGS);

  // --- 列幅の設定 ---
  sheet.setColumnWidth(1, 180);  // A: 設定キー
  sheet.setColumnWidth(2, 220);  // B: 項目名
  sheet.setColumnWidth(3, 360);  // C: 設定値
  sheet.setColumnWidth(4, 280);  // D: 入力例
  sheet.setColumnWidth(5, 420);  // E: 説明

  // --- データ定義 ---
  // '#' で始まるキーはカテゴリ見出し行（コードでスキップされる）
  let rows = [
    // ヘッダー
    ['設定キー', '項目名', '設定値', '入力例', '説明・注意事項'],

    // カテゴリ: 基本設定
    ['#基本設定', '基本設定', '', '', ''],
    ['ADMIN_EMAILS',       '管理者メールアドレス',     '', 'admin@tadakayo.jp, sub@tadakayo.jp', '管理者権限（他者の案件操作可）を付与するユーザー。\nカンマ区切りで複数指定できます。最低1名は設定必須。'],

    // カテゴリ: Zoom連携
    ['#Zoom連携',  'Zoom連携設定', '', '', ''],
    ['ZOOM_ACCOUNT_ID',    'アカウント ID',            '', 'aBcDeFgHiJkLmN_12345',              'Zoom Marketplace → アプリ管理 → 「Account ID」の値。\nZoom連携を使わない場合は空欄でOK。'],
    ['ZOOM_CLIENT_ID',     'クライアント ID',          '', 'xYz123AbC456dEf',                   '同画面の「Client ID」の値。'],
    ['ZOOM_CLIENT_SECRET', 'クライアントシークレット', '', 'a1B2c3D4e5F6g7H8i9J0',             '同画面の「Client Secret」の値。\n※外部に漏らさないでください。'],
    ['ZOOM_FIXED_URL',     '固定Zoom URL',             '', 'https://zoom.us/j/97381145741?pwd=...', '「いつものタダスクID」モードで再利用する固定 Zoom ミーティングの参加URL。\n空欄の場合は固定IDモードを使用しません（毎回新規発行）。'],
    ['ZOOM_FIXED_ID',      '固定Zoom ID',              '', '973 8114 5741',                     '「いつものタダスクID」の Zoom ミーティング ID（ハイフン/スペース可）。'],
    ['ZOOM_FIXED_PASS',    '固定Zoomパスコード',       '', 'tadasc',                            '「いつものタダスクID」の参加パスコード。'],

    // カテゴリ: カレンダー連携
    ['#カレンダー', 'カレンダー連携設定', '', '', ''],
    ['SHARED_CALENDAR_ID', '共有カレンダー ID',        '', 'abc123xyz@group.calendar.google.com', 'タダサポ共有カレンダーのID。\nGoogleカレンダー → 設定 → カレンダーID で確認できます。\n空欄の場合は担当者のデフォルトカレンダーに作成します。'],
    ['ATTACHMENT_FOLDER_ID', '添付ファイル保存先フォルダID', '', '1AbCdEfGhIjKlMnOpQrStUvWxYz', '完了報告/記録修正でアップロードした添付ファイルの保存先Google DriveフォルダID。\nGoogle Drive フォルダURLの /folders/ の後ろの値を入力してください。'],

    // カテゴリ: 日程・予約管理（v1.11.7）
    ['#日程・予約管理', '日程・予約管理設定（v1.11.7+）', '', '', ''],
    ['TEAM_CALENDAR_ID', 'チームカレンダー ID（書込先）', 'c_c6938b18dde61c51ff917d22bea83e6852d1b960250fd583cf0993865cd0172d@group.calendar.google.com', 'xxx@group.calendar.google.com', 'Zoom予約・日程確定時に必ず登録するチーム共有カレンダーのID。\n空欄の場合は SHARED_CALENDAR_ID にフォールバックします。\n方法=Zoomの場合は本IDへの登録が強制されます（重複防止）。'],
    ['DISPLAY_CALENDARS_JSON', '表示専用カレンダー（重複監視）', '[{"name":"タダスク","id":"c_b6f7dbbd799d55c2ef9f64afb519043a93d11f2408706940f87db8eb2e06d028@group.calendar.google.com"}]', '[{"name":"タダスク","id":"xxx@group.calendar.google.com"}]', '日程の重複検知に使用する読み取り専用カレンダーのリスト（JSON配列）。\nname=表示名, id=カレンダーID。複数登録可。\n空配列「[]」も可。'],
    ['SCHEDULE_BUFFER_MIN', '予約前後インターバル（分）', '30', '30', '日程確定の重複判定で前後に確保するバッファ時間（分）。\n0以上の整数。デフォルト30分。\n例: 14:00開始の60分予約 + バッファ30分 → 13:30〜15:30 を占有。'],

    // カテゴリ: メールテンプレート
    ['#メールテンプレート', 'メールテンプレート設定', '', '', ''],
    ['MAIL_FORCE_CC',      'CCメールアドレス（任意）',    '', 'cc@example.com, cc2@example.com', '通常のCCとして追加送信されます。\n空欄の場合はCCなしで送信されます。'],
    ['MAIL_DRY_RUN',       'メールドライラン',            'false', 'true / false', 'true の場合、メールは外部送信せずドライランとして記録のみ行います。\n本番運用時は false にしてください。'],
    ['ANNUAL_USAGE_LIMIT', '年度利用回数上限',            '10', '1 以上の整数', '1ユーザー1年度あたりの利用回数上限です。年度内の総対応回数がこの値を超えると新規対応/再開を制限します。'],
    ['CASE_USAGE_LIMIT',   '案件ごとの対応上限',          '3', '1 以上の整数', '1案件あたりの対応回数上限です。対応回数がこの値に達すると再開できません。'],
    ['MAIL_INITIAL_SUBJECT', '初回メール件名',       'タダサポ｜ご相談を承りました', 'タダサポ｜{{事業所名}}様のご相談を承りました', '「担当する」ボタン押下時に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_INITIAL_BODY',    '初回メール本文',       '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\n以下の内容で受付いたしました。\n\n----------------\n【ご相談内容】\n{{相談内容}}\n----------------\n\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。', '（デフォルト文を参照）', '初回メール本文。C列のセル内で改行可能（Ctrl+Enter）。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}'],
    ['MAIL_DECLINED_SUBJECT', '回数超過メール件名', 'タダサポ｜ご利用回数上限のお知らせ', 'タダサポ｜{{事業所名}}様 ご利用上限のお知らせ', '年間利用回数超過時に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_DECLINED_BODY',    '回数超過メール本文', '{{名前}} 様\n\nいつもタダサポをご利用いただきありがとうございます。\n\n誠に恐れ入りますが、{{事業所名}} 様の今年度のご利用回数が上限（10回）に達しております。\nそのため、今回のご相談につきましては対応を見送らせていただくこととなりました。\n\n大変申し訳ございませんが、何卒ご理解くださいますようお願い申し上げます。\n次年度のご利用をお待ちしております。', '（デフォルト文を参照）', '回数超過メール本文。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}'],

    // カテゴリ: システム情報
    ['#システム情報', 'システム情報（自動設定）', '', '', ''],
    ['SPREADSHEET_URL',    'スプレッドシート URL',     ss.getUrl(), '', 'このスプレッドシートのURL（自動設定・参考表示用）。\n編集不要です。']
  ];

  // --- データ書き込み ---
  sheet.getRange(1, 1, rows.length, 5).setValues(rows);

  // --- 全体の基本スタイル ---
  let allRange = sheet.getRange(1, 1, rows.length, 5);
  allRange.setVerticalAlignment('middle');
  allRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  allRange.setFontFamily('Noto Sans JP');
  allRange.setFontSize(10);

  // --- ヘッダー行 (1行目) ---
  let headerRange = sheet.getRange(1, 1, 1, 5);
  headerRange.setBackground('#0d9488').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(1, 36);

  // --- カテゴリ行のスタイル ---
  let categoryStyle = { bg: '#f0fdfa', font: '#0d9488', size: 11 };
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).charAt(0) === '#') {
      let rowNum = i + 1;
      let catRange = sheet.getRange(rowNum, 1, 1, 5);
      catRange.setBackground(categoryStyle.bg).setFontColor(categoryStyle.font).setFontWeight('bold').setFontSize(categoryStyle.size);
      sheet.setRowHeight(rowNum, 32);
      // B列のカテゴリ名をA-B結合表示風に（A列は非表示なので実質B列が見出し）
      catRange.setBorder(true, null, true, null, null, null, '#99f6e4', SpreadsheetApp.BorderStyle.SOLID);
    }
  }

  // --- 設定値列 (C列) のスタイル: 入力しやすく強調 ---
  let dataRowStart = 2;
  let dataRowCount = rows.length - 1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).charAt(0) !== '#' && rows[i][0] !== '') {
      let r = i + 1;
      // C列（設定値）を入力しやすく
      sheet.getRange(r, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
      // A列（設定キー）をグレー表示
      sheet.getRange(r, 1).setFontColor('#9ca3af').setFontSize(8);
      // B列（項目名）を太字
      sheet.getRange(r, 2).setFontWeight('bold').setFontColor('#1e293b');
      // D列（入力例）をグレーイタリック風
      sheet.getRange(r, 4).setFontColor('#9ca3af').setFontSize(9);
      // E列（説明）をグレー
      sheet.getRange(r, 5).setFontColor('#64748b').setFontSize(9);
      sheet.setRowHeight(r, 40);
    }
  }

  // --- A列を狭めて目立たないように ---
  sheet.setColumnWidth(1, 1);  // ほぼ非表示
  sheet.hideColumns(1);        // A列を非表示（コードは読めるがユーザーには見えない）

  // --- シートタブの色 ---
  sheet.setTabColor('#0d9488');

  // --- 保護: ヘッダーとカテゴリ行は警告付き保護 ---
  headerRange.protect().setDescription('ヘッダー行（編集不可）').setWarningOnly(true);

  // --- フリーズ ---
  sheet.setFrozenRows(1);

  Logger.log('設定シートを作成しました。黄色いセル（設定値）に必要な情報を入力してください。');
}

/**
 * 既存の設定シートにメールテンプレート行を追加するヘルパー。
 * 初回 setupSettingsSheet 実行後に本機能が追加された場合に使用。
 * GASエディタからこの関数を実行してください。
 */
function addEmailTemplates() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  // 既に追加済みか確認
  let data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_INITIAL_SUBJECT') {
      Logger.log('メールテンプレートは既に設定シートに存在します。');
      return;
    }
  }

  let newRows = [
    ['#メールテンプレート', 'メールテンプレート設定', '', '', ''],
    ['MAIL_INITIAL_SUBJECT', '初回メール件名', 'タダサポ｜ご相談を承りました', 'タダサポ｜{{事業所名}}様のご相談を承りました', '「担当する」ボタン押下時に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_INITIAL_BODY', '初回メール本文', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\n以下の内容で受付いたしました。\n\n----------------\n【ご相談内容】\n{{相談内容}}\n----------------\n\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。', '（デフォルト文を参照）', '初回メール本文。C列のセル内で改行可能（Ctrl+Enter）。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}']
  ];

  // システム情報カテゴリの前に挿入
  let insertBefore = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === '#システム情報') {
      insertBefore = i + 1;
      break;
    }
  }

  if (insertBefore > 0) {
    sheet.insertRowsBefore(insertBefore, newRows.length);
    sheet.getRange(insertBefore, 1, newRows.length, 5).setValues(newRows);
  } else {
    let lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 5).setValues(newRows);
    insertBefore = lastRow + 1;
  }

  // カテゴリ行スタイル
  let catRange = sheet.getRange(insertBefore, 1, 1, 5);
  catRange.setBackground('#f0fdfa').setFontColor('#0d9488').setFontWeight('bold').setFontSize(11);
  catRange.setBorder(true, null, true, null, null, null, '#99f6e4', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(insertBefore, 32);

  // データ行スタイル
  for (let j = 1; j < newRows.length; j++) {
    let r = insertBefore + j;
    sheet.getRange(r, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
    sheet.getRange(r, 1).setFontColor('#9ca3af').setFontSize(8);
    sheet.getRange(r, 2).setFontWeight('bold').setFontColor('#1e293b');
    sheet.getRange(r, 4).setFontColor('#9ca3af').setFontSize(9);
    sheet.getRange(r, 5).setFontColor('#64748b').setFontSize(9);
    sheet.setRowHeight(r, 40);
  }

  // 本文行は高さを広めに
  sheet.setRowHeight(insertBefore + newRows.length - 1, 120);

  Logger.log('メールテンプレートの設定行を追加しました。');
}

/**
 * 既存の設定シートに MAIL_FORCE_CC 行を追加するヘルパー。
 * 既に存在する場合はスキップする。
 */
function addForcedCcSetting() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  let data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_FORCE_CC') {
      Logger.log('MAIL_FORCE_CC は既に設定シートに存在します。');
      return;
    }
  }

  let insertAfterRow = -1;
  for (let j = 0; j < data.length; j++) {
    if (String(data[j][0]) === '#メールテンプレート') {
      insertAfterRow = j + 1;
      break;
    }
  }

  let newRow = [
    'MAIL_FORCE_CC',
    'CCメールアドレス（任意）',
    '',
    'cc@example.com, cc2@example.com',
    '通常のCCとして追加送信されます。\n空欄の場合はCCなしで送信されます。'
  ];

  if (insertAfterRow > 0) {
    sheet.insertRowAfter(insertAfterRow);
    sheet.getRange(insertAfterRow + 1, 1, 1, 5).setValues([newRow]);
  } else {
    let last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  let rowNum = insertAfterRow + 1;
  sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
  sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
  sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
  sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
  sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
  sheet.setRowHeight(rowNum, 40);

  Logger.log('MAIL_FORCE_CC の設定行を追加しました。');
}

/**
 * 既存の設定シートに ATTACHMENT_FOLDER_ID 行を追加するヘルパー。
 * 既に存在する場合はスキップする。
 */
/**
 * 既存の設定シートに MAIL_DRY_RUN 行を追加するヘルパー。
 * 既に存在する場合はスキップする。
 */
function addMailDryRunSetting() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  let data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_DRY_RUN') {
      Logger.log('MAIL_DRY_RUN は既に設定シートに存在します。');
      return;
    }
  }

  let insertAfterRow = -1;
  for (let j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'MAIL_FORCE_CC') {
      insertAfterRow = j + 1;
      break;
    }
  }

  let newRow = [
    'MAIL_DRY_RUN',
    'メールドライラン',
    'false',
    'true / false',
    'true の場合、メールは外部送信せずドライランとして記録のみ行います。\n本番運用時は false にしてください。'
  ];

  if (insertAfterRow > 0) {
    sheet.insertRowAfter(insertAfterRow);
    sheet.getRange(insertAfterRow + 1, 1, 1, 5).setValues([newRow]);
  } else {
    let last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  let rowNum = insertAfterRow + 1;
  sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
  sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
  sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
  sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
  sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
  sheet.setRowHeight(rowNum, 40);

  Logger.log('MAIL_DRY_RUN の設定行を追加しました。');
}

function addUsageLimitSettings() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  let data = sheet.getDataRange().getValues();
  let hasAnnual = false;
  let hasCase = false;
  for (let i = 0; i < data.length; i++) {
    let key = String(data[i][0] || '');
    if (key === 'ANNUAL_USAGE_LIMIT') hasAnnual = true;
    if (key === 'CASE_USAGE_LIMIT') hasCase = true;
  }
  if (hasAnnual && hasCase) return;

  let insertAfterRow = -1;
  for (let j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'MAIL_DRY_RUN') {
      insertAfterRow = j + 1;
      break;
    }
  }

  let newRows = [];
  if (!hasAnnual) {
    newRows.push([
      'ANNUAL_USAGE_LIMIT',
      '年度利用回数上限',
      '10',
      '1 以上の整数',
      '1ユーザー1年度あたりの利用回数上限です。年度内の総対応回数がこの値を超えると新規対応/再開を制限します。'
    ]);
  }
  if (!hasCase) {
    newRows.push([
      'CASE_USAGE_LIMIT',
      '案件ごとの対応上限',
      '3',
      '1 以上の整数',
      '1案件あたりの対応回数上限です。対応回数がこの値に達すると再開できません。'
    ]);
  }
  if (!newRows.length) return;

  if (insertAfterRow > 0) {
    sheet.insertRowsAfter(insertAfterRow, newRows.length);
    sheet.getRange(insertAfterRow + 1, 1, newRows.length, 5).setValues(newRows);
  } else {
    let last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, newRows.length, 5).setValues(newRows);
    insertAfterRow = last;
  }

  for (let r = 0; r < newRows.length; r++) {
    let rowNum = insertAfterRow + 1 + r;
    sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
    sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
    sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
    sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
    sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
    sheet.setRowHeight(rowNum, 40);
  }
}

function addAttachmentFolderSetting() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  let data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'ATTACHMENT_FOLDER_ID') {
      Logger.log('ATTACHMENT_FOLDER_ID は既に存在します。');
      return;
    }
  }

  let insertAfterRow = -1;
  for (let j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'SHARED_CALENDAR_ID') {
      insertAfterRow = j + 1;
      break;
    }
  }

  let newRow = ['ATTACHMENT_FOLDER_ID', '添付ファイル保存先フォルダID', '', '1AbCdEfGhIjKlMnOpQrStUvWxYz', '完了報告/記録修正でアップロードした添付ファイルの保存先Google DriveフォルダID。\nGoogle Drive フォルダURLの /folders/ の後ろの値を入力してください。'];

  if (insertAfterRow > 0) {
    sheet.insertRowAfter(insertAfterRow);
    sheet.getRange(insertAfterRow + 1, 1, 1, 5).setValues([newRow]);
  } else {
    let last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  let rowNum = insertAfterRow + 1;
  sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
  sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
  sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
  sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
  sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
  sheet.setRowHeight(rowNum, 40);

  Logger.log('ATTACHMENT_FOLDER_ID の設定行を追加しました。');
}

/**
 * サポート記録シートに ATTACHMENTS 列（O列）を追加する。
 * 既に存在する場合はスキップ。
 */
function addAttachmentsColumnToRecords() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) {
    throw new Error('「サポート記録」シートが見つかりません。');
  }

  let headerRow = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  let expectedHeader = '添付ファイルJSON';

  // 既にO列（15列目）に存在する場合
  if (sheet.getLastColumn() >= 15 && String(sheet.getRange(1, 15).getValue()) === expectedHeader) {
    Logger.log('サポート記録シートの ATTACHMENTS 列は既に存在します。');
    return;
  }

  // ヘッダー行から既存位置を探索（別位置に存在する場合はそのまま利用）
  for (let i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i]) === expectedHeader) {
      Logger.log('添付ファイルJSON 列は既に存在します（列: ' + (i + 1) + '）。');
      return;
    }
  }

  // N列の後ろ（15列目）に追加
  if (sheet.getLastColumn() < 15) {
    let addCount = 15 - sheet.getLastColumn();
    sheet.insertColumnsAfter(sheet.getLastColumn(), addCount);
  } else {
    sheet.insertColumnAfter(14);
  }

  sheet.getRange(1, 15).setValue(expectedHeader);

  // 既存データ行を '[]' で初期化（空セルのみ）
  let lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    let range = sheet.getRange(2, 15, lastRow - 1, 1);
    let values = range.getValues();
    for (let r = 0; r < values.length; r++) {
      if (!values[r][0]) values[r][0] = '[]';
    }
    range.setValues(values);
  }

  Logger.log('サポート記録シートに ATTACHMENTS 列（O列）を追加しました。');
}

/**
 * 添付機能向けスキーマ整備を一括実行する。
 * 1) 設定シートへ ATTACHMENT_FOLDER_ID を追加
 * 2) サポート記録へ ATTACHMENTS 列を追加
 */
function addCaseLimitOverrideColumnsToRecords() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  let expectedCaseHeader = '案件上限上書き';
  let expectedAnnualHeader = '年度上限上書き';
  let requiredColumns = IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1;

  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }
  if (String(sheet.getRange(1, IDX.RECORDS.CASE_LIMIT_OVERRIDE + 1).getValue() || '').trim() !== expectedCaseHeader) {
    sheet.getRange(1, IDX.RECORDS.CASE_LIMIT_OVERRIDE + 1).setValue(expectedCaseHeader);
  }
  if (String(sheet.getRange(1, IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1).getValue() || '').trim() !== expectedAnnualHeader) {
    sheet.getRange(1, IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1).setValue(expectedAnnualHeader);
  }
}

/**
 * サポート記録シートに TOOLS 列（R列 = 18列目）を追加する。
 * 既に存在する場合はスキップする。
 */
function addToolsColumnToRecords() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  let requiredColumns = IDX.RECORDS.TOOLS + 1; // 18
  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }
  let header = String(sheet.getRange(1, IDX.RECORDS.TOOLS + 1).getValue() || '').trim();
  if (!header) {
    sheet.getRange(1, IDX.RECORDS.TOOLS + 1).setValue('対応ツール');
    Logger.log('サポート記録シートに 対応ツール 列を追加しました。');
  }
}

function addSubStaffColumnToRecords() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  let requiredColumns = IDX.RECORDS.SUB_STAFF + 1; // 19
  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }
  let header = String(sheet.getRange(1, IDX.RECORDS.SUB_STAFF + 1).getValue() || '').trim();
  if (!header) {
    sheet.getRange(1, IDX.RECORDS.SUB_STAFF + 1).setValue('サブ担当');
    Logger.log('サポート記録シートに サブ担当 列を追加しました。');
  }
}

function setupAttachmentFeatureSchema() {
  ensureAdminSchema_();
  addForcedCcSetting();
  addMailDryRunSetting();
  addUsageLimitSettings();
  addAttachmentFolderSetting();
  addAttachmentsColumnToRecords();
  addCaseLimitOverrideColumnsToRecords();
  Logger.log('添付機能向けスキーマ整備が完了しました。');
}


// ======================================================================
// v1.11.0: メール下書き機能
// ======================================================================
// 複合キー: (CASE_ID, STAFF_EMAIL, MODE, THREAD_ID) で1レコード
// MODE: 'initial' | 'new' | 'reply' | 'schedule' | 'decline'
// THREAD_ID: reply モードの場合のみ値あり、それ以外は空文字
// ======================================================================

function ensureDraftsSheet_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_DRAFTS);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAMES.EMAIL_DRAFTS);
  let headers = ['下書きID', '案件ID', '担当者メール', 'モード', 'スレッドID', '件名', '本文', 'CC', 'BCC', '対応ツール(JSON)', '更新日時'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#7c3aed').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setTabColor('#a78bfa');
  sheet.setColumnWidth(1, 180); // DRAFT_ID
  sheet.setColumnWidth(2, 140); // CASE_ID
  sheet.setColumnWidth(3, 180); // STAFF_EMAIL
  sheet.setColumnWidth(4, 80);  // MODE
  sheet.setColumnWidth(5, 160); // THREAD_ID
  sheet.setColumnWidth(6, 220); // SUBJECT
  sheet.setColumnWidth(7, 400); // BODY
  sheet.setColumnWidth(8, 180); // CC
  sheet.setColumnWidth(9, 180); // BCC
  sheet.setColumnWidth(10, 160);// TOOLS
  sheet.setColumnWidth(11, 140);// UPDATED_AT
  return sheet;
}

function normalizeDraftKey_(caseId, staffEmail, mode, threadId) {
  return String(caseId || '') + '|' + normalizeEmail_(staffEmail || '') + '|' + String(mode || '') + '|' + String(threadId || '');
}

/**
 * 下書きを保存（upsert）する。
 * payload: { caseId, mode, threadId, subject, body, cc, bcc, tools }
 * 既存の同キー下書きは上書き、なければ追記。
 */
function saveDraft(payload) {
  if (!payload || !payload.caseId || !payload.mode) {
    throw new Error('下書き保存には caseId と mode が必要です。');
  }
  let actor = getActor_();
  let staffEmail = actor.email;
  let sheet = ensureDraftsSheet_();

  let caseId = String(payload.caseId);
  let mode = String(payload.mode);
  let threadId = String(payload.threadId || '');
  let subject = String(payload.subject || '');
  let body = String(payload.body || '');
  let cc = String(payload.cc || '');
  let bcc = String(payload.bcc || '');
  let toolsJson = '';
  if (payload.tools && Array.isArray(payload.tools)) {
    toolsJson = JSON.stringify(payload.tools);
  }
  let now = new Date();
  let targetKey = normalizeDraftKey_(caseId, staffEmail, mode, threadId);

  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let rowKey = normalizeDraftKey_(data[i][IDX.DRAFT.CASE_ID], data[i][IDX.DRAFT.STAFF_EMAIL], data[i][IDX.DRAFT.MODE], data[i][IDX.DRAFT.THREAD_ID]);
    if (rowKey === targetKey) {
      let rowNum = i + 1;
      sheet.getRange(rowNum, IDX.DRAFT.SUBJECT + 1).setValue(subject);
      sheet.getRange(rowNum, IDX.DRAFT.BODY + 1).setValue(body);
      sheet.getRange(rowNum, IDX.DRAFT.CC + 1).setValue(cc);
      sheet.getRange(rowNum, IDX.DRAFT.BCC + 1).setValue(bcc);
      sheet.getRange(rowNum, IDX.DRAFT.TOOLS + 1).setValue(toolsJson);
      sheet.getRange(rowNum, IDX.DRAFT.UPDATED_AT + 1).setValue(now);
      return { draftId: String(data[i][IDX.DRAFT.DRAFT_ID]), updatedAt: now.toISOString() };
    }
  }

  let draftId = 'draft-' + Utilities.getUuid();
  sheet.appendRow([draftId, caseId, staffEmail, mode, threadId, subject, body, cc, bcc, toolsJson, now]);
  return { draftId: draftId, updatedAt: now.toISOString() };
}

/**
 * 指定キーの下書きを取得する。
 * 戻り値: 下書きオブジェクト or null
 */
function loadDraft(caseId, mode, threadId) {
  let actor = getActor_();
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_DRAFTS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  let targetKey = normalizeDraftKey_(caseId, actor.email, mode, threadId);
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let rowKey = normalizeDraftKey_(data[i][IDX.DRAFT.CASE_ID], data[i][IDX.DRAFT.STAFF_EMAIL], data[i][IDX.DRAFT.MODE], data[i][IDX.DRAFT.THREAD_ID]);
    if (rowKey === targetKey) {
      let toolsJson = String(data[i][IDX.DRAFT.TOOLS] || '');
      let tools = [];
      if (toolsJson) {
        try { tools = JSON.parse(toolsJson); } catch (e) { tools = []; }
      }
      let updatedAt = data[i][IDX.DRAFT.UPDATED_AT];
      return {
        draftId: String(data[i][IDX.DRAFT.DRAFT_ID]),
        caseId: String(data[i][IDX.DRAFT.CASE_ID]),
        mode: String(data[i][IDX.DRAFT.MODE]),
        threadId: String(data[i][IDX.DRAFT.THREAD_ID] || ''),
        subject: String(data[i][IDX.DRAFT.SUBJECT] || ''),
        body: String(data[i][IDX.DRAFT.BODY] || ''),
        cc: String(data[i][IDX.DRAFT.CC] || ''),
        bcc: String(data[i][IDX.DRAFT.BCC] || ''),
        tools: tools,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null
      };
    }
  }
  return null;
}

/**
 * 指定キーの下書きを削除する。
 */
function deleteDraft(caseId, mode, threadId) {
  let actor = getActor_();
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_DRAFTS);
  if (!sheet || sheet.getLastRow() < 2) return { deleted: false };

  let targetKey = normalizeDraftKey_(caseId, actor.email, mode, threadId);
  let data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    let rowKey = normalizeDraftKey_(data[i][IDX.DRAFT.CASE_ID], data[i][IDX.DRAFT.STAFF_EMAIL], data[i][IDX.DRAFT.MODE], data[i][IDX.DRAFT.THREAD_ID]);
    if (rowKey === targetKey) {
      sheet.deleteRow(i + 1);
      return { deleted: true };
    }
  }
  return { deleted: false };
}

/**
 * 案件に紐づく現在ユーザーの全下書きを返す。
 * 戻り値: [{ draftId, mode, threadId, subject, body, cc, bcc, tools, updatedAt }, ...]
 */
function listDraftsForCase(caseId) {
  let actor = getActor_();
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_DRAFTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  let data = sheet.getDataRange().getValues();
  let userEmail = normalizeEmail_(actor.email);
  let target = String(caseId || '');
  let out = [];
  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail_(data[i][IDX.DRAFT.STAFF_EMAIL]) !== userEmail) continue;
    if (String(data[i][IDX.DRAFT.CASE_ID]) !== target) continue;
    let toolsJson = String(data[i][IDX.DRAFT.TOOLS] || '');
    let tools = [];
    if (toolsJson) { try { tools = JSON.parse(toolsJson); } catch (e) {} }
    let updatedAt = data[i][IDX.DRAFT.UPDATED_AT];
    out.push({
      draftId: String(data[i][IDX.DRAFT.DRAFT_ID]),
      caseId: String(data[i][IDX.DRAFT.CASE_ID]),
      mode: String(data[i][IDX.DRAFT.MODE]),
      threadId: String(data[i][IDX.DRAFT.THREAD_ID] || ''),
      subject: String(data[i][IDX.DRAFT.SUBJECT] || ''),
      body: String(data[i][IDX.DRAFT.BODY] || ''),
      cc: String(data[i][IDX.DRAFT.CC] || ''),
      bcc: String(data[i][IDX.DRAFT.BCC] || ''),
      tools: tools,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null
    });
  }
  return out;
}

/**
 * 下書きを持つ案件IDの一覧（現在ユーザー分）を返す。
 * バッジ表示用の軽量クエリ。
 */
function listDraftCaseIdsForUser_(userEmail) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_DRAFTS);
  if (!sheet || sheet.getLastRow() < 2) return [];

  let data = sheet.getDataRange().getValues();
  let target = normalizeEmail_(userEmail);
  let seen = {};
  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail_(data[i][IDX.DRAFT.STAFF_EMAIL]) !== target) continue;
    seen[String(data[i][IDX.DRAFT.CASE_ID])] = true;
  }
  return Object.keys(seen);
}


// ======================================================================
// v1.11.0: 予約送信機能
// ======================================================================
// PK: QUEUE_ID（UUID）
// MODE: 'initial' | 'new' | 'reply' | 'schedule' | 'decline'
// STATUS: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'skipped'
// 時間主導トリガーで processScheduledEmails_ が5分おきに実行され、
// SEND_AT <= now のペンディング行を処理する。
// ======================================================================

var SCHEDULED_STUCK_MINUTES = 10;       // 'sending' でこの分数を超えたらスタック扱い
var SCHEDULED_BATCH_LIMIT = 20;         // 1回のトリガーで処理する最大件数
var SCHEDULED_VALID_MODES = { initial: 1, 'new': 1, reply: 1, schedule: 1, decline: 1 };

function ensureScheduledSheet_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAMES.EMAIL_SCHEDULED);
  let headers = ['キューID', '案件ID', '担当者メール', '担当者名', 'モード', 'スレッドID', '件名', '本文', 'CC', 'BCC', '対応ツール(JSON)', '送信予定時刻', 'ステータス', 'エラー', '作成日時', '送信完了日時'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#be185d').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setTabColor('#f472b6');
  sheet.setColumnWidth(1, 200);  // QUEUE_ID
  sheet.setColumnWidth(2, 140);  // CASE_ID
  sheet.setColumnWidth(3, 180);  // STAFF_EMAIL
  sheet.setColumnWidth(4, 120);  // STAFF_NAME
  sheet.setColumnWidth(5, 80);   // MODE
  sheet.setColumnWidth(6, 140);  // THREAD_ID
  sheet.setColumnWidth(7, 220);  // SUBJECT
  sheet.setColumnWidth(8, 400);  // BODY
  sheet.setColumnWidth(9, 180);  // CC
  sheet.setColumnWidth(10, 180); // BCC
  sheet.setColumnWidth(11, 160); // TOOLS
  sheet.setColumnWidth(12, 140); // SEND_AT
  sheet.setColumnWidth(13, 80);  // STATUS
  sheet.setColumnWidth(14, 300); // ERROR
  sheet.setColumnWidth(15, 140); // CREATED_AT
  sheet.setColumnWidth(16, 140); // SENT_AT
  return sheet;
}

/**
 * 予約送信を登録する。
 * payload: { caseId, mode, threadId, subject, body, cc, bcc, tools, sendAt (ISO string) }
 */
function scheduleEmail(payload) {
  if (!payload) throw new Error('payload が不正です');
  if (!payload.caseId) throw new Error('caseId が必要です');
  if (!payload.mode || !SCHEDULED_VALID_MODES[payload.mode]) throw new Error('mode が不正です: ' + payload.mode);
  if (!payload.sendAt) throw new Error('送信予定時刻が必要です');

  let sendAt = new Date(payload.sendAt);
  if (isNaN(sendAt.getTime())) throw new Error('送信予定時刻の形式が不正です');
  let now = new Date();
  // 1分未満の予約は不可（トリガー間隔との衝突防止）
  if (sendAt.getTime() - now.getTime() < 60 * 1000) {
    throw new Error('送信予定時刻は現在時刻より1分以上先を指定してください');
  }

  let actor = getActor_();
  let sheet = ensureScheduledSheet_();
  let queueId = 'sch-' + Utilities.getUuid();

  sheet.appendRow([
    queueId,
    String(payload.caseId),
    actor.email,
    actor.name,
    String(payload.mode),
    String(payload.threadId || ''),
    String(payload.subject || ''),
    String(payload.body || ''),
    String(payload.cc || ''),
    String(payload.bcc || ''),
    (payload.tools && Array.isArray(payload.tools)) ? JSON.stringify(payload.tools) : '',
    sendAt,
    'pending',
    '',
    now,
    ''
  ]);

  return {
    queueId: queueId,
    sendAt: sendAt.toISOString(),
    status: 'pending'
  };
}

/**
 * 予約送信をキャンセルする（pending のみ可）。
 */
function cancelScheduledEmail(queueId) {
  if (!queueId) throw new Error('queueId が必要です');
  let actor = getActor_();
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('予約送信が見つかりません');

  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.SCHEDULED.QUEUE_ID]) !== String(queueId)) continue;

    // 本人または管理者のみキャンセル可
    let ownerEmail = normalizeEmail_(data[i][IDX.SCHEDULED.STAFF_EMAIL]);
    if (ownerEmail !== normalizeEmail_(actor.email) && !actor.isAdmin) {
      throw new Error('この予約送信をキャンセルする権限がありません');
    }
    let status = String(data[i][IDX.SCHEDULED.STATUS] || '');
    if (status !== 'pending') {
      throw new Error('このステータスの予約はキャンセルできません: ' + status);
    }
    let rowNum = i + 1;
    sheet.getRange(rowNum, IDX.SCHEDULED.STATUS + 1).setValue('cancelled');
    return { cancelled: true };
  }
  throw new Error('予約送信が見つかりません: ' + queueId);
}

/**
 * 指定案件に紐づく予約送信（pending/sending のみ）を返す。
 */
function listScheduledForCase(caseId) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  if (!sheet || sheet.getLastRow() < 2) return [];

  let data = sheet.getDataRange().getValues();
  let out = [];
  let target = String(caseId || '');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][IDX.SCHEDULED.CASE_ID]) !== target) continue;
    let status = String(data[i][IDX.SCHEDULED.STATUS] || '');
    if (status !== 'pending' && status !== 'sending') continue;
    out.push(mapScheduledRow_(data[i]));
  }
  return out;
}

/**
 * 現在ユーザーのペンディング予約案件ID一覧（バッジ表示用）
 */
function listScheduledCaseIdsForUser_(userEmail) {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  if (!sheet || sheet.getLastRow() < 2) return [];
  let data = sheet.getDataRange().getValues();
  let target = normalizeEmail_(userEmail);
  let seen = {};
  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail_(data[i][IDX.SCHEDULED.STAFF_EMAIL]) !== target) continue;
    let status = String(data[i][IDX.SCHEDULED.STATUS] || '');
    if (status !== 'pending' && status !== 'sending') continue;
    seen[String(data[i][IDX.SCHEDULED.CASE_ID])] = true;
  }
  return Object.keys(seen);
}

function mapScheduledRow_(row) {
  let toolsJson = String(row[IDX.SCHEDULED.TOOLS] || '');
  let tools = [];
  if (toolsJson) { try { tools = JSON.parse(toolsJson); } catch (e) {} }
  return {
    queueId: String(row[IDX.SCHEDULED.QUEUE_ID]),
    caseId: String(row[IDX.SCHEDULED.CASE_ID]),
    staffEmail: String(row[IDX.SCHEDULED.STAFF_EMAIL]),
    staffName: String(row[IDX.SCHEDULED.STAFF_NAME]),
    mode: String(row[IDX.SCHEDULED.MODE]),
    threadId: String(row[IDX.SCHEDULED.THREAD_ID] || ''),
    subject: String(row[IDX.SCHEDULED.SUBJECT] || ''),
    body: String(row[IDX.SCHEDULED.BODY] || ''),
    cc: String(row[IDX.SCHEDULED.CC] || ''),
    bcc: String(row[IDX.SCHEDULED.BCC] || ''),
    tools: tools,
    sendAt: row[IDX.SCHEDULED.SEND_AT] ? new Date(row[IDX.SCHEDULED.SEND_AT]).toISOString() : null,
    status: String(row[IDX.SCHEDULED.STATUS] || ''),
    error: String(row[IDX.SCHEDULED.ERROR] || ''),
    createdAt: row[IDX.SCHEDULED.CREATED_AT] ? new Date(row[IDX.SCHEDULED.CREATED_AT]).toISOString() : null,
    sentAt: row[IDX.SCHEDULED.SENT_AT] ? new Date(row[IDX.SCHEDULED.SENT_AT]).toISOString() : null
  };
}

/**
 * トリガーから5分おきに呼ばれる。
 * 送信時刻を過ぎた pending 行をバッチ処理する。
 */
function processScheduledEmails_() {
  let lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('processScheduledEmails_: 他の実行中のためスキップ');
    return;
  }

  try {
    let ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
    if (!sheet || sheet.getLastRow() < 2) return;

    let data = sheet.getDataRange().getValues();
    let now = new Date();
    let stuckCutoff = new Date(now.getTime() - SCHEDULED_STUCK_MINUTES * 60 * 1000);

    // 1. 処理対象行を抽出（pending で期限到来、または sending でスタック）
    let targets = [];
    for (let i = 1; i < data.length; i++) {
      let row = data[i];
      let status = String(row[IDX.SCHEDULED.STATUS] || '');
      let sendAt = row[IDX.SCHEDULED.SEND_AT] ? new Date(row[IDX.SCHEDULED.SEND_AT]) : null;
      if (!sendAt) continue;
      let isDue = sendAt.getTime() <= now.getTime();
      if (status === 'pending' && isDue) {
        targets.push({ rowNum: i + 1, row: row });
      } else if (status === 'sending' && sendAt.getTime() < stuckCutoff.getTime()) {
        // スタック行を再処理
        targets.push({ rowNum: i + 1, row: row });
      }
      if (targets.length >= SCHEDULED_BATCH_LIMIT) break;
    }

    if (targets.length === 0) return;

    // 2. 'sending' に一括マーク（ロック解放前）
    targets.forEach(function(t) {
      sheet.getRange(t.rowNum, IDX.SCHEDULED.STATUS + 1).setValue('sending');
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // 3. 各行を順次送信（ロック外で実行）
  // 再取得してクレーム済み行を処理
  let ss2 = getSpreadsheet_();
  let sheet2 = ss2.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  let data2 = sheet2.getDataRange().getValues();
  for (let j = 1; j < data2.length; j++) {
    if (String(data2[j][IDX.SCHEDULED.STATUS]) !== 'sending') continue;
    let rowNum = j + 1;
    let scheduled = mapScheduledRow_(data2[j]);
    try {
      let result = sendScheduledRow_(scheduled);
      sheet2.getRange(rowNum, IDX.SCHEDULED.STATUS + 1).setValue(result.status || 'sent');
      sheet2.getRange(rowNum, IDX.SCHEDULED.ERROR + 1).setValue(result.note || '');
      sheet2.getRange(rowNum, IDX.SCHEDULED.SENT_AT + 1).setValue(new Date());
    } catch (e) {
      sheet2.getRange(rowNum, IDX.SCHEDULED.STATUS + 1).setValue('failed');
      sheet2.getRange(rowNum, IDX.SCHEDULED.ERROR + 1).setValue(String(e && e.message ? e.message : e));
    }
  }
}

/**
 * 予約送信キューの1行を送信する。
 * 戻り値: { status: 'sent'|'skipped', note?: string }
 */
function sendScheduledRow_(s) {
  // 案件の宛先取得
  let recipientEmail = getRecipientEmail_(s.caseId);
  if (!recipientEmail) {
    return { status: 'skipped', note: '案件が見つかりません' };
  }

  // 予約時のスタッフをactorとして扱う（トリガー実行者ではない）
  let scheduledActor = { email: s.staffEmail, name: s.staffName, isAdmin: false };

  let ss = getSpreadsheet_();
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  let recordData = recordSheet.getDataRange().getValues();
  let caseRow = -1;
  let currentStatus = '';
  for (let i = 1; i < recordData.length; i++) {
    if (String(recordData[i][IDX.RECORDS.FK]) === String(s.caseId)) {
      caseRow = i + 1;
      currentStatus = String(recordData[i][IDX.RECORDS.STATUS] || '');
      break;
    }
  }

  // キャンセル済/対応不可になった案件は送信しない
  if (currentStatus === 'cancelled' || currentStatus === 'rejected') {
    return { status: 'skipped', note: '案件ステータスが ' + currentStatus + ' のため送信を中止' };
  }

  // 実送信
  let sendResult = sendInThread_(
    recipientEmail,
    s.subject,
    s.body,
    s.threadId || null,
    s.threadId ? getLastMessageId_(s.threadId) : null,
    s.cc || null,
    s.bcc || null
  );

  // 新規スレッドの場合は保存
  if (!s.threadId && sendResult.threadId) {
    storeThreadId_(s.caseId, sendResult.threadId);
  }

  // モード固有の後処理
  if (s.mode === 'initial' && currentStatus === 'unhandled') {
    // 担当アサイン（ステータスとスタッフ情報を更新）
    let toolsVal = (s.tools && s.tools.length > 0) ? JSON.stringify(s.tools) : '[]';
    if (caseRow === -1) {
      recordSheet.appendRow([
        s.caseId, 'inProgress', scheduledActor.email, scheduledActor.name,
        null, 1, null, null, null, null, null, null, null, null, '[]', '', '', toolsVal, '[]'
      ]);
    } else {
      recordSheet.getRange(caseRow, IDX.RECORDS.STATUS + 1).setValue('inProgress');
      recordSheet.getRange(caseRow, IDX.RECORDS.STAFF_EMAIL + 1).setValue(scheduledActor.email);
      recordSheet.getRange(caseRow, IDX.RECORDS.STAFF_NAME + 1).setValue(scheduledActor.name);
      if (toolsVal !== '[]') {
        recordSheet.getRange(caseRow, IDX.RECORDS.TOOLS + 1).setValue(toolsVal);
      }
    }
  } else if (s.mode === 'decline') {
    // 対応不可にステータス変更
    if (caseRow === -1) {
      recordSheet.appendRow([
        s.caseId, 'rejected', scheduledActor.email, scheduledActor.name,
        null, 1, null, null, null, null, null, null, null, null, '[]', '', '', '[]', '[]'
      ]);
    } else {
      recordSheet.getRange(caseRow, IDX.RECORDS.STATUS + 1).setValue('rejected');
    }
  }

  // メール履歴に記録
  recordEmail_(s.caseId, scheduledActor, recipientEmail, s.subject, s.body);
  return { status: 'sent' };
}

/**
 * v1.11.7 で追加された日程・Zoom予約関連の設定キーを既存の設定シートに追加する。
 * GASエディタからこの関数を1回だけ手動実行してください。
 * 既に存在するキーはスキップされます。
 */
function addScheduleZoomSettings() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  let data = sheet.getDataRange().getValues();
  let existingKeys = {};
  for (let i = 0; i < data.length; i++) existingKeys[String(data[i][0]).trim()] = true;

  // 既に全部あるならスキップ
  let targetKeys = ['ZOOM_FIXED_URL','ZOOM_FIXED_ID','ZOOM_FIXED_PASS','TEAM_CALENDAR_ID','DISPLAY_CALENDARS_JSON','SCHEDULE_BUFFER_MIN'];
  let missing = targetKeys.filter(function(k){ return !existingKeys[k]; });
  if (!missing.length) {
    Logger.log('日程・Zoom予約関連の設定キーは既に全て存在します。');
    return;
  }

  let newRows = [
    ['#日程・予約管理', '日程・予約管理設定（v1.11.7+）', '', '', ''],
    ['ZOOM_FIXED_URL',     '固定Zoom URL',             '', 'https://zoom.us/j/97381145741?pwd=...', '「いつものタダスクID」モードで再利用する固定 Zoom ミーティングの参加URL。\n空欄の場合は固定IDモードを使用しません（毎回新規発行）。'],
    ['ZOOM_FIXED_ID',      '固定Zoom ID',              '', '973 8114 5741',                     '「いつものタダスクID」の Zoom ミーティング ID。'],
    ['ZOOM_FIXED_PASS',    '固定Zoomパスコード',       '', 'tadasc',                            '「いつものタダスクID」の参加パスコード。'],
    ['TEAM_CALENDAR_ID',   'チームカレンダー ID（書込先）', 'c_c6938b18dde61c51ff917d22bea83e6852d1b960250fd583cf0993865cd0172d@group.calendar.google.com', 'xxx@group.calendar.google.com', 'Zoom予約・日程確定時に必ず登録するチーム共有カレンダーID。\n空欄時は SHARED_CALENDAR_ID にフォールバック。\n方法=Zoomの場合は本IDへの登録が強制されます（重複防止）。'],
    ['DISPLAY_CALENDARS_JSON', '表示専用カレンダー（重複監視）', '[{"name":"タダスク","id":"c_b6f7dbbd799d55c2ef9f64afb519043a93d11f2408706940f87db8eb2e06d028@group.calendar.google.com"}]', '[{"name":"タダスク","id":"xxx@group.calendar.google.com"}]', '日程の重複検知に使用する読み取り専用カレンダーのリスト（JSON配列）。\nname=表示名, id=カレンダーID。複数登録可。'],
    ['SCHEDULE_BUFFER_MIN', '予約前後インターバル（分）', '30', '30', '日程確定の重複判定で前後に確保するバッファ時間（分）。\n0以上の整数。']
  ];

  // システム情報カテゴリの前に挿入。なければ末尾。
  let insertBefore = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === '#システム情報') { insertBefore = i + 1; break; }
  }

  // 既存キーは飛ばす
  let toInsert = newRows.filter(function(row){
    let k = String(row[0]).trim();
    if (k.charAt(0) === '#') return true;
    return !existingKeys[k];
  });
  // カテゴリ行が単独になりそうなら除く
  if (toInsert.length === 1 && String(toInsert[0][0]).charAt(0) === '#') return;

  let startRow;
  if (insertBefore > 0) {
    sheet.insertRowsBefore(insertBefore, toInsert.length);
    sheet.getRange(insertBefore, 1, toInsert.length, 5).setValues(toInsert);
    startRow = insertBefore;
  } else {
    let last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, toInsert.length, 5).setValues(toInsert);
    startRow = last + 1;
  }

  // スタイル適用
  for (let j = 0; j < toInsert.length; j++) {
    let r = startRow + j;
    let key = String(toInsert[j][0]);
    if (key.charAt(0) === '#') {
      sheet.getRange(r, 1, 1, 5).setBackground('#f0fdfa').setFontColor('#0d9488').setFontWeight('bold').setFontSize(11);
      sheet.setRowHeight(r, 32);
    } else {
      sheet.getRange(r, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
      sheet.getRange(r, 1).setFontColor('#9ca3af').setFontSize(8);
      sheet.getRange(r, 2).setFontWeight('bold').setFontColor('#1e293b');
      sheet.getRange(r, 4).setFontColor('#9ca3af').setFontSize(9);
      sheet.getRange(r, 5).setFontColor('#64748b').setFontSize(9);
      sheet.setRowHeight(r, 40);
    }
  }

  _settingsCache = null;
  Logger.log('日程・Zoom予約関連の設定行を追加しました（' + toInsert.length + '行）。');
}

/**
 * 予約送信トリガーをセットアップする（GASエディタから手動実行）。
 * 既存のトリガーがあれば削除して再作成。5分間隔。
 */
function setupScheduledEmailTrigger() {
  removeScheduledEmailTrigger();
  ScriptApp.newTrigger('processScheduledEmails_')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('予約送信トリガーを設定しました（5分間隔）');
}

function removeScheduledEmailTrigger() {
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processScheduledEmails_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * 予約送信トリガーの稼働状態を確認する（管理者UI用）。
 */
function getScheduledEmailTriggerStatus() {
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processScheduledEmails_') {
      return { active: true, triggerId: triggers[i].getUniqueId() };
    }
  }
  return { active: false };
}

