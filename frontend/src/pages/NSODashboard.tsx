/**
 * NSO Dashboard — New Store Opening performance tracker.
 * Two views: Store View (Excel-style store summary) and Article Detail.
 */
import { useEffect, useRef, useState } from 'react'
import http from '@/api/http'

async function apiFetch<T>(url: string, params?: Record<string, string>): Promise<T> {
  const res = await http.get<{ success: boolean; data: T; message: string | null }>(url, { params })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface NSOFilters {
  attribute1: string[]; store_status: string[]; division: string[]
  cluster_type: string[]; region_type: string[]; store_tag: string[]
}
interface NSOData { rows: Record<string, unknown>[]; columns: string[]; count: number; total_cached: number; elapsed_ms: number; served_from: string }

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

// ── PCT / NUM columns (lowercase — Parquet cache lowercases column names) ──────
const PCT_COLS = new Set(['achv_per', 'lm_achv_per'])
const NUM_COLS = new Set([
  'area', 'store_area', 'art_str',
  'proj_q', 'proj_q_1', 'proj_q_2', 'proj_q_3', 'proj_q_4', 'proj_q_5', 'proj_q_6',
  'proj_v', 'proj_v_1', 'proj_v_2', 'proj_v_3', 'proj_v_4', 'proj_v_5', 'proj_v_6',
  'proj_cv', 'proj_cv_1', 'proj_cv_2', 'proj_cv_3', 'proj_cv_4', 'proj_cv_5', 'proj_cv_6',
  'pbs_q', 'pbs_v', 'pbs_cv',
  'ttl_stk_q', 'stk_q', 'adj_stk_q', 'in_transit_q', 'pack_pend_q',
  'to_q', 'lm_sl_q', 'mtd_sl_q',
  'ttl_stk_v', 'stk_v', 'adj_stk_v', 'in_transit_v', 'pack_pend_v',
  'to_v', 'lm_sl_val', 'mtd_sl_v',
  'tgt_v', 'sl_v', 'lm_tgt_v', 'lm_sl_v',
  'req_q', 'req_v',
])

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

// ── Store Summary Types ────────────────────────────────────────────────────────
interface StoreRow {
  store_name: string
  store_f_name?: string
  store_area?: number | string
  store_status?: string
  cluster_type?: string
  region_type?: string
  tentetive_date?: string
  opening_date?: string
  pbs_q?: number; ttl_stk_q?: number
  pbs_v?: number; ttl_stk_v?: number
  to_v?: number; mtd_sl_v?: number
  lm_sl_val?: number; lm_tgt_v?: number
  stk_v?: number; pack_pend_v?: number
  opert_days?: number; sl_avg_d?: number
  ach_pct?: number; ach_lm_pct?: number; fill_rate?: number
  [key: string]: unknown
}
interface StoreSummaryData { stores: StoreRow[]; count: number; elapsed_ms: number }

// ── Store Summary Component ────────────────────────────────────────────────────
const STORE_COLS: { key: string; label: string; type: 'text' | 'num' | 'lakh' | 'pct' | 'date' | 'qty' }[] = [
  { key: 'tentetive_date', label: 'TENT DATE',    type: 'date' },
  { key: 'store_area',     label: 'AREA',         type: 'qty'  },
  { key: 'store_f_name',   label: 'STORE NAME',   type: 'text' },
  { key: 'store_name',     label: 'CODE',         type: 'text' },
  { key: 'pbs_q',          label: 'PBS QTY',      type: 'qty'  },
  { key: 'ttl_stk_q',      label: 'STK QTY',      type: 'qty'  },
  { key: 'pbs_v',          label: 'PBS VAL(L)',    type: 'lakh' },
  { key: 'ttl_stk_v',      label: 'TTL STK(L)',   type: 'lakh' },
  { key: 'to_v',           label: 'TO VAL(L)',    type: 'lakh' },
  { key: 'mtd_sl_v',       label: 'MTD SALE(L)',  type: 'lakh' },
  { key: 'ach_lm_pct',     label: 'ACH LM%',     type: 'pct'  },
  { key: 'ach_pct',        label: 'ACH%',         type: 'pct'  },
  { key: 'fill_rate',      label: 'FILL RATE%',   type: 'pct'  },
  { key: 'stk_v',          label: 'STK VAL(L)',   type: 'lakh' },
  { key: 'pack_pend_v',    label: 'PACK PEND(L)', type: 'lakh' },
  { key: 'opert_days',     label: 'OPER DAYS',    type: 'qty'  },
  { key: 'sl_avg_d',       label: 'SL AVG/D(L)',  type: 'lakh' },
]

function fmtLakh(v: unknown): string {
  const n = Number(v)
  if (isNaN(n) || v == null) return '—'
  return n.toFixed(2)  // values already normalized to Lakhs by backend
}
function fmtQty(v: unknown): string {
  const n = Number(v)
  if (isNaN(n) || v == null) return '—'
  return Math.round(n).toLocaleString('en-IN')
}
function fmtDate(v: unknown): string {
  if (!v) return '—'
  const s = String(v)
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

function StoreSummary({
  selStatus, selCluster, selRegion, selTag,
}: {
  selStatus: string; selCluster: string; selRegion: string; selTag: string
}) {
  const [data, setData] = useState<StoreSummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true); setError(null)
    const params: Record<string, string> = {}
    if (selStatus)  params.store_status = selStatus
    if (selCluster) params.cluster_type = selCluster
    if (selRegion)  params.region_type  = selRegion
    if (selTag)     params.store_tag    = selTag
    apiFetch<StoreSummaryData>('/nso/store-summary', params)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data) load() }, [selStatus, selCluster, selRegion, selTag]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportCSV() {
    if (!data?.stores.length) return
    const header = STORE_COLS.map(c => c.label).join(',')
    const body = data.stores.map(r =>
      STORE_COLS.map(c => {
        const v = r[c.key]
        if (c.type === 'lakh') return Number(v).toFixed(2)  // already in Lakhs
        if (c.type === 'pct')  return v == null ? '' : Number(v).toFixed(2)
        if (c.type === 'qty')  return v == null ? '' : String(Math.round(Number(v)))
        if (c.type === 'date') return fmtDate(v)
        return v == null ? '' : String(v)
      }).join(',')
    ).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nso_store_summary_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const stores = data?.stores ?? []
  const active   = stores.filter(r => String(r.store_status ?? '').toUpperCase() === 'ACTIVE')
  const upcoming = stores.filter(r => String(r.store_status ?? '').toUpperCase().includes('UPCOMING'))

  function StoreTable({ rows, title }: { rows: StoreRow[]; title: string }) {
    const color = title.startsWith('Active') ? C.green : '#7dd3fc'
    return (
      <>
        <tr>
          <td colSpan={STORE_COLS.length} style={{
            background: title.startsWith('Active') ? '#052e16' : '#0c1a2e',
            color, fontWeight: 700, fontSize: 11, padding: '6px 10px',
            letterSpacing: 0.5,
          }}>
            {title} ({rows.length})
          </td>
        </tr>
        {rows.map((row, i) => (
          <tr key={row.store_name + i} style={{ background: i % 2 === 0 ? C.surf2 : C.surf1 }}>
            {STORE_COLS.map(col => {
              const v = row[col.key]
              if (col.type === 'pct') {
                const n = Number(v)
                return (
                  <td key={col.key} style={{ ...S.tdPct, color: pctColor(isNaN(n) ? null : n) }}>
                    {v == null ? '—' : n.toFixed(1) + '%'}
                  </td>
                )
              }
              if (col.type === 'lakh') return <td key={col.key} style={S.tdNum}>{fmtLakh(v)}</td>
              if (col.type === 'qty')  return <td key={col.key} style={S.tdNum}>{fmtQty(v)}</td>
              if (col.type === 'date') return <td key={col.key} style={{ ...S.td, color: C.text2 }}>{fmtDate(v)}</td>
              if (col.key === 'store_name') return <td key={col.key} style={{ ...S.td, fontWeight: 700, color: C.blue }}>{String(v ?? '—')}</td>
              if (col.key === 'store_f_name') return <td key={col.key} style={{ ...S.td, minWidth: 160 }}>{String(v ?? '—')}</td>
              return <td key={col.key} style={S.td}>{v == null ? '—' : String(v)}</td>
            })}
          </tr>
        ))}
      </>
    )
  }

  // KPIs from store summary
  const totalMtd = stores.reduce((s, r) => s + (Number(r.mtd_sl_v) || 0), 0)
  const totalPbs = stores.reduce((s, r) => s + (Number(r.pbs_v) || 0), 0)
  const totalStk = stores.reduce((s, r) => s + (Number(r.ttl_stk_v) || 0), 0)
  // STR = stk_v / (mtd_sl_v / opert_days) — days of stock cover at current daily sales rate
  const totalStkV = stores.reduce((s, r) => s + (Number(r.stk_v) || 0), 0)
  const wtdDailySale = stores.reduce((s, r) => {
    const days = Number(r.opert_days) || 0
    const mtd = Number(r.mtd_sl_v) || 0
    return s + (days > 0 ? mtd : 0)
  }, 0)
  const wtdDays = stores.reduce((s, r) => {
    const days = Number(r.opert_days) || 0
    const mtd = Number(r.mtd_sl_v) || 0
    return s + (days > 0 ? days : 0)
  }, 0)
  const avgDailySale = wtdDays > 0 ? wtdDailySale / wtdDays : 0
  const totalSTR = avgDailySale > 0 ? totalStkV / avgDailySale : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 }}>
      {/* Store KPI row */}
      {data && (
        <div style={{ ...S.card, flexShrink: 0 }}>
          <div style={S.kpiRow}>
            {[
              { label: 'Total Stores', val: stores.length, color: C.blue, suffix: '' },
              { label: 'Active', val: active.length, color: C.green, suffix: '' },
              { label: 'Upcoming', val: upcoming.length, color: '#7dd3fc', suffix: '' },
              { label: 'MTD Sale(L)', val: totalMtd.toFixed(2), color: C.green, suffix: '' },
              { label: 'PBS Val(L)', val: totalPbs.toFixed(2), color: C.yellow, suffix: '' },
              { label: 'Stock Val(L)', val: totalStk.toFixed(2), color: C.yellow, suffix: '' },
              { label: 'STR (days)', val: totalSTR.toFixed(1), color: '#c084fc', suffix: '' },
            ].map(k => (
              <div key={k.label} style={S.kpi}>
                <div style={{ ...S.kpiVal, color: k.color }}>{k.val}</div>
                <div style={S.kpiLabel}>{k.label}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button style={S.btnSm} onClick={() => load()} disabled={loading}>
                {loading ? '⋯' : '↻ Reload'}
              </button>
              {data && <button style={S.btnSm} onClick={exportCSV}>⬇ CSV</button>}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...S.card, background: '#450a0a', border: `1px solid ${C.red}` }}>
          <div style={{ padding: '12px 14px', color: C.red, fontSize: 13 }}>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {loading && <div style={{ ...S.card, ...S.empty }}>Loading store summary…</div>}

      {!loading && data && (
        <div style={{ ...S.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...S.tblWrap }}>
            <table style={{ ...S.tbl, minWidth: 1600 }}>
              <thead>
                <tr>
                  {STORE_COLS.map(col => (
                    <th key={col.key} style={col.type === 'text' || col.type === 'date' ? S.th : S.thNum}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.length > 0 && <StoreTable rows={active} title="Active Stores" />}
                {upcoming.length > 0 && <StoreTable rows={upcoming} title="Upcoming Stores" />}
                {stores.length === 0 && (
                  <tr><td colSpan={STORE_COLS.length} style={S.empty}>No stores found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '6px 14px', borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.text3 }}>
            {stores.length} stores · {data.elapsed_ms} ms · V_NSO article aggregation · MTD sale = NSO-plan articles only
          </div>
        </div>
      )}
    </div>
  )
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
  const stores = new Set(rows.map(r => r['store_name'] ?? r['STORE_NAME']))
  const status = (r: Record<string, unknown>) => String(r['store_status'] ?? r['STORE_STATUS'] ?? '').toUpperCase()
  const active = rows.filter(r => status(r) === 'ACTIVE')
  const upcoming = rows.filter(r => status(r).includes('UPCOMING'))
  return {
    total: stores.size,
    active: new Set(active.map(r => r['store_name'] ?? r['STORE_NAME'])).size,
    upcoming: new Set(upcoming.map(r => r['store_name'] ?? r['STORE_NAME'])).size,
    pbsQ: num('pbs_q'), ttlStkQ: num('ttl_stk_q'),
    pbsV: num('pbs_v'), ttlStkV: num('ttl_stk_v'),
    toV: num('to_v'), mtdSlv: num('mtd_sl_v'),
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

  const [filters, setFilters] = useState<NSOFilters>({
    attribute1: [], store_status: [], division: [], cluster_type: [], region_type: [], store_tag: []
  })
  const [selAttr, setSelAttr]       = useState('')
  const [selStatus, setSelStatus]   = useState('')
  const [selDiv, setSelDiv]         = useState('')
  const [selCluster, setSelCluster] = useState('')
  const [selRegion, setSelRegion]   = useState('')
  const [selTag, setSelTag]         = useState('')
  const [search, setSearch]         = useState('')

  const [tab, setTab]       = useState<'store' | 'article'>('store')
  const [data, setData]     = useState<NSOData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Load filter options once
  useEffect(() => {
    apiFetch<NSOFilters>('/nso/filters').then(setFilters).catch(e => setError(String(e)))
  }, [])

  function load() {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { limit: '50000' }
    if (selAttr)    params.attribute1   = selAttr
    if (selStatus)  params.store_status = selStatus
    if (selDiv)     params.division     = selDiv
    if (selCluster) params.cluster_type = selCluster
    if (selRegion)  params.region_type  = selRegion
    if (selTag)     params.store_tag    = selTag
    apiFetch<NSOData>('/nso/data', params)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  // Auto-load on mount (will serve from cache if available)
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reload when any server-side filter changes (instant from Parquet)
  useEffect(() => {
    if (data) load()
  }, [selAttr, selStatus, selDiv, selCluster, selRegion, selTag]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered rows (client-side text search)
  const rows = data?.rows ?? []
  const cols = data?.columns ?? []

  const visible = search.trim()
    ? rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : rows

  const totalPages = Math.ceil(visible.length / PAGE_SIZE)
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset to page 1 when filter/search changes
  useEffect(() => { setPage(1) }, [visible.length])

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
            <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
              New Store Opening — performance tracker · data from Master Data parquet
            </div>
          </div>
          <div style={S.filterRow}>
            {/* Tab switcher */}
            {(['store', 'article'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                ...S.btnSm,
                background: tab === t ? C.blue : 'transparent',
                color: tab === t ? '#fff' : C.text2,
                fontWeight: tab === t ? 700 : 400,
              }}>
                {t === 'store' ? '📊 Store View' : '📋 Article Detail'}
              </button>
            ))}
            <div style={{ width: 1, height: 20, background: C.border }} />
            <select style={S.select} value={selStatus} onChange={e => setSelStatus(e.target.value)}>
              <option value="">All Status</option>
              {filters.store_status.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select style={S.select} value={selCluster} onChange={e => setSelCluster(e.target.value)}>
              <option value="">All Zones</option>
              {filters.cluster_type.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <select style={S.select} value={selRegion} onChange={e => setSelRegion(e.target.value)}>
              <option value="">All Regions</option>
              {filters.region_type.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            {filters.store_tag.length > 0 && (
              <select style={S.select} value={selTag} onChange={e => setSelTag(e.target.value)}>
                <option value="">All Tags</option>
                {filters.store_tag.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {tab === 'article' && (
              <>
                <select style={S.select} value={selAttr} onChange={e => setSelAttr(e.target.value)}>
                  <option value="">All Campaigns</option>
                  {filters.attribute1.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select style={S.select} value={selDiv} onChange={e => setSelDiv(e.target.value)}>
                  <option value="">All Divisions</option>
                  {filters.division.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <button style={S.btn} onClick={() => load()} disabled={loading}>
                  {loading ? '⋯ Loading…' : '⚡ Load'}
                </button>
                {data && <button style={S.btnSm} onClick={exportCSV}>⬇ CSV</button>}
              </>
            )}
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
              {visible.length.toLocaleString()} / {rows.length.toLocaleString()} rows
              {data.total_cached ? ` (${data.total_cached.toLocaleString()} cached)` : ''}
              {` · ${data.elapsed_ms} ms`}
              {data.served_from === 'oracle' ? ' · 🔴 fetched live from Oracle' : ' · ⚡ from Parquet cache'}
            </span>
          </div>
        )}
      </div>

      {/* ── Store View Tab ── */}
      {tab === 'store' && (
        <StoreSummary
          selStatus={selStatus}
          selCluster={selCluster}
          selRegion={selRegion}
          selTag={selTag}
        />
      )}

      {/* ── Article Detail Tab ── */}
      {tab === 'article' && (
        <>
          {/* KPI strip */}
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

          {error && (
            <div style={{ ...S.card, background: '#450a0a', border: `1px solid ${C.red}` }}>
              <div style={{ padding: '12px 14px', color: C.red, fontSize: 13 }}>
                <strong>Error:</strong> {error}
              </div>
            </div>
          )}

          {/* Search */}
          {data && (
            <div style={{ ...S.card, padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <input
                ref={searchRef}
                placeholder="Search store name, status…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...S.select, flex: 1, maxWidth: 300 }}
              />
              <span style={{ fontSize: 11, color: C.text3 }}>
                {visible.length.toLocaleString()} / {rows.length.toLocaleString()} rows
                {data.total_cached ? ` (${data.total_cached.toLocaleString()} cached)` : ''}
                {` · ${data.elapsed_ms} ms`}
              </span>
            </div>
          )}

          {loading && <div style={{ ...S.card, ...S.empty }}>Loading V_NSO data…</div>}

          {!loading && data && cols.length > 0 && (
            <div style={{ ...S.card, ...(isMobile ? {} : { flex: 1, minHeight: 0 }), display: 'flex', flexDirection: 'column' }}>
              <div style={{ ...S.tblWrap, ...(isMobile ? { overflowY: 'visible', flex: 'unset', minHeight: 'unset' } : {}) }}>
                <table style={S.tbl}>
                  <thead>
                    <tr>
                      {cols.map(c => (
                        <th key={c} style={isPct(c) || isNum(c) ? S.thNum : S.th}>{c.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.length === 0 && (
                      <tr><td colSpan={cols.length} style={S.empty}>No rows match filters.</td></tr>
                    )}
                    {paged.map((row, i) => {
                      const status = String(row['store_status'] ?? row['STORE_STATUS'] ?? '')
                      const rowBg = i % 2 === 0 ? statusColor(status) : 'transparent'
                      return (
                        <tr key={i} style={{ background: rowBg }}>
                          {cols.map(c => {
                            const val = row[c]
                            if (c === 'store_status' || c === 'STORE_STATUS') {
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
              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 14px', borderTop: `1px solid ${C.border}`, justifyContent: 'center', fontSize: 12, color: C.text2 }}>
                  <button style={S.btnSm} disabled={page === 1} onClick={() => setPage(1)}>«</button>
                  <button style={S.btnSm} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                  <span>{page} / {totalPages} &nbsp;({visible.length.toLocaleString()} rows)</span>
                  <button style={S.btnSm} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
                  <button style={S.btnSm} disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
                </div>
              )}
            </div>
          )}

          {!loading && !data && !error && (
            <div style={{ ...S.card, ...S.empty }}>
              Select filters above, then click <strong>Load</strong>.
            </div>
          )}
        </>
      )}
    </div>
  )
}
