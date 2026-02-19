/**
 * タダサポ管理システム - Backend Logic (v1.8.1)
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
  RECORDS: 'サポート記録',
  STAFF: 'タダメンマスタ',
  EMAIL_HISTORY: 'メール履歴'
};

var IDX = {
  CASES: { PK: 0, EMAIL: 1, OFFICE: 2, NAME: 3, DETAILS: 4, PREFECTURE: 5, SERVICE: 6 },
  RECORDS: { FK: 0, STATUS: 1, STAFF_EMAIL: 2, STAFF_NAME: 3, DATE: 4, COUNT: 5, METHOD: 6, BUSINESS: 7, CONTENT: 8, REMARKS: 9, HISTORY: 10, EVENT_ID: 11, MEET_URL: 12, THREAD_ID: 13 },
  STAFF: { NAME: 1, EMAIL: 2 },
  EMAIL: { CASE_ID: 0, SEND_DATE: 1, SENDER_EMAIL: 2, SENDER_NAME: 3, RECIPIENT_EMAIL: 4, SUBJECT: 5, BODY: 6 }
};

// ======================================================================
// 設定読み込み（「設定」シートから全設定値を取得しキャッシュ）
// ======================================================================
var _settingsCache = null;

/**
 * スプレッドシートを取得
 * SPREADSHEET_ID（グローバル変数）を使用して開く
 */
function getSpreadsheet_() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID が未設定です。コード.js 先頭の SPREADSHEET_ID にスプレッドシートIDを入力してください。');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
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

/**
 * ADMIN_EMAILS をカンマ区切りで配列として取得
 */
function getAdminEmails_() {
  var raw = getSetting_('ADMIN_EMAILS', '');
  if (!raw) return [];
  return raw.split(',').map(function(e) { return e.trim().toLowerCase(); });
}

// ======================================================================
// Webアプリ エントリポイント
// ======================================================================
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('タダサポ管理 v1.8.1')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ======================================================================
// 初期データ取得
// ======================================================================
function getInitialData() {
  var userEmail = Session.getActiveUser().getEmail();
  var staff = getStaffByEmail(userEmail);

  if (!staff) {
    throw new Error('アクセス権限がありません。管理者によりタダメンマスタへの登録が必要です。');
  }

  var adminEmails = getAdminEmails_();
  var isAdmin = adminEmails.indexOf(userEmail.toLowerCase()) !== -1;
  var cases = getAllCasesJoined();
  var masters = getMasters();

  return {
    user: { name: staff.name, email: userEmail, isAdmin: isAdmin },
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
  var caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  var recordSheet = ss.getSheetByName(SHEET_NAMES.RECORDS);

  var caseData = caseSheet.getDataRange().getValues();
  var recordData = recordSheet.getDataRange().getValues();

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
      supportHistory: parsedHistory
    };
  }

  for (var j = 1; j < caseData.length; j++) {
    var c = caseData[j];
    var ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    var email = String(c[IDX.CASES.EMAIL]);
    var record = recordMap[ts] || { status: 'unhandled' };
    if (record.status === 'inProgress' || record.status === 'completed') {
      var fy = getFiscalYear(ts);
      var key = email + '_' + fy;
      fiscalYearCounts[key] = (fiscalYearCounts[key] || 0) + (Number(record.supportCount) || 1);
    }
  }

  var joinedCases = [];
  for (var j = 1; j < caseData.length; j++) {
    var c = caseData[j];
    var ts = String(c[IDX.CASES.PK]);
    if (!ts) continue;
    var record = recordMap[ts] || { status: 'unhandled', supportCount: 1 };
    var email = String(c[IDX.CASES.EMAIL]);
    var fy = getFiscalYear(ts);
    var count = fiscalYearCounts[email + '_' + fy] || 0;

    joinedCases.push({
      id: ts, timestamp: ts, email: email,
      officeName: c[IDX.CASES.OFFICE], requesterName: c[IDX.CASES.NAME],
      details: c[IDX.CASES.DETAILS], serviceType: c[IDX.CASES.SERVICE],
      prefecture: c[IDX.CASES.PREFECTURE] || null,
      status: record.status, staffEmail: record.staffEmail, staffName: record.staffName,
      scheduledDateTime: record.scheduledDateTime, supportCount: record.supportCount,
      method: record.method, businessType: record.businessType,
      content: record.content, remarks: record.remarks,
      meetUrl: record.meetUrl, eventId: record.eventId,
      threadId: record.threadId || null,
      supportHistory: record.supportHistory || [],
      currentFiscalYearCount: count,
      emails: emailMap[ts] || []
    });
  }

  return joinedCases.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
}

