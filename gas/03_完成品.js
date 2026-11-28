// ======================================================================
// 完成品（スナップショット）— 初期データの保存・読出し・世代番号による無効化（runWrite_）・作り直し・keepWarm（ADR-015）
//   GAS では全ファイルが同じグローバル空間を共有する。手で実行する関数は 00_管理者メニュー に置く。
// ======================================================================

// ======================================================================
// v1.14.0 初期データの完成品（スナップショット）— ADR-015
//   誰が開いても同じになる「案件一覧・マスタ・認証用のタダメンマスタ行・設定値」を組み立て済みの
//   JSON として ScriptCache に置き、getInitialData は DB を開かずに返す。
//   有効性は世代番号（スクリプトプロパティ SNAPSHOT_GEN）で判定し、書込のたびに世代を替える（runWrite_）。
//   作り直しは: 書込後の最初の起動・keepWarm トリガー（5分ごと）・「最新に更新」・完成品が無い/古いとき。
//   ※純粋関数のテスト同期先: tests/unit/src/pure-functions.js
// ======================================================================
const SNAPSHOT_FORMAT_ = 1;                 // 完成品の形を変えたら上げる（古い形を読まない）
const SNAPSHOT_GEN_PROP_ = 'SNAPSHOT_GEN';
const SNAPSHOT_READ_MODE_PROP_ = 'SNAPSHOT_READ_MODE';   // 'sheetsApi' で一括読込。既定は SpreadsheetApp
const SNAPSHOT_MAX_AGE_PROP_ = 'SNAPSHOT_MAX_AGE_MIN';   // 完成品を使う最大の経過分数（既定 10）
const SNAPSHOT_MAX_AGE_DEFAULT_MIN_ = 10;
const SNAPSHOT_META_KEY_ = 'snap:meta';
const SNAPSHOT_CHUNK_CHARS_ = 90000;        // ScriptCache は1項目 100KB まで
const SNAPSHOT_TTL_SEC_ = 21600;            // ScriptCache の上限（6時間）

/** 完成品の材料として読むシート（作り直しで読む順） */
function initialDataSheetNames_() {
  return [SHEET_NAMES.STAFF, SHEET_NAMES.CASES, SHEET_NAMES.RECORDS, SHEET_NAMES.CASES_MANUAL,
    SHEET_NAMES.SETTINGS, SHEET_NAMES.CASES_OVERRIDE, SHEET_NAMES.ANNUAL_ADJUST, SHEET_NAMES.CHAT_LINKS];
}

/** スプレッドシートの URL を ID から組み立てる（DB を開かない） */
function spreadsheetUrlFromId_(id) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
}

// ---------- 書込の検知（世代番号） ----------

/** 現在の世代（毎回スクリプトプロパティから最新を読む。実行内キャッシュは使わない） */
function readSnapshotGen_() {
  return String(PropertiesService.getScriptProperties().getProperty(SNAPSHOT_GEN_PROP_) || '');
}

/** 世代を新しいトークンに替える（読み→加算をしないのでロック不要） */
function bumpSnapshotGen_() {
  let gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  PropertiesService.getScriptProperties().setProperty(SNAPSHOT_GEN_PROP_, gen);
  _scriptPropsCache = null;
  return gen;
}

/** 完成品を無効にする（書込を確定させてから世代を替える）。失敗しても書込そのものは止めない */
function invalidateSnapshot_() {
  try { SpreadsheetApp.flush(); } catch (e) { /* 未使用なら何もしない */ }
  try { bumpSnapshotGen_(); } catch (e) {
    console.warn('[snapshot] 世代の更新に失敗（完成品は SNAPSHOT_MAX_AGE_MIN 分以内に作り直される）: ' + e.message);
  }
}

/**
 * 書込を行う公開関数の包み（v1.14.0）。一番外側の終了時に、成功・失敗を問わず完成品を無効にする
 * （途中まで書いて失敗した場合も古い完成品を配らないため）。公開関数は
 *   function X() { return runWrite_(XImpl_, arguments); }
 * の形で包む。分類は tests/unit/snapshot-write-guard.test.js が検査する。
 */
let _writeDepth = 0;
function runWrite_(impl, args) {
  _writeDepth++;
  try {
    return impl.apply(null, args);
  } finally {
    _writeDepth--;
    if (_writeDepth === 0) invalidateSnapshot_();
  }
}

