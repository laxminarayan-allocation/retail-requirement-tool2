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
interface NSOFilters {
  attribute1: string[]; store_status: string[]; division: string[]
  cluster_type: string[]; region_type: string[]; store_tag: string[]
}
interface NSOData { rows: Record<string, unknown>[]; columns: string[]; count: number; total_cached: number; elapsed_ms: number; served_from: string }
interface CacheStatus { ready: boolean; rows: number; store_master_ready: boolean; source: string }

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
  const [cacheInfo, setCacheInfo]   = useState<CacheStatus | null>(null)

  const [data, setData]     = useState<NSOData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Load filter options + cache status once
  useEffect(() => {
    apiFetch<NSOFilters>('/nso/filters').then(setFilters).catch(e => setError(String(e)))
    apiFetch<CacheStatus>('/nso/cache-status').then(setCacheInfo).catch(() => {})
  }, [])

  function load(forceRefresh = false) {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { limit: '50000' }
    if (selAttr)   params.attribute1    = selAttr
    if (selStatus) params.store_status  = selStatus
    if (selDiv)    params.division      = selDiv
    if (selCluster) params.cluster_type = selCluster
    if (selRegion)  params.region_type  = selRegion
    if (selTag)     params.store_tag    = selTag
    if (forceRefresh) params.force_refresh = 'true'
    apiFetch<NSOData>('/nso/data', params)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  // Auto-load on mount (will serve from cache if available)
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
            <div style={{ fontSize: 11, color: C.text3, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
              New Store Opening — performance tracker
              {cacheInfo && (
                <span style={{
                  background: cacheInfo.ready ? '#14532d' : '#1e3a5f',
                  color: cacheInfo.ready ? '#4ade80' : '#7dd3fc',
                  border: `1px solid ${cacheInfo.ready ? '#16a34a' : '#3b82f6'}`,
                  borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '1px 7px'
                }}>
                  {cacheInfo.ready
                    ? `⚡ Parquet Cache · ${(cacheInfo.rows / 1000).toFixed(0)}K rows`
                    : '🔴 No Cache — will fetch from Oracle'}
                </span>
              )}
              {cacheInfo?.store_master_ready && (
                <span style={{ background: '#1a2a10', color: '#86efac', border: '1px solid #16a34a', borderRadius: 4, fontSize: 10, padding: '1px 7px' }}>
                  + Master Data linked
                </span>
              )}
            </div>
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
            <button style={S.btn} onClick={() => load(false)} disabled={loading}
              title={cacheInfo?.ready ? 'Load instantly from Parquet cache' : 'Load (will fetch from Oracle)'}>
              {loading ? '⋯ Loading…' : cacheInfo?.ready ? '⚡ Quick Load' : '🔍 Load'}
            </button>
            <button style={S.btnSm} onClick={() => load(true)} disabled={loading} title="Re-fetch V_NSO from Oracle (slow)">
              🔄 Reload Oracle
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
              {visible.length.toLocaleString()} / {rows.length.toLocaleString()} rows
              {data.total_cached ? ` (${data.total_cached.toLocaleString()} cached)` : ''}
              {` · ${data.elapsed_ms} ms`}
              {data.served_from === 'oracle' ? ' · 🔴 fetched live from Oracle' : ' · ⚡ from Parquet cache'}
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
          {/* Pagination */}
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
          Select a <strong>Campaign</strong> from the dropdown above, then click <strong>Load</strong>.
        </div>
      )}
    </div>
  )
}
