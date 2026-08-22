/**
 * NSO Dashboard — New Store Opening performance tracker.
 * Reads from MISRETAIL.V_NSO via /api/nso/data with optional filters.
 * Columns are discovered dynamically from the API response.
 */
import { useEffect, useRef, useState } from 'react'
import http from '@/api/http'

async function apiFetch<T>(url: string, params?: Record<string, string>): Promise<T> {
  const res = await http.get<{ success: boolean; data: T; message: string | null }>(url, { params })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface NSOFilters { attribute1: string[]; store_status: string[]; division: string[] }
interface NSOData { rows: Record<string, unknown>[]; columns: string[]; count: number; elapsed_ms: number }

// ── Colour helpers ─────────────────────────────────────────────────────────────
/** Colour a percentage cell like the Excel: red <80, yellow 80-99, green ≥100 */
function pctColor(val: number | null): string {
  if (val === null || isNaN(val)) return '#cbd5e1'
  if (val >= 100) return '#4ade80'
  if (val >= 80)  return '#facc15'
  return '#f87171'
}

/** Row accent by store status */
function statusColor(status: string | null): string {
  if (!status) return 'transparent'
  const s = String(status).toUpperCase()
  if (s === 'ACTIVE')   return '#14532d22'
  if (s.includes('UPCOMING')) return '#1e3a5f44'
  return 'transparent'
}

// ── PCT columns — cells coloured by value ─────────────────────────────────────
const PCT_COLS = new Set(['ACH_LM_%', 'ACH_%', 'FILL_RATE', 'FILL RATE', 'ACH%', 'ACH LM%', 'GM'])
const NUM_COLS = new Set(['PBS_Q', 'TTL_STK_Q', 'PBS_V', 'TTL_STK_V', 'TO_V', 'MTD_SLV',
  'STK_V', 'PACK_PEND_V', 'APPS', 'SLV_AVG_D', 'SLV_AVG/D', 'OPERT_DAYS', 'STORE_AREA'])

function fmtNum(val: unknown): string {
  const n = Number(val)
  if (isNaN(n)) return val == null ? '—' : String(val)
  if (Math.abs(n) >= 1_00_000) return (n / 1_00_000).toFixed(2) + ' L'
  if (Number.isInteger(n)) return n.toLocaleString('en-IN')
  return n.toFixed(2)
}

function fmtPct(val: unknown): string {
  const n = Number(val)
  if (isNaN(n)) return val == null ? '—' : String(val)
  return n.toFixed(2) + '%'
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a', surf1: '#1e293b', surf2: '#0f172a',
  border: '#334155', border2: '#1e293b',
  text: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  blue: '#38bdf8', green: '#4ade80', yellow: '#facc15', red: '#f87171',
}
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 100px)', minHeight: 0 },
  card: { background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' },
  cardHead: { padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 13, fontWeight: 600, color: C.text },
  filterRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  select: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: '5px 10px' },
  btn: { background: C.blue, border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnSm: { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.text2, fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  tblWrap: { overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 },
  tbl: { borderCollapse: 'collapse' as const, width: '100%', minWidth: 1400, fontSize: 11 },
  th: {
    background: C.bg, color: C.text3, fontWeight: 600,
    padding: '6px 10px', textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0,
    borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: 0.4,
  },
  thNum: {
    background: C.bg, color: C.text3, fontWeight: 600,
    padding: '6px 10px', textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0,
    borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: 0.4,
  },
  td: { padding: '6px 10px', color: C.text, borderBottom: `1px solid ${C.border2}`, whiteSpace: 'nowrap' as const, fontSize: 11 },
  tdNum: { padding: '6px 10px', textAlign: 'right' as const, borderBottom: `1px solid ${C.border2}`, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const, fontSize: 11, color: '#7dd3fc' },
  tdPct: { padding: '6px 10px', textAlign: 'right' as const, borderBottom: `1px solid ${C.border2}`, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const, fontSize: 11, fontWeight: 700 },
  kpiRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, padding: '10px 14px' },
  kpi: { background: C.bg, borderRadius: 6, padding: '8px 12px', minWidth: 110, border: `1px solid ${C.border}` },
  kpiVal: { fontSize: 18, fontWeight: 700, color: C.blue, fontVariantNumeric: 'tabular-nums' as const },
  kpiLabel: { fontSize: 10, color: C.text3, marginTop: 2 },
  empty: { padding: 40, textAlign: 'center' as const, color: C.text3, fontSize: 13 },
  badge: { display: 'inline-block', borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '1px 7px' },
}

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

