// ======================================================================
// 管理者操作 — 管理パネル・メンバー権限・設定の更新・再アサイン・案件補正・年間利用補正・手動追加・ステータス遷移・削除・案件編集
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

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
    'MAIL_CLOSING_SUBJECT',
    'MAIL_CLOSING_BODY',
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
    'TOOL_MONTHLY_LIMITS',
    'CASE_KEY_READ_VIA_MAP'
  ];
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

  let filteredSettings = buildEditableSettingsForClient_();

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
    secretStatus: getSecretStatus_(), // v1.13.0: 秘密情報は値を返さず保存場所だけ返す
    auditLogs: logs
  };
}

function upsertStaffMember() { return runWrite_(upsertStaffMemberImpl_, arguments); }
function upsertStaffMemberImpl_(payload) {
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
    sheet.getRange(rowIndex, IDX.STAFF.ROLE + 1).setValue(role); invalidateStaffRowsCache_();
    sheet.getRange(rowIndex, IDX.STAFF.IS_ACTIVE + 1).setValue(String(isActive)); invalidateStaffRowsCache_();
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

function deactivateStaffMember() { return runWrite_(deactivateStaffMemberImpl_, arguments); }
function deactivateStaffMemberImpl_(email) {
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
        sheet.getRange(i + 1, IDX.STAFF.IS_ACTIVE + 1).setValue('false'); invalidateStaffRowsCache_();
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
const SETTINGS_LABEL_MAP_ = {
  CASE_KEY_READ_VIA_MAP:       '案件キーをcase_id経由で結合（S1 Stage4）',
  ANNUAL_USAGE_LIMIT:          '年度利用回数上限',
  CASE_USAGE_LIMIT:            '案件ごとの対応上限',
  MAIL_FORCE_CC:               '通常CCメールアドレス',
  MAIL_INITIAL_SUBJECT:        '初回メール件名',
  MAIL_INITIAL_BODY:           '初回メール本文',
  MAIL_INITIAL_INCLUDE_DETAILS:'初回メールに相談内容を含める',
  MAIL_NEW_SUBJECT:            '新規メール件名テンプレート',
  MAIL_NEW_BODY:               '新規メール本文テンプレート',
  MAIL_SCHEDULE_SUBJECT:       '日程確定メール件名',
  MAIL_SCHEDULE_BODY:          '日程確定メール本文',
  MAIL_DECLINED_SUBJECT:       '回数超過メール件名',
  MAIL_DECLINED_BODY:          '回数超過メール本文',
  MAIL_CLOSING_SUBJECT:        'サポート終了メール件名',
  MAIL_CLOSING_BODY:           'サポート終了メール本文',
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
  SUPPORT_TOOLS:               '対応ツール一覧',
  TOOL_MONTHLY_LIMITS:         'ツール月間上限'
};

/**
 * 管理画面へ返す編集可能設定。秘密情報（SECRET_SETTING_KEYS_）は値を返さず常に空文字（書込専用）。
 */
function buildEditableSettingsForClient_() {
  let settings = loadSettings_();
  let out = {};
  getEditableSettingsKeys_().forEach(function(key) {
    out[key] = isSecretSettingKey_(key) ? '' : (settings[key] || '');
  });
  return out;
}

function updateSettingsAdmin() { return runWrite_(updateSettingsAdminImpl_, arguments); }
function updateSettingsAdminImpl_(patch) {
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
    // v1.13.0: 秘密情報はスクリプトプロパティへ。空文字=変更なし、null=削除。監査ログに値は残さない。
    let secretKeysToBlank = [];
    Object.keys(patch).forEach(function(key) {
      if (!allowMap[key]) throw new Error('更新不可の設定キーです: ' + key);
      if (isSecretSettingKey_(key)) {
        let v = patch[key];
        if (v === '' || v === undefined) return;
        let had = !!String(getScriptProps_()[key] || '').trim();
        setSecret_(key, v === null ? null : String(v));
        before[key] = had ? '(設定済み)' : '(未設定)';
        after[key] = v === null ? '(削除)' : '(変更)';
        secretKeysToBlank.push(key);
        return;
      }
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
    if (secretKeysToBlank.length) blankSecretCellsInSheet_(secretKeysToBlank); // 旧平文を残さない
    _settingsCache = null;
    appendAuditLog_(actor, 'update_settings', 'settings', 'settings', before, after);
  } finally {
    lock.releaseLock();
  }

  return { settings: buildEditableSettingsForClient_(), secretStatus: getSecretStatus_() };
}

function reassignCaseAdmin() { return runWrite_(reassignCaseAdminImpl_, arguments); }
function reassignCaseAdminImpl_(caseId, staffEmail) {
  let actor = requireAdmin_();
  ensureAdminSchema_();
  let targetEmail = normalizeEmail_(staffEmail);
  let isUnassign  = !targetEmail;

  let targetStaff = null;
  if (!isUnassign) {
    targetStaff = getStaffByEmail_(targetEmail);
    if (!targetStaff) throw new Error('対象スタッフが見つかりません。');
  }

  ensureCaseKeyMapping_(caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死）

  // v1.12.6 Stage0: 検索→追記/更新を排他化（競合・二重送信による重複行を防止）
  return withRecordWriteLock_(function() {
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
  });
}

function fixSettingsSheetImpl_() {
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
// 管理者操作の共通ヘルパー（ステータスの検証・案件行の検索）
// ======================================================================
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
function getCasesOverrideMap_() {
  let data = readSheetValues_(SHEET_NAMES.CASES_OVERRIDE);
  if (!data || data.length < 2) return {};
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

// ======================================================================
// 年間利用補正シート ヘルパー（v1.12.4）
// 管理者が「今年度利用数」を手動修正した際の補正量（メール+年度ごと）を保持する。
// 実際に表示される利用回数 = 自動計算値（同一メール+年度の対応回数合算）+ 補正量。
// ======================================================================

/**
 * 「年間利用補正」シートを取得する。存在しなければ作成してヘッダを設定する。
 */
function ensureAnnualUsageAdjustmentSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.ANNUAL_ADJUST);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.ANNUAL_ADJUST);
    sheet.getRange(1, 1, 1, 5).setValues([[
      'メールアドレス', '年度', '補正値', '更新者', '更新日時'
    ]]);
  }
  return sheet;
}

/**
 * 年間利用補正マップを返す。キー = 正規化メール + '_' + 年度、値 = 補正量(整数, 負値可)。
 */
function getAnnualAdjustmentMap_() {
  let data = readSheetValues_(SHEET_NAMES.ANNUAL_ADJUST);
  if (!data || data.length < 2) return {};
  let map = {};
  for (let i = 1; i < data.length; i++) {
    let email = normalizeEmail_(data[i][IDX.ANNUAL_ADJUST.EMAIL]);
    let fy = parseInt(data[i][IDX.ANNUAL_ADJUST.FISCAL_YEAR], 10);
    if (!email || !isFinite(fy)) continue;
    let adj = Number(data[i][IDX.ANNUAL_ADJUST.ADJUSTMENT]);
    if (!isFinite(adj)) adj = 0;
    map[email + '_' + fy] = Math.trunc(adj);
  }
  return map;
}

/**
 * 年間利用補正を upsert する。email は正規化して保存。adjustment は整数(負値可)。
 */
function upsertAnnualAdjustment_(ss, email, fiscalYear, adjustment, actorEmail) {
  let sheet = ensureAnnualUsageAdjustmentSheet_(ss);
  let normEmail = normalizeEmail_(email);
  let fy = parseInt(fiscalYear, 10);
  let adj = Math.trunc(Number(adjustment) || 0);
  let now = new Date();
  let data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizeEmail_(data[i][IDX.ANNUAL_ADJUST.EMAIL]) === normEmail &&
        parseInt(data[i][IDX.ANNUAL_ADJUST.FISCAL_YEAR], 10) === fy) {
      let row = i + 1;
      sheet.getRange(row, IDX.ANNUAL_ADJUST.ADJUSTMENT + 1).setValue(adj);
      sheet.getRange(row, IDX.ANNUAL_ADJUST.UPDATED_BY + 1).setValue(actorEmail || '');
      sheet.getRange(row, IDX.ANNUAL_ADJUST.UPDATED_AT + 1).setValue(now);
      return;
    }
  }
  sheet.appendRow([normEmail, fy, adj, actorEmail || '', now]);
}

