/**
 * v1.14.0 完成品（スナップショット）の流れを、GAS の各サービスを模した環境で gas/ ごと動かして検査する（ADR-015）。
 * 純粋関数の単体テストでは見つからない「未定義の関数呼び出し」「DB を開いてしまう」等を、GAS へ出す前に見つけるため。
 *   ① 完成品が無ければ作り直す ② 2回目は DB を開かずに配る ③ 書込後は作り直す ④ 「最新に更新」
 *   ⑤ Sheets API 一括読込でも同じ案件になる（DB を開かない） ⑥ 診断が一致を報告する ⑦ 非スタッフは拒否
 * データはすべてダミー。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const { readBackendFiles } = require('./src/extract-gas');
// GAS と同じく、ファイルごとに別スクリプトとして名前順に評価する（読込順への依存があれば失敗する）
const FILES = readBackendFiles();
const TZ_OFF = 9 * 3600000; // スプレッドシートのタイムゾーン Asia/Tokyo（夏時間なし）
const pad = (n) => String(n).padStart(2, '0');

function formatDate(date, tz, f) {
  if (f === 'Z') return '+0900';
  const d = new Date(date.getTime() + TZ_OFF);
  if (f === 'H') return String(d.getUTCHours());
  if (f === 'u') return String(((d.getUTCDay() + 6) % 7) + 1);
  return f.replace('yyyy', d.getUTCFullYear()).replace('MM', pad(d.getUTCMonth() + 1)).replace('dd', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours())).replace('mm', pad(d.getUTCMinutes())).replace('ss', pad(d.getUTCSeconds()));
}
const toSerial = (d) => (d.getTime() + TZ_OFF) / 86400000 + 25569;

function createEnv() {
  const pk1 = new Date('2025-01-15T01:23:45Z');
  const pk2 = new Date('2025-06-01T03:00:07Z');
  const sheets = {
    'タダメンマスタ': [['ID', '氏名', 'メール', 'ROLE', '有効'], [1, 'メンバーA', 'a@example.com', 'admin', true], [2, 'メンバーB', 'b@example.com', 'staff', true]],
    '設定': [['key', 'name', 'value'], ['ADMIN_EMAILS', '', ''], ['ZOOM_CLIENT_SECRET', '', 'dummy-plain-secret'], ['MAIL_FORCE_CC', '', 'cc@example.com']],
    '案件リスト': [['申込', 'メール', '事業所', '名前', '相談', '県', '種別'],
      [pk1, 'u1@example.com', '事業所A', '利用者A', '相談A', '東京都', '訪問介護'],
      [pk2, 'u2@example.com', '事業所B', '利用者B', '相談B', '', '通所介護']],
    'サポート記録': [['FK', 'STATUS', 'EMAIL', 'NAME', 'DATE', 'COUNT', 'METHOD', 'BUS', 'CONTENT', 'REMARKS', 'HIST', 'EV', 'MEET', 'TH', 'ATT', 'CL', 'AL', 'TOOLS', 'SUB'],
      [String(pk1), 'inProgress', 'a@example.com', 'メンバーA', new Date('2025-01-20T05:00:00Z'), 1, 'GoogleMeet', '', '', '', '[]', '', '', '', '[]', '', '', '[]', '[]']],
    '案件補正': [['PK', 'EMAIL', 'OFFICE', 'NAME', 'DETAILS', 'PREF', 'SERVICE'], [String(pk2), '', '事業所B（補正）', '', '', '', '']],
  };
  const stats = { opens: 0, apiCalls: 0 };
  const props = { SPREADSHEET_ID: 'dummy_spreadsheet_id_0000000000', SCHEMA_VERSION_APPLIED: '' };
  const cache = {};
  let activeEmail = 'a@example.com';

  const ss = {
    getSheetByName: (n) => (sheets[n] ? {
      getDataRange: () => ({ getValues: () => sheets[n].map((r) => r.slice()) }),
      getLastRow: () => sheets[n].length,
    } : null),
    getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  };
  const apiValues = (name, mode) => sheets[name].map((row) => {
    const out = row.map((v) => (v instanceof Date ? (mode === 'SERIAL_NUMBER' ? toSerial(v) : formatDate(v, '', 'yyyy/MM/dd HH:mm:ss')) : v));
    while (out.length && out[out.length - 1] === '') out.pop(); // API は行末の空セルを省く
    return out;
  });
  const blob = (bytes) => ({ bytes, getBytes() { return bytes; }, getDataAsString() { return bytes.toString('utf8'); } });

  const ctx = {
    console: { log() {}, warn() {}, info() {} },
    Logger: { log() {} },
    SpreadsheetApp: { openById: () => { stats.opens++; return ss; }, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => ({ ...props }),
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cache ? cache[k] : null),
      put: (k, v) => { if (String(v).length > 100000) throw new Error('too large'); cache[k] = String(v); },
      putAll: (kv) => Object.keys(kv).forEach((k) => { if (kv[k].length > 100000) throw new Error('too large'); cache[k] = kv[k]; }),
      getAll: (keys) => keys.reduce((o, k) => { if (k in cache) o[k] = cache[k]; return o; }, {}),
      remove: (k) => { delete cache[k]; },
    }) },
    Utilities: {
      formatDate,
      newBlob: (data) => blob(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')),
      gzip: (b) => blob(zlib.gzipSync(b.bytes)),
      ungzip: (b) => blob(zlib.gunzipSync(b.bytes)),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      base64Decode: (s) => Buffer.from(s, 'base64'),
    },
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail }) },
    ScriptApp: { getOAuthToken: () => 'dummy-token' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: {
      fetchAll: (reqs) => reqs.map((r) => {
        stats.apiCalls++;
        let body;
        if (r.url.includes('fields=')) {
          body = { properties: { timeZone: 'Asia/Tokyo' }, sheets: Object.keys(sheets).map((t) => ({ properties: { title: t } })) };
        } else {
          const u = new URL(r.url);
          const mode = u.searchParams.get('dateTimeRenderOption');
          body = { valueRanges: u.searchParams.getAll('ranges').map((rg) => ({ values: apiValues(rg.slice(1, -1).replace(/''/g, "'"), mode) })) };
        }
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      }),
    },
  };
  vm.createContext(ctx);
  FILES.forEach((f) => vm.runInContext(f.source, ctx, { filename: f.name }));
  vm.runInContext('globalThis.__t = { getInitialData, runWrite_, diagnoseSheetsApiRead, SCHEMA_VERSION_,'
    + ' reset() { _settingsCache = null; _staffRowsCache = null; _spreadsheetCache = null; _scriptPropsCache = null; _prefetched = null; } };', ctx);
  props.SCHEMA_VERSION_APPLIED = ctx.__t.SCHEMA_VERSION_; // 移行は済んでいる前提
  const t = ctx.__t;
  // GAS は実行ごとにグローバルが初期化される。それを模して各呼び出しの前に実行内キャッシュを捨てる
  const run = (fn) => { t.reset(); return fn(); };
  return { t, run, stats, props, cache, setActiveEmail: (e) => { activeEmail = e; } };
}

describe('完成品（スナップショット）の流れ（GAS を模した環境で gas/ を実行）', () => {
  const env = createEnv();
  const { t, run, stats, props, cache } = env;
  let first;

  test('① 完成品が無ければ作り直し、秘密情報はキャッシュに入れない', () => {
    first = run(() => t.getInitialData());
    expect(first.snapshot.source).toBe('rebuild');
    expect(first.user).toEqual(expect.objectContaining({ email: 'a@example.com', isAdmin: true, role: 'admin' }));
    expect(first.cases.length).toBe(2);
    expect(first.forcedCc).toBe('cc@example.com');
    expect(first.cases.find((c) => c.officeName === '事業所B（補正）')).toBeTruthy();
    expect(JSON.stringify(cache)).not.toContain('dummy-plain');
    expect(first).not.toHaveProperty('draftCaseIds');
  });

  test('② 2回目は DB を開かずに同じ内容を配る', () => {
    stats.opens = 0;
    const r = run(() => t.getInitialData());
    expect(r.snapshot.source).toBe('cache');
    expect(stats.opens).toBe(0);
    expect(JSON.stringify(r.cases)).toBe(JSON.stringify(first.cases));
    expect(r.user.isAdmin).toBe(true);
  });

  test('③ 書込（runWrite_）の後は作り直す', () => {
    run(() => t.runWrite_(() => 1, []));
    expect(run(() => t.getInitialData()).snapshot.source).toBe('rebuild');
    expect(run(() => t.getInitialData()).snapshot.source).toBe('cache');
  });

  test('③b 書込が失敗しても世代は替わる（途中まで書いた古い完成品を配らない）', () => {
    expect(() => run(() => t.runWrite_(() => { throw new Error('boom'); }, []))).toThrow('boom');
    expect(run(() => t.getInitialData()).snapshot.source).toBe('rebuild');
  });

  test('④ 「最新に更新」（forceRefresh=true）は完成品があっても作り直す', () => {
    expect(run(() => t.getInitialData(true)).snapshot.source).toBe('rebuild');
  });

  test('⑤ Sheets API 一括読込でも同じ案件になり、SpreadsheetApp を開かない', () => {
    props.SNAPSHOT_READ_MODE = 'sheetsApi';
    run(() => t.runWrite_(() => {}, []));
    stats.opens = 0;
    stats.apiCalls = 0;
    const r = run(() => t.getInitialData());
    expect(r.snapshot.readMode).toBe('sheetsApi');
    expect(stats.apiCalls).toBe(3); // メタ1 + batchGet 2（並列）
    expect(stats.opens).toBe(0);
    expect(JSON.stringify(r.cases)).toBe(JSON.stringify(first.cases));
    delete props.SNAPSHOT_READ_MODE;
  });

  test('⑥ diagnoseSheetsApiRead は全セル一致を報告する', () => {
    const d = run(() => t.diagnoseSheetsApiRead());
    expect(d.ok).toBe(true);
    expect(d.totalMismatches).toBe(0);
  });

  test('⑦ タダメンマスタにいない人は、完成品があっても拒否する', () => {
    env.setActiveEmail('x@example.com');
    expect(() => run(() => t.getInitialData())).toThrow(/アクセス権限/);
    env.setActiveEmail('a@example.com');
  });
});
