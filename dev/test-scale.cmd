@echo off
set "ROOT=%~dp0.."
set "DESKNOTE_DATA_DIR=%ROOT%\.testdata"
start "" "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%" --no-sandbox --disable-gpu --test-scale
exit /b 0
