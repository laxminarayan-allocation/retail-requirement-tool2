import { useState, useEffect, useCallback } from "react"
import { getDivisionSummary, exportExcel, exportCsv } from "./api"

const BG = "#0d2b0d"
const G  = "#22c55e"

function KpiTile({ label, value, sub, color = G }) {
  return (
    <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg px-4 py-3">
      <p className="text-[11px] text-[#6b7280] mb-1">{label}</p>
      <p className="text-xl font-bold leading-none" style={{ color }}>{value ?? "—"}</p>
      {sub && <p className="text-[11px] text-[#6b7280] mt-1">{sub}</p>}
    </div>
  )
}

async function triggerDownload(fetchFn, params, filename) {
  try {
    const res = await fetchFn(params)
    if (!res.ok) { alert("Export failed: " + res.statusText); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert("Export error: " + e.message)
  }
}

export default function Results({ refreshKey }) {
  const [summary, setSummary]   = useState(null)
  const [divRows, setDivRows]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [exporting, setExporting] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getDivisionSummary()
      if (r?.rows_total !== undefined) {
        setSummary(r)
        setDivRows(r.divisions || [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  const handleExport = async (fmt, params = {}) => {
    setExporting(fmt)
    const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "")
    const ext = fmt === "xlsx" ? "xlsx" : "csv"
    await triggerDownload(
      fmt === "xlsx" ? exportExcel : exportCsv,
      params,
      `distribution_${ts}.${ext}`
    )
    setExporting("")
  }

  const totalAllocated = divRows.reduce((s, r) => s + (r.rows_nonzero || 0), 0)
  const totalRows      = summary?.rows_total || 0

  return (
    <div className="space-y-5">
      {/* Refresh + Export bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={load} disabled={loading}
          className="text-xs bg-[#0d2b0d] border border-[#1e4d1e] text-[#22c55e] px-3 py-1.5 rounded hover:border-[#22c55e] disabled:opacity-40">
          {loading ? "Loading…" : "⟳ Refresh"}
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={() => handleExport("xlsx")} disabled={!!exporting}
            className="text-xs bg-[#0d2b0d] border border-[#1e4d1e] text-[#22c55e] px-3 py-1.5 rounded hover:border-[#22c55e] disabled:opacity-40">
            {exporting === "xlsx" ? "Exporting…" : "↓ Excel"}
          </button>
          <button onClick={() => handleExport("csv")} disabled={!!exporting}
            className="text-xs bg-[#0d2b0d] border border-[#1e4d1e] text-[#22c55e] px-3 py-1.5 rounded hover:border-[#22c55e] disabled:opacity-40">
            {exporting === "csv" ? "Exporting…" : "↓ CSV"}
          </button>
          <button onClick={() => handleExport("csv", { exclude_zero: true })} disabled={!!exporting}
            className="text-xs bg-[#0d2b0d] border border-[#1e4d1e] text-[#6b7280] px-3 py-1.5 rounded hover:border-[#22c55e] hover:text-[#e2e8f0] disabled:opacity-40">
            {exporting === "csv_nz" ? "Exporting…" : "↓ CSV (non-zero)"}
          </button>
        </div>
      </div>

      {!summary && !loading && (
        <div className="text-center py-16 text-[#6b7280]">
          <p className="text-2xl mb-2">📊</p>
          <p>No results yet. Run distribution from the Run tab.</p>
        </div>
      )}

      {summary && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Total Rows"     value={totalRows.toLocaleString()} color="#e2e8f0" />
            <KpiTile label="Allocated Rows" value={totalAllocated.toLocaleString()} />
            <KpiTile label="Alloc %"        value={`${totalRows ? ((totalAllocated/totalRows)*100).toFixed(1) : 0}%`} />
            <KpiTile label="Divisions"      value={divRows.length} color="#f59e0b" />
          </div>

          {/* Division table */}
          <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e4d1e]">
                  {["Division", "Total Rows", "Allocated", "Alloc %", "GRC Rows", "WMS Rows", "Export"].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[#6b7280] font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {divRows.map((row, i) => {
                  const pct = row.rows_total ? ((row.rows_nonzero / row.rows_total) * 100).toFixed(1) : "0.0"
                  return (
                    <tr key={i} className={`border-b border-[#061a06] ${i % 2 === 0 ? "bg-[#061a06]" : "bg-[#0a200a]"}`}>
                      <td className="px-3 py-2 text-[#e2e8f0] font-medium">{row.division}</td>
                      <td className="px-3 py-2 text-[#6b7280]">{row.rows_total?.toLocaleString()}</td>
                      <td className="px-3 py-2 text-[#22c55e]">{row.rows_nonzero?.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#1e4d1e] rounded-full overflow-hidden">
                            <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="text-[#e2e8f0]">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[#6b7280]">{row.rows_grc != null ? row.rows_grc?.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-[#6b7280]">{row.rows_wms != null ? row.rows_wms?.toLocaleString() : "—"}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleExport("xlsx", { division: row.division })}
                          disabled={!!exporting}
                          className="text-[10px] text-[#22c55e] hover:underline disabled:opacity-40">
                          ↓ xlsx
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
