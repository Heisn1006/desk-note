@echo off
set "APPDIR=%~dp0"
set "APPDIR=%APPDIR:~0,-1%"
set "ELECTRON_RUN_AS_NODE="
"%APPDIR%\node_modules\electron\dist\electron.exe" --no-sandbox --disable-gpu "%APPDIR%\tools\i18n-smoke.js"
