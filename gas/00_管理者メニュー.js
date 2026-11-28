// ======================================================================
// 管理者メニュー — GAS エディタから人が手で実行する関数だけを置くファイル
//
//   GAS エディタの「実行」プルダウンには、開いているファイルの関数だけが並ぶ。
//   このファイルを開けば、手で実行する関数がこの順で出る。
//   いずれも管理者（タダメンマスタ ROLE=admin）のアカウントで実行する
//   （setupSettingsSheet 以外は管理者確認がある。SDD SEC-01b）。
//
//   本体の処理は役割別のファイルにある（GAS では全ファイルが同じグローバル空間を共有する）:
//     01_定数と設定  02_認証と共通  03_完成品  04_初期データ  05_案件操作  06_メール
//     07_日程と会議  08_記録  09_管理者操作  10_移行と案件キー  11_廃止機能
//   画面から呼ぶ関数（google.script.run）はここに置かない。
// ======================================================================

// ---------- ① 定期処理（完成品の作り直しトリガー。RUNBOOK §1-4-1） ----------

/** keepWarm の時間主導トリガーを（作り直して）1つだけ設定する。管理者が GAS エディタから実行。トリガーは実行した人のアカウントで動く */
function setupKeepWarmTrigger() {
  requireAdmin_();
  removeKeepWarmTrigger_();
  ScriptApp.newTrigger(KEEP_WARM_FUNCTION_).timeBased().everyMinutes(KEEP_WARM_INTERVAL_MIN_).create();
  let msg = 'keepWarm トリガーを設定しました（' + KEEP_WARM_INTERVAL_MIN_ + '分ごと。実行者: ' + Session.getActiveUser().getEmail() + '）';
  console.log(msg);
  return msg;
}

/** keepWarm のトリガーを削除する（管理者が GAS エディタから実行） */
function removeKeepWarmTrigger() {
  requireAdmin_();
  let n = removeKeepWarmTrigger_();
  console.log('keepWarm トリガーを ' + n + ' 件削除しました');
  return n;
}

// ---------- ② 診断（読むだけ） ----------

/**
 * Sheets API 一括読込と SpreadsheetApp の読込を全セルで比べる（SNAPSHOT_READ_MODE=sheetsApi に切り替える前に実行）。
 * シートごとの行数・列数・不一致件数・不一致の位置と型、所要時間を実行ログに出す。値は出さない。
 * 全シート不一致0件（ok: true）を数回確認してから切り替える。
 */
function diagnoseSheetsApiRead() {
  requireAdmin_();
  let names = initialDataSheetNames_();
  let t = Date.now();
  let api = fetchSheetsViaApi_(names);
  let apiMs = Date.now() - t;
  t = Date.now();
  let ss = getSpreadsheet_();
  let sa = {};
  names.forEach(function(n) {
    let sh = ss.getSheetByName(n);
    sa[n] = sh ? sh.getDataRange().getValues() : null;
  });
  let result = {
    apiMs: apiMs, spreadsheetAppMs: Date.now() - t,
    timeZone: { api: api.timeZone, spreadsheetApp: ss.getSpreadsheetTimeZone() },
    sheets: {}, totalMismatches: 0
  };
  names.forEach(function(n) {
    if (api.sheets[n] === null || sa[n] === null) {
      result.sheets[n] = { missing: { api: api.sheets[n] === null, spreadsheetApp: sa[n] === null } };
      if ((api.sheets[n] === null) !== (sa[n] === null)) result.totalMismatches++;
      return;
    }
    let c = compareSheetRows_(sa[n], api.sheets[n], 5);
    result.sheets[n] = c;
    result.totalMismatches += c.mismatches;
  });
  result.ok = result.totalMismatches === 0 && result.timeZone.api === result.timeZone.spreadsheetApp;
  console.log(JSON.stringify(result, null, 1));
  return result;
}

/**
 * テスト用: ドライラン送信でCCが付与されるかを確認する。
 * 送信先は .invalid ドメインを使用する。
 */
