// ======================================================================
// 案件操作 — 担当・再開・差し戻し・キャンセル・回数超過（対応不可）・サブ担当
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// 案件アサイン
// ======================================================================
function assignCase() { return runWrite_(assignCaseImpl_, arguments); }
function assignCaseImpl_(caseId, user, tools) {
  let actor = getActor_();
  ensureCaseEditableByActor_(caseId, actor, true);

  ensureCaseKeyMapping_(caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死）

  let toolsVal = Array.isArray(tools) && tools.length > 0 ? JSON.stringify(tools) : '[]';

  // v1.12.6 Stage0: 検索→追記/更新を排他化（競合・二重送信による重複行を防止）
  withRecordWriteLock_(function() {
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
  });
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
function reopenCase() { return runWrite_(reopenCaseImpl_, arguments); }
function reopenCaseImpl_(caseId, user) {
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
function rollbackCurrentRound() { return runWrite_(rollbackCurrentRoundImpl_, arguments); }
function rollbackCurrentRoundImpl_(caseId) {
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
function cancelCase() { return runWrite_(cancelCaseImpl_, arguments); }
function cancelCaseImpl_(caseId) {
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

// ======================================================================
// 回数超過 → 対応不可（メール送信 + ステータス変更）
// ======================================================================

/**
 * 年間利用回数超過のため案件を対応不可にする。
 * 回数超過メールを送信し、ステータスを rejected に変更する。
 */
function declineCase() { return runWrite_(declineCaseImpl_, arguments); }
function declineCaseImpl_(caseId, user, subject, body, cc, bcc) {
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

// サブ担当更新（メイン担当者 or 管理者のみ）
function updateSubStaff() { return runWrite_(updateSubStaffImpl_, arguments); }
function updateSubStaffImpl_(caseId, subStaffArray) {
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
