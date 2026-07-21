param(
    [string] $ServiceName = "song-world-cup-local-server",
    [string] $DisplayName = "Song World Cup Local Server",
    [ValidateRange(1024, 65535)]
    [int] $Port = 8787
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ServiceName `"$ServiceName`" -DisplayName `"$DisplayName`" -Port $Port"
    $elevationParameters = @{
        FilePath = "powershell.exe"
        Verb = "RunAs"
        WindowStyle = "Hidden"
        ArgumentList = $arguments
        Wait = $true
        PassThru = $true
    }
    $elevated = Start-Process @elevationParameters
    exit $elevated.ExitCode
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RepoRoot ".local-server"
$ServiceDir = Join-Path $RuntimeDir "service"
$LogDir = Join-Path $ServiceDir "logs"
$StartScript = Join-Path $PSScriptRoot "start-local-server.ps1"
$PidFile = Join-Path $RuntimeDir "server.pid"
$SourceWrapper = "E:\code\local-nginx\.runtime\service\local-nginx-gateway.exe"
$WrapperExe = Join-Path $ServiceDir "$ServiceName.exe"
$WrapperXml = Join-Path $ServiceDir "$ServiceName.xml"
$HealthUrl = "http://127.0.0.1:$Port/api/health"

if (-not (Test-Path -LiteralPath $SourceWrapper)) {
    throw "The local-nginx WinSW runtime was not found at $SourceWrapper."
}
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir "node-path.txt"))) {
    throw "Local deployment is not prepared. Run pnpm local:prepare first."
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force
        $existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    if (Test-Path -LiteralPath $WrapperExe) {
        & $WrapperExe uninstall | Out-Host
    }
    else {
        & sc.exe delete $ServiceName | Out-Host
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
}

if (Test-Path -LiteralPath $PidFile) {
    $launcherPid = [int](Get-Content -Raw -LiteralPath $PidFile).Trim()
    $launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $launcherPid" -ErrorAction SilentlyContinue
    if ($launcher -and $launcher.CommandLine -like "*start-local-server.ps1*") {
        & taskkill.exe /PID $launcherPid /T /F | Out-Null
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $ServiceDir, $LogDir | Out-Null
Copy-Item -LiteralPath $SourceWrapper -Destination $WrapperExe -Force

$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$xml = @"
<service>
  <id>$ServiceName</id>
  <name>$DisplayName</name>
  <description>Runs the local song-world-cup Worker on 127.0.0.1:$Port for the /sowocu gateway route.</description>
  <executable>$PowerShell</executable>
  <startarguments>-NoProfile -ExecutionPolicy Bypass -File &quot;$StartScript&quot; -Port $Port</startarguments>
  <workingdirectory>$RepoRoot</workingdirectory>
  <stoptimeout>20 sec</stoptimeout>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <logpath>$LogDir</logpath>
  <log mode="roll"></log>
</service>
"@
[IO.File]::WriteAllText($WrapperXml, $xml, (New-Object Text.UTF8Encoding($false)))

& $WrapperExe install | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "WinSW service installation failed with exit code $LASTEXITCODE."
}
& sc.exe config $ServiceName start= auto | Out-Host
& sc.exe failure $ServiceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Host
Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))

$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    try {
        $health = Invoke-RestMethod -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
        if ($health.status -eq "ok") {
            Write-Output "Windows service installed and healthy at $HealthUrl."
            Get-Service -Name $ServiceName | Format-List Name,DisplayName,Status,StartType
            exit 0
        }
    }
    catch {
    }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)

throw "The Windows service did not become healthy within 45 seconds."
