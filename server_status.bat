@echo off
echo ── Server Status ─────────────────────────────
echo.

netstat -aon | findstr ":8000 " >nul 2>&1
if %errorlevel%==0 (
    echo [RUNNING] Backend   http://10.0.0.59:8000
) else (
    echo [STOPPED] Backend   port 8000 not in use
)

netstat -aon | findstr ":5173 " >nul 2>&1
if %errorlevel%==0 (
    echo [RUNNING] Frontend  http://10.0.0.59:5173
) else (
    echo [STOPPED] Frontend  port 5173 not in use
)

echo.
echo Logs:
echo   Backend  : backend\server.log
echo   Frontend : frontend\server.log
echo.
pause
