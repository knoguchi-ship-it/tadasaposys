/**
 * タダサポ管理システム - Backend Logic (v1.9.0)
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
  AUDIT_LOG: '監査ログ'
};

var IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  // 案件補正シートは案件リストと同じ列構造（PK=A列、値が空の列は「補正なし」を意味する）
  CASES_OVERRIDE: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5, METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10, EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13, ATTACHMENTS: 14, CASE_LIMIT_OVERRIDE: 15, ANNUAL_LIMIT_OVERRIDE: 16, TOOLS: 17, SUB_STAFF: 18 },
  STAFF: { NAME: 1, EMAIL: 2, ROLE: 3, IS_ACTIVE: 4 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3, RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
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

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    throw new Error('「設定」シートが見つかりません。GASエディタで setupSettingsSheet 関数を実行してください。');
  }

  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (!key || key.charAt(0) === '#') continue;
    var val = String(data[i][2]).trim(); // C列（3列目）が設定値
    settings[key] = val;
  }

  _settingsCache = settings;
  return settings;
}

/**
 * 設定値を取得（キーが無い場合はデフォルト値を返す）
 */
function getSetting_(key, defaultValue) {
  var settings = loadSettings_();
  var val = settings[key];
  return (val !== undefined && val !== '') ? val : (defaultValue || '');
}

function saveSetting_(key, value) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
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
  var raw = getSetting_('ADMIN_EMAILS', '');
  if (!raw) return [];
  return raw.split(',').map(function(e) { return e.trim().toLowerCase(); });
}

/**
 * MAIL_FORCE_CC の設定値（空欄ならnull）を返す。
 */
function getForcedCc_() {
  var raw = getSetting_('MAIL_FORCE_CC', '').trim();
  return raw ? raw : null;
}

/**
 * MAIL_DRY_RUN の設定値を bool として返す。
 * true / 1 / yes / on を有効として扱う。
 */
function isMailDryRun_() {
  var raw = String(getSetting_('MAIL_DRY_RUN', '') || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function parsePositiveIntegerSetting_(key, defaultValue) {
  var raw = String(getSetting_(key, String(defaultValue)) || '').trim();
  var num = Number(raw);
  if (!isFinite(num)) return Number(defaultValue);
  var intNum = Math.floor(num);
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
  var num = Number(value);
  if (!isFinite(num)) throw new Error('上限値は1以上の整数で入力してください。');
  var intNum = Math.floor(num);
  if (intNum < 1) throw new Error('上限値は1以上の整数で入力してください。');
  return intNum;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function parseBoolean_(v, defaultValue) {
  if (v === true || v === false) return v;
  var raw = String(v || '').trim().toLowerCase();
  if (!raw) return !!defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function getStaffRoleByEmail_(email) {
  var target = normalizeEmail_(email);
  if (!target) return null;

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    if (em !== target) continue;
    var active = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (!active) return null;
    var role = String(data[i][IDX.STAFF.ROLE] || '').trim().toLowerCase();
    return role || 'staff';
  }
  return null;
}

function isAdminEmail_(email) {
  var role = getStaffRoleByEmail_(email);
  if (role === 'admin') return true;
  var adminEmails = getAdminEmails_();
  return adminEmails.indexOf(normalizeEmail_(email)) !== -1;
}

function getActor_() {
  var actorEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!actorEmail) {
    throw new Error('ユーザー情報の取得に失敗しました。');
  }
  // Staffシート1回読みで name + role を同時取得
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  var staffName = null;
  var staffRole = null;
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
      if (em !== actorEmail) continue;
      var active = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
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
    var adminEmails = getAdminEmails_();
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
  var actor = getActor_();
  if (!actor.isAdmin) {
    throw new Error('管理者権限が必要です。');
  }
  return actor;
}

function getCaseRecordRowIndex_(caseId) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) return i + 1;
  }
  return -1;
}

function ensureCaseEditableByActor_(caseId, actor, allowUnassigned) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var rowIndex = getCaseRecordRowIndex_(caseId);
  if (rowIndex === -1) return true;

  var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  var staffEmail = normalizeEmail_(row[IDX.RECORDS.STAFF_EMAIL]);
  if (!staffEmail && allowUnassigned) return true;
  if (actor.isAdmin) return true;
  if (staffEmail && staffEmail === normalizeEmail_(actor.email)) return true;
  // サブ担当も操作可能（OJT用）
  var subStaffJson = row[IDX.RECORDS.SUB_STAFF] ? String(row[IDX.RECORDS.SUB_STAFF]) : '[]';
  var subStaff = [];
  try { subStaff = JSON.parse(subStaffJson); } catch(e) {}
  if (subStaff.some(function(s) { return normalizeEmail_(s.email) === normalizeEmail_(actor.email); })) return true;
  throw new Error('この案件を操作する権限がありません。');
}

function getOrCreateAuditLogSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.AUDIT_LOG);
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
    var sheet = getOrCreateAuditLogSheet_();
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
  var html = HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('タダサポ管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // 初期データをHTMLに埋め込み（google.script.run の往復を1回削減）
  try {
    var data = getInitialData();
    var json = JSON.stringify(data).replace(/<\//g, '<\\/');
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

  var userEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  var staff = getStaffByEmail(userEmail);

  if (!staff) {
    throw new Error('アクセス権限がありません。管理者によりタダメンマスタへの登録が必要です。');
  }

  var role = getStaffRoleByEmail_(userEmail) || (isAdminEmail_(userEmail) ? 'admin' : 'staff');
  var isAdmin = role === 'admin';
  var cases = getAllCasesJoined();
  var masters = getMasters();

  return {
    user: { name: staff.name, email: userEmail, isAdmin: isAdmin, role: role },
    cases: cases,
    masters: masters
  };
}

// ======================================================================
// 年度計算
// ======================================================================
function getFiscalYear(dateObj) {
  var d = new Date(dateObj);
  if (isNaN(d.getTime())) return 0;
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

// ======================================================================
// データ結合取得
// ======================================================================
function getAllCasesJoined() {
  var ss = getSpreadsheet_();
  // スプレッドシートのタイムゾーンを取得（dateLabel の整形に使用）
  var ssTimeZone = ss.getSpreadsheetTimeZone();
  var caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  var recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);

  var caseData = caseSheet.getDataRange().getValues();
  var recordData = recordSheet.getDataRange().getValues();

  // 手動追加案件シートを読み込み、案件リストとマージ（ヘッダ行を除いた行配列を結合）
  var manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  var manualRows = (manualSheet && manualSheet.getLastRow() > 1)
    ? manualSheet.getDataRange().getValues().slice(1)
    : [];
  var allCaseRows = caseData.slice(1).concat(manualRows);

  // 削除済み案件を除外
  var deletedRaw = getSetting_('DELETED_CASE_IDS', '');
  if (deletedRaw) {
    var deletedSet = {};
    deletedRaw.split(',').forEach(function(id) { if (id) deletedSet[id.trim()] = true; });
    allCaseRows = allCaseRows.filter(function(r) { return !deletedSet[String(r[IDX.CASES.PK])]; });
  }

  // 案件補正マップを読み込む（管理者が修正した値を案件リストに上書き表示するため）
  var overrideMap = getCasesOverrideMap_(ss);

  // メール履歴を読み込み
  var emailMap = {};
  var emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (emailSheet && emailSheet.getLastRow() > 1) {
    var emailData = emailSheet.getDataRange().getValues();
    for (var ei = 1; ei < emailData.length; ei++) {
      var eCaseId = String(emailData[ei][IDX.EMAIL.CASE_ID]);
      if (!emailMap[eCaseId]) emailMap[eCaseId] = [];
      emailMap[eCaseId].push({
        sendDate: emailData[ei][IDX.EMAIL.SEND_DATE] ? new Date(emailData[ei][IDX.EMAIL.SEND_DATE]).toISOString() : null,
        senderName: String(emailData[ei][IDX.EMAIL.SENDER_NAME]),
        subject: String(emailData[ei][IDX.EMAIL.SUBJECT]),
        body: String(emailData[ei][IDX.EMAIL.BODY])
      });
    }
  }

  var recordMap = {};
  var fiscalYearCounts = {};

  for (var i = 1; i < recordData.length; i++) {
    var r = recordData[i];
    var historyStr = r[IDX.RECORDS.HISTORY] ? String(r[IDX.RECORDS.HISTORY]) : '[]';
    var parsedHistory = [];
    try { parsedHistory = JSON.parse(historyStr); } catch(e) { parsedHistory = []; }
    var attachmentsStr = r[IDX.RECORDS.ATTACHMENTS] ? String(r[IDX.RECORDS.ATTACHMENTS]) : '[]';
    var parsedAttachments = [];
    try { parsedAttachments = JSON.parse(attachmentsStr); } catch(e) { parsedAttachments = []; }
    var toolsStr = r[IDX.RECORDS.TOOLS] ? String(r[IDX.RECORDS.TOOLS]) : '[]';
    var parsedTools = [];
    try { parsedTools = JSON.parse(toolsStr); } catch(e) { parsedTools = []; }
    var subStaffStr = r[IDX.RECORDS.SUB_STAFF] ? String(r[IDX.RECORDS.SUB_STAFF]) : '[]';
    var parsedSubStaff = [];
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
        var n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.CASE_LIMIT_OVERRIDE]),
      annualLimitOverride: (function(v) {
        var n = Number(v);
        return isFinite(n) && n > 0 ? Math.floor(n) : null;
      })(r[IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE]),
      supportHistory: parsedHistory,
      attachments: parsedAttachments,
      tools: parsedTools,
      subStaff: parsedSubStaff
    };
  }

  for (var j = 0; j < allCaseRows.length; j++) {
    var c = allCaseRows[j];
    var ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    // 補正シートにメールアドレスの補正があればそちらを使う（年度集計の正確性のため）
    var ovr = overrideMap[ts] || {};
    var email = ovr.email !== null && ovr.email !== undefined ? ovr.email : String(c[IDX.CASES.EMAIL]);
    var record = recordMap[ts] || { status: 'unhandled' };
    if (record.status === 'inProgress' || record.status === 'completed') {
      var fy = getFiscalYear(ts);
      var key = email + '_' + fy;
      fiscalYearCounts[key] = (fiscalYearCounts[key] || 0) + (Number(record.supportCount) || 1);
    }
  }

  var joinedCases = [];
  var seenPks = {};
  for (var j = 0; j < allCaseRows.length; j++) {
    var c = allCaseRows[j];
    var ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    if (seenPks[ts]) continue; // 重複PKをスキップ
    seenPks[ts] = true;
    var record = recordMap[ts] || { status: 'unhandled', supportCount: 1 };
    // 案件補正マップを適用（補正値が存在する場合は上書き、null は補正なし）
    var ovr = overrideMap[ts] || {};
    var email       = ovr.email         !== null && ovr.email         !== undefined ? ovr.email         : String(c[IDX.CASES.EMAIL]);
    var officeName  = ovr.officeName    !== null && ovr.officeName    !== undefined ? ovr.officeName    : c[IDX.CASES.OFFICE];
    var reqName     = ovr.requesterName !== null && ovr.requesterName !== undefined ? ovr.requesterName : c[IDX.CASES.NAME];
    var details     = ovr.details       !== null && ovr.details       !== undefined ? ovr.details       : c[IDX.CASES.DETAILS];
    var prefecture  = ovr.prefecture    !== null && ovr.prefecture    !== undefined ? ovr.prefecture    : (c[IDX.CASES.PREFECTURE] || null);
    var serviceType = ovr.serviceType   !== null && ovr.serviceType   !== undefined ? ovr.serviceType   : c[IDX.CASES.SERVICE];
    var fy = getFiscalYear(ts);
    var count = fiscalYearCounts[email + '_' + fy] || 0;
    // タイムスタンプをJST日付文字列に変換
    // c[IDX.CASES.PK] は GAS が Sheet から読んだ Date オブジェクトのため、
    // String() → new Date() の往復変換を避けて直接 formatDate に渡す
    var pkRaw = c[IDX.CASES.PK];
    var pkDate;
    if (pkRaw && typeof pkRaw.getTime === 'function') {
      pkDate = pkRaw;
    } else if (typeof pkRaw === 'string' && pkRaw.indexOf('manual_') === 0) {
      // 手動追加案件: "manual_" + エポックミリ秒 から日付を復元
      var epoch = Number(pkRaw.replace('manual_', ''));
      pkDate = isFinite(epoch) ? new Date(epoch) : new Date(NaN);
    } else {
      pkDate = new Date(pkRaw);
    }
    var dateLabel = isNaN(pkDate.getTime()) ? '' : Utilities.formatDate(pkDate, ssTimeZone, 'yyyy/MM/dd');

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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();

  var toolsVal = Array.isArray(tools) && tools.length > 0 ? JSON.stringify(tools) : '[]';

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
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
    var before = {
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  var row = data[rowIndex - 1];
  var currentCount = Number(row[IDX.RECORDS.COUNT]) || 1;
  var caseLimit = parseNullablePositiveInteger_(row[IDX.RECORDS.CASE_LIMIT_OVERRIDE]) || getCaseUsageLimit_();
  if (currentCount >= caseLimit) throw new Error('この案件は対応上限（' + caseLimit + '回）に達しているため再開できません。');

  // 現在の回の記録を履歴に保存
  var historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  var history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }
  history.push({
    round: currentCount,
    scheduledDateTime: row[IDX.RECORDS.DATE] ? new Date(row[IDX.RECORDS.DATE]).toISOString() : null,
    method: row[IDX.RECORDS.METHOD] || null,
    content: row[IDX.RECORDS.CONTENT] || null,
    remarks: row[IDX.RECORDS.REMARKS] || null,
    meetUrl: row[IDX.RECORDS.MEET_URL] || null,
    attachments: (function() {
      var a = row[IDX.RECORDS.ATTACHMENTS] ? String(row[IDX.RECORDS.ATTACHMENTS]) : '[]';
      try { return JSON.parse(a); } catch(e) { return []; }
    })(),
    tools: (function() {
      var t = row[IDX.RECORDS.TOOLS] ? String(row[IDX.RECORDS.TOOLS]) : '[]';
      try { return JSON.parse(t); } catch(e) { return []; }
    })(),
    staffName: row[IDX.RECORDS.STAFF_NAME] || null,
    staffEmail: row[IDX.RECORDS.STAFF_EMAIL] || null
  });
  // STATUS(1)～ATTACHMENTS(14) を一括書き込み
  var newRow = [];
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

// スキーマバージョン: マイグレーション追加時にインクリメントする
var SCHEMA_VERSION_ = '5';

function ensureAttachmentSchema_() {
  // CacheService でスキーマ確認済みなら全スキップ（6時間有効）
  try {
    var cache = CacheService.getScriptCache();
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 0; i < data.length; i++) {
    existingKeys[String(data[i][0]).trim()] = true;
  }

  var toAdd = [];
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

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, toAdd.length, 5).setValues(toAdd);
  // 値列（C列）を編集可能な黄色スタイルに
  for (var j = 0; j < toAdd.length; j++) {
    var r = lastRow + 1 + j;
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();

  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
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
    var before = {
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
  var result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAMES.EMAIL_HISTORY);
  var headers = ['案件ID', '送信日時', '送信者メール', '送信者名', '宛先メール', '件名', '本文'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダースタイル
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
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
  var sheet = getOrCreateEmailHistorySheet_();
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
  var ss = getSpreadsheet_();
  // 案件補正シートのメール補正を優先チェック
  var overrideMap = getCasesOverrideMap_(ss);
  var ovr = overrideMap[String(caseId)];
  if (ovr && ovr.email !== null) return ovr.email;

  // 案件リストをチェック
  var caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  var caseData = caseSheet.getDataRange().getValues();
  for (var i = 1; i < caseData.length; i++) {
    if (String(caseData[i][IDX.CASES.PK]) === String(caseId)) {
      return String(caseData[i][IDX.CASES.EMAIL]);
    }
  }

  // 手動追加案件シートもチェック（案件リストに存在しない manual_xxx 案件に対応）
  var manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  if (manualSheet && manualSheet.getLastRow() > 1) {
    var manualData = manualSheet.getDataRange().getValues();
    for (var j = 1; j < manualData.length; j++) {
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
  var encodedSubject = '=?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=';
  var forceCc = getForcedCc_();

  // 設定の必須CCと任意CCをマージ
  var ccParts = [];
  if (forceCc) ccParts.push(forceCc);
  if (optionalCc) ccParts.push(optionalCc);
  var mergedCc = ccParts.length > 0 ? ccParts.join(', ') : null;

  var headers = [
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

  var rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;
  var encoded = Utilities.base64EncodeWebSafe(rawMessage, Utilities.Charset.UTF_8);

  var request = { raw: encoded };
  if (threadId) request.threadId = threadId;

  if (isMailDryRun_()) {
    var stamp = String(new Date().getTime());
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

  var result = Gmail.Users.Messages.send(request, 'me');
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
  var forceCc = getForcedCc_();
  if (!forceCc) {
    throw new Error('MAIL_FORCE_CC が未設定です。CC確認のため設定してください。');
  }

  var result = sendInThread_(
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
    var thread = Gmail.Users.Threads.get('me', threadId, { format: 'metadata', metadataHeaders: ['Message-Id'] });
    var messages = thread.messages;
    if (!messages || messages.length === 0) return null;
    var lastMsg = messages[messages.length - 1];
    var hdrs = lastMsg.payload.headers;
    for (var i = 0; i < hdrs.length; i++) {
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
      var data = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      while (data.length % 4 !== 0) data += '=';
      var bytes = Utilities.base64Decode(data);
      var text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
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
    for (var i = 0; i < payload.parts.length; i++) {
      if (payload.parts[i].mimeType === 'text/plain') {
        var r = getPlainTextBody_(payload.parts[i]);
        if (r) return r;
      }
    }
    // text/plain が見つからなければ再帰（HTML含む）
    for (var j = 0; j < payload.parts.length; j++) {
      var result = getPlainTextBody_(payload.parts[j]);
      if (result) return result;
    }
  }
  return '';
}

/**
 * 案件の全スレッドIDをサポート記録から取得する（カンマ区切りで複数保存）
 */
function getThreadIdsForCase_(caseId) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      var raw = String(data[i][IDX.RECORDS.THREAD_ID] || '');
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      var existing = String(data[i][IDX.RECORDS.THREAD_ID] || '');
      var newVal = existing ? existing + ',' + threadId : threadId;
      sheet.getRange(i + 1, IDX.RECORDS.THREAD_ID + 1).setValue(newVal);
      return;
    }
  }
}

/**
 * 全スタッフのメールアドレスをリストで取得する
 */
function getAllStaffEmails_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  var data = sheet.getDataRange().getValues();
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    var isActive = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  assignCase(caseId, actor, tools);

  // Gmail API で送信（新規スレッド開始）
  var result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);

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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  var result = sendInThread_(recipientEmail, subject, body, null, null, cc || null, bcc || null);
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  var inReplyTo = null;
  if (threadId) {
    inReplyTo = getLastMessageId_(threadId);
  }

  var result = sendInThread_(recipientEmail, subject, body, threadId || null, inReplyTo, cc || null, bcc || null);

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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var threadIds = getThreadIdsForCase_(caseId);

  // スレッドIDが無い場合はメール履歴シートから返す（フォールバック）
  if (!threadIds.length) {
    var ss = getSpreadsheet_();
    var emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
    if (!emailSheet || emailSheet.getLastRow() <= 1) return [];

    var emailData = emailSheet.getDataRange().getValues();
    var fallbackMsgs = [];
    for (var i = 1; i < emailData.length; i++) {
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
  var staffEmails = getAllStaffEmails_();
  var threads = [];

  for (var t = 0; t < threadIds.length; t++) {
    try {
      var thread = GmailApp.getThreadById(threadIds[t]);
      if (!thread) continue;
      var gmailMsgs = thread.getMessages();

      var parsed = gmailMsgs.map(function(msg) {
        var from = msg.getFrom();
        var fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1] : from;
        var isStaff = staffEmails.indexOf(fromEmail.toLowerCase()) !== -1;
        var senderName = from.match(/^(.+?)\s*</) ? from.match(/^(.+?)\s*</)[1].replace(/"/g, '').trim() : fromEmail;
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
    var aDate = a.messages.length ? new Date(a.messages[a.messages.length - 1].sendDate) : 0;
    var bDate = b.messages.length ? new Date(b.messages[b.messages.length - 1].sendDate) : 0;
    return bDate - aDate;
  });

  return threads;
}

// ======================================================================
// Zoom API
// ======================================================================
function getZoomAccessToken_() {
  var accountId = getSetting_('ZOOM_ACCOUNT_ID');
  var clientId = getSetting_('ZOOM_CLIENT_ID');
  var clientSecret = getSetting_('ZOOM_CLIENT_SECRET');

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom API の設定が不足しています。「設定」シートに ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET を入力してください。');
  }

  var credentials = Utilities.base64Encode(clientId + ':' + clientSecret);
  var response = UrlFetchApp.fetch('https://zoom.us/oauth/token', {
    method: 'post',
    headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: 'grant_type=account_credentials&account_id=' + accountId,
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (result.access_token) return result.access_token;
  throw new Error('Zoom認証エラー: ' + (result.reason || response.getContentText()));
}

function createZoomMeeting(title, startTime, durationMinutes) {
  var token = getZoomAccessToken_();
  var startISO = Utilities.formatDate(new Date(startTime), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");

  var response = UrlFetchApp.fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      topic: title, type: 2, start_time: startISO,
      duration: durationMinutes || 60, timezone: 'Asia/Tokyo',
      settings: { join_before_host: true, waiting_room: false, auto_recording: 'none' }
    }),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
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
  var start = new Date(startTime);
  var dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
  var end = new Date(start.getTime() + dur * 60 * 1000);
  var apiCalId = getApiCalendarId_();

  // Calendar Advanced Service で直接イベント+Meet を作成
  var eventResource = {
    summary: title,
    description: description || '',
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
    var created = Calendar.Events.insert(eventResource, apiCalId, { conferenceDataVersion: 1 });
    var meetUrl = '';
    if (created.conferenceData && created.conferenceData.entryPoints) {
      var videoEntry = created.conferenceData.entryPoints.find(function(ep) { return ep.entryPointType === 'video'; });
      if (videoEntry) meetUrl = videoEntry.uri;
    }
    if (meetUrl) {
      // descriptionにもMeet URLを記載（カレンダーの説明欄からもアクセス可能に）
      Calendar.Events.patch({
        description: 'Google Meet URL: ' + meetUrl + '\n\n' + (description || '')
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
      var sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
      var cal = (sharedCalId && sharedCalId !== 'primary') ? CalendarApp.getCalendarById(sharedCalId) : null;
      if (!cal) cal = CalendarApp.getDefaultCalendar();
      var fallback = cal.createEvent(title, start, end, { description: description || '' });
      console.log('フォールバック: CalendarAppでイベント作成 eventId=' + fallback.getId());
      return { meetUrl: '', eventId: fallback.getId() };
    } catch(e2) {
      console.error('CalendarApp フォールバックも失敗: ' + e2.message);
      return { meetUrl: '', eventId: '' };
    }
  }
}

// ======================================================================
// 既存カレンダーイベントの日時を更新
// ======================================================================
function getApiCalendarId_() {
  var sharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
  return (sharedCalId && sharedCalId !== 'primary') ? sharedCalId : 'primary';
}

function updateCalendarEventDateTime_(eventId, newStartTime, durationMinutes) {
  if (!eventId) return;
  try {
    var apiCalId = getApiCalendarId_();
    var cleanId = String(eventId).replace('@google.com', '');
    var start = new Date(newStartTime);
    var dur = (durationMinutes && Number(durationMinutes) > 0) ? Number(durationMinutes) : 60;
    var end = new Date(start.getTime() + dur * 60 * 1000);
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
    var apiCalId = getApiCalendarId_();
    var cleanId = String(eventId).replace('@google.com', '');
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
    var parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function buildKeepAttachmentIdMap_(keepAttachmentIds) {
  var map = {};
  (keepAttachmentIds || []).forEach(function(id) {
    var key = String(id || '').trim();
    if (key) map[key] = true;
  });
  return map;
}

function getAttachmentFolder_() {
  var folderId = getSetting_('ATTACHMENT_FOLDER_ID', '');
  if (!folderId) throw new Error('添付ファイル保存先が未設定です。設定シートの ATTACHMENT_FOLDER_ID を入力してください。');
  try {
    return DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error('ATTACHMENT_FOLDER_ID が無効です。設定シートを確認してください。');
  }
}

function saveNewAttachments_(caseId, user, newAttachments) {
  var files = newAttachments || [];
  if (!files.length) return [];

  var folder = getAttachmentFolder_();
  var uploaded = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var fileName = String(f.name || ('attachment_' + (i + 1)));
    var mimeType = String(f.mimeType || 'application/octet-stream');
    var base64Data = String(f.base64Data || '');
    if (!base64Data) continue;

    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    var file = folder.createFile(blob);
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
    var fileId = String(att && att.fileId ? att.fileId : '');
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
  var actor = getActor_();
  ensureCaseEditableByActor_(recordData.timestamp, actor, false);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
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

  var before = {
    status: data[rowIndex - 1][IDX.RECORDS.STATUS],
    scheduledDateTime: data[rowIndex - 1][IDX.RECORDS.DATE],
    method: data[rowIndex - 1][IDX.RECORDS.METHOD],
    content: data[rowIndex - 1][IDX.RECORDS.CONTENT]
  };

  var currentMeetUrl = data[rowIndex - 1][IDX.RECORDS.MEET_URL];
  var currentAttachments = parseJsonArray_(data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS]);
  var eventTitle = '【タダサポ】' + recordData.officeName + ' 様';

  // サーバー生成データを追跡
  var newMeetUrl = null;
  var newEventId = null;

  var currentEventId = data[rowIndex - 1][IDX.RECORDS.EVENT_ID];

  // skipCalendar=true の場合はカレンダー・Meet・Zoom登録をスキップ
  if (recordData.scheduledDateTime && !currentMeetUrl && !recordData.skipCalendar) {
    if (recordData.method === 'GoogleMeet') {
      try {
        var meetResult = createGoogleMeetEvent(eventTitle, recordData.scheduledDateTime, recordData.details, recordData.duration);
        newEventId = meetResult.eventId;
        newMeetUrl = meetResult.meetUrl;
      } catch(e) { console.error('Google Meet作成エラー: ' + e.message); }

    } else if (recordData.method === 'Zoom') {
      try {
        var zDur = (recordData.duration && Number(recordData.duration) > 0) ? Number(recordData.duration) : 60;
        var zoomResult = createZoomMeeting(eventTitle, recordData.scheduledDateTime, zDur);
        newEventId = String(zoomResult.meetingId);
        newMeetUrl = zoomResult.joinUrl;
        var zStart = new Date(recordData.scheduledDateTime);
        var zEnd = new Date(zStart.getTime() + zDur * 60 * 1000);
        var zSharedCalId = getSetting_('SHARED_CALENDAR_ID', '');
        var zCal = (zSharedCalId && zSharedCalId !== 'primary') ? CalendarApp.getCalendarById(zSharedCalId) : null;
        if (!zCal) zCal = CalendarApp.getDefaultCalendar();
        zCal.createEvent(eventTitle, zStart, zEnd, {
          description: 'Zoom URL: ' + zoomResult.joinUrl + '\n\n' + (recordData.details || '')
        });
      } catch(e) { console.error('Zoom作成エラー: ' + e.message); }
    }
  } else if (recordData.scheduledDateTime && currentEventId && !recordData.skipCalendar) {
    // 既存カレンダーイベントの日時を更新
    updateCalendarEventDateTime_(currentEventId, recordData.scheduledDateTime, recordData.duration);
  }

  // 添付ファイル処理（バッチ書き込みの前に解決）
  var finalAttachments = null;
  var attachmentsValue = data[rowIndex - 1][IDX.RECORDS.ATTACHMENTS];
  var hasAttachmentUpdate = recordData.keepAttachmentIds !== undefined || recordData.newAttachments !== undefined;
  if (hasAttachmentUpdate) {
    var keepIds = Array.isArray(recordData.keepAttachmentIds)
      ? recordData.keepAttachmentIds
      : currentAttachments.map(function(a) { return a.fileId; });
    var keepIdMap = buildKeepAttachmentIdMap_(keepIds);
    var keptAttachments = currentAttachments.filter(function(a) {
      return !!(a && a.fileId && keepIdMap[String(a.fileId)]);
    });
    var uploadedAttachments = saveNewAttachments_(recordData.timestamp, recordData.user || null, recordData.newAttachments || []);
    var mergedAttachments = keptAttachments.concat(uploadedAttachments);

    if (mergedAttachments.length > 5) {
      throw new Error('添付ファイルは1回の報告につき最大5件です。');
    }

    trashRemovedAttachments_(currentAttachments, keepIdMap);
    attachmentsValue = JSON.stringify(mergedAttachments);
    finalAttachments = mergedAttachments;
  }

  // STATUS(1)～TOOLS(17) を一括書き込み（既存値を保持しつつ変更箇所を上書き）
  var curRow = data[rowIndex - 1];
  var batchRow = [
    recordData.status,                                                          // STATUS(1)
    curRow[IDX.RECORDS.STAFF_EMAIL],                                            // STAFF_EMAIL(2)
    curRow[IDX.RECORDS.STAFF_NAME],                                             // STAFF_NAME(3)
    recordData.scheduledDateTime ? new Date(recordData.scheduledDateTime) : null, // DATE(4)
    curRow[IDX.RECORDS.COUNT],                                                  // COUNT(5)
    recordData.method,                                                          // METHOD(6)
    curRow[IDX.RECORDS.BUSINESS],                                               // BUSINESS(7)
    recordData.content,                                                         // CONTENT(8)
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
  var normalized = normalizeEmail_(email);
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var staffEmail = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    var isActive = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (isActive && staffEmail === normalized) {
      return { name: data[i][IDX.STAFF.NAME], email: normalized };
    }
  }
  return null;
}

function getMasters() {
  var zoomEnabled = !!getSetting_('ZOOM_ACCOUNT_ID');
  var attachmentFolderConfigured = !!getSetting_('ATTACHMENT_FOLDER_ID');
  var methods = ['GoogleMeet', 'メール等', '電話等', '対面'];
  if (zoomEnabled) methods.splice(1, 0, 'Zoom');
  var allStaff = [];
  try {
    var ss = getSpreadsheet_();
    var staffSheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (staffSheet && staffSheet.getLastRow() > 1) {
      var rows = staffSheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var em = normalizeEmail_(rows[i][IDX.STAFF.EMAIL]);
        if (!em) continue;
        var active = parseBoolean_(rows[i][IDX.STAFF.IS_ACTIVE], true);
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
    supportTools: (function() {
      var raw = getSetting_('SUPPORT_TOOLS', '');
      if (!raw) return null; // nullのときフロントエンドでデフォルトにフォールバック
      return raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    })(),
    toolMonthlyLimits: (function() {
      var raw = getSetting_('TOOL_MONTHLY_LIMITS', '');
      if (!raw) return {};
      var result = {};
      raw.split(',').forEach(function(pair) {
        var parts = pair.split(':');
        if (parts.length === 2) {
          var name = parts[0].trim();
          var limit = parseInt(parts[1].trim(), 10);
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
    'SUPPORT_TOOLS',
    'TOOL_MONTHLY_LIMITS'
  ];
}

function ensureStaffAdminSchema_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet) return;
  var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var roleHeader = String(headers[IDX.STAFF.ROLE] || '').trim();
  var activeHeader = String(headers[IDX.STAFF.IS_ACTIVE] || '').trim();

  if (sheet.getLastColumn() < 5) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), 5 - sheet.getLastColumn());
  }
  if (!roleHeader) sheet.getRange(1, IDX.STAFF.ROLE + 1).setValue('ROLE');
  if (!activeHeader) sheet.getRange(1, IDX.STAFF.IS_ACTIVE + 1).setValue('IS_ACTIVE');

  if (sheet.getLastRow() > 1) {
    var roleRange = sheet.getRange(2, IDX.STAFF.ROLE + 1, sheet.getLastRow() - 1, 1);
    var activeRange = sheet.getRange(2, IDX.STAFF.IS_ACTIVE + 1, sheet.getLastRow() - 1, 1);
    var roleValues = roleRange.getValues();
    var activeValues = activeRange.getValues();
    for (var i = 0; i < roleValues.length; i++) {
      if (!String(roleValues[i][0] || '').trim()) roleValues[i][0] = 'staff';
      if (String(activeValues[i][0] || '').trim() === '') activeValues[i][0] = 'true';
    }
    roleRange.setValues(roleValues);
    activeRange.setValues(activeValues);
  }
}

function migrateAdminEmailsToStaffRoles_() {
  var adminMap = {};
  getAdminEmails_().forEach(function(e) { adminMap[normalizeEmail_(e)] = true; });
  if (!Object.keys(adminMap).length) return;

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
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

  var settings = loadSettings_();
  var allowed = getEditableSettingsKeys_();
  var filteredSettings = {};
  for (var i = 0; i < allowed.length; i++) {
    filteredSettings[allowed[i]] = settings[allowed[i]] || '';
  }

  var auditSheet = getOrCreateAuditLogSheet_();
  var logs = [];
  if (auditSheet.getLastRow() > 1) {
    var data = auditSheet.getRange(2, 1, Math.min(100, auditSheet.getLastRow() - 1), 8).getValues();
    for (var j = 0; j < data.length; j++) {
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
  var actor = requireAdmin_();
  ensureAdminSchema_();
  if (!payload) throw new Error('payload が必要です。');

  var email = normalizeEmail_(payload.email);
  var name = String(payload.name || '').trim();
  var role = String(payload.role || 'staff').trim().toLowerCase();
  var hasIsActive = Object.prototype.hasOwnProperty.call(payload, 'isActive');
  var isActive = hasIsActive ? parseBoolean_(payload.isActive, true) : null;

  if (!email) throw new Error('メールアドレスは必須です。');
  if (role !== 'admin' && role !== 'staff') throw new Error('role は admin または staff を指定してください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet) throw new Error('スタッフシートが見つかりません。');
    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;
    var before = null;
    for (var i = 1; i < data.length; i++) {
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
  var actor = requireAdmin_();
  ensureAdminSchema_();
  var target = normalizeEmail_(email);
  if (!target) throw new Error('email が必要です。');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet || sheet.getLastRow() <= 1) return listStaffMembers_();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (normalizeEmail_(data[i][IDX.STAFF.EMAIL]) === target) {
        var before = {
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
  SUPPORT_TOOLS:               '対応ツール一覧'
};

function updateSettingsAdmin(patch) {
  var actor = requireAdmin_();
  ensureAdminSchema_();
  if (!patch || typeof patch !== 'object') throw new Error('patch が必要です。');

  var allowMap = {};
  getEditableSettingsKeys_().forEach(function(k) { allowMap[k] = true; });

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) throw new Error('設定シートが見つかりません。');
  var data = sheet.getDataRange().getValues();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var before = {};
    var after = {};
    Object.keys(patch).forEach(function(key) {
      if (!allowMap[key]) throw new Error('更新不可の設定キーです: ' + key);
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === key) {
          before[key] = String(data[i][2] || '');
          sheet.getRange(i + 1, 3).setValue(String(patch[key] || ''));
          after[key] = String(patch[key] || '');
          found = true;
          break;
        }
      }
      if (!found) {
        // シートに行がない場合は末尾に追加して保存
        var newVal = String(patch[key] || '');
        var label = SETTINGS_LABEL_MAP_[key] || key;
        var newRow = sheet.getLastRow() + 1;
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

  var settings = loadSettings_();
  var out = {};
  getEditableSettingsKeys_().forEach(function(key) { out[key] = settings[key] || ''; });
  return out;
}

function reassignCaseAdmin(caseId, staffEmail) {
  var actor = requireAdmin_();
  ensureAdminSchema_();
  var targetEmail = normalizeEmail_(staffEmail);

  // 未割当の場合（staffEmail が空）: 担当をクリアして unhandled に戻す
  var isUnassign = !targetEmail;
  var targetStaff = null;
  if (!isUnassign) {
    targetStaff = getStaffByEmail(targetEmail);
    if (!targetStaff) throw new Error('対象スタッフが見つかりません。');
  }

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }

  if (isUnassign) {
    // 未割当：レコード行がなければ何もしない（元々 unhandled）
    if (rowIndex === -1) return;
    var before = {
      status: String(data[rowIndex - 1][IDX.RECORDS.STATUS] || ''),
      staffEmail: String(data[rowIndex - 1][IDX.RECORDS.STAFF_EMAIL] || ''),
      staffName: String(data[rowIndex - 1][IDX.RECORDS.STAFF_NAME] || '')
    };
    sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('unhandled');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue('');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue('');
    appendAuditLog_(actor, 'unassign_case', 'case', caseId, before, {
      status: 'unhandled', staffEmail: '', staffName: ''
    });
    return;
  }

  if (rowIndex === -1) {
    sheet.appendRow([
      caseId, 'inProgress', targetEmail, targetStaff.name,
      null, 1, null, null, null, null, null, null, null, null, '[]', '', '', '[]', '[]'
    ]);
    appendAuditLog_(actor, 'reassign_case', 'case', caseId, null, {
      status: 'inProgress',
      staffEmail: targetEmail,
      staffName: targetStaff.name
    });
    return;
  }

  var before = {
    status: String(data[rowIndex - 1][IDX.RECORDS.STATUS] || ''),
    staffEmail: String(data[rowIndex - 1][IDX.RECORDS.STAFF_EMAIL] || ''),
    staffName: String(data[rowIndex - 1][IDX.RECORDS.STAFF_NAME] || '')
  };

  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('inProgress');
  sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(targetEmail);
  sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(targetStaff.name);
  appendAuditLog_(actor, 'reassign_case', 'case', caseId, before, {
    status: 'inProgress',
    staffEmail: targetEmail,
    staffName: targetStaff.name
  });
  return;
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) { Logger.log('設定シートが見つかりません。'); return; }

  var data = sheet.getDataRange().getValues();
  var fixed = [];

  for (var i = 1; i < data.length; i++) {
    var key   = String(data[i][0]).trim();
    var label = String(data[i][1]).trim();
    var row   = i + 1;

    // B列がキー名と同じ（壊れた状態）なら正しい日本語名に修正
    if (key && label === key && SETTINGS_LABEL_MAP_[key]) {
      sheet.getRange(row, 2).setValue(SETTINGS_LABEL_MAP_[key]);
      fixed.push(key + ' → ' + SETTINGS_LABEL_MAP_[key]);
    }

    // 書式が未設定の行（背景色なし）にも書式を適用
    var bg = sheet.getRange(row, 3).getBackground();
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
  var normalized = String(status || '').trim();
  if (normalized === 'unhandled' || normalized === 'inProgress' || normalized === 'completed' || normalized === 'rejected' || normalized === 'cancelled') {
    return normalized;
  }
  throw new Error('status は unhandled / inProgress / completed / rejected / cancelled を指定してください。');
}

function getCaseRowIndex_(sheet, caseId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
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
  var sheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
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
  var sheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var pk = String(data[i][IDX.CASES_OVERRIDE.PK]);
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
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
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
  var sheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
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
  var actor = requireAdmin_();
  if (!payload.email)         throw new Error('メールアドレスは必須です。');
  if (!payload.officeName)    throw new Error('介護事業所名は必須です。');
  if (!payload.requesterName) throw new Error('お名前は必須です。');
  if (!payload.details)       throw new Error('困りごと詳細は必須です。');

  var ss = getSpreadsheet_();
  var sheet = ensureCasesManualSheet_(ss);

  // 申込日が指定されていればそのエポックミリ秒をPKに使用（月間カウントに反映）
  var baseTime;
  if (payload.applicationDate) {
    // "yyyy-MM-dd" → JST正午で生成（日付ずれ防止）
    baseTime = new Date(payload.applicationDate + 'T12:00:00+09:00').getTime();
  } else {
    baseTime = new Date().getTime();
  }
  var pk = 'manual_' + baseTime;
  sheet.appendRow([
    pk,
    payload.email,
    payload.officeName,
    payload.requesterName,
    payload.details,
    payload.prefecture || '',
    payload.serviceType || ''
  ]);

  appendAuditLog_(actor, 'add_manual_case', 'case', pk, null, {
    email: payload.email,
    officeName: payload.officeName,
    requesterName: payload.requesterName
  });

  return { pk: pk };
}

function ensureRecordRowForCase_(sheet, caseId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
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
  var actor = getActor_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var rowIndex = getCaseRecordRowIndex_(caseId);
  if (rowIndex === -1) throw new Error('案件が見つかりません: ' + caseId);

  var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  var staffEmail = normalizeEmail_(row[IDX.RECORDS.STAFF_EMAIL]);
  var isMainStaff = staffEmail && staffEmail === normalizeEmail_(actor.email);
  if (!actor.isAdmin && !isMainStaff) throw new Error('サブ担当を設定する権限がありません。');

  var MAX_SUB_STAFF = 1;
  if (Array.isArray(subStaffArray) && subStaffArray.length > MAX_SUB_STAFF) {
    throw new Error('サブ担当は最大' + MAX_SUB_STAFF + '名までです。');
  }
  var validated = [];
  if (Array.isArray(subStaffArray)) {
    var staffSheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    var staffData = staffSheet.getDataRange().getValues();
    var staffMap = {};
    for (var i = 1; i < staffData.length; i++) {
      var e = normalizeEmail_(staffData[i][IDX.STAFF.EMAIL]);
      if (e) staffMap[e] = String(staffData[i][IDX.STAFF.NAME]);
    }
    for (var j = 0; j < subStaffArray.length; j++) {
      var email = normalizeEmail_(subStaffArray[j].email);
      if (email && staffMap[email]) {
        validated.push({ email: email, name: staffMap[email] });
      }
    }
  }

  var before = row[IDX.RECORDS.SUB_STAFF] ? String(row[IDX.RECORDS.SUB_STAFF]) : '[]';
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  var row = data[rowIndex - 1];
  var beforeUrl = row[IDX.RECORDS.MEET_URL] || '';
  var eventId = row[IDX.RECORDS.EVENT_ID];
  var url = (newUrl || '').trim();

  // MEET_URL 列を更新
  sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(url);

  // カレンダーイベントのdescription + conferenceData（「Meetに参加する」ボタン）を更新
  if (eventId) {
    try {
      var apiCalId = getApiCalendarId_();
      var cleanId = String(eventId).replace('@google.com', '');
      var event = Calendar.Events.get(apiCalId, cleanId);
      var existingDesc = event.description || '';

      // 既存のURL行（"...URL: http..."）を除去
      var urlLinePattern = /^(Google Meet URL|Zoom URL|URL)\s*[:：]\s*https?:\/\/\S+\s*/gm;
      var stripped = existingDesc.replace(urlLinePattern, '');
      stripped = stripped.replace(/^\n+/, '');

      // 新しいURL行を先頭に挿入
      var newDesc;
      if (url) {
        var label = url.indexOf('zoom.us') !== -1 ? 'Zoom URL' : url.indexOf('meet.google') !== -1 ? 'Google Meet URL' : 'URL';
        newDesc = label + ': ' + url + (stripped ? '\n\n' + stripped : '');
      } else {
        newDesc = stripped;
      }

      // patch用オブジェクトを構築
      var patchBody = { description: newDesc };

      // 「Google Meetに参加する」ボタン（conferenceData）の更新
      var isMeetUrl = url && url.indexOf('meet.google.com/') !== -1;
      if (isMeetUrl) {
        // Meet URLからミーティングコードを抽出（例: abc-defg-hij）
        var meetCode = url.replace(/.*meet\.google\.com\//, '').replace(/[?#].*$/, '');
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
  var actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, false);

  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('レコードが見つかりません: ' + caseId);

  var row = data[rowIndex - 1];
  var historyJson = row[IDX.RECORDS.HISTORY] ? String(row[IDX.RECORDS.HISTORY]) : '[]';
  var history = [];
  try { history = JSON.parse(historyJson); } catch(e) { history = []; }

  var idx = Number(roundIndex);
  if (!isFinite(idx) || idx < 0 || idx >= history.length) {
    throw new Error('指定された履歴インデックスが範囲外です: ' + roundIndex);
  }

  var before = JSON.parse(JSON.stringify(history[idx]));

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

function setCaseStatusAdmin(caseId, status) {
  var actor = requireAdmin_();
  ensureAdminSchema_();

  var normalizedStatus = normalizeAdminCaseStatus_(status);
  var ss = getSpreadsheet_();
  var recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!recordSheet) throw new Error('サポート記録シートが見つかりません。');

  var rowIndex = ensureRecordRowForCase_(recordSheet, caseId);
  var row = recordSheet.getRange(rowIndex, 1, 1, recordSheet.getLastColumn()).getValues()[0];
  var before = {
    status: String(row[IDX.RECORDS.STATUS] || ''),
    staffEmail: String(row[IDX.RECORDS.STAFF_EMAIL] || ''),
    staffName: String(row[IDX.RECORDS.STAFF_NAME] || '')
  };

  recordSheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue(normalizedStatus);
  appendAuditLog_(actor, 'admin_set_case_status', 'case', caseId, before, { status: normalizedStatus });
  return;
}

function deleteCaseAdmin(caseId) {
  var actor = requireAdmin_();
  var ss = getSpreadsheet_();

  // 案件情報を記録（監査ログ用）
  var before = { caseId: String(caseId) };

  // 1. RECORDS シートから行を削除 + 添付ファイルをゴミ箱に移動
  var recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (recordSheet && recordSheet.getLastRow() > 1) {
    var recData = recordSheet.getDataRange().getValues();
    for (var i = recData.length - 1; i >= 1; i--) {
      if (String(recData[i][IDX.RECORDS.FK]) === String(caseId)) {
        // 添付ファイルをゴミ箱へ
        var attachments = parseJsonArray_(recData[i][IDX.RECORDS.ATTACHMENTS]);
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
  var manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
  var isManualCase = false;
  if (manualSheet && manualSheet.getLastRow() > 1) {
    var manualData = manualSheet.getDataRange().getValues();
    for (var j = manualData.length - 1; j >= 1; j--) {
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
  var overrideSheet = ss.getSheetByName(SHEET_NAMES.CASES_OVERRIDE);
  if (overrideSheet && overrideSheet.getLastRow() > 1) {
    var ovrData = overrideSheet.getDataRange().getValues();
    for (var k = ovrData.length - 1; k >= 1; k--) {
      if (String(ovrData[k][0]) === String(caseId)) {
        overrideSheet.deleteRow(k + 1);
        break;
      }
    }
  }

  // 4. EMAIL_HISTORY シートから関連行を削除（下から上へ）
  var emailSheet = ss.getSheetByName(SHEET_NAMES.EMAIL_HISTORY);
  if (emailSheet && emailSheet.getLastRow() > 1) {
    var emailData = emailSheet.getDataRange().getValues();
    for (var m = emailData.length - 1; m >= 1; m--) {
      if (String(emailData[m][IDX.EMAIL.CASE_ID]) === String(caseId)) {
        emailSheet.deleteRow(m + 1);
      }
    }
  }

  // 5. 通常案件（IMPORTRANGE）の場合は削除済みリストに追加
  if (!isManualCase) {
    var deletedRaw = getSetting_('DELETED_CASE_IDS', '');
    var deletedList = deletedRaw ? deletedRaw.split(',') : [];
    if (deletedList.indexOf(String(caseId)) === -1) {
      deletedList.push(String(caseId));
      saveSetting_('DELETED_CASE_IDS', deletedList.join(','));
    }
  }

  appendAuditLog_(actor, 'admin_delete_case', 'case', caseId, before, { deleted: true });
  return;
}

function updateCaseDataAdmin(caseId, payload) {
  var actor = requireAdmin_();
  ensureAdminSchema_();
  if (!payload || typeof payload !== 'object') throw new Error('payload が不正です。');

  var casePatch = payload.casePatch || payload.case || {};
  var recordPatch = payload.recordPatch || payload.record || {};
  if (typeof casePatch !== 'object' || typeof recordPatch !== 'object') throw new Error('casePatch / recordPatch が不正です。');

  var ss = getSpreadsheet_();
  var caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  var recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!caseSheet || !recordSheet) throw new Error('必要なシートが見つかりません。');

  // 案件の存在確認: まずCASESシート、なければCASES_MANUALシートを検索
  var caseRowIndex = getCaseRowIndex_(caseSheet, caseId);
  var isManualCase = false;
  var manualSheet = null;
  var manualRowIndex = -1;
  if (caseRowIndex === -1) {
    manualSheet = ss.getSheetByName(SHEET_NAMES.CASES_MANUAL);
    if (manualSheet) manualRowIndex = getCaseRowIndex_(manualSheet, caseId);
    if (manualRowIndex === -1) throw new Error('案件が見つかりません: ' + caseId);
    isManualCase = true;
  }

  // 案件補正シートを取得（通常案件のcasePatch書き込み先）
  var overrideSheet = ensureCasesOverrideSheet_(ss);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var actualCaseSheet = isManualCase ? manualSheet : caseSheet;
    var actualCaseRowIndex = isManualCase ? manualRowIndex : caseRowIndex;
    var beforeCaseRow = actualCaseSheet.getRange(actualCaseRowIndex, 1, 1, actualCaseSheet.getLastColumn()).getValues()[0];
    var recordRowIndex = ensureRecordRowForCase_(recordSheet, caseId);
    var beforeRecordRow = recordSheet.getRange(recordRowIndex, 1, 1, recordSheet.getLastColumn()).getValues()[0];

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
          manualSheet.getRange(manualRowIndex, IDX.CASES.OFFICE + 1).setValue(String(casePatch.officeName || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'requesterName')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.NAME + 1).setValue(String(casePatch.requesterName || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'details')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.DETAILS + 1).setValue(String(casePatch.details || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'prefecture')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.PREFECTURE + 1).setValue(String(casePatch.prefecture || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'serviceType')) {
          manualSheet.getRange(manualRowIndex, IDX.CASES.SERVICE + 1).setValue(String(casePatch.serviceType || '').trim());
        }
      } else {
        // 通常案件: 案件補正シートに書き込み
        var overrideRowIndex = getOrCreateOverrideRowIndex_(overrideSheet, caseId);
        if (Object.prototype.hasOwnProperty.call(casePatch, 'email')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.EMAIL + 1).setValue(String(casePatch.email || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'officeName')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.OFFICE + 1).setValue(String(casePatch.officeName || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'requesterName')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.NAME + 1).setValue(String(casePatch.requesterName || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'details')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.DETAILS + 1).setValue(String(casePatch.details || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'prefecture')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.PREFECTURE + 1).setValue(String(casePatch.prefecture || '').trim());
        }
        if (Object.prototype.hasOwnProperty.call(casePatch, 'serviceType')) {
          overrideSheet.getRange(overrideRowIndex, IDX.CASES_OVERRIDE.SERVICE + 1).setValue(String(casePatch.serviceType || '').trim());
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(recordPatch, 'status')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.STATUS + 1).setValue(normalizeAdminCaseStatus_(recordPatch.status));
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'staffEmail')) {
      var targetEmail = normalizeEmail_(recordPatch.staffEmail);
      var staff = targetEmail ? getStaffByEmail(targetEmail) : null;
      if (targetEmail && !staff) throw new Error('存在しないスタッフです: ' + targetEmail);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(targetEmail);
      if (!Object.prototype.hasOwnProperty.call(recordPatch, 'staffName')) {
        recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(staff ? staff.name : '');
      }
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'staffName')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(String(recordPatch.staffName || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'scheduledDateTime')) {
      var dt = recordPatch.scheduledDateTime;
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.DATE + 1).setValue(dt ? new Date(dt) : null);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'supportCount')) {
      var count = Number(recordPatch.supportCount);
      if (!isFinite(count) || count < 1) throw new Error('supportCount は1以上の数値を指定してください。');
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.COUNT + 1).setValue(Math.floor(count));
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'caseLimitOverride')) {
      var caseOverride = parseNullablePositiveInteger_(recordPatch.caseLimitOverride);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.CASE_LIMIT_OVERRIDE + 1).setValue(caseOverride === null ? '' : caseOverride);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'annualLimitOverride')) {
      var annualOverride = parseNullablePositiveInteger_(recordPatch.annualLimitOverride);
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1).setValue(annualOverride === null ? '' : annualOverride);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'method')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.METHOD + 1).setValue(String(recordPatch.method || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'businessType')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.BUSINESS + 1).setValue(String(recordPatch.businessType || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'content')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.CONTENT + 1).setValue(String(recordPatch.content || '').trim());
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'remarks')) {
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.REMARKS + 1).setValue(String(recordPatch.remarks || '').trim());
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
      var toolsVal = Array.isArray(recordPatch.tools) ? JSON.stringify(recordPatch.tools) : '[]';
      recordSheet.getRange(recordRowIndex, IDX.RECORDS.TOOLS + 1).setValue(toolsVal);
    }
    if (Object.prototype.hasOwnProperty.call(recordPatch, 'subStaff')) {
      var subStaffVal = Array.isArray(recordPatch.subStaff) ? JSON.stringify(recordPatch.subStaff) : '[]';
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
  var ss = getSpreadsheet_();
  var existing = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (existing) {
    Logger.log('「設定」シートは既に存在します。');
    return;
  }

  var sheet = ss.insertSheet(SHEET_NAMES.SETTINGS);

  // --- 列幅の設定 ---
  sheet.setColumnWidth(1, 180);  // A: 設定キー
  sheet.setColumnWidth(2, 220);  // B: 項目名
  sheet.setColumnWidth(3, 360);  // C: 設定値
  sheet.setColumnWidth(4, 280);  // D: 入力例
  sheet.setColumnWidth(5, 420);  // E: 説明

  // --- データ定義 ---
  // '#' で始まるキーはカテゴリ見出し行（コードでスキップされる）
  var rows = [
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

    // カテゴリ: カレンダー連携
    ['#カレンダー', 'カレンダー連携設定', '', '', ''],
    ['SHARED_CALENDAR_ID', '共有カレンダー ID',        '', 'abc123xyz@group.calendar.google.com', 'タダサポ共有カレンダーのID。\nGoogleカレンダー → 設定 → カレンダーID で確認できます。\n空欄の場合は担当者のデフォルトカレンダーに作成します。'],
    ['ATTACHMENT_FOLDER_ID', '添付ファイル保存先フォルダID', '', '1AbCdEfGhIjKlMnOpQrStUvWxYz', '完了報告/記録修正でアップロードした添付ファイルの保存先Google DriveフォルダID。\nGoogle Drive フォルダURLの /folders/ の後ろの値を入力してください。'],

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
  var allRange = sheet.getRange(1, 1, rows.length, 5);
  allRange.setVerticalAlignment('middle');
  allRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  allRange.setFontFamily('Noto Sans JP');
  allRange.setFontSize(10);

  // --- ヘッダー行 (1行目) ---
  var headerRange = sheet.getRange(1, 1, 1, 5);
  headerRange.setBackground('#0d9488').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(1, 36);

  // --- カテゴリ行のスタイル ---
  var categoryStyle = { bg: '#f0fdfa', font: '#0d9488', size: 11 };
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).charAt(0) === '#') {
      var rowNum = i + 1;
      var catRange = sheet.getRange(rowNum, 1, 1, 5);
      catRange.setBackground(categoryStyle.bg).setFontColor(categoryStyle.font).setFontWeight('bold').setFontSize(categoryStyle.size);
      sheet.setRowHeight(rowNum, 32);
      // B列のカテゴリ名をA-B結合表示風に（A列は非表示なので実質B列が見出し）
      catRange.setBorder(true, null, true, null, null, null, '#99f6e4', SpreadsheetApp.BorderStyle.SOLID);
    }
  }

  // --- 設定値列 (C列) のスタイル: 入力しやすく強調 ---
  var dataRowStart = 2;
  var dataRowCount = rows.length - 1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).charAt(0) !== '#' && rows[i][0] !== '') {
      var r = i + 1;
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  // 既に追加済みか確認
  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_INITIAL_SUBJECT') {
      Logger.log('メールテンプレートは既に設定シートに存在します。');
      return;
    }
  }

  var newRows = [
    ['#メールテンプレート', 'メールテンプレート設定', '', '', ''],
    ['MAIL_INITIAL_SUBJECT', '初回メール件名', 'タダサポ｜ご相談を承りました', 'タダサポ｜{{事業所名}}様のご相談を承りました', '「担当する」ボタン押下時に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_INITIAL_BODY', '初回メール本文', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\n以下の内容で受付いたしました。\n\n----------------\n【ご相談内容】\n{{相談内容}}\n----------------\n\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。', '（デフォルト文を参照）', '初回メール本文。C列のセル内で改行可能（Ctrl+Enter）。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}']
  ];

  // システム情報カテゴリの前に挿入
  var insertBefore = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === '#システム情報') {
      insertBefore = i + 1;
      break;
    }
  }

  if (insertBefore > 0) {
    sheet.insertRowsBefore(insertBefore, newRows.length);
    sheet.getRange(insertBefore, 1, newRows.length, 5).setValues(newRows);
  } else {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 5).setValues(newRows);
    insertBefore = lastRow + 1;
  }

  // カテゴリ行スタイル
  var catRange = sheet.getRange(insertBefore, 1, 1, 5);
  catRange.setBackground('#f0fdfa').setFontColor('#0d9488').setFontWeight('bold').setFontSize(11);
  catRange.setBorder(true, null, true, null, null, null, '#99f6e4', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(insertBefore, 32);

  // データ行スタイル
  for (var j = 1; j < newRows.length; j++) {
    var r = insertBefore + j;
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_FORCE_CC') {
      Logger.log('MAIL_FORCE_CC は既に設定シートに存在します。');
      return;
    }
  }

  var insertAfterRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][0]) === '#メールテンプレート') {
      insertAfterRow = j + 1;
      break;
    }
  }

  var newRow = [
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
    var last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  var rowNum = insertAfterRow + 1;
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'MAIL_DRY_RUN') {
      Logger.log('MAIL_DRY_RUN は既に設定シートに存在します。');
      return;
    }
  }

  var insertAfterRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'MAIL_FORCE_CC') {
      insertAfterRow = j + 1;
      break;
    }
  }

  var newRow = [
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
    var last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  var rowNum = insertAfterRow + 1;
  sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
  sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
  sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
  sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
  sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
  sheet.setRowHeight(rowNum, 40);

  Logger.log('MAIL_DRY_RUN の設定行を追加しました。');
}

