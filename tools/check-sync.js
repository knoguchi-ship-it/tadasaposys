#!/usr/bin/env node
/**
 * ドキュメント同期チェック（npm run check）
 *
 * AI_RULES.md「作業前レビュー」の照合項目のうち、機械的に判定できるものを検査する。
 * 依存パッケージなし（Node 標準のみ）。本番 GAS への push 対象外（.claspignore の tools/**）。
 *
 *   node tools/check-sync.js           ... 不一致があれば終了コード 1
 *   node tools/check-sync.js --strict  ... 本番識別子・個人情報の残存も失敗扱い
 *   node tools/check-sync.js --session ... Claude Code SessionStart フック用（結果を文脈に渡し、常に終了コード 0）
 *
 * 本番の識別子は、このスクリプトに書かない。ローカル（Git 対象外）の
 * .clasp.json / .clasp.deploy.json / .private-terms.local.txt から実値を読んで照合する。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// v1.14.0〜 バックエンドは gas/ に役割別（ADR-016）。版数コメントと const IDX はこのファイルにある
const BACKEND_CORE = 'gas/01_定数と設定.js';
// Windows（core.autocrlf=true）の作業ツリーは CRLF のため、LF に正規化して読む
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// ---------------------------------------------------------------- 結果の記録
function createReport() {
  const items = [];
  return {
    items,
    ok: (section, msg) => items.push({ level: 'ok', section, msg }),
    error: (section, msg) => items.push({ level: 'error', section, msg }),
    warn: (section, msg) => items.push({ level: 'warn', section, msg }),
  };
}

// ---------------------------------------------------------------- 1. 版数
/** 版数の同期対象（AI_RULES.md グランドルール6）と、その書式 */
const VERSION_TARGETS = [
  { file: BACKEND_CORE, re: /Backend Logic \(v(\d+\.\d+\.\d+)\)/ },
  { file: 'index.html', re: /<meta name="app-version" content="(\d+\.\d+\.\d+)"/ },
  { file: 'CHANGELOG.md', re: /^## \[(\d+\.\d+\.\d+)\]/m },
  { file: 'AI_RULES.md', re: /\*\*現行バージョン:\*\* v(\d+\.\d+\.\d+)/ },
  { file: 'docs/SDD.md', re: /^\*\*Version:\*\* (\d+\.\d+\.\d+)/m },
  { file: 'docs/HANDOVER.md', re: /^\*\*Version:\*\* (\d+\.\d+\.\d+)/m },
  { file: 'docs/Manual.md', re: /操作マニュアル v(\d+\.\d+\.\d+)/ },
];

function checkVersions(r, readFile = read) {
  const expected = JSON.parse(readFile('package.json')).version;
  for (const t of VERSION_TARGETS) {
    const m = readFile(t.file).match(t.re);
    if (!m) r.error('版数', `${t.file}: 版数の記載が見つからない（書式 ${t.re}）`);
    else if (m[1] !== expected) r.error('版数', `${t.file}: v${m[1]}（package.json は v${expected}）`);
  }
  return expected;
}

// ---------------------------------------------------------------- 2. IDX 定数
/** バックエンド（gas/01_定数と設定.js）の const IDX = {...} を評価して取り出す */
function parseCodeIdx(src) {
  const start = src.indexOf('const IDX = {');
  if (start < 0) throw new Error(BACKEND_CORE + ' に const IDX が見つからない');
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  // 数値リテラルとコメントだけのオブジェクトなので Function で評価する
  return Function(`"use strict"; return (${src.slice(from, i + 1)});`)();
}

/** AI_RULES.md「データモデル」節のコードブロックから NAME: { K:0, ... } を取り出す */
function parseRulesIdx(md) {
  const sec = md.split(/^## データモデル/m)[1];
  if (!sec) throw new Error('AI_RULES.md に「## データモデル」節が見つからない');
  const block = (sec.match(/```javascript\n([\s\S]*?)```/) || [])[1];
  if (!block) throw new Error('AI_RULES.md データモデル節に javascript ブロックが見つからない');
  const out = {};
  const re = /^\s*([A-Z_]+):\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(block))) {
    const fields = {};
    for (const f of m[2].matchAll(/([A-Z_]+)\s*:\s*(\d+)/g)) fields[f[1]] = Number(f[2]);
    out[m[1]] = fields;
  }
  return out;
}

/**
 * SDD の節（### S-xx）と IDX 名の対応。SDD に節を足したらここも足す。
 * CASES_OVERRIDE（S-06）は「S-01 と同一列構造」と明記されているため S-01 の表と照合する。
 * ANNUAL_ADJUST は SDD のシート一覧表に列名だけ記載（S 節なし）のため照合対象外。
 */
