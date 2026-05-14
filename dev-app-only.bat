@echo off
setlocal

cd /d "%~dp0"
title SkillHub Dev App

set "ELECTRON_BIN=%~dp0node_modules\.bin\electron.cmd"

echo ========================================
echo  SkillHub Dev App Only
echo ========================================
echo.
echo This file assumes the Vite dev server is already running.
echo Renderer URL: http://127.0.0.1:5173
echo.

call npm run build:main
if errorlevel 1 (
  echo.
  echo [ERROR] Main/preload build failed.
  pause
  exit /b 1
)

call npx wait-on http://127.0.0.1:5173 --timeout 30000
if errorlevel 1 (
  echo.
  echo [ERROR] Vite is not ready on http://127.0.0.1:5173
  echo Please run npm run dev first.
  pause
  exit /b 1
)

set "VITE_DEV_SERVER_URL=http://127.0.0.1:5173"
set "ELECTRON_RUN_AS_NODE="
if exist "%ELECTRON_BIN%" (
  call "%ELECTRON_BIN%" "%~dp0dist\main\main\index.js"
) else (
  call npx --no-install electron "%~dp0dist\main\main\index.js"
)

echo.
echo SkillHub has closed.
pause
endlocal
