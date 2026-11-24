import { useState, useEffect, useRef } from "react"
import { getDivisions, startRun, getJob, openJobWS } from "./api"
import StepperBar from "./components/StepperBar"
import LiveLog from "./components/LiveLog"

const STATUS_COLOR = {
  queued:  "text-yellow-400",
  running: "text-blue-400",
  done:    "text-[#22c55e]",
  error:   "text-red-400",
  pending: "text-[#6b7280]",
}

export default function RunPanel() {
  const [divisions, setDivisions] = useState([])
  const [selDivs, setSelDivs]     = useState([])
  const [runAll, setRunAll]       = useState(true)
  const [jobId, setJobId]         = useState(null)
  const [job, setJob]             = useState(null)
  const [steps, setSteps]         = useState({})
  const [logs, setLogs]           = useState([])
  const [starting, setStarting]   = useState(false)
  const wsRef = useRef(null)

  useEffect(() => {
    getDivisions().then(d => setDivisions(d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!jobId) return
    if (wsRef.current) wsRef.current.close()
    wsRef.current = openJobWS(
      jobId,
      (msg) => {
        setJob(msg)
        if (msg.steps) {
          const s = {}
          msg.steps.forEach(st => { s[st.n] = st.status })
          setSteps(s)
        }
        if (msg.logs) setLogs(msg.logs)
      },
      () => {
        getJob(jobId).then(j => {
          setJob(j)
          if (j.steps) {
            const s = {}
            j.steps.forEach(st => { s[st.n] = st.status })
            setSteps(s)
          }
        }).catch(() => {})
      }
    )
    return () => wsRef.current?.close()
  }, [jobId])

  const handleStart = async () => {
    setStarting(true)
    setSteps({})
    setLogs([])
    setJob(null)
    try {
      const config = { divisions: runAll ? [] : selDivs, run_all: runAll }
      const res = await startRun(config)
      if (res.job_id) {
        setJobId(res.job_id)
      } else {
        alert(res.detail || res.error || "Failed to start run")
      }
    } catch (e) {
      alert("Error: " + e.message)
    } finally {
      setStarting(false)
    }
  }

  const toggleDiv = (d) => {
    setSelDivs(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  const jobStatus = job?.status || "pending"

  return (
    <div className="space-y-5">
      {/* Config */}
      <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-[#e2e8f0]">Run Configuration</p>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={runAll} onChange={e => setRunAll(e.target.checked)}
            className="accent-[#22c55e]" />
          <span className="text-sm text-[#e2e8f0]">Run all divisions</span>
        </label>

        {!runAll && (
          <div>
            <p className="text-xs text-[#6b7280] mb-2">Select divisions:</p>
            <div className="flex flex-wrap gap-2">
              {divisions.map(d => (
                <label key={d} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={selDivs.includes(d)}
                    onChange={() => toggleDiv(d)} className="accent-[#22c55e]" />
                  <span className="text-xs text-[#e2e8f0]">{d}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={starting || jobStatus === "running" || jobStatus === "queued"}
          className="bg-[#22c55e] text-[#061a06] font-semibold text-sm px-5 py-2 rounded
            hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {starting ? "Starting..." : jobStatus === "queued" ? "Queued..." : jobStatus === "running" ? "Running..." : "▶  Start Run"}
        </button>
      </div>

      {/* Status */}
      {job && (
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#e2e8f0]">
              Job <span className="font-mono text-[10px] text-[#6b7280]">{jobId?.slice(0, 8)}</span>
            </p>
            <span className={`text-sm font-semibold ${STATUS_COLOR[jobStatus] || "text-[#6b7280]"}`}>
              {jobStatus.toUpperCase()}
            </span>
          </div>

          <StepperBar steps={steps} />

          {job.error && (
            <div className="bg-red-950 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
              {job.error}
            </div>
          )}

          <div>
            <p className="text-xs text-[#6b7280] mb-1">Live Log</p>
            <LiveLog lines={logs} />
          </div>
        </div>
      )}

      <p className="text-[11px] text-[#6b7280]">
        Max 2 concurrent runs. Additional runs are queued automatically.
      </p>
    </div>
  )
}
