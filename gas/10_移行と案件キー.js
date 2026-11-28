// ======================================================================
// 移行と案件キー — スキーマの自動移行・初期構築の本体・案件キーのサロゲート化（S1）
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// S1 Stage1: 案件キーマップ（案件の不変サロゲートID ↔ 自然キーの対応表）
//   ★Expand 基盤。本 PR ではどの既存経路からも呼ばれない（未接続）。
//   次段 Dual-write で案件作成・初回タッチ時に getOrCreateCaseId_ を接続する。
// ======================================================================

// 案件キーマップシートを取得（なければ作成）。getOrCreateAuditLogSheet_ と同型。
function getOrCreateCaseKeyMapSheet_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.CASE_KEY_MAP);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET_NAMES.CASE_KEY_MAP);
  sheet.getRange(1, 1, 1, 5).setValues([[
    '案件ID', '種別', '自然キー_正準化', '正規化メール', '作成日時'
  ]]);
  sheet.setFrozenRows(1);
  return sheet;
}

// 案件の不変サロゲートID(case_id)を取得（なければ採番して登録）。冪等。
//   - withScriptLock_ 内で find-or-create を不可分化（Sheetsは制約を強制できないためコードで強制）
//   - (種別, 自然キー_正準化) を一意キーとして既存検索 → あれば既存 case_id を返す
//   - 万一クロス種別で同 epoch（case_id衝突）かつ自然キー不一致なら連番サフィックスで回避
function getOrCreateCaseId_(pkRaw, emailRaw) {
  let nk = canonicalNaturalKey_(pkRaw);
  if (!nk) return null; // パース不能は安全停止（呼び出し側でスキップ）
  return withScriptLock_(function() {
    let sheet = getOrCreateCaseKeyMapSheet_();
    let data = sheet.getDataRange().getValues();
    let usedCaseIds = {};
    for (let i = 1; i < data.length; i++) {
      let row = data[i];
      let existingType = String(row[CASE_KEY_MAP_COL.SOURCE_TYPE]);
      let existingNk = String(row[CASE_KEY_MAP_COL.NATURAL_KEY]);
      let existingId = String(row[CASE_KEY_MAP_COL.CASE_ID]);
      if (existingId) usedCaseIds[existingId] = true;
      // 一意キー (種別, 自然キー_正準化) で既存一致 → 冪等に既存IDを返す
      if (existingType === nk.sourceType && existingNk === nk.canonical) {
        return existingId;
      }
    }
    // 新規採番（決定的 case_<epoch>）。クロス種別epoch衝突時のみ連番で回避。
    let caseId = buildCaseId_(nk.epoch);
    if (usedCaseIds[caseId]) {
      let suffix = 1;
      while (usedCaseIds[caseId + '_' + suffix]) suffix++;
      let collidedId = caseId;
      caseId = caseId + '_' + suffix;
      appendAuditLog_(
        { email: 'system', name: 'case-key-map' },
        'caseIdCollisionResolved', 'caseKeyMap', caseId,
        { collidedWith: collidedId, sourceType: nk.sourceType }, { naturalKey: nk.canonical }
      );
    }
    sheet.appendRow([
      caseId, nk.sourceType, nk.canonical, normalizeEmail_(emailRaw), new Date()
    ]);
    return caseId;
  });
}

// ----------------------------------------------------------------------
// S1 Stage2: Dual-write（案件キーマップへの登録を書込チョークポイントに接続）
//   ★additive・非致死: 案件キーマップへ追記するだけ。既存の読み取り・FK列・
//   ユーザー操作の結果には一切影響しない。失敗しても本処理は止めない
//   （未登録分は Stage3 Backfill が権威的に補完するため安全）。
// ----------------------------------------------------------------------

