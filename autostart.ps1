# SS27 Auto-start — runs at login via Task Scheduler
# Waits 10s for network, then starts backend + frontend

Start-Sleep -Seconds 10

$ROOT     = "C:\Users\allocation_user\Desktop\Projects\SS27\retail_requirement_tool"
$BACKEND  = "$ROOT\backend"
$FRONTEND = "$ROOT\frontend"
$PYTHON   = "$BACKEND\venv\Scripts\python.exe"

# Kill any leftovers from previous session
Get-Process -Name "python","python3","node" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

# Backend
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$BACKEND'; & '$PYTHON' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
) -WindowStyle Minimized

Start-Sleep -Seconds 3

# Frontend
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$FRONTEND'; npm run dev"
) -WindowStyle Minimized