/**
 * 管理者が「今年度利用数（実数）」を手動修正する（v1.12.4）。
 * desiredCount は目的の絶対値。内部では「目的値 − 自動計算値(base)」を補正量として
 * メール+年度ごとに保存するため、その後に実案件が増えても加算が継続する。
 * 利用回数は同一メール+年度で合算されるため、補正は同一メール+年度の全案件に反映される。
 *
 * @param {string} caseId 対象案件のPK（メール+年度の解決に使用）
 * @param {number} desiredCount 目的の今年度利用数（0以上の整数）
 * @returns {{ email:string, fiscalYear:number, base:number, adjustment:number, effective:number }}
 */
function setAnnualUsageCountAdmin() { return runWrite_(setAnnualUsageCountAdminImpl_, arguments); }
function setAnnualUsageCountAdminImpl_(caseId, desiredCount) {
  let actor = requireAdmin_();
  let n = Number(desiredCount);
  if (!isFinite(n) || n < 0) throw new Error('今年度利用数は0以上の整数で指定してください。');
  n = Math.floor(n);

  let ss = getSpreadsheet_();
  // 対象案件の email + 年度 を、表示と同じ結合ロジックから解決する
  let joined = getAllCasesJoined_();
  let target = null;
  for (let i = 0; i < joined.length; i++) {
    if (String(joined[i].id) === String(caseId)) { target = joined[i]; break; }
  }
  if (!target) throw new Error('対象の案件が見つかりません。');

  let email = normalizeEmail_(target.email);
  if (!email) throw new Error('対象案件にメールアドレスが設定されていません。');
  let fy = caseFiscalYear_(caseId);

  // base（自動計算値） = 現在の表示値（effective） − 既存補正量
  let adjMap = getAnnualAdjustmentMap_();
  let key = email + '_' + fy;
  let existingAdj = adjMap[key] || 0;
  let base = (Number(target.currentFiscalYearCount) || 0) - existingAdj;
  if (base < 0) base = 0;
  let newAdj = n - base;

  upsertAnnualAdjustment_(ss, email, fy, newAdj, actor.email);

  appendAuditLog_(actor, 'set_annual_usage_count', 'annual_usage', key,
    { previousEffective: target.currentFiscalYearCount, previousAdjustment: existingAdj },
    { desiredCount: n, base: base, newAdjustment: newAdj }
  );

  return { email: email, fiscalYear: fy, base: base, adjustment: newAdj, effective: n };
}

