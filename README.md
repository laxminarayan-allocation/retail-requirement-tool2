# Retail Requirement Tool

Replenishment calculation engine for 200+ stores.

## Architecture

```
React (Vite + TypeScript)
        │  REST / JSON
        ▼
FastAPI (Python)
  ├── API Layer
  ├── Service Layer
  ├── Calculation Engine
  └── Data Access Layer
        │
        ▼
  Oracle Database (MISRETAIL / CK_A2166 / SSRK / REPORT schemas)
```

## Phase Status

| Phase | Title                     | Status      |
|-------|---------------------------|-------------|
| 1     | Project Setup             | ✅ Complete  |
| 2     | Oracle Connection         | ⏳ Pending  |
| 3     | SQL Data Layer            | ⏳ Pending  |
| 4     | React UI                  | ⏳ Pending  |
| 5     | Factor Engine             | ⏳ Pending  |
| 6     | Calculation Engine        | ⏳ Pending  |
| 7     | Validation                | ⏳ Pending  |
| 8     | Calculation API           | ⏳ Pending  |
| 9     | Dashboard                 | ⏳ Pending  |
| 10    | Result Explorer           | ⏳ Pending  |
| 11    | Excel Export              | ⏳ Pending  |
| 12    | Performance Optimization  | ⏳ Pending  |
| 13    | Testing                   | ⏳ Pending  |
| 14    | Production Hardening      | ⏳ Pending  |

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- Oracle Instant Client (if using thick mode for oracledb)

---

## Backend Setup (Windows PowerShell)

```powershell
cd C:\Users\allocation_user\Desktop\Projects\SS27\retail_requirement_tool\backend

python -m venv venv
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

Configure Oracle credentials:

```powershell
copy .env.example .env
# Open .env and fill in ORACLE_USER, ORACLE_PASSWORD, ORACLE_HOST, ORACLE_SERVICE_NAME
notepad .env
```

Run the backend:

```powershell
uvicorn app.main:app --reload --port 8000
```

Test in browser: http://localhost:8000/docs

---

## Frontend Setup (Windows PowerShell)

```powershell
cd C:\Users\allocation_user\Desktop\Projects\SS27\retail_requirement_tool\frontend

npm install
npm run dev
```

Open: http://localhost:5173

---

## API Endpoints (Phase 1)

| Method | Path                   | Description              |
|--------|------------------------|--------------------------|
| GET    | /api/health            | Liveness check           |
| GET    | /api/database/status   | Oracle connectivity test |

---

## Running Tests

```powershell
cd backend
.\venv\Scripts\Activate.ps1
pytest tests/ -v
```

---

## Oracle Note

Credentials must be set in `backend/.env` before Phase 2.  
The `.env` file is git-ignored — never commit credentials.
