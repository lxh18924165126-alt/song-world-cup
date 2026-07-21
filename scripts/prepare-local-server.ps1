param(
    [ValidatePattern('^/[^?#]*/$')]
    [string] $BasePath = "/sowocu/",

    [ValidateRange(1024, 65535)]
    [int] $Port = 8787,

    [switch] $RotateAdminToken
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot ".local-server"
$StateDir = Join-Path $RuntimeDir "wrangler-state"
$AssetDir = Join-Path $RuntimeDir "web-dist"
$WebDistDir = Join-Path $RepoRoot "apps\web\dist"
$TokenFile = Join-Path $RuntimeDir "admin-token.txt"
$DevVarsFile = Join-Path $RepoRoot "apps\api\.dev.vars"
$NodePathFile = Join-Path $RuntimeDir "node-path.txt"
$MetadataFile = Join-Path $RuntimeDir "deployment.json"
$Pnpm = Get-Command pnpm.cmd -ErrorAction Stop
$Node = Get-Command node.exe -ErrorAction Stop

function Invoke-Pnpm {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)

    & $Pnpm.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

New-Item -ItemType Directory -Force -Path $RuntimeDir, $StateDir, $AssetDir | Out-Null

if ($RotateAdminToken -or -not (Test-Path -LiteralPath $TokenFile)) {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    [IO.File]::WriteAllText($TokenFile, $token, (New-Object Text.UTF8Encoding($false)))
}

$adminToken = (Get-Content -Raw -LiteralPath $TokenFile).Trim()
if ($adminToken.Length -lt 32) {
    throw "The generated local admin token is invalid."
}
$devVars = "AUTH_MODE=`"mock`"`r`nADMIN_TOKEN=`"$adminToken`"`r`n"
[IO.File]::WriteAllText($DevVarsFile, $devVars, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($NodePathFile, $Node.Source, (New-Object Text.UTF8Encoding($false)))

$previousBasePath = [Environment]::GetEnvironmentVariable("VITE_BASE_PATH", "Process")
try {
    $env:VITE_BASE_PATH = $BasePath
    Set-Location $RepoRoot
    Invoke-Pnpm @("install", "--frozen-lockfile")
    Invoke-Pnpm @("build")
    $builtIndex = Join-Path $WebDistDir "index.html"
    if (-not (Test-Path -LiteralPath $builtIndex)) {
        throw "The /sowocu/ web build did not produce apps/web/dist/index.html."
    }
    Get-ChildItem -LiteralPath $WebDistDir |
        Where-Object { $_.Name -ne "index.html" } |
        Copy-Item -Destination $AssetDir -Recurse -Force
    Copy-Item -LiteralPath $builtIndex -Destination (Join-Path $AssetDir "index.html") -Force
    Invoke-Pnpm @(
        "--filter", "@song-world-cup/api", "exec", "wrangler", "d1", "migrations", "apply",
        "song-world-cup", "--local", "--persist-to", $StateDir
    )
}
finally {
    if ($null -eq $previousBasePath) {
        Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue
    }
    else {
        $env:VITE_BASE_PATH = $previousBasePath
    }
}

$metadata = [ordered]@{
    basePath = $BasePath
    port = $Port
    stateDirectory = $StateDir
    assetDirectory = $AssetDir
    preparedAt = [DateTimeOffset]::Now.ToString("o")
}
[IO.File]::WriteAllText(
    $MetadataFile,
    ($metadata | ConvertTo-Json),
    (New-Object Text.UTF8Encoding($false))
)

Write-Output "Local deployment assets and database migrations are ready."
Write-Output "Public base path: $BasePath"
Write-Output "Worker listen URL: http://127.0.0.1:$Port"
Write-Output "The admin token is stored in the ignored runtime directory and was not printed."
