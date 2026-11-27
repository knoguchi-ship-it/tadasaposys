/**
 * v1.14.0 初期データの完成品（スナップショット）— 純粋関数の単体テスト（ADR-015）
 * コード.js から関数を直接取り出して検査する（tests/unit/src/extract-gas.js）。
 */
'use strict';

const { loadGasFunctions } = require('./src/extract-gas');

const {
  splitIntoChunks_,
  snapshotUsable_,
  stripSecretSettings_,
  parseTzOffset_,
  serialToDate_,
  mergeApiValues_,
  compareSheetRows_,
  buildBatchGetUrl_,
} = loadGasFunctions([
  'splitIntoChunks_', 'snapshotUsable_', 'stripSecretSettings_', 'parseTzOffset_',
  'serialToDate_', 'mergeApiValues_', 'cellKind_', 'compareSheetRows_', 'buildBatchGetUrl_',
]);

const JST = () => 9 * 3600000; // 日本時間（夏時間なし）

describe('splitIntoChunks_（ScriptCache の1項目上限に合わせて分割）', () => {
  test('size ごとに分割し、つなげると元に戻る', () => {
    const s = 'a'.repeat(25);
    const parts = splitIntoChunks_(s, 10);
    expect(parts.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(parts.join('')).toBe(s);
  });
  test('空文字は1片（空）にする', () => {
    expect(splitIntoChunks_('', 10)).toEqual(['']);
  });
});

describe('snapshotUsable_（完成品を使ってよいか）', () => {
  const now = 1_800_000_000_000;
  const meta = { f: 1, gen: 'g1', builtAt: now - 60_000, n: 3, prefix: 'snap:g1:x:' };
  const maxAge = 10 * 60_000;
  test('形式・世代が一致し、期限内なら使う', () => {
    expect(snapshotUsable_(meta, 'g1', now, maxAge, 1)).toBe(true);
  });
  test('世代が違えば使わない（作成後に書込があった）', () => {
    expect(snapshotUsable_(meta, 'g2', now, maxAge, 1)).toBe(false);
  });
  test('現在の世代が空なら使わない', () => {
    expect(snapshotUsable_(meta, '', now, maxAge, 1)).toBe(false);
  });
  test('期限を過ぎたら使わない（フォーム申込を拾うため作り直す）', () => {
    expect(snapshotUsable_({ ...meta, builtAt: now - maxAge - 1 }, 'g1', now, maxAge, 1)).toBe(false);
    expect(snapshotUsable_({ ...meta, builtAt: now - maxAge }, 'g1', now, maxAge, 1)).toBe(true);
  });
  test('形式が違う・メタが壊れている場合は使わない', () => {
    expect(snapshotUsable_(meta, 'g1', now, maxAge, 2)).toBe(false);
    expect(snapshotUsable_(null, 'g1', now, maxAge, 1)).toBe(false);
    expect(snapshotUsable_({ ...meta, n: 0 }, 'g1', now, maxAge, 1)).toBe(false);
    expect(snapshotUsable_({ ...meta, prefix: '' }, 'g1', now, maxAge, 1)).toBe(false);
    expect(snapshotUsable_({ ...meta, builtAt: String(meta.builtAt) }, 'g1', now, maxAge, 1)).toBe(false);
  });
  test('作成時刻が未来すぎる（時計のずれが1分超）なら使わない', () => {
    expect(snapshotUsable_({ ...meta, builtAt: now + 60_001 }, 'g1', now, maxAge, 1)).toBe(false);
    expect(snapshotUsable_({ ...meta, builtAt: now + 30_000 }, 'g1', now, maxAge, 1)).toBe(true);
  });
});

describe('stripSecretSettings_（完成品に秘密情報を入れない）', () => {
  test('秘密情報キーだけを除き、元のオブジェクトは変えない', () => {
    const settings = { ADMIN_EMAILS: 'a@example.com', ZOOM_CLIENT_SECRET: 'dummy-secret', MAIL_FORCE_CC: '' };
    const out = stripSecretSettings_(settings, ['ZOOM_CLIENT_SECRET', 'ZOOM_ACCOUNT_ID']);
    expect(out).toEqual({ ADMIN_EMAILS: 'a@example.com', MAIL_FORCE_CC: '' });
    expect(settings.ZOOM_CLIENT_SECRET).toBe('dummy-secret');
  });
});

describe('parseTzOffset_', () => {
  test('+0900 / -05:00 / 不正', () => {
    expect(parseTzOffset_('+0900')).toBe(9 * 3600000);
    expect(parseTzOffset_('-05:00')).toBe(-5 * 3600000);
    expect(parseTzOffset_('+0530')).toBe(5.5 * 3600000);
    expect(parseTzOffset_('x')).toBe(0);
  });
});

describe('serialToDate_（シリアル値 → Date）', () => {
  test('日本時間の壁時計として解釈する（案件キーの日時が一致すること）', () => {
    // 2025/01/15 10:23:45 JST = 2025-01-15T01:23:45Z
    const serial = 45672 + (10 * 3600 + 23 * 60 + 45) / 86400;
    expect(serialToDate_(serial, JST).toISOString()).toBe('2025-01-15T01:23:45.000Z');
  });
  test('浮動小数の誤差はミリ秒に丸める（秒がずれない）', () => {
    const serial = 45672 + (10 * 3600 + 23 * 60 + 45) / 86400 - 1e-11;
    expect(serialToDate_(serial, JST).getUTCMilliseconds()).toBe(0);
    expect(serialToDate_(serial, JST).getUTCSeconds()).toBe(45);
  });
  test('夏時間の境目でもオフセットを合わせ直す', () => {
    // 米国東部: 2025-03-09 02:00 に -5h → -4h。03:30（夏時間）の壁時計は 07:30Z
    const offsetAt = (ms) => (ms >= Date.UTC(2025, 2, 9, 7, 0, 0) ? -4 : -5) * 3600000;
    const serial = 45725 + 3.5 / 24; // 2025-03-09 03:30
    expect(serialToDate_(serial, offsetAt).toISOString()).toBe('2025-03-09T07:30:00.000Z');
  });
});

describe('mergeApiValues_（Sheets API の値を getValues() と同じ形にする）', () => {
  const toDate = (v) => serialToDate_(v, JST);
  test('書式付きで文字列になったセルだけを日時にする（数値は数値のまま）', () => {
    const serial = [['申込日時', '回数'], [45672.5, 3]];
    const fmt = [['申込日時', '回数'], ['2025/01/15 12:00:00', 3]];
    const out = mergeApiValues_(serial, fmt, toDate);
    expect(out[1][0]).toBeInstanceOf(Date);
    expect(out[1][0].toISOString()).toBe('2025-01-15T03:00:00.000Z');
    expect(out[1][1]).toBe(3);
  });
  test('API が省いた行末の空セル・空行を "" で埋め、最長の行の幅に揃える', () => {
    const serial = [['A', 'B', 'C'], ['x'], [], ['y', '', true]];
    const out = mergeApiValues_(serial, serial, toDate);
    expect(out).toEqual([['A', 'B', 'C'], ['x', '', ''], ['', '', ''], ['y', '', true]]);
  });
  test('文字列の "manual_..." や真偽値はそのまま', () => {
    const serial = [['manual_1700000000000', false]];
    expect(mergeApiValues_(serial, serial, toDate)).toEqual([['manual_1700000000000', false]]);
  });
  test('空のシートは空配列', () => {
    expect(mergeApiValues_([], [], toDate)).toEqual([]);
  });
});

describe('compareSheetRows_（一括読込と getValues の全セル比較）', () => {
  test('日時は getTime が同じなら一致、値は出さず位置と型だけ返す', () => {
    const d1 = new Date('2025-01-15T01:23:45Z');
    const a = [['h1', 'h2'], [d1, 'x']];
    const b = [['h1', 'h2'], [new Date(d1.getTime()), 'x']];
    expect(compareSheetRows_(a, b, 5).mismatches).toBe(0);
  });
  test('日時が1ミリ秒でも違えば不一致。日時と数値の取り違えも不一致', () => {
    const d1 = new Date('2025-01-15T01:23:45Z');
    const r = compareSheetRows_([[d1, d1]], [[new Date(d1.getTime() + 1), 45672]], 5);
    expect(r.mismatches).toBe(2);
    expect(r.samples).toEqual([
      { row: 1, col: 1, kindA: 'date', kindB: 'date' },
      { row: 1, col: 2, kindA: 'date', kindB: 'number' },
    ]);
    expect(JSON.stringify(r)).not.toContain('2025');
  });
  test('getValues の空シート [[""]] と API の [] は一致。行末の欠けは "" とみなす', () => {
    expect(compareSheetRows_([['']], [], 5).mismatches).toBe(0);
    expect(compareSheetRows_([['a', '']], [['a']], 5).mismatches).toBe(0);
  });
  test('サンプルは maxSamples 件まで、件数は全部数える', () => {
    const r = compareSheetRows_([[1, 2, 3]], [['1', '2', '3']], 2);
    expect(r.mismatches).toBe(3);
    expect(r.samples.length).toBe(2);
  });
});

describe('buildBatchGetUrl_（日時の受け取り方を選べる）', () => {
  test('既定はシリアル値、FORMATTED_STRING も指定できる', () => {
    expect(buildBatchGetUrl_('dummy-id', ['案件リスト'])).toContain('dateTimeRenderOption=SERIAL_NUMBER');
    const url = buildBatchGetUrl_('dummy-id', ['案件リスト', "O'Brien"], 'FORMATTED_STRING');
    expect(url).toContain('dateTimeRenderOption=FORMATTED_STRING');
    expect(new URL(url).searchParams.getAll('ranges')).toEqual(["'案件リスト'", "'O''Brien'"]);
  });
});