function verifyCcDryRun() {
  requireAdmin_();
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

// ---------- ③ 初期構築（新しく環境を作るときに上から順に1回ずつ。RUNBOOK §1-4） ----------
//   どれも既にある行・シートはスキップする（何度実行してもよい）。本体は 10_移行と案件キー。

/** 「設定」シートを作る（既にあれば何もしない）。タダメンマスタが空でも実行できるよう管理者確認はしない */
function setupSettingsSheet() { return runWrite_(setupSettingsSheetImpl_, arguments); }

/** 設定シートにメールテンプレートの行を追加する */
function addEmailTemplates() { return runAdminWrite_(addEmailTemplatesImpl_, arguments); }

/** 設定シートに MAIL_FORCE_CC（自動CC）の行を追加する */
function addForcedCcSetting() { return runAdminWrite_(addForcedCcSettingImpl_, arguments); }

/** 設定シートに MAIL_DRY_RUN（ドライラン。最初は true 推奨）の行を追加する */
function addMailDryRunSetting() { return runAdminWrite_(addMailDryRunSettingImpl_, arguments); }

/** 設定シートに年間・案件ごとの利用上限の行を追加する */
function addUsageLimitSettings() { return runAdminWrite_(addUsageLimitSettingsImpl_, arguments); }

/** 設定シートに ATTACHMENT_FOLDER_ID（添付保存フォルダ）の行を追加する */
function addAttachmentFolderSetting() { return runAdminWrite_(addAttachmentFolderSettingImpl_, arguments); }

// ---------- ④ 移行・修復（通常は起動時の自動移行 ensureAttachmentSchema_ が行う。手で直したいときだけ） ----------

/** 添付機能向けのスキーマ整備を一括実行する（設定行の追加・サポート記録の列追加） */
function setupAttachmentFeatureSchema() { return runAdminWrite_(setupAttachmentFeatureSchemaImpl_, arguments); }

/** サポート記録シートに ATTACHMENTS 列（O列）を追加する */
function addAttachmentsColumnToRecords() { return runAdminWrite_(addAttachmentsColumnToRecordsImpl_, arguments); }

/** サポート記録シートに案件ごと・年間の上限特例の列（P・Q列）を追加する */
function addCaseLimitOverrideColumnsToRecords() { return runAdminWrite_(addCaseLimitOverrideColumnsToRecordsImpl_, arguments); }

/** サポート記録シートに TOOLS 列（R列）を追加する */
function addToolsColumnToRecords() { return runAdminWrite_(addToolsColumnToRecordsImpl_, arguments); }

/** サポート記録シートに SUB_STAFF 列（S列）を追加する */
function addSubStaffColumnToRecords() { return runAdminWrite_(addSubStaffColumnToRecordsImpl_, arguments); }

/** 日程・Zoom 関連の設定キー（v1.11.7）を設定シートに追加する */
function addScheduleZoomSettings() { return runAdminWrite_(addScheduleZoomSettingsImpl_, arguments); }

/** 設定シートの B列（項目名）がキー名のままの行を直し、書式を他の行に合わせる。本体は 09_管理者操作 */
function fixSettingsSheet() { return runAdminWrite_(fixSettingsSheetImpl_, arguments); }

// ---------- ⑤ 廃止機能の後始末（予約送信は v1.12.1 で廃止。本体は 11_廃止機能） ----------

/**
 * 既存の未送信予約を disabled にする。メール送信・案件更新は行わない。
 * 本番反映後に手動実行できるほか、残存トリガーから呼ばれても安全。
 */
function disablePendingScheduledEmails() { return runAdminWrite_(disablePendingScheduledEmailsImpl_, arguments); }

/**
 * 旧予約送信トリガーを削除する。v1.12.1以降、新規作成はしない。
 */
function setupScheduledEmailTrigger() {
  requireAdmin_();
  removeScheduledEmailTrigger_();
  Logger.log('予約送信機能は廃止済みです。既存トリガーを削除しました。');
  return { active: false, disabled: true };
}

/** 旧予約送信トリガーを削除する */
function removeScheduledEmailTrigger() {
  requireAdmin_();
  removeScheduledEmailTrigger_();
}

/**
 * 旧予約送信トリガーが残っているかを確認する。
 */
function getScheduledEmailTriggerStatus() {
  requireAdmin_();
  let triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processScheduledEmails_') {
      return { active: true, triggerId: triggers[i].getUniqueId() };
    }
  }
  return { active: false };
}