// caseId(=現行の自然キー文字列)から案件本体の「生PK＋依頼者メール」を解決する。
//   フォーム案件は CASES の Date オブジェクトを、手動案件は CASES_MANUAL の
//   "manual_<epoch>" 文字列をそのまま返す。これにより Stage2 と Stage3 Backfill が
//   同一の正準化源を使い、同じ case_id に収束する（cross-stage 冪等）。
function resolveCaseNaturalSource_(ss, caseIdStr) {
  let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  if (caseSheet && caseSheet.getLastRow() > 1) {
    let cd = caseSheet.getDataRange().getValues();
    for (let i = 1; i < cd.length; i++) {
      let pk = cd[i][IDX.CASES.PK];
      if (pk !== '' && pk != null && String(pk) === caseIdStr) {
        return { pkRaw: pk, email: cd[i][IDX.CASES.EMAIL] };
      }
    }
  }
  let manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  if (manualSheet && manualSheet.getLastRow() > 1) {
    let md = manualSheet.getDataRange().getValues();
    for (let j = 1; j < md.length; j++) {
      let mpk = md[j][IDX.CASES.PK];
      if (mpk !== '' && mpk != null && String(mpk) === caseIdStr) {
        return { pkRaw: mpk, email: md[j][IDX.CASES.EMAIL] };
      }
    }
  }
  return null; // 案件本体が見つからない（孤立FK等）
}

// 書込チョークポイントから呼ぶ非致死ラッパー。案件本体を権威解決して採番・登録する。
//   pkRaw/email を直接渡せる場合（新規作成時など）はそれを優先し、再スキャンを避ける。
function ensureCaseKeyMapping_(caseId, opt) {
  try {
    if (caseId === '' || caseId == null) return null;
    if (opt && opt.pkRaw != null) {
      // 新規作成パス: 生PKとメールが手元にあるので直接採番（スキャン不要）
      return getOrCreateCaseId_(opt.pkRaw, opt.email);
    }
    let ss = getSpreadsheet_();
    let resolved = resolveCaseNaturalSource_(ss, String(caseId));
    if (!resolved) return null; // 案件本体なし → スキップ（Backfill対象外）
    return getOrCreateCaseId_(resolved.pkRaw, resolved.email);
  } catch (e) {
    Logger.log('ensureCaseKeyMapping_ failed (non-fatal) caseId=' + caseId + ': ' + e.message);
    return null;
  }
}

// ======================================================================
// S1 Stage1: 案件キーのサロゲート化（Expand 基盤 — 挙動ゼロ変化）
//   不安定な日付PK（String(Date) の TZ/型ブレ）を、エポックms基盤の
//   正準自然キーへ収束させ、決定的サロゲート case_id を導出する純粋ヘルパー。
//   ※テスト同期先: tests/unit/src/pure-functions.js
// ======================================================================

// 案件PK（Date | "manual_<epoch>" | 日時文字列）を正準形へ。
// 返り値: { sourceType:'form'|'manual', epoch:Number, canonical:String } | null
// パース不能（NaN/空）は null を返し、呼び出し側でスキップ＝安全停止する。
function canonicalNaturalKey_(pkRaw) {
  // フォーム案件: Sheet から読んだ Date オブジェクト → getTime() で安定化
  if (pkRaw && typeof pkRaw.getTime === 'function') {
    let t = pkRaw.getTime();
    if (isNaN(t)) return null;
    return { sourceType: 'form', epoch: t, canonical: String(t) };
  }
  let s = String(pkRaw == null ? '' : pkRaw).trim();
  if (!s) return null;
  // 手動追加案件: "manual_<エポックミリ秒>"（caseFiscalYear_ の判定と整合）
  if (s.indexOf('manual_') === 0) {
    let e = Number(s.slice('manual_'.length));
    if (!isFinite(e)) return null;
    return { sourceType: 'manual', epoch: e, canonical: 'manual_' + e };
  }
  // 日時文字列の救済（String(Date) で文字列化された不安定経路）→ form 扱い
  let dt = new Date(s).getTime();
  if (isNaN(dt)) return null;
  return { sourceType: 'form', epoch: dt, canonical: String(dt) };
}

// 決定的サロゲートキー。同じ epoch から常に同じ case_id が再現するため
// バックフィルが冪等になる（2026 idempotent-backfill ベストプラクティス）。
function buildCaseId_(epoch) {
  return 'case_' + epoch;
}

