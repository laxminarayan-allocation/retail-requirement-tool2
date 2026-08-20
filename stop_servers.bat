@echo off
echo Stopping servers...

REM Kill uvicorn / python on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill vite / node on port 5173
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Done. Both servers stopped.
pause
