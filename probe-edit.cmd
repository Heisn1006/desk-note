@echo off
set "APPDIR=%~dp0"
set "DESKNOTE_DATA_DIR=%APPDIR%.testdata"
set "APPDIR=%APPDIR:~0,-1%"
start "" "%APPDIR%\node_modules\electron\dist\electron.exe" "%APPDIR%" --no-sandbox --disable-gpu --hash=edit
exit /b 0
