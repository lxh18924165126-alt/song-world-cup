param(
    [ValidateRange(1024, 65535)]
    [int] $Port = 8787
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot ".local-server"
$StartScript = Join-Path $PSScriptRoot "start-local-server.ps1"
$PidFile = Join-Path $RuntimeDir "server.pid"
$StdoutLog = Join-Path $RuntimeDir "server.out.log"
$StderrLog = Join-Path $RuntimeDir "server.err.log"
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$ServiceName = "song-world-cup-local-server"

function Test-WorkerHealth {
    try {
        $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2 -UseBasicParsing
        return $response.status -eq "ok"
    }
    catch {
        return $false
    }
}

if (Test-WorkerHealth) {
    Write-Output "The local Worker is already healthy at $HealthUrl."
    exit 0
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne "Running") {
        $serviceScript = "Start-Service -Name '$ServiceName'; (Get-Service -Name '$ServiceName').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($serviceScript))
        $elevationParameters = @{
            FilePath = "powershell.exe"
            Verb = "RunAs"
            WindowStyle = "Hidden"
            ArgumentList = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
            Wait = $true
            PassThru = $true
        }
        $elevated = Start-Process @elevationParameters
        if ($elevated.ExitCode -ne 0) {
            throw "Starting the installed Windows service failed with exit code $($elevated.ExitCode)."
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-WorkerHealth) {
            Write-Output "The installed Windows service is healthy at $HealthUrl."
            exit 0
        }
        Start-Sleep -Milliseconds 500
    }
    throw "The installed Windows service did not become healthy within 45 seconds."
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($listener) {
    throw "Port $Port is in use by another process that did not return the expected health response."
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`" -Port $Port"
$startParameters = @{
    FilePath = $PowerShell
    ArgumentList = $arguments
    WorkingDirectory = $RepoRoot
    WindowStyle = "Hidden"
    RedirectStandardOutput = $StdoutLog
    RedirectStandardError = $StderrLog
    PassThru = $true
}
$process = Start-Process @startParameters

[IO.File]::WriteAllText($PidFile, [string]$process.Id, (New-Object Text.UTF8Encoding($false)))

$deadline = [DateTime]::UtcNow.AddSeconds(45)
while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-WorkerHealth) {
        Write-Output "The local Worker is healthy at $HealthUrl (launcher PID $($process.Id))."
        exit 0
    }
    if ($process.HasExited) {
        $stderr = if (Test-Path -LiteralPath $StderrLog) { (Get-Content -Tail 20 -LiteralPath $StderrLog) -join [Environment]::NewLine } else { "" }
        throw "The local Worker launcher exited before becoming healthy.$([Environment]::NewLine)$stderr"
    }
    Start-Sleep -Milliseconds 500
}

& taskkill.exe /PID $process.Id /T /F | Out-Null
throw "The local Worker did not become healthy within 45 seconds. Check $StdoutLog and $StderrLog."
