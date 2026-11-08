@echo off
set "ROOT=%~dp0.."
set "ELECTRON_RUN_AS_NODE="
"%ROOT%\node_modules\electron\dist\electron.exe" --no-sandbox --disable-gpu "%ROOT%\dev\tools\i18n-smoke.js"
