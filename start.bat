@echo off
echo Starting CityKart SS27 Retail Requirement Tool...
echo.

:: Start backend
echo [1/2] Starting backend on http://0.0.0.0:8000 ...
start "SS27 Backend" cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start frontend
echo [2/2] Starting frontend on http://0.0.0.0:5173 ...
start "SS27 Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both servers starting. Access the app at:
echo   http://10.0.0.59:5173   (from any device on LAN)
echo   http://localhost:5173   (on this machine)
echo.
pause
