import { useState, useEffect, useCallback } from "react"
import {
  getSummary, getFilterOptions, getRows, getChartDivision, getChartReason, getExportUrl
} from "./api"
import KpiCard from "./components/KpiCard"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts"

const PAGE_SIZE = 100
const GREEN = "#22c55e"
const COLS = [
  { field: "store_code",     header: "Store",    width: 90  },
  { field: "store_name",     header: "Name",     width: 160 },
  { field: "barcode",        header: "Barcode",  width: 110 },
  { field: "item_name",      header: "Item",     width: 180 },
  { field: "division",       header: "Division", width: 90  },
  { field: "final_allocate", header: "Alloc",    width: 70  },
  { field: "req_qty",        header: "REQ",      width: 70  },
  { field: "stock",          header: "Stock",    width: 70  },
  { field: "reason",         header: "Reason",   width: 130 },
]

export default function Dashboard() {
  const [summary, setSummary]   = useState(null)
  const [filters, setFilters]   = useState(null)
  const [rows, setRows]         = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(false)
  const [chartDiv, setChartDiv] = useState([])
  const [chartReason, setChartReason] = useState([])
  const [sel, setSel] = useState({ division: "", reason: "", min_alloc: "" })

  useEffect(() => {
    getSummary().then(setSummary).catch(() => {})
    getFilterOptions().then(setFilters).catch(() => {})
    getChartDivision().then(d => setChartDiv(d || [])).catch(() => {})
    getChartReason().then(d => setChartReason(d || [])).catch(() => {})
  }, [])

  const fetchRows = useCallback(async (p = 1, s = sel) => {
    setLoading(true)
    const params = { page: p, page_size: PAGE_SIZE, mode: "allocated" }
    if (s.division)  params.division  = s.division
    if (s.reason)    params.reason    = s.reason
    if (s.min_alloc) params.min_alloc = s.min_alloc
    try {
      const res = await getRows(params)
      setRows(res.rows || [])
      setTotal(res.total || 0)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }, [sel])

  useEffect(() => { fetchRows(1, sel) }, [])

  const handleFilter = () => fetchRows(1, sel)

  const kpis = summary ? [
    { label: "Total Allocated", value: (summary.total_allocated ?? 0).toLocaleString() },
    { label: "Stores Covered",  value: (summary.stores_covered ?? 0).toLocaleString() },
    { label: "Items Covered",   value: (summary.items_covered ?? 0).toLocaleString() },
    { label: "Avg Fill %",      value: `${(summary.avg_fill_pct ?? 0).toFixed(1)}%` },
    { label: "Shortfall",       value: (summary.total_shortfall ?? 0).toLocaleString(), positive: false },
  ] : []

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(k => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-3">
          <p className="text-xs text-[#6b7280] mb-2">Allocation by Division</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartDiv} margin={{ top: 0, right: 8, left: 0, bottom: 40 }}>
              <XAxis dataKey="division" tick={{ fill: "#6b7280", fontSize: 10 }}
                angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "#061a06", border: "1px solid #1e4d1e", color: "#e2e8f0", fontSize: 11 }} />
              <Bar dataKey="total_allocated" radius={[3,3,0,0]}>
                {chartDiv.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? GREEN : "#16a34a"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-3">
          <p className="text-xs text-[#6b7280] mb-2">Top Hold Reasons</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartReason.slice(0, 10)} layout="vertical"
              margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
              <YAxis dataKey="reason" type="category" width={130}
                tick={{ fill: "#6b7280", fontSize: 9 }} />
              <Tooltip contentStyle={{ background: "#061a06", border: "1px solid #1e4d1e", color: "#e2e8f0", fontSize: 11 }} />
              <Bar dataKey="count" fill="#f59e0b" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-end">
        {filters?.divisions && (
          <select value={sel.division} onChange={e => setSel(s => ({...s, division: e.target.value}))}
            className="bg-[#0d2b0d] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1.5">
            <option value="">All Divisions</option>
            {filters.divisions.map(d => <option key={d}>{d}</option>)}
          </select>
        )}
        {filters?.reasons && (
          <select value={sel.reason} onChange={e => setSel(s => ({...s, reason: e.target.value}))}
            className="bg-[#0d2b0d] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1.5">
            <option value="">All Reasons</option>
            {filters.reasons.map(r => <option key={r}>{r}</option>)}
          </select>
        )}
        <input type="number" placeholder="Min alloc" value={sel.min_alloc}
          onChange={e => setSel(s => ({...s, min_alloc: e.target.value}))}
          className="bg-[#0d2b0d] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1.5 w-24" />
        <button onClick={handleFilter}
          className="bg-[#22c55e] text-[#061a06] text-xs font-semibold px-3 py-1.5 rounded hover:bg-[#16a34a]">
          Apply
        </button>
        <div className="flex gap-2 ml-auto">
          {["division","allocated","full"].map(m => (
            <a key={m} href={getExportUrl(m)} target="_blank" rel="noopener noreferrer"
              className="bg-[#0d2b0d] border border-[#1e4d1e] text-[#22c55e] text-xs px-2 py-1.5 rounded hover:border-[#22c55e]">
              ↓ {m}
            </a>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e4d1e]">
                {COLS.map(c => (
                  <th key={c.field} style={{ width: c.width, minWidth: c.width }}
                    className="text-left px-2 py-2 text-[#6b7280] font-medium">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length} className="text-center text-[#6b7280] py-8">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="text-center text-[#6b7280] py-8">No results</td></tr>
              ) : rows.map((row, i) => (
                <tr key={i} className={`border-b border-[#0d2b0d] ${i % 2 === 0 ? "bg-[#061a06]" : "bg-[#0a200a]"}`}>
                  {COLS.map(c => (
                    <td key={c.field} className="px-2 py-1.5 text-[#e2e8f0] truncate"
                      style={{ maxWidth: c.width }}>
                      {row[c.field] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[#1e4d1e]">
          <span className="text-[11px] text-[#6b7280]">{total.toLocaleString()} rows</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => fetchRows(page - 1, sel)}
              className="px-2 py-1 text-xs text-[#22c55e] disabled:opacity-30 hover:bg-[#1e4d1e] rounded">
              ‹ Prev
            </button>
            <span className="px-2 py-1 text-xs text-[#6b7280]">{page}/{totalPages || 1}</span>
            <button disabled={page >= totalPages} onClick={() => fetchRows(page + 1, sel)}
              className="px-2 py-1 text-xs text-[#22c55e] disabled:opacity-30 hover:bg-[#1e4d1e] rounded">
              Next ›
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