// ======================================================================
// 案件アサイン
// ======================================================================
function assignCase(caseId, user) {
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
    sheet.appendRow([
      caseId, 'inProgress', user.email, user.name,
      null, 1, null, null, null, null, null, null, null, null
    ]);
  } else {
    sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('inProgress');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(user.email);
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(user.name);
  }
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
  if (currentCount >= 3) throw new Error('この案件は対応上限（3回）に達しているため再開できません。');

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
    staffName: row[IDX.RECORDS.STAFF_NAME] || null,
    staffEmail: row[IDX.RECORDS.STAFF_EMAIL] || null
  });
  sheet.getRange(rowIndex, IDX.RECORDS.HISTORY + 1).setValue(JSON.stringify(history));

  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('inProgress');
  sheet.getRange(rowIndex, IDX.RECORDS.COUNT + 1).setValue(currentCount + 1);
  sheet.getRange(rowIndex, IDX.RECORDS.DATE + 1).setValue(null);
  sheet.getRange(rowIndex, IDX.RECORDS.METHOD + 1).setValue(null);
  sheet.getRange(rowIndex, IDX.RECORDS.CONTENT + 1).setValue(null);
  sheet.getRange(rowIndex, IDX.RECORDS.REMARKS + 1).setValue(null);
  sheet.getRange(rowIndex, IDX.RECORDS.EVENT_ID + 1).setValue(null);
  sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(null);
}

// ======================================================================
// 回数超過 → 対応不可（メール送信 + ステータス変更）
// ======================================================================

/**
 * 年間利用回数超過のため案件を対応不可にする。
 * 回数超過メールを送信し、ステータスを rejected に変更する。
 */
function declineCase(caseId, user, subject, body) {
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
      caseId, 'rejected', user.email, user.name,
      null, 1, null, null, null, null, null, null, null, null
    ]);
  } else {
    sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue('rejected');
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_EMAIL + 1).setValue(user.email);
    sheet.getRange(rowIndex, IDX.RECORDS.STAFF_NAME + 1).setValue(user.name);
  }

  // メール送信
  var result = sendInThread_(recipientEmail, subject, body, null, null);
  storeThreadId_(caseId, result.threadId);
  recordEmail_(caseId, user, recipientEmail, subject, body);
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
 */
