#!/usr/bin/env node
/**
 * Claude Code PreToolUse フック: AI_RULES.md「コマンド実行ポリシー」の機械的な強制（必要最小限）
 *
 * - 禁止（必ず拒否・exit 2）: -i なしの clasp deploy / clasp create-deployment / force push /
 *   --no-verify / git reset --hard / git clean -f / 未コミット差分がある状態の clasp pull
 * - 要確認（ask）: clasp push / clasp deploy -i / git push
 *   ※ 確認省略モード（bypassPermissions）で ask が確認を出すかはドキュメント上の保証がない。
 *     出ない場合も「ユーザー確認なしに実行しない」ルールは AI が守る。
 *
 * 判定は文字列照合だけで、外部コマンドは clasp pull のときの git status だけ実行する（軽量）。
 * 引用符内とヒアドキュメント本文（コミットメッセージ等）は照合対象から外す（誤検出防止）。
 */
'use strict';

const { execFileSync } = require('child_process');

/** 引用符内・ヒアドキュメント本文を取り除き、コマンド区切りで分割する */
function segments(cmd) {
  let s = String(cmd || '');
  // ヒアドキュメント本文（<<'EOF' ... EOF / <<EOF ... EOF / <<-EOF）
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, ' ');
  // PowerShell here-string（@' ... '@ / @" ... "@）
  s = s.replace(/@(['"])\n[\s\S]*?\n\1@/g, ' ');
  // 引用符内
  s = s.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
  return s.split(/\n|;|&&|\|\||\|/).map((x) => x.trim()).filter(Boolean);
}

/** 1つのコマンドを判定する。{ decision: 'deny'|'ask', reason } または null */
function judgeSegment(seg, opts = {}) {
  const has = (re) => re.test(seg);
  if (has(/\bclasp\b/)) {
    if (has(/\bcreate-deployment\b/)) return { decision: 'deny', reason: 'clasp create-deployment は禁止（新しい URL が発行される）。固定 deploymentId への clasp deploy -i <DEPLOYMENT_ID> を使う' };
    if (has(/\bdeploy\b/)) {
      if (!has(/\s(-i|--deploymentId)(\s|=|$)/)) return { decision: 'deny', reason: '-i <固定 deploymentId> なしの clasp deploy は禁止（新しい URL が発行される）' };
      return { decision: 'ask', reason: 'clasp deploy は本番 Webapp を更新する。ユーザーの確認が必要' };
    }
    if (has(/\bpull\b/)) {
      const dirty = opts.isDirty ? opts.isDirty() : false;
      if (dirty) return { decision: 'deny', reason: '未コミット差分がある状態の clasp pull は禁止（ローカルが上書きされる）。先に commit する' };
      return null;
    }
    if (has(/\bpush\b/)) return { decision: 'ask', reason: 'clasp push は本番 GAS のコードを書き換える。ユーザーの確認が必要' };
  }
  if (has(/\bgit\b/)) {
    if (has(/--no-verify\b/) || (has(/\bcommit\b/) && has(/\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/))) {
      return { decision: 'deny', reason: '--no-verify（コミット前検査の回避）は禁止' };
    }
    if (has(/\bpush\b/)) {
      if (has(/\s(--force|--force-with-lease|--mirror)(\s|=|$)|\s-[a-zA-Z]*f[a-zA-Z]*(\s|$)|\s\+\S/)) {
        return { decision: 'deny', reason: 'force push は禁止（共有履歴の破壊）' };
      }
      return { decision: 'ask', reason: 'git push は公開リポジトリへ出す。ユーザーの確認が必要' };
    }
    if (has(/\breset\b/) && has(/--hard\b/)) return { decision: 'deny', reason: 'git reset --hard は禁止（未コミット作業の消失）' };
    if (has(/\bclean\b/) && has(/\s(-[a-zA-Z]*f[a-zA-Z]*|--force)(\s|$)/)) return { decision: 'deny', reason: 'git clean -f は禁止（未追跡ファイルの消失）' };
  }
  return null;
}

/** フック入力（tool_name, tool_input）を判定する。deny を最優先 */
function judge(input, opts = {}) {
  const name = input.tool_name || '';
  const ti = input.tool_input || {};
  const results = [];
  if (name === 'Bash' || name === 'PowerShell') {
    for (const seg of segments(ti.command)) {
      const r = judgeSegment(seg, opts);
      if (r) results.push(r);
    }
  } else if (name === 'mcp__git__git_push') {
    if (ti.force || ti.forceWithLease) results.push({ decision: 'deny', reason: 'force push は禁止（共有履歴の破壊）' });
    else if (ti.delete) results.push({ decision: 'deny', reason: 'リモートブランチの削除はユーザーが行う' });
    else results.push({ decision: 'ask', reason: 'git push は公開リポジトリへ出す。ユーザーの確認が必要' });
  } else if (name === 'mcp__git__git_reset') {
    if (ti.mode === 'hard') results.push({ decision: 'deny', reason: 'git reset --hard は禁止（未コミット作業の消失）' });
  } else if (name === 'mcp__git__git_clean') {
    if (ti.force) results.push({ decision: 'deny', reason: 'git clean -f は禁止（未追跡ファイルの消失）' });
  } else if (name === 'mcp__git__git_commit') {
    if (ti.noVerify) results.push({ decision: 'deny', reason: '--no-verify（コミット前検査の回避）は禁止' });
  }
  return results.find((r) => r.decision === 'deny') || results.find((r) => r.decision === 'ask') || null;
}

function isDirty() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch (e) {
    return true; // 判定できないときは安全側
  }
}

function main() {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { process.exit(0); }
    const r = judge(input, { isDirty });
    if (!r) process.exit(0);
    const reason = `[AI_RULES.md コマンド実行ポリシー] ${r.reason}`;
    if (r.decision === 'deny') {
      process.stderr.write(reason);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
    }));
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { segments, judgeSegment, judge };