// S1 Stage4: 読み取り結合キー。viaMap=false は従来どおり String(raw)（後方互換）。
// viaMap=true は正準 case_id（同一案件の日付PK表記ブレを epoch で吸収）。
// 案件PK・記録FK・メールCASE_ID・補正PK を同じ規則で正準化することで、
// 表記ブレに起因する「同一案件が別行扱いになる」結合ズレを解消する。
// パース不能（孤立FK等）は String(raw) にフォールバックし従来挙動を維持。
function joinKeyForRead_(raw, viaMap) {
  if (!viaMap) return String(raw);
  let nk = canonicalNaturalKey_(raw);
  return nk ? buildCaseId_(nk.epoch) : String(raw);
}

// ======================================================================
// スキーマ移行（起動時・作り直し時の自動移行 ensureAttachmentSchema_）
//   移行はすべて冪等。SCHEMA_VERSION_ を上げると次回に1回だけ走る。
// ======================================================================

// スキーマバージョン: マイグレーション追加時にインクリメントする
// v1.11.7 で 6 に更新（addScheduleZoomSettings を自動実行）
const SCHEMA_VERSION_ = '6';

// v1.13.0: 適用済みのスキーマ版を永続記録するスクリプトプロパティ（SDD S-00・F-02）
const SCRIPT_PROP_SCHEMA_APPLIED_ = 'SCHEMA_VERSION_APPLIED';

/**
 * スキーマ移行の確認が必要か（純粋関数・v1.13.0）。
 * 永続記録（スクリプトプロパティ）か、従来の CacheService の印のどちらかが現行版なら不要。
 */
function schemaMigrationNeeded_(appliedProp, cachedVersion, currentVersion) {
  let cur = String(currentVersion);
  return String(appliedProp == null ? '' : appliedProp).trim() !== cur
    && String(cachedVersion == null ? '' : cachedVersion).trim() !== cur;
}

/** スキーマ移行が済んでいるか（プロパティは getScriptProps_ の一括取得を使うので追加の読込なし） */
function isSchemaApplied_() {
  let cached = null;
  try { cached = CacheService.getScriptCache().get('schema_v'); } catch (e) { /* 利用不可は無視 */ }
  return !schemaMigrationNeeded_(getScriptProps_()[SCRIPT_PROP_SCHEMA_APPLIED_], cached, SCHEMA_VERSION_);
}