function getRecipientEmail_(caseId) {
  var ss = getSpreadsheet_();
  var caseSheet = ss.getSheetByName(SHEET_NAMES.CASES);
  var caseData = caseSheet.getDataRange().getValues();

  for (var i = 1; i < caseData.length; i++) {
    if (String(caseData[i][IDX.CASES.PK]) === String(caseId)) {
      return String(caseData[i][IDX.CASES.EMAIL]);
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
function sendInThread_(to, subject, body, threadId, inReplyTo) {
  var encodedSubject = '=?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=';

  var headers = [
    'MIME-Version: 1.0',
    'To: ' + to,
    'Subject: ' + encodedSubject,
    'Content-Type: text/plain; charset=UTF-8'
  ];

  if (inReplyTo) {
    headers.push('In-Reply-To: ' + inReplyTo);
    headers.push('References: ' + inReplyTo);
  }

  var rawMessage = headers.join('\r\n') + '\r\n\r\n' + body;
  var encoded = Utilities.base64EncodeWebSafe(rawMessage, Utilities.Charset.UTF_8);

  var request = { raw: encoded };
  if (threadId) request.threadId = threadId;

  var result = Gmail.Users.Messages.send(request, 'me');
  return { messageId: result.id, threadId: result.threadId };
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
 */
function getPlainTextBody_(payload) {
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString('UTF-8');
  }
  if (payload.parts) {
    for (var i = 0; i < payload.parts.length; i++) {
      var result = getPlainTextBody_(payload.parts[i]);
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
    if (data[i][IDX.STAFF.EMAIL]) {
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
function assignAndSendEmail(caseId, user, subject, body) {
  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  assignCase(caseId, user);

  // Gmail API で送信（新規スレッド開始）
  var result = sendInThread_(recipientEmail, subject, body, null, null);

  // スレッドIDを保存
  storeThreadId_(caseId, result.threadId);

  // メール履歴にも記録（バックアップ）
  recordEmail_(caseId, user, recipientEmail, subject, body);
}

// ======================================================================
// 新規メール送信（新しいスレッドを立てる）
// ======================================================================

/**
 * 案件に対して新規メールを送信する（新しいスレッドを作成）。
 * 「メール送信」ボタンから呼ばれる。
 */
function sendNewCaseEmail(caseId, user, subject, body) {
  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  var result = sendInThread_(recipientEmail, subject, body, null, null);
  storeThreadId_(caseId, result.threadId);
  recordEmail_(caseId, user, recipientEmail, subject, body);
}

// ======================================================================
// スレッド返信（既存スレッドに返信する）
// ======================================================================

/**
 * 案件の既存スレッドに返信する。
 * threadIdを指定して呼ばれる。
 */
function sendCaseEmail(caseId, user, subject, body, threadId) {
  var recipientEmail = getRecipientEmail_(caseId);
  if (!recipientEmail) throw new Error('案件が見つかりません: ' + caseId);

  var inReplyTo = null;
  if (threadId) {
    inReplyTo = getLastMessageId_(threadId);
  }

  var result = sendInThread_(recipientEmail, subject, body, threadId || null, inReplyTo);

  // threadId未指定の場合は新規スレッドとして保存
  if (!threadId && result.threadId) {
    storeThreadId_(caseId, result.threadId);
  }

  recordEmail_(caseId, user, recipientEmail, subject, body);
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

  // Gmail API から全スレッドを取得
  var staffEmails = getAllStaffEmails_();
  var threads = [];

  for (var t = 0; t < threadIds.length; t++) {
    try {
      var thread = Gmail.Users.Threads.get('me', threadIds[t], { format: 'full' });
      var gmailMsgs = thread.messages || [];

      var parsed = gmailMsgs.map(function(msg) {
        var hdrs = msg.payload.headers;
        var from = '', subj = '', date = '';
        for (var i = 0; i < hdrs.length; i++) {
          switch(hdrs[i].name.toLowerCase()) {
            case 'from': from = hdrs[i].value; break;
            case 'subject': subj = hdrs[i].value; break;
            case 'date': date = hdrs[i].value; break;
          }
        }
        var fromEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)[1] : from;
        var isStaff = staffEmails.indexOf(fromEmail.toLowerCase()) !== -1;
        var senderName = from.match(/^(.+?)\s*</) ? from.match(/^(.+?)\s*</)[1].replace(/"/g, '').trim() : fromEmail;
        return {
          sendDate: date ? new Date(date).toISOString() : null,
          senderName: senderName,
          fromEmail: fromEmail,
          subject: subj,
          body: getPlainTextBody_(msg.payload),
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
function createGoogleMeetEvent(title, startTime, description) {
  var start = new Date(startTime);
  var end = new Date(start.getTime() + 60 * 60 * 1000);
  var calendarId = getSetting_('SHARED_CALENDAR_ID', 'primary');

  var event = CalendarApp.getCalendarById(calendarId || 'primary')
    || CalendarApp.getDefaultCalendar();
  var created = (typeof event.createEvent === 'function')
    ? event.createEvent(title, start, end, { description: description })
    : CalendarApp.getDefaultCalendar().createEvent(title, start, end, { description: description });

  try {
    var eventId = created.getId().replace('@google.com', '');
    var calEvent = Calendar.Events.get('primary', eventId);
    calEvent.conferenceData = {
      createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
    };
    var updated = Calendar.Events.patch(calEvent, 'primary', calEvent.id, { conferenceDataVersion: 1 });
    if (updated.conferenceData && updated.conferenceData.entryPoints) {
      var videoEntry = updated.conferenceData.entryPoints.find(function(ep) { return ep.entryPointType === 'video'; });
      if (videoEntry) return { meetUrl: videoEntry.uri, eventId: created.getId() };
    }
  } catch(e) {
    console.log('Calendar Advanced Service未設定のため簡易URL使用: ' + e.message);
  }

  return { meetUrl: 'https://meet.google.com/lookup/' + Utilities.getUuid().substring(0, 10), eventId: created.getId() };
}

// ======================================================================
// サポート記録の更新（方法別: Meet / Zoom / その他）
// ======================================================================
function updateSupportRecord(recordData) {
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
  if (rowIndex === -1) throw new Error('レコードが見つかりません ID: ' + recordData.timestamp);

  var currentMeetUrl = data[rowIndex - 1][IDX.RECORDS.MEET_URL];
  var eventTitle = '【タダサポ】' + recordData.officeName + ' 様';

  if (recordData.scheduledDateTime && !currentMeetUrl) {
    if (recordData.method === 'GoogleMeet') {
      try {
        var meetResult = createGoogleMeetEvent(eventTitle, recordData.scheduledDateTime, recordData.details);
        sheet.getRange(rowIndex, IDX.RECORDS.EVENT_ID + 1).setValue(meetResult.eventId);
        sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(meetResult.meetUrl);
      } catch(e) { console.error('Google Meet作成エラー: ' + e.message); }

    } else if (recordData.method === 'Zoom') {
      try {
        var zoomResult = createZoomMeeting(eventTitle, recordData.scheduledDateTime, 60);
        sheet.getRange(rowIndex, IDX.RECORDS.EVENT_ID + 1).setValue(zoomResult.meetingId);
        sheet.getRange(rowIndex, IDX.RECORDS.MEET_URL + 1).setValue(zoomResult.joinUrl);
        var start = new Date(recordData.scheduledDateTime);
        var end = new Date(start.getTime() + 60 * 60 * 1000);
        CalendarApp.getDefaultCalendar().createEvent(eventTitle, start, end, {
          description: 'Zoom URL: ' + zoomResult.joinUrl + '\n\n' + (recordData.details || '')
        });
      } catch(e) { console.error('Zoom作成エラー: ' + e.message); }
    }
  }

  sheet.getRange(rowIndex, IDX.RECORDS.STATUS + 1).setValue(recordData.status);
  sheet.getRange(rowIndex, IDX.RECORDS.DATE + 1).setValue(recordData.scheduledDateTime ? new Date(recordData.scheduledDateTime) : null);
  sheet.getRange(rowIndex, IDX.RECORDS.METHOD + 1).setValue(recordData.method);
  sheet.getRange(rowIndex, IDX.RECORDS.CONTENT + 1).setValue(recordData.content);
}

// ======================================================================
// マスタデータ
// ======================================================================
function getStaffByEmail(email) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][IDX.STAFF.EMAIL]).toLowerCase() === email.toLowerCase()) {
      return { name: data[i][IDX.STAFF.NAME], email: email };
    }
  }
  return null;
}

function getMasters() {
  var zoomEnabled = !!getSetting_('ZOOM_ACCOUNT_ID');
  var methods = ['GoogleMeet', '電話等', '対面'];
  if (zoomEnabled) methods.splice(1, 0, 'Zoom');
  return {
    methods: methods,
    businessTypes: ['訪問介護', '通所介護', '居宅介護支援', '福祉用具貸与', '小規模多機能', '有料老人ホーム', 'その他'],
    prefectures: ['東京都', '神奈川県', '大阪府', '愛知県', '福岡県', '北海道', 'その他'],
    allStaff: [],
    emailTemplates: {
      initialSubject: getSetting_('MAIL_INITIAL_SUBJECT', 'タダサポ｜ご相談を承りました'),
      initialBody: getSetting_('MAIL_INITIAL_BODY', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\nご相談内容を確認いたしました。\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。'),
      declinedSubject: getSetting_('MAIL_DECLINED_SUBJECT', 'タダサポ｜ご利用回数上限のお知らせ'),
      declinedBody: getSetting_('MAIL_DECLINED_BODY', '{{名前}} 様\n\nいつもタダサポをご利用いただきありがとうございます。\n\n誠に恐れ入りますが、{{事業所名}} 様の今年度のご利用回数が上限（10回）に達しております。\nそのため、今回のご相談につきましては対応を見送らせていただくこととなりました。\n\n大変申し訳ございませんが、何卒ご理解くださいますようお願い申し上げます。\n次年度のご利用をお待ちしております。')
    }
  };
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

    // カテゴリ: メールテンプレート
    ['#メールテンプレート', 'メールテンプレート設定', '', '', ''],
    ['MAIL_INITIAL_SUBJECT', '初回メール件名',       'タダサポ｜ご相談を承りました', 'タダサポ｜{{事業所名}}様のご相談を承りました', '「担当する」ボタン押下時に送信されるメールの件名。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}}'],
    ['MAIL_INITIAL_BODY',    '初回メール本文',       '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\nご相談内容を確認いたしました。\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。', '（デフォルト文を参照）', '初回メール本文。C列のセル内で改行可能（Ctrl+Enter）。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}'],
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
    ['MAIL_INITIAL_BODY', '初回メール本文', '{{名前}} 様\n\nこの度はタダサポへご相談いただきありがとうございます。\n担当させていただきます{{担当者名}}と申します。\n\nご相談内容を確認いたしました。\n追ってサポート日時のご連絡をさせていただきます。\n\n何かご不明な点がございましたら、お気軽にお問い合わせください。\n\n今後ともよろしくお願いいたします。', '（デフォルト文を参照）', '初回メール本文。C列のセル内で改行可能（Ctrl+Enter）。\n使用可能タグ: {{事業所名}} {{名前}} {{担当者名}} {{相談内容}}']
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
