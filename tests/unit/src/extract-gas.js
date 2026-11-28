/**
 * バックエンド（gas/*.js）からトップレベル関数を名前で取り出し、Node で実行できるようにする（v1.14.0）。
 * pure-functions.js のような手作業の写しを増やさず、本物のコードをそのまま検査するため。
 * 取り出せるのは GAS の API に触れない純粋関数だけ（触れる関数は呼ぶと ReferenceError になる）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// v1.14.0〜 バックエンドは gas/ に役割別のファイルで置く（ADR-016）。GAS と同じく名前順に読む
const GAS_DIR = path.join(__dirname, '..', '..', '..', 'gas');

/** バックエンドのファイル一覧（名前順）。[{ name, source }] */
function readBackendFiles() {
  return fs.readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort()
    .map((f) => ({ name: f, source: fs.readFileSync(path.join(GAS_DIR, f), 'utf8').replace(/\r\n/g, '\n') }));
}

/** バックエンド全体を1つの文字列にする（関数の取り出し・走査用） */
function readSource() {
  return readBackendFiles().map((f) => f.source).join('\n');
}

/** `function name(` から、行頭の `}` までを1つの関数として返す */
function extractFunctionSource(src, name) {
  const re = new RegExp('^function ' + name + '\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('gas/ に function ' + name + ' がありません');
  const end = src.indexOf('\n}\n', m.index);
  if (end === -1) throw new Error('function ' + name + ' の終わりが見つかりません');
  return src.slice(m.index, end + 2);
}

/** 指定した関数（と依存する純粋関数）をまとめて評価し、{ 名前: 関数 } を返す */
function loadGasFunctions(names) {
  const src = readSource();
  const body = names.map((n) => extractFunctionSource(src, n)).join('\n\n')
    + '\nreturn {' + names.map((n) => n + ': ' + n).join(', ') + '};';
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** トップレベルの関数宣言を { name, body（1行目） } の一覧で返す */
function listTopLevelFunctions() {
  const src = readSource();
  const out = [];
  const re = /^function ([A-Za-z0-9_$]+)\(([^)]*)\)\s*\{(.*)$/gm;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ name: m[1], params: m[2], firstLine: m[3] });
  return out;
}

module.exports = { loadGasFunctions, listTopLevelFunctions, extractFunctionSource, readSource, readBackendFiles };