function addUsageLimitSettings() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  var data = sheet.getDataRange().getValues();
  var hasAnnual = false;
  var hasCase = false;
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0] || '');
    if (key === 'ANNUAL_USAGE_LIMIT') hasAnnual = true;
    if (key === 'CASE_USAGE_LIMIT') hasCase = true;
  }
  if (hasAnnual && hasCase) return;

  var insertAfterRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'MAIL_DRY_RUN') {
      insertAfterRow = j + 1;
      break;
    }
  }

  var newRows = [];
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
    var last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, newRows.length, 5).setValues(newRows);
    insertAfterRow = last;
  }

  for (var r = 0; r < newRows.length; r++) {
    var rowNum = insertAfterRow + 1 + r;
    sheet.getRange(rowNum, 3).setBackground('#fffbeb').setBorder(true, true, true, true, null, null, '#f59e0b', SpreadsheetApp.BorderStyle.SOLID).setFontWeight('bold');
    sheet.getRange(rowNum, 1).setFontColor('#9ca3af').setFontSize(8);
    sheet.getRange(rowNum, 2).setFontWeight('bold').setFontColor('#1e293b');
    sheet.getRange(rowNum, 4).setFontColor('#9ca3af').setFontSize(9);
    sheet.getRange(rowNum, 5).setFontColor('#64748b').setFontSize(9);
    sheet.setRowHeight(rowNum, 40);
  }
}

