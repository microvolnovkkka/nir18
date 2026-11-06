param([switch]$NoBrowser,[int]$Port = 8090)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deepseek-runtime.ps1')
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
New-Item -ItemType Directory -Path (Join-Path $localRoot 'bin'),(Join-Path $localRoot 'logs') -Force | Out-Null
$binary = Join-Path $localRoot 'bin\bot-playground.exe'
$pidFile = Join-Path $localRoot 'deepseek.pid'
$addressFile = Join-Path $localRoot 'deepseek-address.txt'
if (Test-Path -LiteralPath $pidFile) {
    $processIdValue = 0
    if ([int]::TryParse(([IO.File]::ReadAllText($pidFile)).Trim(),[ref]$processIdValue)) {
        $running = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
        if ($running -and $running.Path -eq $binary) {
            $existingUrl = [IO.File]::ReadAllText($addressFile).Trim()
            Write-Host "Already running: $existingUrl. Stop it before changing the API key or rebuilding."
            if (-not $NoBrowser) { Start-Process $existingUrl }
            exit 0
        }
    }
}
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$Port)
try { $listener.Start() } catch { throw "Port $Port is already in use. Use STOP-DEEPSEEK.cmd or choose another port." }
finally { $listener.Stop() }

$goExe = $env:NIR18_GO
if (-not $goExe) {
    $bundled = Join-Path $projectRoot '.local\tools\go\bin\go.exe'
    if (Test-Path -LiteralPath $bundled) { $goExe = $bundled }
}
if (-not $goExe) {
    $pointer = Join-Path $runtimeBase 'tools\go-executable.txt'
    if (Test-Path -LiteralPath $pointer) { $goExe = [IO.File]::ReadAllText($pointer).Trim() }
}
if (-not $goExe) { $command = Get-Command go -ErrorAction SilentlyContinue; if ($command) { $goExe = $command.Source } }
if (-not $goExe -or -not (Test-Path -LiteralPath $goExe)) { throw 'Go >=1.26.1 is required. Install Go or set NIR18_GO to the full path to go.exe.' }
$env:GOCACHE = Join-Path $localRoot 'go-cache'
$env:GOMODCACHE = Join-Path $localRoot 'go-mod'
$env:GOPATH = Join-Path $localRoot 'go-path'
# Respect an explicitly installed Go toolchain; permit Go to resolve required patch updates.
$env:GOTOOLCHAIN = 'auto'
Push-Location (Join-Path $projectRoot 'backend')
try {
    Write-Host 'Building the local DeepSeek playground...'
    & $goExe build -trimpath -o $binary ./cmd/bot-playground
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. Check the error above and network access for first-time dependencies.' }
} finally { Pop-Location }

$originalKey = $env:DEEPSEEK_API_KEY
try {
    if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
        $env:DEEPSEEK_API_KEY = (Read-Host 'Paste DeepSeek API key (visible; not saved to a file)').Trim()
    }
    if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) { throw 'API key is empty.' }
    if (-not $env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL = 'deepseek-flash' }
    $url = "http://127.0.0.1:$Port"
    $started = Start-Process -FilePath $binary -ArgumentList @('-addr',"127.0.0.1:$Port") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localRoot 'logs\deepseek.stdout.log') -RedirectStandardError (Join-Path $localRoot 'logs\deepseek.stderr.log')
    [IO.File]::WriteAllText($pidFile,[string]$started.Id)
    [IO.File]::WriteAllText($addressFile,$url)
    $ready = $false
    for ($attemptIndex=0; $attemptIndex -lt 40; $attemptIndex++) {
        $started.Refresh()
        if ($started.HasExited) { throw "The playground stopped during startup. See $localRoot\logs\deepseek.stderr.log." }
        try { $status = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 1; if ($status.status -eq 'ready') { $ready = $true; break } } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { Stop-Process -Id $started.Id -ErrorAction SilentlyContinue; throw "The playground did not start. See $localRoot\logs." }
    Write-Host "Ready: $url" -ForegroundColor Green
    Write-Host 'API requests are paid. Use STOP-DEEPSEEK.cmd to stop the playground.'
    if (-not $NoBrowser) { Start-Process $url }
} finally { $env:DEEPSEEK_API_KEY = $originalKey }
