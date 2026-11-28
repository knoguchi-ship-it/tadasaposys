#!/usr/bin/env node
/**
 * 本番デプロイ（npm run deploy）— AI_RULES.md グランドルール1「仕組み」/ ADR-013
 *
 * 人が端末で実行する。確認省略オプションは設けない（最後に「deploy」と手入力しないと進まない）。
 * 1. 事前検査: 作業ツリーがクリーン / appsscript.json の webapp=USER_ACCESSING・DOMAIN, executionApi=MYSELF /
 *    .clasp.json の rootDir が dist / .clasp.deploy.json に固定 deploymentId（production）がある
 * 2. テスト: 単体（Jest）・同期チェック（npm run check）・E2E（dist をビルドして検証）
 * 3. ビルド: dist/ を作り直し、原本と一致することを確認
 * 4. 確認: 反映先・版・コミットを表示し、スクリプトプロパティ SPREADSHEET_ID の設定済みを確認
 * 5. clasp push --force → clasp deploy -i <固定 deploymentId>（-i なしの新規デプロイは構造的に起きない）
 *
 * 本番の識別子はこのファイルに書かない。deploymentId は Git 対象外の .clasp.deploy.json から読む。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync, execFileSync } = require('child_process');
const { build, isDistFresh } = require('./build');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function fail(msg) {
  console.error('\n✗ デプロイ中止: ' + msg);
  process.exit(1);
}

function run(cmd, args) {
  console.log('\n$ ' + [cmd].concat(args).join(' '));
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(cmd + ' ' + args.join(' ') + ' が失敗（終了コード ' + r.status + '）');
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** 事前検査（純粋関数。単体テスト対象） */
function preflight({ manifest, claspJson, deployJson, gitStatus }) {
  const errors = [];
  if (gitStatus) errors.push('未コミットの変更がある（先に commit する）');
  if (manifest?.webapp?.executeAs !== 'USER_ACCESSING' || manifest?.webapp?.access !== 'DOMAIN') {
    errors.push('appsscript.json の webapp が USER_ACCESSING / DOMAIN でない');
  }
  if (manifest?.executionApi && manifest.executionApi.access !== 'MYSELF') {
    errors.push('appsscript.json の executionApi.access が MYSELF でない');
  }
  if (!claspJson) errors.push('.clasp.json がない');
  else if (String(claspJson.rootDir || '').replace(/[\\/]+$/, '') !== 'dist') {
    errors.push('.clasp.json の rootDir が "dist" でない（ビルド前の原本を push してしまう）');
  }
  const id = deployJson && deployJson.production;
  if (!id) errors.push('.clasp.deploy.json に production（固定 deploymentId）がない');
  else if (!/^AKfycb[A-Za-z0-9_-]{30,}$/.test(id)) errors.push('.clasp.deploy.json の production が deploymentId の形式でない');
  return errors;
}

function readJsonOrNull(f) {
  try { return JSON.parse(read(f)); } catch (e) { return null; }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(String(a || '').trim()); }));
}

async function main() {
  if (!process.stdin.isTTY) fail('端末から人が実行する（確認の手入力が必要）');

  const manifest = readJsonOrNull('appsscript.json');
  const claspJson = readJsonOrNull('.clasp.json');
  const deployJson = readJsonOrNull('.clasp.deploy.json');
  const gitStatus = git(['status', '--porcelain']);
  const errors = preflight({ manifest, claspJson, deployJson, gitStatus });
  if (errors.length) fail('\n  - ' + errors.join('\n  - '));

  const version = JSON.parse(read('package.json')).version;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (branch !== 'master') console.warn(`⚠ 現在のブランチは ${branch}（通常は master からデプロイする）`);

  run('npm', ['run', 'test:unit']);
  run('npm', ['run', 'check']);
  run('npm', ['test']); // dist をビルドして E2E

  build();
  if (!isDistFresh()) fail('dist/ が原本と一致しない');

  console.log('\n================ 本番デプロイ確認 ================');
  console.log(`版: v${version} / コミット: ${commit}（${branch}）`);
  console.log('反映先: 固定 deploymentId（.clasp.deploy.json の production。URL は変わらない）');
  console.log('push 対象: dist/（index.html・gas/ のバックエンド一式・appsscript.json）');
  console.log('==================================================');
  const prop = await ask('GAS「プロジェクトの設定 → スクリプト プロパティ」に SPREADSHEET_ID を設定済みですか？ [yes/no]: ');
  if (prop !== 'yes') fail('先に SPREADSHEET_ID を設定する（未設定のまま反映するとアプリが起動しない。RUNBOOK §3）');
  const ok = await ask('本番へ反映するには deploy と入力: ');
  if (ok !== 'deploy') fail('確認の入力がなかった');

  run('clasp', ['push', '--force']);
  run('clasp', ['deploy', '-i', deployJson.production, '-d', `v${version} ${commit}`]);

  console.log('\n✓ 反映しました。続けて:');
  console.log('  1. GAS デプロイ管理画面で「実行=アクセスしているユーザー / アクセス=NPO法人タダカヨ 内の全員」を目視確認');
  console.log('  2. 本番URLで動作確認（ブラウザのコンソールに [perf] initial data が出る）');
  console.log('  3. 付いたデプロイ番号 @nn を docs/HANDOVER.md の「現在地」と §1 に記録');
}

if (require.main === module) main();
module.exports = { preflight };
