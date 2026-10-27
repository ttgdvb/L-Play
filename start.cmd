@echo off
cd /d "%~dp0"
if not exist "node_modules\@vercel\blob\package.json" (
  call npm.cmd ci --omit=dev
  if errorlevel 1 exit /b 1
)
if not exist ".runtime\config.json" (
  powershell.exe -NoProfile -File "%~dp0scripts\setup.ps1"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
set LA_LAN=0
node server.mjs
pause