const SDD_SECTIONS = {
  CASES: 'S-01', RECORDS: 'S-02', STAFF: 'S-03', EMAIL: 'S-04',
  CASES_OVERRIDE: 'S-01', DRAFT: 'S-07', SCHEDULED: 'S-08', CHAT_LINK: 'S-10',
};
const SDD_EXEMPT = ['ANNUAL_ADJUST'];

/** SDD の S-xx 節の表から {KEY: idx} を取り出す（2種類の表の書式に対応） */
function parseSddSection(md, sid) {
  const parts = md.split(/^### /m);
  const sec = parts.find((p) => p.startsWith(sid + ':'));
  if (!sec) return null;
  const fields = {};
  for (const line of sec.split('\n')) {
    // 書式A: | 0 | A | `PK` | ...
    let m = line.match(/^\|\s*(\d+)\s*\|\s*[A-Z]{1,2}\s*\|\s*`([A-Z_]+)`/);
    if (m) { fields[m[2]] = Number(m[1]); continue; }
    // 書式B: | A | `SUBMITTED_AT`: 0 | ...
    m = line.match(/^\|\s*[A-Z]{1,2}\s*\|\s*`([A-Z_]+)`\s*:\s*(\d+)/);
    if (m) fields[m[1]] = Number(m[2]);
  }
  return fields;
}

function diffFields(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) if (a[k] !== b[k]) out.push(`${k}: コード=${a[k]} / 文書=${b[k]}`);
  return out;
}

function checkIdx(r, readFile = read) {
  const code = parseCodeIdx(readFile(BACKEND_CORE));
  const rules = parseRulesIdx(readFile('AI_RULES.md'));
  for (const name of Object.keys(code)) {
    if (!rules[name]) { r.error('IDX', `AI_RULES.md データモデル節に ${name} がない`); continue; }
    const d = diffFields(code[name], rules[name]);
    if (d.length) r.error('IDX', `AI_RULES.md の ${name} がコードと不一致: ${d.join(', ')}`);
  }
  for (const name of Object.keys(rules)) {
    if (!code[name]) r.error('IDX', `AI_RULES.md の ${name} は ${BACKEND_CORE} の IDX にない`);
  }
  const sdd = readFile('docs/SDD.md');
  for (const [name, sid] of Object.entries(SDD_SECTIONS)) {
    if (!code[name]) { r.error('IDX', `SDD対応表の ${name} は ${BACKEND_CORE} の IDX にない`); continue; }
    const fields = parseSddSection(sdd, sid);
    if (!fields) { r.error('IDX', `docs/SDD.md に ### ${sid} 節がない（${name}）`); continue; }
    // STAFF は A列(ID) を IDX に持たないため、コード側のキーだけ比較する
    const subset = name === 'STAFF'
      ? Object.fromEntries(Object.keys(code[name]).map((k) => [k, fields[k]]))
      : fields;
    const d = diffFields(code[name], subset);
    if (d.length) r.error('IDX', `docs/SDD.md ${sid}（${name}）がコードと不一致: ${d.join(', ')}`);
  }
  for (const name of Object.keys(code)) {
    if (!SDD_SECTIONS[name] && !SDD_EXEMPT.includes(name)) {
      r.warn('IDX', `${name} は SDD 節との対応が tools/check-sync.js の SDD_SECTIONS に未登録`);
    }
  }
}

