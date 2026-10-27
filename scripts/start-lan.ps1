$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
function Test-PrivateIPv4([string] $address) {
  $parts = $address.Split('.')
  return $parts.Count -eq 4 -and ($parts[0] -eq '10' -or ($parts[0] -eq '192' -and $parts[1] -eq '168') -or ($parts[0] -eq '172' -and [int]$parts[1] -ge 16 -and [int]$parts[1] -le 31))
}
$candidates = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Sort-Object @{Expression={if ($_.InterfaceAlias -match 'Wi-Fi|Wireless') {0} else {1}}})
$chosen = $null
foreach ($candidate in $candidates) {
  $address = @($candidate.IPv4Address | Where-Object { Test-PrivateIPv4 $_.IPAddress }) | Select-Object -First 1
  if ($address) { $chosen = [ordered]@{interface=$candidate.InterfaceAlias;address=$address.IPAddress;prefixLength=[int]$address.PrefixLength}; break }
}
if (-not $chosen) { throw 'No active private Wi-Fi/LAN address found. Connect to Wi-Fi and try again.' }
if (-not (Test-Path -LiteralPath '.runtime\config.json')) { throw 'Run scripts\setup.ps1 first to configure audio tools.' }
$serverPath = Join-Path $projectRoot 'server.mjs'
$pidFile = Join-Path $projectRoot '.runtime\server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $appProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $appProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $appProcessId"
  if ($appProcess) {
    if ($appProcess.Name -ne 'node.exe' -or -not $appProcess.CommandLine.Contains($serverPath)) { throw 'Recorded process does not match this La Play instance. Nothing was stopped.' }
    Stop-Process -Id $appProcessId
  }
}
$chosen | ConvertTo-Json | Set-Content -LiteralPath '.runtime\lan.json' -Encoding utf8
$previousLanMode = $env:LA_LAN
try {
  $env:LA_LAN = '1'
  $appProc = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.runtime\server.log') -RedirectStandardError (Join-Path $projectRoot '.runtime\server-error.log') -PassThru
} finally { $env:LA_LAN = $previousLanMode }
$appProc.Id | Set-Content -LiteralPath $pidFile
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4217/api/health' -TimeoutSec 2; if ($health.lanEnabled) { $ready = $true; break } } catch {}
  Start-Sleep -Milliseconds 150
}
if (-not $ready) { throw 'LAN server did not become ready. Check .runtime\server-error.log.' }
Write-Output ('Phone on the same Wi-Fi: http://' + $chosen.address + ':4217/')
Write-Output 'Keep this computer awake. Use stop.cmd to stop the LAN session.'
