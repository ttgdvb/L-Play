@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\start-lan.ps1"
pause
