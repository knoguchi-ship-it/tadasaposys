#!/usr/bin/env node
/**
 * 本番ビルド（npm run build）— ADR-013
 *
 * 開発用の原本 index.html（ブラウザ内 Babel・CDN の React/Tailwind）から、本番用の dist/ を作る。
 *   dist/index.html   … JSX を事前変換し React・lucide を同梱した1本のスクリプト＋ビルド済み Tailwind CSS
 *   dist/コード.js     … そのままコピー
 *   dist/appsscript.json … そのままコピー
 * clasp は dist/ を push する（.clasp.json の rootDir を "dist" にする。RUNBOOK §3）。
 *
 * 原本の目印:
 *   <!-- build:dev-only:start --> ... <!-- build:dev-only:end -->  … 除去（CDN・Babel・importmap 等）
 *   <!-- build:css -->                                           … ビルド済み Tailwind CSS を埋め込む
 *   <!-- build:app ... --> の直後の <script type="text/babel"> … 事前変換したスクリプトに差し替え
 *
 * 依存（devDependencies・版固定）: esbuild / tailwindcss@3 / react@18.2.0 / react-dom@18.2.0 / lucide-react@0.330.0
 * React 18.2.0 固定（ADR-004）は package.json の版固定で保証する（CDN の ?deps 指定は不要になる）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/** 原本から開発専用ブロックを除去する */
function stripDevOnly(html) {
  const re = /[ \t]*<!-- build:dev-only:start[\s\S]*?<!-- build:dev-only:end -->[ \t]*\r?\n?/g;
  const out = html.replace(re, '');
  if (/build:dev-only:(start|end)/.test(out)) throw new Error('build:dev-only の start/end の対応が崩れている');
  return out;
}

/** build:app 目印直後の text/babel スクリプトの中身と、その範囲を返す */
function extractApp(html) {
  const marker = html.indexOf('<!-- build:app');
  if (marker < 0) throw new Error('<!-- build:app --> の目印が見つからない');
  const open = html.indexOf('<script type="text/babel"', marker);
  const bodyStart = html.indexOf('>', open) + 1;
  const close = html.indexOf('</script>', bodyStart);
  if (open < 0 || close < 0) throw new Error('build:app の直後に <script type="text/babel"> がない');
  const markerEnd = html.indexOf('-->', marker) + 3;
  return { start: marker, end: close + '</script>'.length, code: html.slice(bodyStart, close), markerEnd };
}

/** インラインに埋め込む JS/CSS が HTML の終了タグとして解釈されないようにする */
function escapeInline(text, tag) {
  return text.replace(new RegExp('</' + tag, 'gi'), '<\\/' + tag).replace(/<!--/g, '<\\!--');
}

/** インラインに埋め込む JS/CSS が ASCII だけで書かれていることを確かめる（GAS 配信で壊れないように） */
function assertAscii(text, label) {
  const m = /[^\x00-\x7f]/.exec(text);
  if (m) {
    const ctx = text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ');
    throw new Error(label + ' に ASCII 以外の文字が残っている（位置 ' + m.index + '）: …' + ctx + '…');
  }
  return text;
}

/**
 * HTML 全体に BMP 外の文字（絵文字 🔒 など U+10000 以上）が無いことを確かめる。
 * GAS は配信時にアプリの HTML を外枠ページ（userCodeAppPanel）の JS 文字列へ埋め込むが、BMP 外の文字で
 * その JS が壊れる（v1.13.0 テストデプロイで「Uncaught SyntaxError: Invalid or unexpected token」。v1.12.13 までは 0 個）。
 */
function assertNoAstral(html) {
  let line = 1;
  for (const ch of html) {
    if (ch === '\n') line++;
    else if (ch.codePointAt(0) > 0xffff) {
      throw new Error('ビルド結果の ' + line + ' 行目に BMP 外の文字（' + ch + ' U+' + ch.codePointAt(0).toString(16).toUpperCase()
        + '）がある。GAS の配信で壊れるため、JS では \\u エスケープにし、HTML 部分では使わない');
    }
  }
  return html;
}

