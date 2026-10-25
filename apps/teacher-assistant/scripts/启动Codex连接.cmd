@echo off
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Codex bridge has not started.
  pause
  exit /b 1
)
node scripts\start-codex-bridge.mjs
pause
