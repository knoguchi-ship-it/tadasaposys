$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$codexArgs = @(
  '--cd', $repoRoot,
  '--sandbox', 'workspace-write',
  '--ask-for-approval', 'on-request',
  '-c', 'approvals_reviewer="auto_review"'
) + $args

& codex @codexArgs
exit $LASTEXITCODE
