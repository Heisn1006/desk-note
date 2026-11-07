@echo off
set "APPDIR=%~dp0"
set "APPDIR=%APPDIR:~0,-1%"
start "" "%APPDIR%\node_modules\electron\dist\electron.exe" "%APPDIR%" --no-sandbox --disable-gpu
exit /b 0
