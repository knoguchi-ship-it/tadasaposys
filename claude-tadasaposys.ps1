$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$claudeArgs = @(
  '--dangerously-skip-permissions',
  '--add-dir', $repoRoot
) + $args

Push-Location $repoRoot
try {
  & claude @claudeArgs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