/**
 * 案件補正シートで caseId に対応する行番号を返す。
 * 該当行がなければ PK だけセットした新規行を追加してその行番号を返す。
 */
function getOrCreateOverrideRowIndex_(sheet, caseId) {
  ensureCaseKeyMapping_(caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死）
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
function addManualCase() { return runWrite_(addManualCaseImpl_, arguments); }
function addManualCaseImpl_(payload) {
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

  // S1 Stage2: 新規案件を案件キーマップへ登録（生PKとメールを直接渡す・additive・非致死）
  ensureCaseKeyMapping_(pk, { pkRaw: pk, email: payload.email });

  return { pk: pk };
}

function ensureRecordRowForCase_(sheet, caseId) {
  ensureCaseKeyMapping_(caseId); // S1 Stage2: 案件キーマップへ登録（additive・非致死。ロック外で自前ロック取得）
  // v1.12.6 Stage0: 検索→追記を排他化（競合・二重送信による重複行を防止）
  return withRecordWriteLock_(function() {
    let data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][IDX.RECORDS.FK]) === String(caseId)) return i + 1;
    }
    sheet.appendRow([
      caseId, 'unhandled', '', '',
      null, 1, null, null, null, null, '[]', null, null, null, '[]', '', '', '[]', '[]'
    ]);
    return sheet.getLastRow();
  });
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
function setCaseStatusAdmin() { return runWrite_(setCaseStatusAdminImpl_, arguments); }
function setCaseStatusAdminImpl_(caseId, status) {
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

function deleteCaseAdmin() { return runWrite_(deleteCaseAdminImpl_, arguments); }
function deleteCaseAdminImpl_(caseId) {
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

function updateCaseDataAdmin() { return runWrite_(updateCaseDataAdminImpl_, arguments); }
function updateCaseDataAdminImpl_(caseId, payload) {
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
      let staff = targetEmail ? getStaffByEmail_(targetEmail) : null;
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