/** 管理者だけが実行できる書込の包み（GAS エディタから実行する保守用関数）。内部からは XImpl_ を直接呼ぶ */
function runAdminWrite_(impl, args) {
  requireAdmin_();
  return runWrite_(impl, args);
}

// ---------- 純粋関数 ----------

/** 文字列を size 文字ごとに分割する（純粋関数） */
function splitIntoChunks_(s, size) {
  let out = [];
  let str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  if (!out.length) out.push('');
  return out;
}

/**
 * 完成品のメタ情報が使えるか（純粋関数）。
 * 形式一致・世代一致・作成から maxAgeMs 以内（時計のずれは1分まで許す）・分割数が正。
 */
function snapshotUsable_(meta, gen, nowMs, maxAgeMs, format) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.f !== format) return false;
  if (!gen || meta.gen !== gen) return false;
  if (typeof meta.builtAt !== 'number' || !(meta.n > 0) || !meta.prefix) return false;
  let age = nowMs - meta.builtAt;
  return age >= -60000 && age <= maxAgeMs;
}

/** 設定値から秘密情報キーを除いた写しを返す（純粋関数。完成品に秘密を入れない） */
function stripSecretSettings_(settings, secretKeys) {
  let out = {};
  Object.keys(settings || {}).forEach(function(k) {
    if (secretKeys.indexOf(k) === -1) out[k] = settings[k];
  });
  return out;
}

/** 'Z' 形式のオフセット（+0900 / -05:00）をミリ秒にする（純粋関数） */
function parseTzOffset_(z) {
  let m = String(z == null ? '' : z).match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  let v = (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60000;
  return m[1] === '-' ? -v : v;
}

/**
 * スプレッドシートのシリアル値（1899-12-30 起点の日数・スプレッドシートのタイムゾーンの壁時計）を Date にする（純粋関数）。
 * offsetAt(ms) はその瞬間のタイムゾーンのオフセット(ms)を返す関数。夏時間の境目のため2回合わせる。
 */
function serialToDate_(serial, offsetAt) {
  let wall = Math.round((Number(serial) - 25569) * 86400000);
  let off = offsetAt(wall);
  let t = wall - off;
  let off2 = offsetAt(t);
  if (off2 !== off) t = wall - off2;
  return new Date(t);
}

/**
 * Sheets API の2回分の値（日時=シリアル値／日時=書式付き文字列）を、getValues() と同じ形の2次元配列にする（純粋関数）。
 * - 1回目が数値で2回目が文字列のセル = 日時セル → toDate(シリアル値)
 * - 欠けたセル（API は行末の空セル・空行を省く）は '' で埋め、全行を最長の行の幅に揃える
 */
function mergeApiValues_(serialRows, fmtRows, toDate) {
  let rows = serialRows || [];
  let fmts = fmtRows || [];
  let width = 0;
  rows.forEach(function(r) { if (r && r.length > width) width = r.length; });
  return rows.map(function(r, i) {
    let row = r || [];
    let f = fmts[i] || [];
    let out = new Array(width);
    for (let c = 0; c < width; c++) {
      let v = row[c];
      if (v === undefined || v === null) out[c] = '';
      else if (typeof v === 'number' && typeof f[c] === 'string') out[c] = toDate(v);
      else out[c] = v;
    }
    return out;
  });
}

function cellKind_(v) {
  if (v === undefined || v === null || v === '') return 'empty';
  if (v && typeof v.getTime === 'function') return 'date';
  return typeof v;
}

/**
 * 2つの2次元配列をセルごとに比べる（純粋関数）。日時は getTime() が同じなら一致。
 * 不一致は件数と、先頭 maxSamples 件の位置（1始まり）と型だけを返す（値は返さない＝個人情報を出さない）。
 */
function compareSheetRows_(a, b, maxSamples) {
  let A = a || [], B = b || [];
  let width = function(rows) { let w = 0; rows.forEach(function(r) { if (r && r.length > w) w = r.length; }); return w; };
  let res = { rowsA: A.length, rowsB: B.length, colsA: width(A), colsB: width(B), mismatches: 0, samples: [] };
  let rows = Math.max(A.length, B.length), cols = Math.max(res.colsA, res.colsB);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let va = (A[r] || [])[c], vb = (B[r] || [])[c];
      if (va === undefined || va === null) va = '';
      if (vb === undefined || vb === null) vb = '';
      let ka = cellKind_(va), kb = cellKind_(vb);
      let same = (ka === 'date' && kb === 'date') ? va.getTime() === vb.getTime() : (ka !== 'date' && kb !== 'date' && va === vb);
      if (!same) {
        res.mismatches++;
        if (res.samples.length < (maxSamples || 0)) res.samples.push({ row: r + 1, col: c + 1, kindA: ka, kindB: kb });
      }
    }
  }
  return res;
}

