/**
 * コード.js から抽出したピュア関数群（GAS依存なし）
 * 単体テスト用に CommonJS として export する。
 *
 * ⚠️ コード.js の対応関数を変更した場合は本ファイルも同期して更新すること。
 */

'use strict';

// ── 年度計算 ────────────────────────────────────────────────
// コード.js: getFiscalYear()
function getFiscalYear(dateObj) {
  var d = new Date(dateObj);
  if (isNaN(d.getTime())) return 0;
  return d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
}

// コード.js: caseFiscalYear_()
// 案件PKから年度を求める。手動追加案件のPK "manual_<エポックミリ秒>" にも対応する。
function caseFiscalYear(pkRaw) {
  if (pkRaw && typeof pkRaw.getTime === 'function') return getFiscalYear(pkRaw);
  var s = String(pkRaw);
  if (s.indexOf('manual_') === 0) {
    var epoch = Number(s.replace('manual_', ''));
    return getFiscalYear(isFinite(epoch) ? new Date(epoch) : new Date(NaN));
  }
  return getFiscalYear(s);
}

// コード.js: annualUsageKey_()
// 年間利用回数の集計キー。メール正規化 + 案件PKの年度で構成する。
function annualUsageKey(email, pkRaw) {
  return normalizeEmail(email) + '_' + caseFiscalYear(pkRaw);
}

// コード.js / index.html: 今年度利用数の実効値（v1.12.4）
// 自動計算値(base) + 管理者補正(adjustment)。0 未満にはしない。
function effectiveAnnualCount(base, adjustment) {
  var v = (Number(base) || 0) + (Number(adjustment) || 0);
  return v < 0 ? 0 : v;
}

// ── 入力バリデーション ────────────────────────────────────
// コード.js: parseNullablePositiveInteger_()
function parseNullablePositiveInteger(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  var num = Number(value);
  if (!isFinite(num)) throw new Error('上限値は1以上の整数で入力してください。');
  var intNum = Math.floor(num);
  if (intNum < 1) throw new Error('上限値は1以上の整数で入力してください。');
  return intNum;
}

// コード.js: normalizeEmail_()
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// コード.js: parseBoolean_()
function parseBoolean(v, defaultValue) {
  if (v === true || v === false) return v;
  var raw = String(v || '').trim().toLowerCase();
  if (!raw) return !!defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// ── セキュリティ ──────────────────────────────────────────
// コード.js: sanitizeForSheet_()
// 参考: OWASP A03:2025 スプレッドシート数式インジェクション対策
function sanitizeForSheet(value) {
  if (typeof value !== 'string') return value;
  if (value.length === 0) return value;
  if (/^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

// ── 上限値計算ヘルパー ────────────────────────────────────
// コード.js: parsePositiveIntegerSetting_() の相当処理
function parsePositiveIntegerOrDefault(raw, defaultValue) {
  var num = Number(String(raw || '').trim());
  if (!isFinite(num)) return Number(defaultValue);
  var intNum = Math.floor(num);
  return intNum > 0 ? intNum : Number(defaultValue);
}

// ── 日程・カレンダー（v1.11.7）────────────────────────────
// コード.js: parseDisplayCalendarsJson_()
function parseDisplayCalendarsJson(raw) {
  if (!raw) return [];
  var parsed;
  try { parsed = JSON.parse(String(raw)); } catch (e) { return []; }
  if (!Array.isArray(parsed)) return [];
  var result = [];
  for (var i = 0; i < parsed.length; i++) {
    var item = parsed[i] || {};
    var name = String(item.name || '').trim();
    var id = String(item.id || '').trim();
    if (id) result.push({ name: name || id, id: id });
  }
  return result;
}

// コード.js: eventsOverlap_()
function eventsOverlap(aStart, aEnd, bStart, bEnd) {
  var as = (aStart instanceof Date) ? aStart.getTime() : new Date(aStart).getTime();
  var ae = (aEnd instanceof Date) ? aEnd.getTime() : new Date(aEnd).getTime();
  var bs = (bStart instanceof Date) ? bStart.getTime() : new Date(bStart).getTime();
  var be = (bEnd instanceof Date) ? bEnd.getTime() : new Date(bEnd).getTime();
  return as < be && ae > bs;
}

// コード.js: computeBufferedWindow_()
function computeBufferedWindow(start, durationMin, bufferMin) {
  var s = (start instanceof Date) ? new Date(start.getTime()) : new Date(start);
  var dur = Math.max(0, Number(durationMin) || 0);
  var buf = Math.max(0, Number(bufferMin) || 0);
  var plain = new Date(s.getTime() + dur * 60000);
  return {
    start: new Date(s.getTime() - buf * 60000),
    end: new Date(plain.getTime() + buf * 60000),
    plainStart: s,
    plainEnd: plain
  };
}

// コード.js: getScheduleBufferMin_() のパース部分
// 空文字・null・undefined は default を返す（GAS側は getSetting_ がdefault適用するためここに来ない想定）
function parseScheduleBufferMin(raw, defaultValue) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return Number(defaultValue);
  var num = Number(s);
  if (!isFinite(num) || num < 0) return Number(defaultValue);
  return Math.floor(num);
}

// ============================================================
// Stage0: 重複FK行の選択不変条件（書込と表示の一致）
// 書込経路（for…break）と表示経路（recordMap）が、重複FK時に同一行
// （=最初の一致）を指すことを保証する。ズレると「完了しても未対応に
// 戻る」バグ（行109に書き行110を表示）が再発する。
// ============================================================

// コード.js: 書込経路の行選択（最初の一致のインデックス）
function selectFirstRecordIndexByFk(fkList, caseId) {
  var key = String(caseId);
  for (var i = 0; i < fkList.length; i++) {
    if (String(fkList[i]) === key) return i;
  }
  return -1;
}

// コード.js: getAllCasesJoined の recordMap 構築（最初の一致を採用）
function buildRecordMapFirstWins(records) {
  var map = {};
  for (var i = 0; i < records.length; i++) {
    var k = String(records[i].fk);
    if (Object.prototype.hasOwnProperty.call(map, k)) continue; // 重複は最初の行を採用
    map[k] = records[i].payload;
  }
  return map;
}

module.exports = {
  getFiscalYear,
  caseFiscalYear,
  annualUsageKey,
  effectiveAnnualCount,
  parseNullablePositiveInteger,
  normalizeEmail,
  parseBoolean,
  sanitizeForSheet,
  parsePositiveIntegerOrDefault,
  parseDisplayCalendarsJson,
  eventsOverlap,
  computeBufferedWindow,
  parseScheduleBufferMin,
  selectFirstRecordIndexByFk,
  buildRecordMapFirstWins,
};