function ensureAttachmentSchema_() {
  // v1.13.0: 適用済みの版をスクリプトプロパティに永続記録し、一致すれば全スキップ。
  // v1.12.x までは CacheService の6時間の印だけで、6時間ごとに最初の利用者が全移行確認（約10秒）を待っていた。
  if (isSchemaApplied_()) return;

  try {
    // v1.14.0: 移行全体を1つの書込として包む（完成品の世代更新を最後に1回だけにする）
    runWrite_(function() {
      ensureAdminSchema_();
      addForcedCcSettingImpl_();
      addMailDryRunSettingImpl_();
      addUsageLimitSettingsImpl_();
      addAttachmentFolderSettingImpl_();
      addAttachmentsColumnToRecordsImpl_();
      addCaseLimitOverrideColumnsToRecordsImpl_();
      addToolsColumnToRecordsImpl_();
      addSubStaffColumnToRecordsImpl_();
      addMissingEmailSettings_();
      addScheduleZoomSettingsImpl_();  // v1.11.7: 日程・Zoom予約関連の設定キー追加
    }, []);
  } catch (e) {
    throw new Error('添付機能の初期化に失敗しました。管理者に連絡してください。詳細: ' + e.message);
  }

  // 全マイグレーション成功後に永続記録（失敗時は記録しないので次回また確認する）
  try {
    PropertiesService.getScriptProperties().setProperty(SCRIPT_PROP_SCHEMA_APPLIED_, SCHEMA_VERSION_);
    _scriptPropsCache = null;
  } catch (e) { /* 記録失敗は無視（次回また確認するだけ） */ }
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
    toAdd.push(['MAIL_SCHEDULE_BODY', '日程確定メール本文', '{{名前}} 様\n\nいつもお世話になっております。\nタダサポ担当の{{担当者名}}です。\n\nサポート日程が決まりましたのでご連絡いたします。\n\n----------------\n【サポート日程】\n日時：{{日程}}\n方法：{{対応方法}}\n{{URL}}\n----------------\n\n当日はどうぞよろしくお願いいたします。\nご不明な点がございましたらお気軽にご連絡ください。', '', '日程確定時のメール本文テンプレート。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}} {{日程}} {{対応方法}} {{URL}}']);
  }
  if (!existingKeys['MAIL_CLOSING_SUBJECT']) {
    toAdd.push(['MAIL_CLOSING_SUBJECT', 'サポート終了メール件名', 'タダサポ｜サポート完了のお知らせ', '', '完了報告時に「サポート終了メールを送信する」を選んだ際に送信するメールの件名。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['MAIL_CLOSING_BODY']) {
    toAdd.push(['MAIL_CLOSING_BODY', 'サポート終了メール本文', '{{名前}} 様\n\nこの度はタダサポをご利用いただき、誠にありがとうございました。\n{{事業所名}} 様へのサポートは今回をもちまして完了とさせていただきます。\n\nまたお困りごとがございましたら、いつでもお気軽にご相談ください。\n今後ともタダサポをよろしくお願いいたします。\n\n{{担当者名}}', '', '完了報告時に送信するサポート終了メールの本文テンプレート。使用可能タグ: {{名前}} {{事業所名}} {{担当者名}}']);
  }
  if (!existingKeys['SUPPORT_TOOLS']) {
    toAdd.push(['SUPPORT_TOOLS', '対応ツール一覧', 'Word・Excel,Windows（基本操作）,LINEWORKS,Google（基本操作）,Google Workspace,AI（ChatGPT、Gemini 他）,ケアプランデータ連携システム,介護ソフト,その他', '', 'カンマ区切りで管理。フォームの対応ツール選択肢に使用']);
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

function ensureStaffAdminSchema_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet) return;
  let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  let roleHeader = String(headers[IDX.STAFF.ROLE] || '').trim();
  let activeHeader = String(headers[IDX.STAFF.IS_ACTIVE] || '').trim();

  if (sheet.getLastColumn() < 5) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), 5 - sheet.getLastColumn()); invalidateStaffRowsCache_();
  }
  if (!roleHeader) sheet.getRange(1, IDX.STAFF.ROLE + 1).setValue('ROLE'); invalidateStaffRowsCache_();
  if (!activeHeader) sheet.getRange(1, IDX.STAFF.IS_ACTIVE + 1).setValue('IS_ACTIVE'); invalidateStaffRowsCache_();

  if (sheet.getLastRow() > 1) {
    let n = sheet.getLastRow() - 1;
    let rows = sheet.getRange(2, 1, n, IDX.STAFF.IS_ACTIVE + 1).getValues();
    let plan = planStaffDefaults_(rows);
    // v1.13.0: メールがある行の空欄だけを補完し、変更があったときだけ書き込む。
    // 従来はメールの無い空行にも D=staff / E=true を書き、最終行が伸びたまま戻らなかった（1,506 行の原因）
    if (plan.roleChanged) { sheet.getRange(2, IDX.STAFF.ROLE + 1, n, 1).setValues(plan.role); invalidateStaffRowsCache_(); }
    if (plan.activeChanged) { sheet.getRange(2, IDX.STAFF.IS_ACTIVE + 1, n, 1).setValues(plan.active); invalidateStaffRowsCache_(); }
  }
}

/**
 * タダメンマスタの ROLE / IS_ACTIVE の補完計画（純粋関数・v1.13.0）。
 * メール（IDX.STAFF.EMAIL）がある行だけ、ROLE 空欄→'staff'、IS_ACTIVE 空欄→'true' にする。メールの無い行は触らない。
 * 返り値: { role: [[v]], active: [[v]], roleChanged, activeChanged }（role/active はそのまま setValues できる形）
 */
