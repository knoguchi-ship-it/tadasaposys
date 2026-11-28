// ======================================================================
// メール — メール履歴・Gmail スレッド・送信（担当＋初回メール・新規・返信）・スレッド読込・下書き
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

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
  ensureCaseKeyMapping_(caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死）
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
  let overrideMap = getCasesOverrideMap_();
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
 * 認証ユーザー（=Gmail送信元の "me"）の表示名と email を返す。
 * Staff シートに登録されていれば NAME 列を表示名として利用し、
 * 未登録 / 名前空 の場合は表示名なしで email のみを返す。
 * v1.12.2 で追加：差出人 From ヘッダの RFC 2047 エンコードに用いる。
 */
function getSenderInfo_() {
  let actorEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!actorEmail) return null;
  try {
    let ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (sheet && sheet.getLastRow() > 1) {
      let data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        let em = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
        if (em === actorEmail) {
          return { email: actorEmail, name: String(data[i][IDX.STAFF.NAME] || '') };
        }
      }
    }
  } catch (e) { /* スプレッドシート未取得など — name 無しで返す */ }
  return { email: actorEmail, name: '' };
}

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

  // v1.12.2: From ヘッダを RFC 2047 で明示。
  // 未設定だと Gmail API が表示名を非エンコードのまま From に詰めるケースがあり、
  // 受信側で UTF-8 → Latin-1 解釈の文字化け（例: "NPO法人タダカヨ" → "NPOæ³•äººã‚¿ãƒ€ã‚«ãƒ¨"）が発生する。
  let sender = getSenderInfo_();
  let fromHeader = null;
  if (sender && sender.email) {
    if (sender.name) {
      let encodedFromName = '=?UTF-8?B?' + Utilities.base64Encode(sender.name, Utilities.Charset.UTF_8) + '?=';
      fromHeader = 'From: ' + encodedFromName + ' <' + sender.email + '>';
    } else {
      fromHeader = 'From: <' + sender.email + '>';
    }
  }

  let headers = [
    'MIME-Version: 1.0'
  ];
  if (fromHeader) headers.push(fromHeader);
  headers.push('To: ' + to);
  headers.push('Subject: ' + encodedSubject);
  headers.push('Content-Type: text/plain; charset=UTF-8');
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
function assignAndSendEmail() { return runWrite_(assignAndSendEmailImpl_, arguments); }
function assignAndSendEmailImpl_(caseId, user, subject, body, cc, bcc, tools) {
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
function sendNewCaseEmail() { return runWrite_(sendNewCaseEmailImpl_, arguments); }
function sendNewCaseEmailImpl_(caseId, user, subject, body, cc, bcc) {
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
function sendCaseEmail() { return runWrite_(sendCaseEmailImpl_, arguments); }
function sendCaseEmailImpl_(caseId, user, subject, body, threadId, cc, bcc) {
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

  ensureCaseKeyMapping_(payload.caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死）

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
