@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org, then try again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Please install Node.js 24 or newer.');process.exit(1)}"
if errorlevel 1 goto failed
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
if not exist .env (
  node scripts/setup.mjs
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo Open http://localhost:3001 in your browser. Keep this window open. Ctrl+C stops Relay.
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Relay could not start. Read the error above.
pause
exit /b 1