function planStaffDefaults_(rows) {
  let out = { role: [], active: [], roleChanged: false, activeChanged: false };
  (rows || []).forEach(function(r) {
    let hasEmail = String(r[IDX.STAFF.EMAIL] || '').trim() !== '';
    let role = r[IDX.STAFF.ROLE], active = r[IDX.STAFF.IS_ACTIVE];
    if (hasEmail && !String(role == null ? '' : role).trim()) { role = 'staff'; out.roleChanged = true; }
    if (hasEmail && String(active == null ? '' : active).trim() === '') { active = 'true'; out.activeChanged = true; }
    out.role.push([role == null ? '' : role]);
    out.active.push([active == null ? '' : active]);
  });
  return out;
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
    // v1.13.0: 既に admin の行は書き直さない
    if (adminMap[em] && String(data[i][IDX.STAFF.ROLE] || '').trim().toLowerCase() !== 'admin') {
      sheet.getRange(i + 1, IDX.STAFF.ROLE + 1).setValue('admin'); invalidateStaffRowsCache_();
    }
  }
}

function ensureAdminSchema_() {
  // スキーマ確認済み（永続記録または CacheService）ならスキップ
  if (isSchemaApplied_()) return;
  ensureStaffAdminSchema_();
  migrateAdminEmailsToStaffRoles_();
  getOrCreateAuditLogSheet_();
}

// ======================================================================
// 初期構築・設定行の追加（00_管理者メニューの ③④ から呼ぶ本体。自動移行からも呼ぶ）
// ======================================================================

/**
 * 「設定」シートを自動作成する。既に存在する場合はスキップする。
 *
 * シート構造:
 *   A列 = 設定キー（システム参照用・編集不可）
 *   B列 = 項目名（日本語表示）
 *   C列 = 設定値 ← ここに入力してください
 *   D列 = 入力例
 *   E列 = 説明・注意事項
 */
