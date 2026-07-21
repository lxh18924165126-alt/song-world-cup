$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $RepoRoot ".local-server\server.pid"
$ServiceName = "song-world-cup-local-server"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Stopped") {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Stop-Service -Name $ServiceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    else {
        $serviceScript = "Stop-Service -Name '$ServiceName' -Force; (Get-Service -Name '$ServiceName').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))"
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
            throw "Stopping the installed Windows service failed with exit code $($elevated.ExitCode)."
        }
    }
    Write-Output "The installed Windows service has stopped."
}

if (-not (Test-Path -LiteralPath $PidFile)) {
    if (-not $service) {
        Write-Output "No recorded local Worker process exists."
    }
    exit 0
}

$serverPid = [int](Get-Content -Raw -LiteralPath $PidFile).Trim()
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
if ($process) {
    if ($process.CommandLine -notlike "*start-local-server.ps1*") {
        throw "PID $serverPid no longer belongs to the song-world-cup launcher; refusing to stop it."
    }
    & taskkill.exe /PID $serverPid /T /F | Out-Null
}

Remove-Item -LiteralPath $PidFile -Force
Write-Output "The local Worker has stopped."
