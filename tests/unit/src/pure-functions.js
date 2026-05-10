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

module.exports = {
  getFiscalYear,
  parseNullablePositiveInteger,
  normalizeEmail,
  parseBoolean,
  sanitizeForSheet,
  parsePositiveIntegerOrDefault,
};
