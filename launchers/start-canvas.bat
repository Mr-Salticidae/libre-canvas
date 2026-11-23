@echo off
rem LibreCanvas launcher - starts bridge, canvas dev server, ComfyUI, then opens the browser.
rem The real work is in start-canvas.ps1 (hidden window, UTF-8 BOM so Chinese logs read fine).
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-canvas.ps1"
exit /b 0
