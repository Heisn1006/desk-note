@echo off
cd /d "%~dp0"
node tools\i18n-check.js
if errorlevel 1 exit /b 1
node tools\data-check.js
if errorlevel 1 exit /b 1
node tools\schedule-check.js
if errorlevel 1 exit /b 1
node tools\backup-check.js
if errorlevel 1 exit /b 1
node tools\geometry-check.js
if errorlevel 1 exit /b 1
node tools\crop-check.js
if errorlevel 1 exit /b 1
node tools\fullscreen-check.js
if errorlevel 1 exit /b 1
echo.
echo ALL CHECKS PASSED
