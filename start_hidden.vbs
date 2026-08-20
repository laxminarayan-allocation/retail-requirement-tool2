Dim shell
Set shell = CreateObject("WScript.Shell")

Dim base
base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' ── Backend (uvicorn) ─────────────────────────────────────────────────────────
Dim backendDir
backendDir = base & "backend"

shell.Run "cmd /c cd /d """ & backendDir & """ && venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 >> """ & backendDir & "\server.log"" 2>&1", 0, False

' ── Frontend (vite) ───────────────────────────────────────────────────────────
Dim frontendDir
frontendDir = base & "frontend"

shell.Run "cmd /c cd /d """ & frontendDir & """ && npm run dev >> """ & frontendDir & "\server.log"" 2>&1", 0, False

WScript.Echo "Servers started in background." & vbCrLf & vbCrLf & "Backend : http://10.0.0.59:8000" & vbCrLf & "Frontend: http://10.0.0.59:5173" & vbCrLf & vbCrLf & "Run stop_servers.bat to stop."
