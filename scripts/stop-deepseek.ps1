$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deepseek-runtime.ps1')
$binary = Join-Path $localRoot 'bin\bot-playground.exe'
$pidFile = Join-Path $localRoot 'deepseek.pid'
if (Test-Path -LiteralPath $pidFile) {
    $processIdValue = 0
    if ([int]::TryParse(([IO.File]::ReadAllText($pidFile)).Trim(),[ref]$processIdValue)) {
        $running = Get-Process -Id $processIdValue -ErrorAction SilentlyContinue
        if ($running -and $running.Path -eq $binary) {
            Stop-Process -Id $running.Id
            $running.WaitForExit(10000) | Out-Null
        }
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Host 'DeepSeek playground stopped. Source files are preserved.' -ForegroundColor Green
