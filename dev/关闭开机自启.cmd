@echo off
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v DeskNote /f 2>nul
echo.
echo 已关闭开机自启：DeskNote
pause
