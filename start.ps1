# SS27 Retail Requirement Tool — Start Script
# Kills any old processes, then starts backend + frontend in separate windows.

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BACKEND = Join-Path $ROOT "backend"
$FRONTEND = Join-Path $ROOT "frontend"
$VENV_PYTHON = Join-Path $BACKEND "venv\Scripts\python.exe"

Write-Host ""
Write-Host "=== SS27 Retail Requirement Tool ===" -ForegroundColor Cyan
Write-Host ""

# ── Kill old processes ─────────────────────────────────────────────────────────
Write-Host "Stopping old python/node processes..." -ForegroundColor Yellow
Get-Process -Name "python","python3" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# ── Backend ────────────────────────────────────────────────────────────────────
Write-Host "Starting backend (FastAPI on :8000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$BACKEND'; & '$VENV_PYTHON' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
) -WindowStyle Normal

Start-Sleep -Seconds 2

# ── Frontend ───────────────────────────────────────────────────────────────────
Write-Host "Starting frontend (Vite on :5173)..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$FRONTEND'; npm run dev"
) -WindowStyle Normal

Write-Host ""
Write-Host "Both servers started." -ForegroundColor Cyan
Write-Host "  Backend : http://10.0.0.59:8000" -ForegroundColor White
Write-Host "  Frontend: http://10.0.0.59:5173" -ForegroundColor White
Write-Host ""