// ---------------------------------------------------------------- 3. テスト件数
const TEST_RE = /^\s*(?:test|it)(?:\.only)?\(/gm;

function countTests(readFile = read, listDir = (d) => fs.readdirSync(path.join(ROOT, d))) {
  const perSpec = {};
  let e2e = 0;
  for (const f of listDir('tests/e2e').filter((f) => f.endsWith('.spec.ts')).sort()) {
    const n = (readFile(`tests/e2e/${f}`).match(TEST_RE) || []).length;
    perSpec[f.replace(/\.spec\.ts$/, '')] = n;
    e2e += n;
  }
  let unit = 0;
  const dynamic = [];
  for (const f of listDir('tests/unit').filter((f) => f.endsWith('.test.js'))) {
    const src = readFile(`tests/unit/${f}`);
    unit += (src.match(TEST_RE) || []).length;
    if (/\b(?:test|it)\.each\b/.test(src)) dynamic.push(`tests/unit/${f}`);
  }
  for (const f of Object.keys(perSpec)) {
    if (/\btest\.each\b/.test(readFile(`tests/e2e/${f}.spec.ts`))) dynamic.push(`tests/e2e/${f}.spec.ts`);
  }
  return { unit, e2e, perSpec, dynamic };
}

// ---------------------------------------------------------------- 4. HANDOVER 現在地
function checkHandover(r, version, counts, readFile = read) {
  const md = readFile('docs/HANDOVER.md');
  // 書式: **現在地:** vX.Y.Z / 本番 @nn / 単体 N件 / E2E N件
  //   リポジトリの版が本番より新しい（未反映）ときは「本番 @nn（vA.B.C）」と本番の版を併記する
  const cur = md.match(/\*\*現在地:\*\* v(\d+\.\d+\.\d+) \/ 本番 @(\d+)(?:（v(\d+\.\d+\.\d+)）)? \/ 単体 (\d+)件 \/ E2E (\d+)件/);
  if (!cur) {
    r.error('HANDOVER', '冒頭の「**現在地:** vX.Y.Z / 本番 @nn / 単体 N件 / E2E N件」行が見つからない');
    return;
  }
  const [, v, at, prodV, unit, e2e] = cur;
  const deployedV = prodV || v; // 本番に出ている版
  if (v !== version) r.error('HANDOVER', `現在地の版 v${v} が package.json v${version} と不一致`);
  if (Number(unit) !== counts.unit) r.error('HANDOVER', `現在地の単体 ${unit}件 ≠ 実テスト ${counts.unit}件`);
  if (Number(e2e) !== counts.e2e) r.error('HANDOVER', `現在地の E2E ${e2e}件 ≠ 実テスト ${counts.e2e}件`);

  const dep = md.match(/\*\*本番デプロイバージョン\*\*: @(\d+)（v(\d+\.\d+\.\d+)/);
  if (!dep) r.error('HANDOVER', '§1「本番デプロイバージョン: @nn（vX.Y.Z」が見つからない');
  else if (dep[1] !== at || dep[2] !== deployedV) {
    r.error('HANDOVER', `§1 本番デプロイバージョン @${dep[1]}（v${dep[2]}）が現在地の本番 @${at}（v${deployedV}）と不一致`);
  }

  // §8 のスペック一覧（- `NN-name`: 説明（N件 ...）
  const listed = {};
  for (const m of md.matchAll(/^- `(\d{2}-[a-z0-9-]+)`: .*?（(\d+)件/gm)) listed[m[1]] = Number(m[2]);
  for (const [spec, n] of Object.entries(counts.perSpec)) {
    if (!(spec in listed)) r.error('HANDOVER', `§8 スペック一覧に ${spec} がない（${n}件）`);
    else if (listed[spec] !== n) r.error('HANDOVER', `§8 ${spec}: 記載 ${listed[spec]}件 ≠ 実テスト ${n}件`);
  }
  for (const spec of Object.keys(listed)) {
    if (!(spec in counts.perSpec)) r.error('HANDOVER', `§8 スペック一覧の ${spec} は tests/e2e に存在しない`);
  }
}

// ---------------------------------------------------------------- 5. ADR 件数
function checkAdr(r, readFile = read) {
  const nums = [...readFile('docs/ADR.md').matchAll(/^## ADR-(\d+)/gm)].map((m) => Number(m[1]));
  const max = Math.max(...nums);
  if (nums.length !== max) r.error('ADR', `docs/ADR.md: ${nums.length}件だが最大番号は ADR-${max}（欠番か重複）`);
  // 現行の索引を持つ文書のみ（docs/test-criteria.html 等の日付つき評価記録は当時の値のため対象外）
  for (const f of ['AI_RULES.md', 'docs/HANDOVER.md', 'docs/build-from-scratch.html']) {
    for (const m of readFile(f).matchAll(/ADR-001〜(\d+)/g)) {
      if (Number(m[1]) !== max) r.error('ADR', `${f}: 「ADR-001〜${m[1]}」だが実際は ADR-${String(max).padStart(3, '0')} まで`);
    }
  }
}

// ---------------------------------------------------------------- 6. 仕組みの実在
function checkMechanisms(r) {
  const ignore = exists('.claspignore') ? read('.claspignore').split(/\r?\n/) : [];
  for (const p of ['temp/**', 'tests/**', 'docs/**', 'tools/**', 'dist/**']) {
    if (!ignore.includes(p)) r.error('仕組み', `.claspignore に ${p} がない`);
  }
  const gi = exists('.gitignore') ? read('.gitignore') : '';
  for (const p of ['.clasp.json', '.clasp.*.json', 'temp/', '.private-terms.local.txt', 'dist/']) {
    if (!gi.split(/\r?\n/).includes(p)) r.error('仕組み', `.gitignore に ${p} がない`);
  }
  if (!exists('.github/workflows/playwright.yml')) r.error('仕組み', 'CI（.github/workflows/playwright.yml）がない');
  else {
    const ci = read('.github/workflows/playwright.yml');
    for (const step of ['npm run test:unit', 'npm run check']) {
      if (!ci.includes(step)) r.error('仕組み', `CI に ${step} がない`);
    }
  }
  // フック（AI_RULES.md 各グランドルールの「仕組み」欄）
  let hooks = {};
  try { hooks = JSON.parse(read('.claude/settings.json')).hooks || {}; } catch (e) { /* 下で検出 */ }
  const hookCmds = (ev) => (hooks[ev] || []).flatMap((h) => (h.hooks || []).map((x) => x.command || ''));
  if (!hookCmds('PreToolUse').some((c) => c.includes('.claude/hooks/guard.js'))) r.error('仕組み', '.claude/settings.json に PreToolUse フック（guard.js）がない');
  if (!hookCmds('SessionStart').some((c) => c.includes('check-sync.js'))) r.error('仕組み', '.claude/settings.json に SessionStart フック（check-sync.js --session）がない');
  if (!exists('.claude/hooks/guard.js')) r.error('仕組み', '.claude/hooks/guard.js がない');
  if (!exists('.githooks/pre-commit')) r.error('仕組み', '.githooks/pre-commit がない');
  // 本番ビルド・デプロイ（ADR-013）
  for (const f of ['tools/build.js', 'tools/deploy.js']) {
    if (!exists(f)) r.error('仕組み', f + ' がない');
  }
  const scripts = JSON.parse(read('package.json')).scripts || {};
  for (const k of ['build', 'deploy', 'check']) {
    if (!scripts[k]) r.error('仕組み', `package.json に npm run ${k} がない`);
  }
  // ローカルの clasp 設定（Git 対象外。存在する人だけ確認）
  if (exists('.clasp.json')) {
    let rootDir = '';
    try { rootDir = String(JSON.parse(read('.clasp.json')).rootDir || ''); } catch (e) { /* 壊れていれば下で警告 */ }
    if (rootDir.replace(/[\\/]+$/, '') !== 'dist') {
      r.warn('仕組み', '.clasp.json の rootDir が "dist" でない（v1.13.0〜 clasp はビルド成果物を push する。RUNBOOK §1-2）');
    }
  }
  let hooksPath = '';
  try { hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' , stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* 未設定 */ }
  if (hooksPath !== '.githooks') r.warn('仕組み', `git の core.hooksPath が .githooks でない（pre-commit が動かない）。npm install で自動設定、または git config core.hooksPath .githooks`);
  const manifest = JSON.parse(read('appsscript.json'));
  if (manifest.webapp?.executeAs !== 'USER_ACCESSING' || manifest.webapp?.access !== 'DOMAIN') {
    r.error('本番安全', `appsscript.json webapp が USER_ACCESSING/DOMAIN でない: ${JSON.stringify(manifest.webapp)}`);
  }
  if (manifest.executionApi?.access !== 'MYSELF') {
    r.warn('本番安全', `appsscript.json executionApi.access が ${manifest.executionApi?.access}（あるべき値 MYSELF・是正予定）`);
  }
}

// ---------------------------------------------------------------- 7. 本番識別子・個人情報
/** ローカルの Git 対象外ファイルから、照合すべき実値を集める（値はスクリプトに書かない） */
function loadSecretTerms() {
  const terms = [];
  const collect = (obj) => {
    if (typeof obj === 'string' && obj.length >= 20) terms.push(obj);
    else if (obj && typeof obj === 'object') Object.values(obj).forEach(collect);
  };
  for (const f of ['.clasp.json', '.clasp.deploy.json']) {
    if (exists(f)) { try { collect(JSON.parse(read(f))); } catch (e) { /* 壊れていても続行 */ } }
  }
  if (exists('.private-terms.local.txt')) {
    for (const line of read('.private-terms.local.txt').split(/\r?\n/)) {
      const t = line.trim();
      if (t && !t.startsWith('#')) terms.push(t);
    }
  }
  return terms;
}

/**
 * 実値を知らなくても検出できる形式。
 * 個人名・個人メールは形式で判別できない（モックの test@ 等と区別不可）ため、
 * .private-terms.local.txt に登録した語で照合する。
 */
const ID_PATTERNS = [
  { label: 'GAS deploymentId/スクリプトURL', re: /AKfycb[A-Za-z0-9_-]{30,}/g },
  { label: 'Google ファイル/スクリプトID形式', re: /(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{40,70}(?![A-Za-z0-9_-])/g }, // ファイルIDは44桁・スクリプトIDは57桁
  { label: 'Chat Webhook URL', re: /chat\.googleapis\.com\/v1\/spaces\/[^\s'"`]*key=/g },
];

function scanIdentifiers(r, strict) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch (e) {
    r.warn('識別子', 'git ls-files を実行できないため識別子スキャンを省略');
    return;
  }
  files = files.filter((f) => /\.(md|js|ts|html|json|gs|yml|txt|ps1|toml|dbml)$/.test(f) && f !== 'package-lock.json');
  const terms = loadSecretTerms();
  const hits = {}; // file -> Set(label)
  let total = 0;
  for (const f of files) {
    let text;
    try { text = read(f); } catch (e) { continue; }
    const add = (label, n) => { (hits[f] ||= {}); hits[f][label] = (hits[f][label] || 0) + n; total += n; };
    for (const p of ID_PATTERNS) {
      const n = (text.match(p.re) || []).length;
      if (n) add(p.label, n);
    }
    for (const t of terms) {
      const n = text.split(t).length - 1;
      if (n) add('ローカル登録の実値・個人名', n);
    }
  }
  const report = strict ? r.error : r.warn;
  for (const [f, labels] of Object.entries(hits)) {
    report('識別子', `${f}: ${Object.entries(labels).map(([l, n]) => `${l}×${n}`).join(', ')}`);
  }
  if (!exists('.private-terms.local.txt')) {
    r.warn('識別子', '.private-terms.local.txt がないため個人名の照合を省略（1行1語で作成。Git 対象外）');
  }
  return total;
}

// ---------------------------------------------------------------- 8. origin との差
function checkRemote(r) {
  try {
    const out = execFileSync('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { cwd: ROOT, encoding: 'utf8' , stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const [behind, ahead] = out.split(/\s+/).map(Number);
    if (ahead || behind) r.warn('Git', `origin との差: 未 push ${ahead} / 未取込 ${behind}（最終 fetch 時点）`);
  } catch (e) {
    r.warn('Git', '上流ブランチとの差を取得できない');
  }
}

// ---------------------------------------------------------------- 実行
function main() {
  const strict = process.argv.includes('--strict');
  const session = process.argv.includes('--session');
  const r = createReport();
  const run = (name, fn) => {
    try { return fn(); } catch (e) { r.error(name, `検査自体が失敗: ${e.message}`); return undefined; }
  };
  const version = run('版数', () => checkVersions(r));
  run('IDX', () => checkIdx(r));
  const counts = run('テスト件数', () => countTests());
  if (counts) {
    r.ok('テスト件数', `単体 ${counts.unit}件 / E2E ${counts.e2e}件（静的集計）`);
    for (const f of counts.dynamic || []) r.error('テスト件数', `${f}: test.each 等で件数が静的に数えられない。1件ずつ test() で書く（件数照合のため）`);
    run('HANDOVER', () => checkHandover(r, version, counts));
  }
  run('ADR', () => checkAdr(r));
  run('仕組み', () => checkMechanisms(r));
  const idHits = run('識別子', () => scanIdentifiers(r, strict));
  run('Git', () => checkRemote(r));

  const errors = r.items.filter((i) => i.level === 'error');
  const warns = r.items.filter((i) => i.level === 'warn');
  if (session) {
    console.log('【セッション開始時の自動チェック（npm run check）】AI_RULES.md「作業前レビュー」照合項目1〜7の結果。'
      + 'エラーは作業前にユーザーへ報告すること。照合項目8（テスト実行）・9（差分の目視）は別途行う。');
  }
  for (const i of r.items) {
    const mark = { ok: '✓', warn: '⚠', error: '✗' }[i.level];
    console.log(`${mark} [${i.section}] ${i.msg}`);
  }
  console.log(`\n版数 v${version} / エラー ${errors.length} / 警告 ${warns.length} / 識別子・個人情報の残存 ${idHits ?? '-'}件`);
  process.exitCode = errors.length && !session ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  parseCodeIdx, parseRulesIdx, parseSddSection, diffFields, countTests,
  checkVersions, checkIdx, checkHandover, checkAdr, createReport, ID_PATTERNS,
};