function addAttachmentFolderSetting() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    Logger.log('「設定」シートが見つかりません。先に setupSettingsSheet を実行してください。');
    return;
  }

  var data = sheet.getDataRange().getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'ATTACHMENT_FOLDER_ID') {
      Logger.log('ATTACHMENT_FOLDER_ID は既に存在します。');
      return;
    }
  }

  var insertAfterRow = -1;
  for (var j = 0; j < data.length; j++) {
    if (String(data[j][0]) === 'SHARED_CALENDAR_ID') {
      insertAfterRow = j + 1;
      break;
    }
  }

  var newRow = ['ATTACHMENT_FOLDER_ID', '添付ファイル保存先フォルダID', '', '1AbCdEfGhIjKlMnOpQrStUvWxYz', '完了報告/記録修正でアップロードした添付ファイルの保存先Google DriveフォルダID。\nGoogle Drive フォルダURLの /folders/ の後ろの値を入力してください。'];

  if (insertAfterRow > 0) {
    sheet.insertRowAfter(insertAfterRow);
    sheet.getRange(insertAfterRow + 1, 1, 1, 5).setValues([newRow]);
  } else {
    var last = sheet.getLastRow();
    sheet.getRange(last + 1, 1, 1, 5).setValues([newRow]);
    insertAfterRow = last;
  }

  var rowNum = insertAfterRow + 1;
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) {
    throw new Error('「サポート記録」シートが見つかりません。');
  }

  var headerRow = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var expectedHeader = '添付ファイルJSON';

  // 既にO列（15列目）に存在する場合
  if (sheet.getLastColumn() >= 15 && String(sheet.getRange(1, 15).getValue()) === expectedHeader) {
    Logger.log('サポート記録シートの ATTACHMENTS 列は既に存在します。');
    return;
  }

  // ヘッダー行から既存位置を探索（別位置に存在する場合はそのまま利用）
  for (var i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i]) === expectedHeader) {
      Logger.log('添付ファイルJSON 列は既に存在します（列: ' + (i + 1) + '）。');
      return;
    }
  }

  // N列の後ろ（15列目）に追加
  if (sheet.getLastColumn() < 15) {
    var addCount = 15 - sheet.getLastColumn();
    sheet.insertColumnsAfter(sheet.getLastColumn(), addCount);
  } else {
    sheet.insertColumnAfter(14);
  }

  sheet.getRange(1, 15).setValue(expectedHeader);

  // 既存データ行を '[]' で初期化（空セルのみ）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var range = sheet.getRange(2, 15, lastRow - 1, 1);
    var values = range.getValues();
    for (var r = 0; r < values.length; r++) {
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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  var expectedCaseHeader = '案件上限上書き';
  var expectedAnnualHeader = '年度上限上書き';
  var requiredColumns = IDX.RECORDS.ANNUAL_LIMIT_OVERRIDE + 1;

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
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  var requiredColumns = IDX.RECORDS.TOOLS + 1; // 18
  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }
  var header = String(sheet.getRange(1, IDX.RECORDS.TOOLS + 1).getValue() || '').trim();
  if (!header) {
    sheet.getRange(1, IDX.RECORDS.TOOLS + 1).setValue('対応ツール');
    Logger.log('サポート記録シートに 対応ツール 列を追加しました。');
  }
}

function addSubStaffColumnToRecords() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.RECORDS);
  if (!sheet) throw new Error('「サポート記録」シートが見つかりません。');

  var requiredColumns = IDX.RECORDS.SUB_STAFF + 1; // 19
  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }
  var header = String(sheet.getRange(1, IDX.RECORDS.SUB_STAFF + 1).getValue() || '').trim();
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