// ── Derived KPIs ───────────────────────────────────────────────────────────────
function deriveKPIs(rows: Record<string, unknown>[]) {
  if (!rows.length) return null
  const num = (col: string) => rows.reduce((s, r) => s + (Number(r[col]) || 0), 0)
  const active = rows.filter(r => String(r['STORE_STATUS'] ?? '').toUpperCase() === 'ACTIVE').length
  const upcoming = rows.filter(r => String(r['STORE_STATUS'] ?? '').toUpperCase().includes('UPCOMING')).length
  return {
    total: rows.length, active, upcoming,
    pbsQ: num('PBS_Q'), ttlStkQ: num('TTL_STK_Q'),
    pbsV: num('PBS_V'), ttlStkV: num('TTL_STK_V'),
    toV: num('TO_V'), mtdSlv: num('MTD_SLV'),
  }
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = String(status).toUpperCase()
  const bg = s === 'ACTIVE' ? '#14532d' : '#1e3a5f'
  const color = s === 'ACTIVE' ? '#4ade80' : '#7dd3fc'
  const border = s === 'ACTIVE' ? '#16a34a' : '#3b82f6'
  return <span style={{ ...S.badge, background: bg, color, border: `1px solid ${border}` }}>{status}</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function NSODashboard() {
  const isMobile = useIsMobile()

  const [filters, setFilters] = useState<NSOFilters>({ attribute1: [], store_status: [], division: [] })
  const [selAttr, setSelAttr] = useState('')
  const [selStatus, setSelStatus] = useState('')
  const [selDiv, setSelDiv] = useState('')
  const [search, setSearch] = useState('')

  const [data, setData] = useState<NSOData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Load filter options once
  useEffect(() => {
    apiFetch<NSOFilters>('/nso/filters').then(setFilters).catch(e => setError(String(e)))
  }, [])

  function load() {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { limit: '2000' }
    if (selAttr)   params.attribute1    = selAttr
    if (selStatus) params.store_status  = selStatus
    if (selDiv)    params.division      = selDiv
    apiFetch<NSOData>('/nso/data', params)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  // Auto-load on mount
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered rows (client-side text search)
  const rows = data?.rows ?? []
  const cols = data?.columns ?? []

  const visible = search.trim()
    ? rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows

  const kpis = deriveKPIs(visible)

  // Column display helpers
  const isPct = (c: string) => PCT_COLS.has(c)
  const isNum = (c: string) => NUM_COLS.has(c) || (data?.rows[0] && typeof data.rows[0][c] === 'number' && !isPct(c))

  function exportCSV() {
    if (!visible.length) return
    const header = cols.join(',')
    const body = visible.map(r => cols.map(c => {
      const v = r[c]
      const s = v == null ? '' : String(v)
      return s.includes(',') ? `"${s}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nso_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div style={{ ...S.page, height: isMobile ? 'auto' : 'calc(100vh - 100px)' }}>

      {/* ── Header + filters ── */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>NSO Dashboard</div>
            <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>New Store Opening — performance tracker from V_NSO</div>
          </div>
          <div style={S.filterRow}>
            <select style={S.select} value={selAttr} onChange={e => setSelAttr(e.target.value)}>
              <option value="">All Campaigns</option>
              {filters.attribute1.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select style={S.select} value={selStatus} onChange={e => setSelStatus(e.target.value)}>
              <option value="">All Status</option>
              {filters.store_status.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select style={S.select} value={selDiv} onChange={e => setSelDiv(e.target.value)}>
              <option value="">All Divisions</option>
              {filters.division.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <button style={S.btn} onClick={load} disabled={loading}>
              {loading ? '⋯' : '🔍 Load'}
            </button>
            {data && <button style={S.btnSm} onClick={exportCSV}>⬇ CSV</button>}
          </div>
        </div>

        {/* Search */}
        {data && (
          <div style={{ padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={searchRef}
              placeholder="Search store name, status…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...S.select, flex: 1, maxWidth: 300 }}
            />
            <span style={{ fontSize: 11, color: C.text3 }}>
              {visible.length.toLocaleString()} / {rows.length.toLocaleString()} stores
              {data.elapsed_ms && ` · ${data.elapsed_ms} ms`}
            </span>
          </div>
        )}
      </div>

      {/* ── KPI strip ── */}
      {kpis && (
        <div style={{ ...S.card, flexShrink: 0 }}>
          <div style={S.kpiRow}>
            {[
              { label: 'Total Stores', val: kpis.total.toLocaleString(), color: C.blue },
              { label: 'Active', val: kpis.active.toLocaleString(), color: C.green },
              { label: 'Upcoming', val: kpis.upcoming.toLocaleString(), color: '#7dd3fc' },
              { label: 'PBS Qty', val: (kpis.pbsQ / 1000).toFixed(1) + 'K', color: C.blue },
              { label: 'Stock Qty', val: (kpis.ttlStkQ / 1000).toFixed(1) + 'K', color: C.blue },
              { label: 'PBS Value (L)', val: (kpis.pbsV / 100000).toFixed(2), color: C.yellow },
              { label: 'Stock Value (L)', val: (kpis.ttlStkV / 100000).toFixed(2), color: C.yellow },
              { label: 'Turnover (L)', val: (kpis.toV / 100000).toFixed(2), color: C.green },
              { label: 'MTD Sales (L)', val: (kpis.mtdSlv / 100000).toFixed(2), color: C.green },
            ].map(k => (
              <div key={k.label} style={S.kpi}>
                <div style={{ ...S.kpiVal, color: k.color }}>{k.val}</div>
                <div style={S.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ ...S.card, background: '#450a0a', border: `1px solid ${C.red}` }}>
          <div style={{ padding: '12px 14px', color: C.red, fontSize: 13 }}>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {loading && (
        <div style={{ ...S.card, ...S.empty }}>Loading V_NSO data…</div>
      )}

      {!loading && data && cols.length > 0 && (
        <div style={{ ...S.card, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={S.tblWrap}>
            <table style={S.tbl}>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c} style={isPct(c) || isNum(c) ? S.thNum : S.th}>{c.replace(/_/g, ' ')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={cols.length} style={S.empty}>No rows match filters.</td></tr>
                )}
                {visible.map((row, i) => {
                  const status = String(row['STORE_STATUS'] ?? '')
                  const rowBg = i % 2 === 0 ? statusColor(status) : 'transparent'
                  return (
                    <tr key={i} style={{ background: rowBg }}>
                      {cols.map(c => {
                        const val = row[c]
                        if (c === 'STORE_STATUS') {
                          return <td key={c} style={S.td}><StatusBadge status={String(val ?? '')} /></td>
                        }
                        if (isPct(c)) {
                          const n = Number(val)
                          return (
                            <td key={c} style={{ ...S.tdPct, color: pctColor(isNaN(n) ? null : n) }}>
                              {fmtPct(val)}
                            </td>
                          )
                        }
                        if (isNum(c)) {
                          return <td key={c} style={S.tdNum}>{fmtNum(val)}</td>
                        }
                        return <td key={c} style={S.td}>{val == null ? '—' : String(val)}</td>
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !data && !error && (
        <div style={{ ...S.card, ...S.empty }}>Select filters and click Load to view NSO data.</div>
      )}
    </div>
  )
}
