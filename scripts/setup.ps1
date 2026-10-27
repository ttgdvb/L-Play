$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Could not install application dependencies.' }
$pythonCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
)
$pythonPath = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pythonPath) {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand -and $pythonCommand.Source -notlike '*WindowsApps*') { $pythonPath = $pythonCommand.Source }
}
if (-not $pythonPath) { throw 'Please install Python 3.12+ from python.org, then run setup again.' }
New-Item -ItemType Directory -Force -Path '.runtime\python' | Out-Null
& $pythonPath -m pip install --disable-pip-version-check --upgrade --target '.runtime\python' 'yt-dlp[default]==2026.10.26' 'imageio-ffmpeg==0.6.0'
if ($LASTEXITCODE -ne 0) { throw 'Could not install audio tools.' }
$env:PYTHONPATH = (Resolve-Path -LiteralPath '.runtime\python').Path
& $pythonPath (Join-Path $PSScriptRoot 'configure_tools.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not configure audio tools.' }
Write-Host 'Audio tools are ready. Run start.cmd to open La Play.'
