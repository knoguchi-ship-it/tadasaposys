/**
 * Claude Code PreToolUse フック（.claude/hooks/guard.js）の単体テスト
 * AI_RULES.md「コマンド実行ポリシー」の禁止・要確認が判定どおりになるか。
 */

'use strict';

const { judge } = require('../../.claude/hooks/guard');

const bash = (command, opts) => judge({ tool_name: 'Bash', tool_input: { command } }, opts);
const decision = (command, opts) => (bash(command, opts) || {}).decision || null;

describe('禁止コマンドは拒否する', () => {
  test('禁止コマンド一覧', () => {
    const cmds = [
    ['clasp deploy -d "v1.2.3"'],
    ['clasp deploy'],
    ['npx clasp create-deployment'],
    ['git push --force origin master'],
    ['git push -f'],
    ['git push --force-with-lease'],
    ['git push origin +master'],
    ['git commit --no-verify -m "x"'],
    ['git commit -nm "x"'],
    ['git reset --hard HEAD~1'],
    ['git clean -fd'],
    ['git status && git push --force'],
    ].map((r) => r[0]);
    for (const cmd of cmds) expect([cmd, decision(cmd)]).toEqual([cmd, 'deny']); // 失敗時にどのコマンドか分かる形
  });

  test('未コミット差分がある状態の clasp pull は拒否、クリーンなら通す', () => {
    expect(decision('clasp pull', { isDirty: () => true })).toBe('deny');
    expect(decision('clasp pull', { isDirty: () => false })).toBeNull();
  });
});

describe('本番・公開に影響するコマンドは確認を求める', () => {
  test('要確認コマンド一覧', () => {
    const cmds = [
    ['clasp push --force'],
    ['clasp deploy -i <DEPLOYMENT_ID> -d "v1.2.3"'],
    ['git push origin feat/x'],
    ['git push -u origin feat/x'],
    ['npm run deploy'],
    ].map((r) => r[0]);
    for (const cmd of cmds) expect([cmd, decision(cmd)]).toEqual([cmd, 'ask']); // 失敗時にどのコマンドか分かる形
  });
});

describe('通常の操作と、引用符・ヒアドキュメント内の文字列は止めない', () => {
  test('通常の操作・引用符/ヒアドキュメント内の文字列', () => {
    const cmds = [
    ['git status'],
    ['git commit -q -F - <<\'EOF\'\nchore: force push や git reset --hard の禁止を追加\nEOF'],
    ['git commit -m "docs: clasp deploy -d は禁止と明記"'],
    ['npm run check'],
    ['git log --oneline -5'],
    ['git clean -n'],
    ].map((r) => r[0]);
    for (const cmd of cmds) expect([cmd, decision(cmd)]).toEqual([cmd, null]); // 失敗時にどのコマンドか分かる形
  });
});

describe('MCP の git ツール', () => {
  test('force push・reset --hard・clean -f・noVerify は拒否、通常の push は確認', () => {
    expect(judge({ tool_name: 'mcp__git__git_push', tool_input: { force: true } }).decision).toBe('deny');
    expect(judge({ tool_name: 'mcp__git__git_push', tool_input: {} }).decision).toBe('ask');
    expect(judge({ tool_name: 'mcp__git__git_reset', tool_input: { mode: 'hard' } }).decision).toBe('deny');
    expect(judge({ tool_name: 'mcp__git__git_reset', tool_input: { mode: 'mixed' } })).toBeNull();
    expect(judge({ tool_name: 'mcp__git__git_clean', tool_input: { force: true } }).decision).toBe('deny');
    expect(judge({ tool_name: 'mcp__git__git_commit', tool_input: { message: 'x', noVerify: true } }).decision).toBe('deny');
  });
});