// ---------- 読込（SpreadsheetApp / Sheets API 一括） ----------

let _prefetched = null; // { sheets: { シート名: 2次元配列 | null（シート無し） }, timeZone }

/** 作り直しの間だけ、先に一括で読んだ値を readSheetValues_ から返す */
function withPrefetchedSheets_(src, fn) {
  if (!src || !src.sheets) return fn();
  let prev = _prefetched;
  _prefetched = src;
  try { return fn(); } finally { _prefetched = prev; }
}

/** シートの全値（getDataRange().getValues() と同じ形）。シートが無ければ null */
function readSheetValues_(name) {
  if (_prefetched && Object.prototype.hasOwnProperty.call(_prefetched.sheets, name)) return _prefetched.sheets[name];
  let sheet = getSpreadsheet_().getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues() : null;
}

function getSpreadsheetTimeZone_() {
  if (_prefetched && _prefetched.timeZone) return _prefetched.timeZone;
  return getSpreadsheet_().getSpreadsheetTimeZone();
}

/**
 * Sheets API values:batchGet の URL を組み立てる（純粋関数）。
 * シート名は A1 表記の引用符で囲み（' は '' に）、URL エンコードする。値は書式なし。
 * 日時は dateTimeRenderOption（既定 SERIAL_NUMBER。FORMATTED_STRING で書式付き文字列）。
 */
