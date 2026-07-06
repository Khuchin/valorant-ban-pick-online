@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Agent Draft Tool Local Server
cd /d "%~dp0"

echo ================================================
echo   Agent Draft Tool Local Server - No Install
echo ================================================
echo.

if not exist "%~dp0server.js" (
  echo [ERROR] server.js was not found.
  echo Extract the entire ZIP file before running this launcher.
  pause
  exit /b 1
)
if not exist "%~dp0public\index.html" (
  echo [ERROR] public\index.html was not found.
  echo Extract the entire ZIP file before running this launcher.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not available in PATH.
  echo Install Node.js 18 or newer, restart Windows, and try again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe') do if not defined NODE_EXE set "NODE_EXE=%%I"

echo Node.js:
"%NODE_EXE%" --version
if errorlevel 1 (
  echo [ERROR] Node.js could not be executed.
  pause
  exit /b 1
)

echo.
echo No npm install is needed in this version.
echo Local address: http://localhost:3000
echo Keep this window open while using the program.
echo Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:3000"
"%NODE_EXE%" "%~dp0server.js"

set "SERVER_EXIT=%ERRORLEVEL%"
echo.
echo The server stopped. Exit code: %SERVER_EXIT%
pause
exit /b %SERVER_EXIT%
