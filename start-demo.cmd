@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (
  echo 请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
if not exist ".env.local" (
  copy /y ".env.example" ".env.local" >nul
  echo 已创建 .env.local，请填入豆包 API Key 后保存。
  start "" notepad ".env.local"
  pause
)
if not exist "node_modules" (
  call npm install
  if errorlevel 1 (pause & exit /b 1)
)
call npm run build || (pause & exit /b 1)
start "Marie Server" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173/"
