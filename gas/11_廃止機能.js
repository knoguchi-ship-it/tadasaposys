// ======================================================================
// 廃止機能 — 予約送信（v1.12.1 で廃止）の後始末。残存トリガー・既存キューのためだけに残す
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// v1.12.1: 予約送信機能は廃止
// ======================================================================
// 時間主導トリガーではトリガー作成者の Gmail から送信されるため、
// 「アクセスユーザー本人から送る」要件を満たせない。既存トリガーが
// 残っていても誤送信しないよう、送信処理は行わず未送信行を無効化する。
// ======================================================================

const SCHEDULED_DISABLED_NOTE = '予約送信機能廃止により未送信のまま無効化しました';
function disablePendingScheduledEmailsImpl_() {
  return disablePendingScheduledEmails_();
}

function disablePendingScheduledEmails_() {
  let ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAMES.EMAIL_SCHEDULED);
  if (!sheet || sheet.getLastRow() < 2) return { disabled: 0 };

  let data = sheet.getDataRange().getValues();
  let disabled = 0;
  let now = new Date();
  for (let i = 1; i < data.length; i++) {
    let status = String(data[i][IDX.SCHEDULED.STATUS] || '');
    if (status !== 'pending' && status !== 'sending') continue;
    let rowNum = i + 1;
    sheet.getRange(rowNum, IDX.SCHEDULED.STATUS + 1).setValue('disabled');
    sheet.getRange(rowNum, IDX.SCHEDULED.ERROR + 1).setValue(SCHEDULED_DISABLED_NOTE);
    sheet.getRange(rowNum, IDX.SCHEDULED.SENT_AT + 1).setValue(now);
    disabled++;
  }
  if (disabled > 0) SpreadsheetApp.flush();
  Logger.log('予約送信キューを無効化しました: ' + disabled + '件');
  return { disabled: disabled };
}

/**
 * 旧予約送信トリガー互換。送信はせず、未送信予約を disabled に更新する。
 */
function processScheduledEmails_() {
  return disablePendingScheduledEmails_();
}

function sendScheduledRow_(s) {
  throw new Error('予約送信機能は廃止されました。');
}

function removeScheduledEmailTrigger_() {
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processScheduledEmails_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