function bundleApp(code) {
  const esbuild = require('esbuild');
  const result = esbuild.buildSync({
    stdin: { contents: code, loader: 'jsx', resolveDir: ROOT, sourcefile: 'index.html(app)' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome109', 'edge109', 'safari15', 'firefox115'],
    jsx: 'transform',
    minify: true,
    legalComments: 'none',
    // ASCII 以外（日本語・絵文字）は \uXXXX に置き換える（esbuild の既定）。GAS の HtmlService は
    // 配信時に ASCII 以外を含むインラインスクリプトを壊すことがある（v1.13.0 テストデプロイで SyntaxError）
    charset: 'ascii',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
    logLevel: 'silent',
  });
  if (result.warnings.length) {
    for (const w of result.warnings) console.warn('[esbuild warn]', w.text);
  }
  return result.outputFiles[0].text;
}

function buildCss(htmlForScan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tadasapo-css-'));
  try {
    const input = path.join(tmp, 'in.css');
    const content = path.join(tmp, 'content.html');
    const output = path.join(tmp, 'out.css');
    fs.writeFileSync(input, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
    fs.writeFileSync(content, htmlForScan);
    const cli = require.resolve('tailwindcss/lib/cli.js');
    execFileSync(process.execPath, [cli, '-i', input, '-o', output, '--content', content, '--minify'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** 原本の内容ハッシュ（index.html・コード.js・appsscript.json・package-lock.json）。dist の鮮度確認に使う */
function sourceHash() {
  const parts = ['index.html', 'コード.js', 'appsscript.json', 'package-lock.json']
    .map((f) => f + '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));
  return sha256(parts.join('\n---\n'));
}

function build() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const app = extractApp(src);
  const js = assertAscii(escapeInline(bundleApp(app.code), 'script'), 'アプリ本体の JS');

  // Tailwind はアプリのクラス名を原本全体から走査する
  const css = assertAscii(escapeInline(buildCss(src), 'style'), 'Tailwind の CSS');

  let html = src.slice(0, app.start)
    + '<!-- アプリ本体（npm run build で事前変換・React 18.2.0 同梱） -->\n  <script>' + js + '</script>'
    + src.slice(app.end);
  html = stripDevOnly(html);
  if (!html.includes('<!-- build:css -->')) throw new Error('<!-- build:css --> の目印が見つからない');
  html = html.replace('<!-- build:css -->', '<style>' + css + '</style>');

  // 残ってはいけないもの
  for (const bad of ['text/babel', 'cdn.tailwindcss.com', 'babel.min.js', 'type="importmap"', 'esm.sh/']) {
    if (html.includes(bad)) throw new Error('ビルド結果に開発用の参照が残っている: ' + bad);
  }

  assertNoAstral(html);

  const hash = sourceHash();
  html = html.replace('<head>', '<head>\n  <!-- build: source-sha256=' + hash + ' -->');

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'コード.js'), path.join(DIST, 'コード.js'));
  fs.copyFileSync(path.join(ROOT, 'appsscript.json'), path.join(DIST, 'appsscript.json'));

  const kb = (n) => (n / 1024).toFixed(0) + 'KB';
  console.log(`dist/index.html ${kb(Buffer.byteLength(html))}（JS ${kb(Buffer.byteLength(js))} / CSS ${kb(Buffer.byteLength(css))}）`);
  console.log('source-sha256 ' + hash);
  return { hash, bytes: Buffer.byteLength(html) };
}

/** dist が原本の最新内容からビルドされているか（デプロイ前の確認用） */
function isDistFresh() {
  const p = path.join(DIST, 'index.html');
  if (!fs.existsSync(p)) return false;
  const m = fs.readFileSync(p, 'utf8').match(/build: source-sha256=([0-9a-f]{64})/);
  return !!m && m[1] === sourceHash()
    && fs.readFileSync(path.join(DIST, 'コード.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'コード.js'), 'utf8')
    && fs.readFileSync(path.join(DIST, 'appsscript.json'), 'utf8') === fs.readFileSync(path.join(ROOT, 'appsscript.json'), 'utf8');
}

if (require.main === module) {
  try {
    build();
  } catch (e) {
    console.error('build failed: ' + e.message);
    process.exit(1);
  }
}

module.exports = { build, isDistFresh, sourceHash, stripDevOnly, extractApp, escapeInline, assertAscii, assertNoAstral };
