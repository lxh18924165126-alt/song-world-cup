param(
    [ValidateRange(1024, 65535)]
    [int] $Port = 8787
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot ".local-server"
$StateDir = Join-Path $RuntimeDir "wrangler-state"
$AssetDir = Join-Path $RuntimeDir "web-dist"
$DevVarsFile = Join-Path $RepoRoot "apps\api\.dev.vars"
$NodePathFile = Join-Path $RuntimeDir "node-path.txt"
$IndexFile = Join-Path $AssetDir "index.html"
$WranglerCli = Join-Path $RepoRoot "apps\api\node_modules\wrangler\bin\wrangler.js"

if (
    -not (Test-Path -LiteralPath $DevVarsFile) -or
    -not (Test-Path -LiteralPath $NodePathFile) -or
    -not (Test-Path -LiteralPath $IndexFile) -or
    -not (Test-Path -LiteralPath $WranglerCli)
) {
    throw "Local deployment is not prepared. Run pnpm local:prepare first."
}

$NodeExe = (Get-Content -Raw -LiteralPath $NodePathFile).Trim()
if (-not (Test-Path -LiteralPath $NodeExe)) {
    throw "The prepared Node.js executable no longer exists. Run pnpm local:prepare again."
}

$env:NO_COLOR = "1"
Set-Location (Join-Path $RepoRoot "apps\api")
$wranglerArguments = @(
    $WranglerCli, "dev", "--local",
    "--ip", "127.0.0.1", "--port", $Port, "--persist-to", $StateDir,
    "--assets", $AssetDir,
    "--show-interactive-dev-session=false"
)
& $NodeExe @wranglerArguments

if ($LASTEXITCODE -ne 0) {
    throw "The local Worker exited with code $LASTEXITCODE"
}