function setupSettingsSheetImpl_() {
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
    ['ZOOM_ACCOUNT_ID',    'アカウント ID',            '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
    ['ZOOM_CLIENT_ID',     'クライアント ID',          '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
    ['ZOOM_CLIENT_SECRET', 'クライアントシークレット', '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
    ['ZOOM_FIXED_URL',     '固定Zoom URL',             '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
    ['ZOOM_FIXED_ID',      '固定Zoom ID',              '', '123 4567 8901',                     '「いつものタダスクID」の Zoom ミーティング ID（ハイフン/スペース可）。'],
    ['ZOOM_FIXED_PASS',    '固定Zoomパスコード',       '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],

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
    ['MAIL_CLOSING_SUBJECT',  'サポート終了メール件名', 'タダサポ｜サポート完了のお知らせ', 'タダサポ｜{{事業所名}}様 サポート完了のお知らせ', '完了報告時に「サポート終了メールを送信する」を選んだ際に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_CLOSING_BODY',     'サポート終了メール本文', '{{名前}} 様\n\nこの度はタダサポをご利用いただき、誠にありがとうございました。\n{{事業所名}} 様へのサポートは今回をもちまして完了とさせていただきます。\n\nまたお困りごとがございましたら、いつでもお気軽にご相談ください。\n今後ともタダサポをよろしくお願いいたします。\n\n{{担当者名}}', '（デフォルト文を参照）', '完了報告時に送信するサポート終了メールの本文。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],

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

function addEmailTemplatesImpl_() {
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

function addForcedCcSettingImpl_() {
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

function addMailDryRunSettingImpl_() {
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

function addUsageLimitSettingsImpl_() {
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

function addAttachmentFolderSettingImpl_() {
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

function addAttachmentsColumnToRecordsImpl_() {
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

function addCaseLimitOverrideColumnsToRecordsImpl_() {
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

function addToolsColumnToRecordsImpl_() {
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

function addSubStaffColumnToRecordsImpl_() {
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

function setupAttachmentFeatureSchemaImpl_() {
  ensureAdminSchema_();
  addForcedCcSettingImpl_();
  addMailDryRunSettingImpl_();
  addUsageLimitSettingsImpl_();
  addAttachmentFolderSettingImpl_();
  addAttachmentsColumnToRecordsImpl_();
  addCaseLimitOverrideColumnsToRecordsImpl_();
  Logger.log('添付機能向けスキーマ整備が完了しました。');
}

function addScheduleZoomSettingsImpl_() {
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
    ['ZOOM_FIXED_URL',     '固定Zoom URL',             '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
    ['ZOOM_FIXED_ID',      '固定Zoom ID',              '', '123 4567 8901',                     '「いつものタダスクID」の Zoom ミーティング ID。'],
    ['ZOOM_FIXED_PASS',    '固定Zoomパスコード',       '', '（管理画面の設定管理から入力）', 'v1.13.0〜 スクリプトプロパティに書込専用で保存。組織内の誰でも読めるため、このシートには入力しない。'],
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

// ======================================================================
// S1 Stage1: 案件キー移行リコンサイル診断（読み取り専用・書込ゼロ）
//   全案件（フォーム＋手動）を走査し、サロゲート化に向けた現状を報告する。
//   ・案件総数 / マップ登録済 / 未登録（=Backfill 予定件数）
//   ・正準化不能（安全停止）件数 / 重複自然キー / クロス種別epoch衝突
//   ・サポート記録FKの重複（Stage0 の重複検出を流用）
//   ・現行 String(PK) 結合キー → 将来 case_id の対応プレビュー（先頭20件）
//   これが Stage3 Backfill 前のリコンサイル基準（pre/post 件数突合）になる。
//   ※マップシートは存在する場合のみ読む（診断では作成しない＝完全な読み取り専用）。
// ======================================================================
function diagnoseCaseKeyMigration_() {
  let ss = getSpreadsheet_();
  let report = {
    totalCases: 0, formCases: 0, manualCases: 0,
    unparseable: 0, mappedCount: 0, unmappedCount: 0,
    duplicateNaturalKeys: 0, crossTypeEpochCollisions: 0,
    duplicateRecordFk: 0, recordRows: 0,
    samples: []
  };

  // 既存マップ（あれば）を (種別|自然キー) → case_id で読む
  let mapByNk = {};
  let caseIdByEpoch = {}; // epoch → {sourceType,canonical} 衝突検出用
  let mapSheet = ss.getSheetByName(SHEET_NAMES.CASE_KEY_MAP);
  if (mapSheet && mapSheet.getLastRow() > 1) {
    let md = mapSheet.getDataRange().getValues();
    for (let i = 1; i < md.length; i++) {
      let t = String(md[i][CASE_KEY_MAP_COL.SOURCE_TYPE]);
      let nk = String(md[i][CASE_KEY_MAP_COL.NATURAL_KEY]);
      mapByNk[t + '|' + nk] = String(md[i][CASE_KEY_MAP_COL.CASE_ID]);
    }
  }

  // 全案件を走査
  let caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  let manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  let allRows = [];
  if (caseSheet && caseSheet.getLastRow() > 1) allRows = allRows.concat(caseSheet.getDataRange().getValues().slice(1));
  if (manualSheet && manualSheet.getLastRow() > 1) allRows = allRows.concat(manualSheet.getDataRange().getValues().slice(1));

  let seenNk = {};
  for (let j = 0; j < allRows.length; j++) {
    let pkRaw = allRows[j][IDX.CASES.PK];
    if (pkRaw === '' || pkRaw == null) continue;
    report.totalCases++;
    let nk = canonicalNaturalKey_(pkRaw);
    if (!nk) { report.unparseable++; continue; }
    if (nk.sourceType === 'manual') report.manualCases++; else report.formCases++;

    let nkKey = nk.sourceType + '|' + nk.canonical;
    if (seenNk[nkKey]) report.duplicateNaturalKeys++; else seenNk[nkKey] = true;

    // クロス種別epoch衝突（同一epochで自然キー/種別が異なる）
    let prev = caseIdByEpoch[nk.epoch];
    if (prev && (prev.sourceType !== nk.sourceType || prev.canonical !== nk.canonical)) {
      report.crossTypeEpochCollisions++;
    } else if (!prev) {
      caseIdByEpoch[nk.epoch] = { sourceType: nk.sourceType, canonical: nk.canonical };
    }

    if (mapByNk[nkKey]) report.mappedCount++; else report.unmappedCount++;

    if (report.samples.length < 20) {
      report.samples.push({
        currentJoinKey: String(pkRaw),
        futureCaseId: buildCaseId_(nk.epoch),
        sourceType: nk.sourceType,
        mapped: !!mapByNk[nkKey]
      });
    }
  }

  // サポート記録FKの重複（Stage0 と同じ「最初の一致」採用前提の健全性確認）
  let recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (recordSheet && recordSheet.getLastRow() > 1) {
    let rd = recordSheet.getDataRange().getValues();
    report.recordRows = rd.length - 1;
    let seenFk = {};
    for (let k = 1; k < rd.length; k++) {
      let fk = rd[k][IDX.RECORDS.FK];
      if (fk === '' || fk == null) continue;
      let sfk = String(fk);
      if (seenFk[sfk]) report.duplicateRecordFk++; else seenFk[sfk] = true;
    }
  }

  Logger.log('[案件キー移行診断] ' + JSON.stringify(report, null, 2));
  return report;
}

// ======================================================================
// S1 Stage3: 案件キーマップ Backfill（既存全案件をマップへ冪等投入）
//   ★破壊的（本番データ追記）。既定は dryRun=true で「計画のみ」を返し
//   何も書き込まない。実行（dryRun:false）は本番GASからの明示操作が必要で、
//   実行前に必ず停止・ドライラン・復元手順確認（CLAUDE.md グランドルール）。
//   ・冪等: 既存 (種別, 自然キー) はスキップ。再実行しても重複を作らない。
//   ・Stage2 Dual-write と同一の正準化源（生PK）を使うため case_id が一致。
// ----------------------------------------------------------------------

// Backfill 計画ロジック（純粋）。既存登録スキップ・バッチ内重複自然キーの
// dedup・case_id 衝突の連番回避を行う。tests/unit/src/pure-functions.js に同期。
//   cases: [{ sourceType, canonical, epoch, email }]
//   existingKeySet: { '種別|自然キー': true }（既存マップ）
//   usedCaseIds: { caseId: true }（既存マップの採番済みID）
function planBackfill_(cases, existingKeySet, usedCaseIds) {
  existingKeySet = existingKeySet || {};
  let used = {};
  if (usedCaseIds) Object.keys(usedCaseIds).forEach(function(k) { used[k] = true; });
  let planned = {};
  let toCreate = [];
  let alreadyMapped = 0, duplicateNaturalKeys = 0, collisions = 0;
  for (let i = 0; i < cases.length; i++) {
    let c = cases[i];
    let key = c.sourceType + '|' + c.canonical;
    if (existingKeySet[key]) { alreadyMapped++; continue; }      // 既に登録済み（冪等）
    if (planned[key]) { duplicateNaturalKeys++; continue; }       // 同一バッチ内の重複自然キー
    let caseId = buildCaseId_(c.epoch);
    if (used[caseId]) {                                           // クロス種別epoch衝突 → 連番回避
      let s = 1;
      while (used[caseId + '_' + s]) s++;
      caseId = caseId + '_' + s;
      collisions++;
    }
    used[caseId] = true;
    planned[key] = true;
    toCreate.push({ caseId: caseId, sourceType: c.sourceType, canonical: c.canonical, email: c.email });
  }
  return { toCreate: toCreate, alreadyMapped: alreadyMapped, duplicateNaturalKeys: duplicateNaturalKeys, collisions: collisions };
}

function backfillCaseKeyMap_(options) {
  options = options || {};
  let dryRun = options.dryRun !== false; // 既定 true（安全側。明示的に false で実書込）
  let ss = getSpreadsheet_();

  // 全案件（フォーム＋手動）を {sourceType,canonical,epoch,email} へ正準化
  let cases = [];
  let totalCases = 0, unparseable = 0;
  [SHEET_NAMES.CASES, SHEET_NAMES.CASES_MANUAL].forEach(function(name) {
    let sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    let d = sh.getDataRange().getValues();
    for (let i = 1; i < d.length; i++) {
      let pk = d[i][IDX.CASES.PK];
      if (pk === '' || pk == null) continue;
      totalCases++;
      let nk = canonicalNaturalKey_(pk); // Stage2 と同一の生PK正準化（cross-stage一致）
      if (!nk) { unparseable++; continue; }
      cases.push({ sourceType: nk.sourceType, canonical: nk.canonical, epoch: nk.epoch, email: d[i][IDX.CASES.EMAIL] });
    }
  });

  return withScriptLock_(function() {
    let sheet = dryRun ? ss.getSheetByName(SHEET_NAMES.CASE_KEY_MAP) : getOrCreateCaseKeyMapSheet_();
    let existingKeySet = {}, usedCaseIds = {};
    if (sheet && sheet.getLastRow() > 1) {
      let md = sheet.getDataRange().getValues();
      for (let j = 1; j < md.length; j++) {
        let t = String(md[j][CASE_KEY_MAP_COL.SOURCE_TYPE]);
        let nkc = String(md[j][CASE_KEY_MAP_COL.NATURAL_KEY]);
        let id = String(md[j][CASE_KEY_MAP_COL.CASE_ID]);
        existingKeySet[t + '|' + nkc] = true;
        if (id) usedCaseIds[id] = true;
      }
    }

    let plan = planBackfill_(cases, existingKeySet, usedCaseIds);
    let report = {
      dryRun: dryRun, totalCases: totalCases, unparseable: unparseable,
      alreadyMapped: plan.alreadyMapped, duplicateNaturalKeys: plan.duplicateNaturalKeys,
      collisions: plan.collisions, toCreate: plan.toCreate.length, created: 0,
      sample: plan.toCreate.slice(0, 20)
    };

    if (!dryRun && plan.toCreate.length > 0) {
      let now = new Date();
      let rows = plan.toCreate.map(function(p) {
        return [p.caseId, p.sourceType, p.canonical, normalizeEmail_(p.email), now];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
      report.created = rows.length;
    }

    Logger.log('[案件キーBackfill] ' + JSON.stringify(report, null, 2));
    return report;
  });
}

// ----------------------------------------------------------------------
// S1 Stage3: 管理者向け公開エントリ（アプリ管理画面から実行するため）
//   手動GASエディタ操作を避け、管理者がアプリ上でドライラン→本実行できる。
//   いずれも requireAdmin_ で権限を強制し、監査ログに記録する。
// ----------------------------------------------------------------------

// 案件キー移行の現状診断（読み取り専用）。管理者のみ。
function runCaseKeyMigrationDiagnosis() {
  let actor = requireAdmin_();
  let report = diagnoseCaseKeyMigration_();
  appendAuditLog_(actor, 'caseKeyMigration_diagnose', 'caseKeyMap', '', null, report);
  return report;
}

// 案件キーマップ Backfill。管理者のみ。dryRun=true（既定）は計画のみ・書込ゼロ。
//   dryRun=false で実書込（破壊的＝本番データ追記）。監査ログに結果を記録する。
function runCaseKeyBackfill() { return runWrite_(runCaseKeyBackfillImpl_, arguments); }
function runCaseKeyBackfillImpl_(dryRun) {
  let actor = requireAdmin_();
  let isDry = dryRun !== false; // 既定 true（安全側）。明示的に false のときだけ実書込
  let report = backfillCaseKeyMap_({ dryRun: isDry });
  appendAuditLog_(actor, isDry ? 'caseKeyBackfill_dryRun' : 'caseKeyBackfill_execute', 'caseKeyMap', '', null, report);
  return report;
}
