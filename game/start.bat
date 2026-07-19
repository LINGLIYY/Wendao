chcp 65001 >nul
@echo off
cd /d "%~dp0"

rem 清理占用 3456 端口的旧进程
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3456 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1

rem 延迟 2 秒后自动打开浏览�?start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3456"

set PYTHONIOENCODING=utf-8
if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe server.py
) else (
  python server.py
)
pause

