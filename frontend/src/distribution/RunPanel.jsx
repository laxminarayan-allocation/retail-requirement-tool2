import { useState, useEffect } from "react"
import {
  getBaseStatus, buildBase, distribute, getHoldRules, saveHoldRules,
  getStoreFilterMeta, getItemFilterMeta, getStoreList, getBarcodePreview,
} from "./api"
import StepperBar from "./components/StepperBar"

const BG = "#0d2b0d"
const BORDER = "border-[#1e4d1e]"
const G = "#22c55e"

const REQ_SOURCES  = [{ val: "GRC", text: "GRC" }, { val: "WMS", text: "WMS" }, { val: "BOTH", text: "GRC + WMS" }]
const BIZ_SEGMENTS = [{ val: "APPS", text: "APPS" }, { val: "GM", text: "GM" }, { val: "BOTH", text: "Both" }]
const SORT_MODES   = [
  { val: "fill_rate",    text: "Fill Rate" },
  { val: "combined_req", text: "Combined REQ" },
  { val: "festive_req",  text: "Festive REQ" },
]

function PillGroup({ options, value, onChange }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button key={o.val} onClick={() => onChange(o.val)}
          className={`px-3 py-1 text-xs rounded-full border transition-colors ${
            value === o.val
              ? "bg-[#22c55e] text-[#061a06] border-[#22c55e] font-semibold"
              : "bg-[#061a06] border-[#1e4d1e] text-[#6b7280] hover:border-[#22c55e] hover:text-[#e2e8f0]"
          }`}>
          {o.text}
        </button>
      ))}
    </div>
  )
}

function HoldRuleRow({ rule, onChange, onDelete }) {
  const fields = ["division", "department", "store_name", "store_code", "attribute1", "article_name"]
  const ops    = ["==", "!=", "in", "not_in", "contains", ">", "<"]
  return (
    <div className="flex gap-1 flex-wrap items-center">
      <select value={rule.field} onChange={e => onChange({ ...rule, field: e.target.value })}
        className="bg-[#061a06] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1">
        {fields.map(f => <option key={f}>{f}</option>)}
      </select>
      <select value={rule.op} onChange={e => onChange({ ...rule, op: e.target.value })}
        className="bg-[#061a06] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1">
        {ops.map(o => <option key={o}>{o}</option>)}
      </select>
      <input value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value })}
        placeholder="value"
        className="flex-1 min-w-[120px] bg-[#061a06] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1" />
      <button onClick={onDelete} className="text-red-400 hover:text-red-300 text-xs px-1">✕</button>
    </div>
  )
}

