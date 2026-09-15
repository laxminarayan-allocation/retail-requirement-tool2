"""
Start backend + frontend for retail_requirement_tool.

Usage:
    python start.py          # backend only (prod — serves built dist/)
    python start.py --dev    # backend + frontend dev server (hot reload)
    python start.py --build  # build frontend then start backend (prod)
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT    = Path(__file__).parent
BACKEND = ROOT / "backend"
FRONTEND= ROOT / "frontend"

BACKEND_CMD  = [sys.executable, "-m", "uvicorn", "app.main:app",
                "--host", "0.0.0.0", "--port", "8000"]
FRONTEND_DEV = ["npm", "run", "dev"]
FRONTEND_BUILD = ["npm", "run", "build"]

def banner(msg: str) -> None:
    print(f"\n{'='*60}\n  {msg}\n{'='*60}")

def run_build() -> bool:
    banner("Building frontend (npm run build)...")
    r = subprocess.run(FRONTEND_BUILD, cwd=FRONTEND, shell=True)
    if r.returncode != 0:
        print("ERROR: Frontend build failed.")
        return False
    print("Frontend built successfully → dist/")
    return True

def start_backend() -> subprocess.Popen:
    banner("Starting backend  →  http://0.0.0.0:8000")
    print("   Tailscale  :  https://ckho-d-aloc.tail8de265.ts.net/")
    print("   Local      :  http://10.0.0.59:8000")
    return subprocess.Popen(BACKEND_CMD, cwd=BACKEND)

def start_frontend_dev() -> subprocess.Popen:
    banner("Starting frontend dev  →  http://localhost:5173")
    return subprocess.Popen(FRONTEND_DEV, cwd=FRONTEND, shell=True)

def main() -> None:
    parser = argparse.ArgumentParser(description="Start retail_requirement_tool")
    parser.add_argument("--dev",   action="store_true", help="Run frontend dev server alongside backend")
    parser.add_argument("--build", action="store_true", help="Build frontend first then start backend")
    args = parser.parse_args()

    procs: list[subprocess.Popen] = []

    try:
        if args.build:
            if not run_build():
                sys.exit(1)

        be = start_backend()
        procs.append(be)

        if args.dev:
            time.sleep(2)
            fe = start_frontend_dev()
            procs.append(fe)

        print("\n[start.py] Running. Press Ctrl+C to stop all.\n")
        for p in procs:
            p.wait()

    except KeyboardInterrupt:
        print("\n[start.py] Stopping...")
        for p in procs:
            p.terminate()
        for p in procs:
            try: p.wait(timeout=5)
            except subprocess.TimeoutExpired: p.kill()
        print("[start.py] Done.")

if __name__ == "__main__":
    main()
