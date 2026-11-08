@echo off
set "DIR=%~dp0.."
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v DeskNote /t REG_SZ /d "\"%DIR%\node_modules\electron\dist\electron.exe\" \"%DIR%\" --hidden" /f
echo.
echo 已开启开机自启：DeskNote
pause