function buildBatchGetUrl_(spreadsheetId, sheetNames, dateTimeRenderOption) {
  let ranges = sheetNames.map(function(n) {
    return 'ranges=' + encodeURIComponent("'" + String(n).replace(/'/g, "''") + "'");
  }).join('&');
  return 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId)
    + '/values:batchGet?' + ranges + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption='
    + (dateTimeRenderOption || 'SERIAL_NUMBER');
}

function sheetsApiRequest_(url) {
  return { url: url, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
}

function assertHttpOk_(res, label) {
  let code = res.getResponseCode();
  if (code !== 200) throw new Error(label + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
}

/**
 * Sheets API でシートを読む。メタ情報（タイムゾーン・シート名）を1回取り、存在するシートだけを
 * batchGet で2回並列に読む（日時判定のため）。返り値 { timeZone, sheets: { 名前: 2次元配列 | null } }
 */
function fetchSheetsViaApi_(names) {
  let id = getSpreadsheetId_();
  let base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
  let metaRes = UrlFetchApp.fetchAll([
    sheetsApiRequest_(base + '?fields=' + encodeURIComponent('properties.timeZone,sheets.properties.title'))
  ])[0];
  assertHttpOk_(metaRes, 'Sheets API meta');
  let meta = JSON.parse(metaRes.getContentText());
  let tz = meta.properties && meta.properties.timeZone;
  if (!tz) throw new Error('Sheets API meta: timeZone がありません');
  let titles = {};
  (meta.sheets || []).forEach(function(s) { titles[s.properties.title] = true; });
  let present = names.filter(function(n) { return titles[n]; });
  let sheets = {};
  names.forEach(function(n) { if (!titles[n]) sheets[n] = null; });
  if (present.length) {
    let res = UrlFetchApp.fetchAll([
      sheetsApiRequest_(buildBatchGetUrl_(id, present, 'SERIAL_NUMBER')),
      sheetsApiRequest_(buildBatchGetUrl_(id, present, 'FORMATTED_STRING'))
    ]);
    assertHttpOk_(res[0], 'Sheets API batchGet(serial)');
    assertHttpOk_(res[1], 'Sheets API batchGet(formatted)');
    let serial = JSON.parse(res[0].getContentText()).valueRanges || [];
    let fmt = JSON.parse(res[1].getContentText()).valueRanges || [];
    let offsetAt = function(ms) { return parseTzOffset_(Utilities.formatDate(new Date(ms), tz, 'Z')); };
    let toDate = function(v) { return serialToDate_(v, offsetAt); };
    present.forEach(function(n, i) {
      sheets[n] = mergeApiValues_((serial[i] || {}).values || [], (fmt[i] || {}).values || [], toDate);
    });
  }
  return { timeZone: tz, sheets: sheets };
}

/** 作り直し用の読込。SNAPSHOT_READ_MODE=sheetsApi なら一括、失敗したら SpreadsheetApp に戻す */
function readInitialSheets_() {
  let mode = String(getScriptProps_()[SNAPSHOT_READ_MODE_PROP_] || '').trim();
  if (mode !== 'sheetsApi') return { mode: 'spreadsheetApp', sheets: null, timeZone: null };
  try {
    let r = fetchSheetsViaApi_(initialDataSheetNames_());
    return { mode: 'sheetsApi', sheets: r.sheets, timeZone: r.timeZone };
  } catch (e) {
    console.warn('[snapshot] Sheets API の一括読込に失敗。SpreadsheetApp で読み直します: ' + e.message);
    return { mode: 'spreadsheetApp(fallback)', sheets: null, timeZone: null };
  }
}

// ---------- 保存・読出し（ScriptCache） ----------

function saveSnapshot_(snap) {
  let json = JSON.stringify(snap);
  let b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
  let parts = splitIntoChunks_(b64, SNAPSHOT_CHUNK_CHARS_);
  // 同じ世代で作り直しても分割片が混ざらないよう、作成ごとに別の接頭辞にする
  let prefix = 'snap:' + snap.gen + ':' + snap.builtAt.toString(36) + ':';
  let kv = {};
  parts.forEach(function(p, i) { kv[prefix + i] = p; });
  let cache = CacheService.getScriptCache();
  cache.putAll(kv, SNAPSHOT_TTL_SEC_);
  // メタ情報は最後に書く（分割片が揃ってから見えるように）
  cache.put(SNAPSHOT_META_KEY_, JSON.stringify({
    f: SNAPSHOT_FORMAT_, gen: snap.gen, builtAt: snap.builtAt, n: parts.length, prefix: prefix
  }), SNAPSHOT_TTL_SEC_);
  return { chunks: parts.length, chars: b64.length };
}

function loadSnapshot_(gen, nowMs, maxAgeMs) {
  try {
    let cache = CacheService.getScriptCache();
    let meta = JSON.parse(cache.get(SNAPSHOT_META_KEY_) || 'null');
    if (!snapshotUsable_(meta, gen, nowMs, maxAgeMs, SNAPSHOT_FORMAT_)) return null;
    let keys = [];
    for (let i = 0; i < meta.n; i++) keys.push(meta.prefix + i);
    let got = cache.getAll(keys);
    let parts = [];
    for (let i = 0; i < keys.length; i++) {
      if (got[keys[i]] == null) return null; // 一部が消えていたら作り直す
      parts.push(got[keys[i]]);
    }
    let bytes = Utilities.base64Decode(parts.join(''));
    let json = Utilities.ungzip(Utilities.newBlob(bytes, 'application/x-gzip')).getDataAsString('UTF-8');
    let snap = JSON.parse(json);
    return (snap && snap.f === SNAPSHOT_FORMAT_ && snap.gen === gen) ? snap : null;
  } catch (e) {
    console.warn('[snapshot] 読出しに失敗（作り直します）: ' + e.message);
    return null;
  }
}

function snapshotMaxAgeMs_(props) {
  return parsePositiveIntegerOrDefault_(props[SNAPSHOT_MAX_AGE_PROP_], SNAPSHOT_MAX_AGE_DEFAULT_MIN_) * 60000;
}

// ---------- 作り直し ----------

/**
 * 完成品を作り直して保存し、作った完成品を返す。
 * 作り始めと保存直前で世代が変わっていたら（途中で書込があった）、保存せずにその呼び出しにだけ返す。
 * 同時に複数人が作り直してもよい（世代で正しさを保つため、ロックは取らない）。
 */
function rebuildSnapshot_(reason, perfOut) {
  let p = perfOut || {};
  let t0 = Date.now();
  let lap = function(name) { let now = Date.now(); p[name] = now - t0; t0 = now; };

  ensureAttachmentSchema_(); // 移行（書込）は世代を読む前に済ませる
  lap('schema');
  let gen = readSnapshotGen_() || bumpSnapshotGen_();
  let src = readInitialSheets_();
  lap('read');

  let snap = withPrefetchedSheets_(src, function() {
    let casesDetail = {};
    let cases = getAllCasesJoined_(casesDetail);
    p.casesDetail = casesDetail;
    lap('cases');
    let masters = getMasters_();
    let forcedCc = getForcedCc_() || '';
    let staffRows = getStaffRows_();
    let settings = stripSecretSettings_(loadSettings_(), SECRET_SETTING_KEYS_);
    lap('masters');
    return {
      f: SNAPSHOT_FORMAT_, gen: gen, builtAt: Date.now(), reason: reason, readMode: src.mode,
      cases: cases, masters: masters, forcedCc: forcedCc, staffRows: staffRows, settings: settings
    };
  });

  if (readSnapshotGen_() === gen) {
    try { p.saved = saveSnapshot_(snap); } catch (e) { console.warn('[snapshot] 保存に失敗: ' + e.message); }
  } else {
    p.discarded = true; // 作っている間に書込があった。次の起動で作り直す
  }
  lap('save');
  p.readMode = src.mode;
  return snap;
}

/** 完成品のタダメンマスタ行・設定値を実行内キャッシュに入れる（認証を DB なしで行うため） */
function primeFromSnapshot_(snap) {
  _staffRowsCache = snap.staffRows || [];
  _settingsCache = snap.settings || {};
}

// ======================================================================
// v1.13.0 DB の温め（keep-warm）→ v1.14.0〜 完成品の定期作り直し（DB の温めも兼ねる）
// ======================================================================
// 時間帯はスクリプトプロパティで変更できる（DB を開かずに判定するため、設定シートではなくプロパティ）。
//   KEEP_WARM_HOURS: 'H-H'（開始時以上・終了時未満。既定 '8-20'）
//   KEEP_WARM_DAYS : 曜日 1=月 … 7=日 の範囲（既定 '1-7' = 毎日）
const KEEP_WARM_FUNCTION_ = 'keepWarm';
const KEEP_WARM_INTERVAL_MIN_ = 5;

/** 範囲指定 'a-b' を [a, b] にする。不正なら既定値 */
function parseRangeSpec_(spec, defLo, defHi, min, max) {
  let m = String(spec == null ? '' : spec).trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return [defLo, defHi];
  let lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
  if (lo < min || hi > max || lo > hi) return [defLo, defHi];
  return [lo, hi];
}

/**
 * 温める時間帯か（純粋関数）。hour: 0〜23、isoDay: 1=月 … 7=日。
 * 時間は 開始以上・終了未満、曜日は両端を含む。
 */
function isWithinKeepWarmWindow_(hour, isoDay, hoursSpec, daysSpec) {
  let h = parseRangeSpec_(hoursSpec, 8, 20, 0, 24);
  let d = parseRangeSpec_(daysSpec, 1, 7, 1, 7);
  return hour >= h[0] && hour < h[1] && isoDay >= d[0] && isoDay <= d[1];
}

/**
 * 時間主導トリガーから呼ばれる（setupKeepWarmTrigger で設定）。時間帯外は DB を開かずに終わる。
 * v1.14.0〜 時間帯内は完成品（スナップショット）を作り直す（ADR-015）。IMPORTRANGE で入るフォーム申込や
 * シートの直接編集はこれで画面に反映される。DB も温まる。所要時間と内訳を実行ログに出す。
 */
function keepWarm() {
  let now = new Date();
  let hour = parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'H'), 10);
  let isoDay = parseInt(Utilities.formatDate(now, 'Asia/Tokyo', 'u'), 10);
  let props = getScriptProps_();
  if (!isWithinKeepWarmWindow_(hour, isoDay, props.KEEP_WARM_HOURS, props.KEEP_WARM_DAYS)) return;
  let t = Date.now();
  let detail = {};
  rebuildSnapshot_('trigger', detail);
  console.log(JSON.stringify({ keepWarm: Date.now() - t, detail: detail }));
}

function removeKeepWarmTrigger_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function(tr) {
    if (tr.getHandlerFunction() === KEEP_WARM_FUNCTION_) { ScriptApp.deleteTrigger(tr); n++; }
  });
  return n;
}
