// ======================================================================
// 認証と共通 — タダメンマスタの読込・権限判定（getActor_ / requireAdmin_）・排他ロック・監査ログ・入力の無害化
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// v1.13.0: タダメンマスタの読込を1実行1回にする（起動時に3〜4回読んでいた）
// ======================================================================
let _staffRowsCache = null;

function getStaffRows_() {
  if (_staffRowsCache) return _staffRowsCache;
  let data = readSheetValues_(SHEET_NAMES.STAFF); // v1.14.0: 一括読込の値があればそれを使う
  _staffRowsCache = (data && data.length > 1) ? data : [];
  return _staffRowsCache;
}

function invalidateStaffRowsCache_() {
  _staffRowsCache = null;
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

  let data = getStaffRows_(); // v1.13.0: 1実行1回の読込
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
  // Staffシート1回読みで name + role を同時取得（v1.13.0: 実行内キャッシュを共用）
  let staffName = null;
  let staffRole = null;
  {
    let data = getStaffRows_();
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

// v1.12.6 Stage0: サポート記録への「検索→無ければ追記」を排他制御するスクリプトロック。
// 競合・二重送信で複数実行が同時に rowIndex===-1 を見て二重追記する事故（重複行）を防ぐ。
// 重い外部API（Zoom/Calendar/Gmail）は内側に入れず、シート検索＋追記のクリティカル区間のみ包むこと。
// スクリプト全体で単一のグローバルロックを取得し、find-or-create 等の
// 「読み→書き」を不可分化する汎用ヘルパー（v1.12.6 / S1で一般化）。
//   ★再入ガード（S1 Stage2）: GAS の ScriptLock は再入不可（保持中に再度
//   waitLock するとデッドロック→30秒でタイムアウト）。GAS実行は単一スレッドの
//   ため、実行内フラグで「既に保持中なら再取得せず fn を実行」とすることで、
//   ロック内チョークポイントから getOrCreateCaseId_ 等を安全にネスト呼び出しできる。
let _scriptLockHeld = false;
function withScriptLock_(fn) {
  if (_scriptLockHeld) return fn(); // 既に同一実行でロック保持中 → 再取得しない
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 最大30秒待機（高競合時は tryLock より waitLock が確実）
  _scriptLockHeld = true;
  try {
    return fn();
  } finally {
    _scriptLockHeld = false;
    lock.releaseLock();
  }
}

// サポート記録の検索→追記を排他化（重複行生成を防止）。withScriptLock_ に委譲（DRY）。
function withRecordWriteLock_(fn) {
  return withScriptLock_(fn);
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
// スタッフ情報（メールアドレスから引く。無効なメンバーは null）
// ======================================================================
function getStaffByEmail_(email) {
  let normalized = normalizeEmail_(email);
  let data = getStaffRows_(); // v1.13.0: 1実行1回の読込

  for (let i = 1; i < data.length; i++) {
    let staffEmail = normalizeEmail_(data[i][IDX.STAFF.EMAIL]);
    let isActive = parseBoolean_(data[i][IDX.STAFF.IS_ACTIVE], true);
    if (isActive && staffEmail === normalized) {
      return { name: data[i][IDX.STAFF.NAME], email: normalized };
    }
  }
  return null;
}
