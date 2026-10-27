$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime\server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No background La Play session recorded. Close its terminal or press Ctrl+C.'; exit 0 }
$appProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
$appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $appProcessId"
$serverPath = Join-Path $projectRoot 'server.mjs'
if (-not $appProcess) { Write-Host 'La Play is already stopped.'; exit 0 }
if ($appProcess.Name -ne 'node.exe' -or -not $appProcess.CommandLine.Contains($serverPath)) { throw 'The recorded process is not this La Play instance. Nothing was stopped.' }
Stop-Process -Id $appProcessId
Write-Host 'La Play stopped.'
