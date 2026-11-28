/**
 * v1.14.0 バックエンドの役割別ファイル構成（ADR-016）
 *
 * gas/ の役割別ファイルは、GAS では同じグローバル空間で名前順に評価される。そこで次を保証する。
 *   ・旧 コード.js が残っていない／ファイル名は「2桁番号_名前.js」
 *   ・トップレベルの宣言がファイル間で重複しない（後のファイルが黙って上書きするのを防ぐ）
 *   ・トップレベルの const/let はリテラルだけで初期化する（ファイルの読込順に依存しない）
 *   ・00_管理者メニュー は「GAS エディタから手で実行する関数」だけを置き、漏れもない
 *     （画面から google.script.run で呼ぶ関数・トリガー用の関数は置かない）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readBackendFiles } = require('./src/extract-gas');

const ROOT = path.join(__dirname, '..', '..');
const MENU = '00_管理者メニュー.js';
// 画面から呼ばず、手でも実行しない公開関数（メニューに置かない）
const NOT_MENU = { doGet: 'Webアプリの入口', keepWarm: '時間主導トリガーが呼ぶ' };

const files = readBackendFiles();
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** トップレベルの宣言 [{ kind, name, line }] */
function topLevel(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    const m = line.match(/^(function|const|let|var)\s+([A-Za-z0-9_$]+)/);
    if (m) out.push({ kind: m[1], name: m[2], line: i + 1, text: line });
  });
  return out;
}

/** トップレベルの const/let の初期化式（複数行の { } / [ ] にも対応） */
function initializerOf(source, decl) {
  const lines = source.split('\n');
  const first = lines[decl.line - 1];
  const rhs = first.slice(first.indexOf('=') + 1).trim();
  if (rhs.startsWith('{') || rhs.startsWith('[')) {
    const open = rhs[0];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    const text = [rhs].concat(lines.slice(decl.line)).join('\n');
    for (let i = 0; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return text.slice(0, i + 1);
    }
    throw new Error(decl.name + ' の初期化式の終わりが見つからない');
  }
  const m = rhs.match(/^(.*?);\s*(\/\/.*)?$/);
  if (!m) throw new Error(decl.name + ' の初期化式を読めない: ' + first);
  return m[1];
}

function publicFunctions(source) {
  return topLevel(source).filter((d) => d.kind === 'function' && !d.name.endsWith('_')).map((d) => d.name);
}
const calledFromClient = (name) => html.includes('.' + name + '(');

describe('バックエンドの役割別ファイル構成（gas/）', () => {
  test('旧 コード.js が残っておらず、ファイル名は「2桁番号_名前.js」', () => {
    expect(fs.existsSync(path.join(ROOT, 'コード.js'))).toBe(false);
    expect(files.length).toBeGreaterThanOrEqual(2);
    files.forEach((f) => expect(f.name).toMatch(/^\d{2}_[^/]+\.js$/));
    expect(files[0].name).toBe(MENU); // 名前順で先頭（GAS エディタでも一番上）
  });

  test('トップレベルの宣言がファイル間で重複しない', () => {
    const seen = {};
    const dup = [];
    files.forEach((f) => topLevel(f.source).forEach((d) => {
      if (seen[d.name]) dup.push(d.name + '（' + seen[d.name] + ' と ' + f.name + '）');
      else seen[d.name] = f.name;
    }));
    expect(dup).toEqual([]);
  });

  test('トップレベルの const/let はリテラルだけで初期化する（他の宣言を参照しない＝読込順に依存しない）', () => {
    const bad = [];
    files.forEach((f) => topLevel(f.source).filter((d) => d.kind !== 'function').forEach((d) => {
      if (d.kind === 'var') { bad.push(d.name + '（var は使わない）'); return; }
      const init = initializerOf(f.source, d);
      try {
        // 識別子を参照していれば ReferenceError になる
        Function('"use strict"; return (' + init + ');')();
      } catch (e) {
        bad.push(f.name + ' ' + d.name + ': ' + e.message);
      }
    }));
    expect(bad).toEqual([]);
  });

  test('管理者メニューには手で実行する関数だけを置く（画面から呼ぶ関数・トリガー用を置かない）', () => {
    const menu = files.find((f) => f.name === MENU);
    const misplaced = publicFunctions(menu.source)
      .filter((n) => calledFromClient(n) || Object.prototype.hasOwnProperty.call(NOT_MENU, n));
    expect(misplaced).toEqual([]);
  });

  test('手で実行する関数（画面から呼ばない公開関数）はすべて管理者メニューにある', () => {
    const outside = files.filter((f) => f.name !== MENU)
      .flatMap((f) => publicFunctions(f.source).map((n) => ({ n, file: f.name })))
      .filter((x) => !calledFromClient(x.n) && !Object.prototype.hasOwnProperty.call(NOT_MENU, x.n))
      .map((x) => x.n + '（' + x.file + '）');
    expect(outside).toEqual([]);
  });
});