export default function RunPanel({ onRunComplete }) {
  // Config
  const [reqSource,  setReqSource]  = useState("GRC")
  const [bizSegment, setBizSegment] = useState("APPS")
  const [sortMode,   setSortMode]   = useState("fill_rate")
  const [minQty,     setMinQty]     = useState(0)

  // Hold rules
  const [holdRules, setHoldRules]   = useState([])
  const [rulesSaved, setRulesSaved] = useState(false)

  // Status
  const [baseStatus, setBaseStatus] = useState(null)
  const [steps,      setSteps]      = useState({})
  const [running,    setRunning]    = useState(false)
  const [phase,      setPhase]      = useState("") // "base" | "dist"
  const [logs,       setLogs]       = useState([])
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState("")

  useEffect(() => {
    getBaseStatus().then(r => setBaseStatus(r?.data ?? r)).catch(() => {})
    getHoldRules().then(setHoldRules).catch(() => {})
  }, [])

  const log = (msg) => setLogs(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`])

  const setStep = (n, s) => setSteps(p => ({ ...p, [n]: s }))

  const handleRun = async () => {
    setRunning(true)
    setError("")
    setResult(null)
    setLogs([])
    setSteps({})

    try {
      // ── Build Base (steps 1-7) ──────────────────────────────────────────
      setPhase("base")
      log("Building base dataset…")
      ;[1,2,3,4].forEach(n => setStep(n, "running"))

      const baseParams = {
        req_source:   reqSource,
        biz_segment:  bizSegment,
        sort_mode:    sortMode,
        min_qty:      minQty,
      }
      const baseRes = await buildBase(baseParams)
      if (!baseRes?.success) throw new Error(baseRes?.message || "Build base failed")

      ;[1,2,3,4].forEach(n => setStep(n, "done"))
      ;[5,6,7].forEach(n => setStep(n, "done"))
      log(`✓ Base built — ${baseRes.data?.rows?.toLocaleString()} rows`)

      // Update base status
      getBaseStatus().then(r => setBaseStatus(r?.data ?? r)).catch(() => {})

      // ── Distribute (steps 8-11) ──────────────────────────────────────────
      setPhase("dist")
      setStep(8, "running")
      log("Running distribution engine…")

      const distRes = await distribute({ min_qty: minQty, hold_rules: holdRules })
      if (!distRes?.success) throw new Error(distRes?.message || "Distribution failed")

      setStep(8, "done")
      ;[9,10,11].forEach(n => setStep(n, "done"))

      const d = distRes.data
      log(`✓ Done — ${d?.total_allocated?.toLocaleString()} units allocated to ${d?.stores_covered} stores`)
      setResult(d)
      onRunComplete?.()

    } catch (e) {
      setError(e.message || "Unknown error")
      log(`✗ Error: ${e.message}`)
      // Mark current running step as error
      setSteps(p => {
        const n = { ...p }
        Object.keys(n).forEach(k => { if (n[k] === "running") n[k] = "error" })
        return n
      })
    } finally {
      setRunning(false)
      setPhase("")
    }
  }

  const handleSaveRules = async () => {
    await saveHoldRules(holdRules).catch(() => {})
    setRulesSaved(true)
    setTimeout(() => setRulesSaved(false), 2000)
  }

  const addRule = () => setHoldRules(r => [...r, { field: "division", op: "==", value: "" }])
  const updateRule = (i, r) => setHoldRules(rs => rs.map((x, j) => j === i ? r : x))
  const deleteRule = (i) => setHoldRules(rs => rs.filter((_, j) => j !== i))

  const baseReady = baseStatus?.ready

  return (
    <div className="space-y-5">
      {/* Config */}
      <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-4">
        <p className="text-sm font-semibold text-[#e2e8f0]">Run Configuration</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[#6b7280] mb-2">REQ Source</p>
            <PillGroup options={REQ_SOURCES} value={reqSource} onChange={setReqSource} />
          </div>
          <div>
            <p className="text-xs text-[#6b7280] mb-2">Business Segment</p>
            <PillGroup options={BIZ_SEGMENTS} value={bizSegment} onChange={setBizSegment} />
          </div>
          <div>
            <p className="text-xs text-[#6b7280] mb-2">Sort Mode</p>
            <PillGroup options={SORT_MODES} value={sortMode} onChange={setSortMode} />
          </div>
          <div>
            <p className="text-xs text-[#6b7280] mb-2">Min Qty</p>
            <input type="number" value={minQty} min={0}
              onChange={e => setMinQty(Number(e.target.value))}
              className="w-24 bg-[#061a06] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1.5" />
          </div>
        </div>
      </div>

      {/* Hold Rules */}
      <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-[#e2e8f0]">Hold Rules <span className="text-[11px] text-[#6b7280] font-normal ml-1">({holdRules.length})</span></p>
          <div className="flex gap-2">
            {rulesSaved && <span className="text-[11px] text-[#22c55e]">✓ Saved</span>}
            <button onClick={handleSaveRules}
              className="text-xs text-[#6b7280] hover:text-[#e2e8f0] border border-[#1e4d1e] px-2 py-1 rounded">
              Save Rules
            </button>
            <button onClick={addRule}
              className="text-xs bg-[#061a06] border border-[#1e4d1e] text-[#22c55e] px-2 py-1 rounded hover:border-[#22c55e]">
              + Add Rule
            </button>
          </div>
        </div>
        {holdRules.length === 0
          ? <p className="text-xs text-[#6b7280]">No hold rules — all barcodes will be distributed.</p>
          : <div className="space-y-2">
              {holdRules.map((r, i) => (
                <HoldRuleRow key={i} rule={r} onChange={(nr) => updateRule(i, nr)} onDelete={() => deleteRule(i)} />
              ))}
            </div>
        }
      </div>

      {/* Run button */}
      <div className="flex items-center gap-4">
        <button onClick={handleRun} disabled={running}
          className="bg-[#22c55e] text-[#061a06] font-bold text-sm px-6 py-2.5 rounded
            hover:bg-[#16a34a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {running
            ? phase === "base" ? "⟳ Building Base…" : "⟳ Distributing…"
            : baseReady ? "▶ Rebuild + Run" : "▶ Build + Run"
          }
        </button>
        {baseReady && !running && (
          <span className="text-[11px] text-[#22c55e]">
            ✓ Base cached — {baseStatus.rows?.toLocaleString?.()} rows
          </span>
        )}
      </div>

      {/* Stepper */}
      {(running || Object.keys(steps).length > 0) && (
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-4">
          <StepperBar steps={steps} />

          {/* Log */}
          <div className="bg-black/40 border border-[#1e4d1e] rounded font-mono text-[11px] text-[#86efac] h-32 overflow-y-auto p-2 space-y-0.5">
            {logs.length === 0
              ? <span className="text-[#6b7280]">Log will appear here…</span>
              : logs.map((l, i) => <div key={i}>{l}</div>)
            }
          </div>

          {error && (
            <div className="bg-red-950 border border-red-700 rounded px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {[
                { label: "Allocated",      value: result.total_allocated?.toLocaleString() },
                { label: "Stores",         value: result.stores_covered?.toLocaleString() },
                { label: "Alloc %",        value: `${result.alloc_pct?.toFixed(1)}%` },
                { label: "Balance Stock",  value: result.total_balance?.toLocaleString() },
              ].map(k => (
                <div key={k.label} className="bg-[#061a06] border border-[#1e4d1e] rounded px-3 py-2">
                  <p className="text-[10px] text-[#6b7280]">{k.label}</p>
                  <p className="text-base font-bold text-[#22c55e]">{k.value ?? "—"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
