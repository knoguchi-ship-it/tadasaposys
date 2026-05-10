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

module.exports = {
  getFiscalYear,
  parseNullablePositiveInteger,
  normalizeEmail,
  parseBoolean,
  sanitizeForSheet,
  parsePositiveIntegerOrDefault,
  parseDisplayCalendarsJson,
  eventsOverlap,
  computeBufferedWindow,
  parseScheduleBufferMin,
};
