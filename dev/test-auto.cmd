@echo off
set "ROOT=%~dp0.."
start "" "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%" --no-sandbox --disable-gpu --test-auto
exit /b 0
