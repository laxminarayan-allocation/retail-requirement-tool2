import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'

const PAGE_SIZE = 20

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768)
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return m
}

function fmt(v: unknown, dec = 0) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (isNaN(n)) return '—'
  if (Math.abs(n) >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`
  if (Math.abs(n) >= 100_000) return `${(n / 100_000).toFixed(1)}L`
  return n.toLocaleString('en-IN', { maximumFractionDigits: dec })
}

function AchvBadge({ val }: { val: unknown }) {
  const n = Number(val)
  if (isNaN(n) || val === null || val === undefined) return <span className="achv-na">—</span>
  const cls = n >= 100 ? 'achv-green' : n >= 80 ? 'achv-amber' : 'achv-red'
  return <span className={cls}>{n.toFixed(1)}%</span>
}

function GrowthBadge({ val }: { val: unknown }) {
  const n = Number(val)
  if (isNaN(n) || val === null || val === undefined) return <span className="achv-na">—</span>
  const cls = n >= 0 ? 'achv-green' : 'achv-red'
  return <span className={cls}>{n > 0 ? '+' : ''}{n.toFixed(1)}%</span>
}

function MultiSelectDropdown({
  label, options, selected, onToggle, onClear,
}: {
  label: string; options: string[]; selected: string[]
  onToggle: (v: string) => void; onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: selected.length > 0 ? '#1e3a5f' : '#0f1724',
        border: `1px solid ${selected.length > 0 ? '#3b82f6' : '#2a3a55'}`,
        borderRadius: 6, padding: '5px 10px', color: selected.length > 0 ? '#7dd3fc' : 'inherit',
        cursor: 'pointer', fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap',
      }}>
        {label}
        {selected.length > 0 && (
          <span style={{ background: '#3b82f6', borderRadius: 10, padding: '1px 6px', fontSize: 10, color: '#fff', fontWeight: 700 }}>
            {selected.length}
          </span>
        )}
        <span style={{ opacity: 0.4, fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
          background: '#1e293b', border: '1px solid #2a3a55', borderRadius: 8,
          minWidth: 180, maxHeight: 300, overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a2540', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#1e293b' }}>
            <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {selected.length > 0 ? `${selected.length} selected` : `All ${label}`}
            </span>
            {selected.length > 0 && (
              <button onClick={() => { onClear(); setOpen(false) }} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                Clear all
              </button>
            )}
          </div>
          {options.map(v => {
            const checked = selected.includes(v)
            return (
              <div key={v} onClick={() => onToggle(v)} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
                background: checked ? '#1a3050' : 'transparent', fontSize: 12,
                borderBottom: '1px solid #1a2540',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = checked ? '#1a3050' : '#0f172a')}
                onMouseLeave={e => (e.currentTarget.style.background = checked ? '#1a3050' : 'transparent')}
              >
                <span style={{
                  width: 15, height: 15, border: `2px solid ${checked ? '#3b82f6' : '#475569'}`,
                  borderRadius: 3, background: checked ? '#3b82f6' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  fontSize: 10, color: '#fff', fontWeight: 700,
                }}>
                  {checked ? '✓' : ''}
                </span>
                <span style={{ color: checked ? '#7dd3fc' : '#cbd5e1' }}>{v}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type Row = Record<string, unknown>

interface CacheStatus { ready: boolean; fetching: boolean; error: string; rows_ty?: number; rows_ly?: number }

export default function SaleDashboard() {
  const isMobile = useIsMobile()
  const [rows, setRows]             = useState<Row[]>([])
  const [allRows, setAllRows]       = useState<Row[]>([])
  const [cacheInfo, setCacheInfo]   = useState<CacheStatus | null>(null)
  const [loading, setLoading]       = useState(false)
  const [fetching, setFetching]     = useState(false)
  const [error, setError]           = useState('')
  const [page, setPage]             = useState(1)
  const [sortCol, setSortCol]       = useState('TY_V')
  const [sortDir, setSortDir]       = useState<'asc'|'desc'>('desc')
  const [storeSearch, setStoreSearch] = useState('')
  const [selCluster, setSelCluster]       = useState('')
  const [selRegion, setSelRegion]         = useState('')
  const [selStatus, setSelStatus]         = useState('')
  const [selAttrs, setSelAttrs]           = useState<string[]>([])
  const [selDivisions, setSelDivisions]   = useState<string[]>([])
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [lyDateFrom, setLyDateFrom]     = useState('')
  const [lyDateTo, setLyDateTo]         = useState('')
  const [customLY, setCustomLY]         = useState(false)
  const [filters, setFilters]       = useState<Record<string, string[]>>({})
  const [pollRef, setPollRef]       = useState<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef) { clearInterval(pollRef); setPollRef(null) }
  }, [pollRef])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = {}
      if (selCluster)          params.cluster_type = selCluster
      if (selRegion)           params.region_type  = selRegion
      if (selStatus && selStatus !== '-') params.store_status = selStatus
      if (selAttrs.length)     params.attribute1   = selAttrs.join(',')
      if (selDivisions.length) params.division     = selDivisions.join(',')
      if (storeSearch)         params.store_search = storeSearch
      if (dateFrom)              params.date_from    = dateFrom
      if (dateTo)                params.date_to      = dateTo
      if (customLY && lyDateFrom) params.ly_date_from = lyDateFrom
      if (customLY && lyDateTo)   params.ly_date_to   = lyDateTo

      const res = await axios.get('/api/sale/data', { params, timeout: 30000 })
      const d = res.data?.data
      if (!d) return
      if (d.loading) {
        setFetching(true)
        return
      }
      setFetching(false)
      stopPolling()
      setAllRows(d.rows || [])
      setPage(1)
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) setError(e.response?.data?.detail || e.message)
      else setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [selCluster, selRegion, selStatus, selAttrs, selDivisions, storeSearch, dateFrom, dateTo, stopPolling])

  const startPolling = useCallback(() => {
    if (pollRef) return
    const id = setInterval(async () => {
      try {
        const res = await axios.get('/api/sale/cache-status')
        const d: CacheStatus = res.data?.data
        setCacheInfo(d)
        if (d.ready) { stopPolling(); loadData() }
        if (d.error) { setError(d.error); stopPolling() }
      } catch { /* ignore */ }
    }, 5000)
    setPollRef(id)
  }, [pollRef, stopPolling, loadData])

  useEffect(() => {
    axios.get('/api/sale/filters').then(r => setFilters(r.data?.data || {})).catch(() => {})
  }, [])

  useEffect(() => { loadData() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fetching) startPolling()
  }, [fetching, startPolling])

  // Re-load when server-side filters change
  useEffect(() => {
    if (cacheInfo?.ready || allRows.length > 0) loadData()
  }, [selCluster, selRegion, selStatus, selAttrs, selDivisions, dateFrom, dateTo, lyDateFrom, lyDateTo, customLY]) // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side search + sort
  useEffect(() => {
    let r = [...allRows]
    if (storeSearch) r = r.filter(x => String(x.STORE_NAME || '').toLowerCase().includes(storeSearch.toLowerCase()))
    r.sort((a, b) => {
      const av = Number(a[sortCol] ?? 0), bv = Number(b[sortCol] ?? 0)
      return sortDir === 'desc' ? bv - av : av - bv
    })
    setRows(r)
    setPage(1)
  }, [allRows, storeSearch, sortCol, sortDir])

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function Th({ col, label }: { col: string; label: string }) {
    const active = sortCol === col
    return (
      <th onClick={() => toggleSort(col)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {label} {active ? (sortDir === 'desc' ? '↓' : '↑') : ''}
      </th>
    )
  }

  const tyTotal  = allRows.reduce((s, r) => s + Number(r.TY_V  || 0), 0)
  const lyTotal  = allRows.reduce((s, r) => s + Number(r.LY_V  || 0), 0)
  const tgtTotal = allRows.reduce((s, r) => s + Number(r.TY_TGT_V || 0), 0)
  const achvPct  = tgtTotal > 0 ? (tyTotal / tgtTotal * 100) : null
  const grwthPct = lyTotal > 0 ? ((tyTotal - lyTotal) / lyTotal * 100) : null

  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  function exportCsv() {
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    const lines = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = 'sale_dashboard.csv'
    a.click()
  }

  function forceReload() {
    setFetching(true)
    axios.get('/api/sale/data', { params: { force_refresh: true } }).catch(() => {})
  }

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const activeFilterCount = [selCluster, selRegion, selStatus, ...selAttrs, ...selDivisions, dateFrom || dateTo ? '1' : '', customLY ? '1' : ''].filter(Boolean).length

  // ── Tab state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'summary' | 'daily' | 'comparison'>('summary')
  const [dailyRows, setDailyRows] = useState<Row[]>([])
  const [dailyLoading, setDailyLoading] = useState(false)

  const loadDailyData = useCallback(async () => {
    setDailyLoading(true)
    try {
      const params: Record<string, string> = { by_date: 'true' }
      if (selCluster) params.cluster_type = selCluster
      if (selRegion)  params.region_type  = selRegion
      if (selStatus && selStatus !== '-') params.store_status = selStatus
      if (selAttrs.length)     params.attribute1 = selAttrs.join(',')
      if (selDivisions.length) params.division   = selDivisions.join(',')
      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo
      if (customLY && lyDateFrom) params.ly_date_from = lyDateFrom
      if (customLY && lyDateTo)   params.ly_date_to   = lyDateTo
      const res = await axios.get('/api/sale/data', { params, timeout: 30000 })
      const d = res.data?.data
      if (d && !d.loading) setDailyRows(d.rows || [])
    } catch { /* ignore */ }
    finally { setDailyLoading(false) }
  }, [selCluster, selRegion, selStatus, selAttrs, selDivisions, dateFrom, dateTo, customLY, lyDateFrom, lyDateTo])

  useEffect(() => {
    if (activeTab === 'daily') loadDailyData()
  }, [activeTab, loadDailyData])

  // Reusable inline multi-select toggle
  function toggleMulti<T extends string>(arr: T[], val: T, set: (v: T[]) => void) {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])
  }

  const achvColor = (pct: number | null) => pct === null ? '#64748b' : pct >= 100 ? '#22c55e' : pct >= 80 ? '#f59e0b' : '#ef4444'

  const sharedStyle = `
    .sd-btn { background:#1a2235; border:1px solid #2a3a55; border-radius:6px; padding:5px 12px; color:inherit; cursor:pointer; font-size:12px; }
    .sd-btn:hover { background:#243050; }
    .sd-btn:disabled { opacity:.4; cursor:default; }
    .achv-green{color:#22c55e;font-weight:600} .achv-amber{color:#f59e0b;font-weight:600}
    .achv-red{color:#ef4444;font-weight:600} .achv-na{opacity:.35}
  `

  // ── Mobile layout ───────────────────────────────────────────────────────────
  if (isMobile) return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', minHeight: '100vh' }}>
      <style>{sharedStyle}</style>

      {/* Mobile header */}
      <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Sale Dashboard</div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>Store-wise TY vs LY</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="sd-btn" onClick={loadData} disabled={loading || fetching} style={{ padding: '6px 12px' }}>
              {loading ? '…' : '⟳'}
            </button>
            <button onClick={() => setFilterDrawerOpen(true)} style={{
              padding: '6px 12px', borderRadius: 8, border: `1px solid ${activeFilterCount > 0 ? '#3b82f6' : '#334155'}`,
              background: activeFilterCount > 0 ? '#1e3a5f' : '#0f172a',
              color: activeFilterCount > 0 ? '#7dd3fc' : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              ⚙ {activeFilterCount > 0 ? activeFilterCount : ''} Filters
            </button>
          </div>
        </div>
        {/* Search */}
        <input
          type="text" placeholder="Search store…" value={storeSearch}
          onChange={e => setStoreSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box' as const, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
        />
        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, marginTop: 8 }}>
            {selCluster && <span onClick={() => setSelCluster('')} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>Zone: {selCluster} ✕</span>}
            {selRegion  && <span onClick={() => setSelRegion('')}  style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>Region: {selRegion} ✕</span>}
            {selStatus  && <span onClick={() => setSelStatus('')}  style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>{selStatus} ✕</span>}
            {selAttrs.map(v => <span key={v} onClick={() => setSelAttrs(a => a.filter(x => x !== v))} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>Camp: {v} ✕</span>)}
            {selDivisions.map(v => <span key={v} onClick={() => setSelDivisions(a => a.filter(x => x !== v))} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>Div: {v} ✕</span>)}
            {(dateFrom || dateTo) && <span onClick={() => { setDateFrom(''); setDateTo('') }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6', cursor: 'pointer' }}>📅 TY Period ✕</span>}
            {customLY && <span onClick={() => { setCustomLY(false); setLyDateFrom(''); setLyDateTo('') }} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: '#312e0a', color: '#f59e0b', border: '1px solid #f59e0b', cursor: 'pointer' }}>📅 LY Custom ✕</span>}
          </div>
        )}
      </div>

      {/* KPI horizontal scroll */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px', scrollbarWidth: 'none' as const }}>
        {[
          { label: 'TY Sale', val: fmt(tyTotal), sub: `${allRows.length} stores`, color: '#38bdf8' },
          { label: 'LY Sale', val: fmt(lyTotal), sub: `${allRows.filter(r => Number(r.LY_V) > 0).length} stores`, color: '#7dd3fc' },
          { label: 'Target', val: fmt(tgtTotal), sub: '', color: '#facc15' },
          { label: 'Achv%', val: achvPct !== null ? achvPct.toFixed(1) + '%' : '—', sub: '', color: achvColor(achvPct) },
          { label: 'Growth', val: grwthPct !== null ? (grwthPct > 0 ? '+' : '') + grwthPct.toFixed(1) + '%' : '—', sub: '', color: grwthPct !== null && grwthPct >= 0 ? '#22c55e' : '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ flexShrink: 0, background: '#1e293b', borderRadius: 10, padding: '8px 14px', border: '1px solid #334155', textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.val}</div>
            {k.sub && <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{k.sub}</div>}
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 3, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Banners */}
      <div style={{ padding: '0 12px' }}>
        {fetching && !error && (
          <div style={{ background: '#1a2a10', border: '1px solid #2d5a1a', borderRadius: 8, padding: '10px 14px', marginBottom: 8, fontSize: 12 }}>
            ⏳ Fetching from Oracle…
          </div>
        )}
        {error && <div style={{ background: '#2a1010', border: '1px solid #5a1a1a', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 12, color: '#f87171' }}>⚠ {error}</div>}
      </div>

      {/* Store cards */}
      <div style={{ padding: '0 12px 80px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && !fetching && <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>Loading…</div>}
        {!loading && paged.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569', fontSize: 14 }}>
            {allRows.length === 0 ? 'No data — tap ⟳ to refresh' : 'No stores match filters'}
          </div>
        )}
        {paged.map((r, i) => {
          const tyAchv = r.TY_TGT_V ? Number(r.TY_V) / Number(r.TY_TGT_V) * 100 : null
          const growth = Number(r.GRWTH_PCT)
          const achvC = achvColor(tyAchv)
          return (
            <div key={i} style={{
              background: '#1e293b', borderRadius: 10, padding: '12px 14px',
              border: `1px solid #334155`, borderLeft: `3px solid ${achvC}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', flex: 1 }}>{String(r.STORE_NAME || '—')}</div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' as const, justifyContent: 'flex-end' }}>
                  {!!r.DIVISION     && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: '#1e3a5f', color: '#7dd3fc' }}>{String(r.DIVISION)}</span>}
                  {!!r.CLUSTER_TYPE && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: '#0f172a', color: '#64748b' }}>{String(r.CLUSTER_TYPE)}</span>}
                  {!!r.REGION_TYPE  && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: '#0f172a', color: '#64748b' }}>{String(r.REGION_TYPE)}</span>}
                </div>
              </div>
              {r.OPERT_DAYS != null && <div style={{ fontSize: 9, color: '#64748b', marginBottom: 6 }}>⏱ Oper Days: <span style={{ color: '#94a3b8', fontWeight: 700 }}>{String(r.OPERT_DAYS)}d</span></div>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                {[
                  { label: 'TY Sale', val: fmt(r.TY_V), color: '#38bdf8' },
                  { label: 'TY Qty', val: fmt(r.TY_QTY), color: '#7dd3fc' },
                  { label: 'TY Achv', val: tyAchv !== null ? tyAchv.toFixed(1) + '%' : '—', color: achvC },
                  { label: 'LY Sale', val: fmt(r.LY_V), color: '#94a3b8' },
                  { label: 'TY Target', val: fmt(r.TY_TGT_V), color: '#facc15' },
                  { label: 'Growth', val: !isNaN(growth) ? (growth > 0 ? '+' : '') + growth.toFixed(1) + '%' : '—', color: !isNaN(growth) && growth >= 0 ? '#22c55e' : '#ef4444' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0f172a', borderRadius: 6, padding: '5px 8px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{m.val}</div>
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '12px 0', alignItems: 'center' }}>
            <button className="sd-btn" style={{ padding: '8px 18px' }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>{page} / {totalPages} &nbsp;({rows.length} stores)</span>
            <button className="sd-btn" style={{ padding: '8px 18px' }} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
          </div>
        )}
      </div>

      {/* Filter Drawer */}
      {filterDrawerOpen && (
        <>
          <div onClick={() => setFilterDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2001, background: '#1e293b', borderTop: '1px solid #334155', borderRadius: '16px 16px 0 0', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #334155' }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>Filters</span>
              <button onClick={() => setFilterDrawerOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Single-select filters */}
              {[
                { label: 'Zone', val: selCluster, set: setSelCluster, opts: filters.cluster_type || [] },
                { label: 'Region', val: selRegion, set: setSelRegion, opts: filters.region_type || [] },
                { label: 'Status', val: selStatus, set: setSelStatus, opts: filters.store_status || ['ACTIVE', 'INACTIVE'] },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{f.label}</div>
                  <select value={f.val} onChange={e => f.set(e.target.value)} style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 13 }}>
                    <option value=''>All {f.label}s</option>
                    {f.opts.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              ))}
              {/* Multi-select: Division */}
              {(filters.division || []).length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Division {selDivisions.length > 0 && <span style={{ color: '#7dd3fc' }}>({selDivisions.length})</span>}</div>
                    {selDivisions.length > 0 && <button onClick={() => setSelDivisions([])} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(filters.division || []).map(v => (
                      <button key={v} onClick={() => toggleMulti(selDivisions, v, setSelDivisions)} style={{
                        fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${selDivisions.includes(v) ? '#3b82f6' : '#334155'}`,
                        background: selDivisions.includes(v) ? '#1e3a5f' : '#0f172a',
                        color: selDivisions.includes(v) ? '#7dd3fc' : '#64748b', fontWeight: 600,
                      }}>{v}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Multi-select: Campaign/Attribute */}
              {(filters.attribute1 || []).length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Campaign {selAttrs.length > 0 && <span style={{ color: '#7dd3fc' }}>({selAttrs.length})</span>}</div>
                    {selAttrs.length > 0 && <button onClick={() => setSelAttrs([])} style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {(filters.attribute1 || []).map(v => (
                      <button key={v} onClick={() => toggleMulti(selAttrs, v, setSelAttrs)} style={{
                        fontSize: 11, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${selAttrs.includes(v) ? '#3b82f6' : '#334155'}`,
                        background: selAttrs.includes(v) ? '#1e3a5f' : '#0f172a',
                        color: selAttrs.includes(v) ? '#7dd3fc' : '#64748b', fontWeight: 600,
                      }}>{v}</button>
                    ))}
                  </div>
                </div>
              )}
              {/* TY Date Range */}
              <div>
                <div style={{ fontSize: 10, color: '#7dd3fc', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>TY Period (This Year)</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>FROM</div>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' as const }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>TO</div>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' as const }} />
                  </div>
                </div>
                {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ marginTop: 6, fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>✕ Clear TY dates</button>}
              </div>
              {/* LY Custom Dates */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: customLY ? '#f59e0b' : '#64748b', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>LY Custom (Festival)</div>
                  <button onClick={() => { setCustomLY(c => !c); if (customLY) { setLyDateFrom(''); setLyDateTo('') } }}
                    style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: `1px solid ${customLY ? '#f59e0b' : '#334155'}`, background: 'none', color: customLY ? '#f59e0b' : '#64748b', cursor: 'pointer' }}>
                    {customLY ? 'Remove' : '+ Add'}
                  </button>
                </div>
                {customLY && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>FROM</div>
                      <input type="date" value={lyDateFrom} onChange={e => setLyDateFrom(e.target.value)} style={{ width: '100%', background: '#0f172a', border: '1px solid #f59e0b44', borderRadius: 8, padding: '9px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>TO</div>
                      <input type="date" value={lyDateTo} onChange={e => setLyDateTo(e.target.value)} style={{ width: '100%', background: '#0f172a', border: '1px solid #f59e0b44', borderRadius: 8, padding: '9px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' as const }} />
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => setFilterDrawerOpen(false)} style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: '#0ea5e9', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>Apply</button>
              {activeFilterCount > 0 && (
                <button onClick={() => { setSelCluster(''); setSelRegion(''); setSelStatus(''); setSelAttrs([]); setSelDivisions([]); setDateFrom(''); setDateTo(''); setCustomLY(false); setLyDateFrom(''); setLyDateTo('') }}
                  style={{ width: '100%', padding: '11px', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Clear All Filters
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )

  // ── Desktop layout ──────────────────────────────────────────────────────────
  return (
    <div className="sale-dash">
      <style>{`
        .sale-dash { padding: 12px; font-size: 13px; }
        .kpi-strip { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
        .kpi { background: var(--card-bg, #1a2235); border-radius: 8px; padding: 10px 14px; flex: 1 1 130px; min-width: 110px; }
        .kpi-label { font-size: 11px; opacity: .65; text-transform: uppercase; letter-spacing: .05em; }
        .kpi-val { font-size: 20px; font-weight: 700; color: #38bdf8; margin-top: 2px; }
        .kpi-sub { font-size: 11px; opacity: .5; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
        .filters select, .filters input[type=text] { background: var(--input-bg, #0f1724); border: 1px solid #2a3a55;
          border-radius: 6px; padding: 5px 8px; color: inherit; font-size: 12px; }
        .filters input[type=date] { background: var(--input-bg, #0f1724); border: 1px solid #2a3a55;
          border-radius: 6px; padding: 5px 8px; color: inherit; font-size: 12px; }
        .filters label { font-size: 11px; opacity: .6; margin-right: 2px; }
        .date-group { display: flex; gap: 6px; align-items: flex-end; }
        .sale-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .sale-table th { background: #0f1724; padding: 7px 8px; text-align: right; border-bottom: 1px solid #2a3a55; font-size: 11px; }
        .sale-table th:first-child { text-align: left; }
        .sale-table td { padding: 6px 8px; border-bottom: 1px solid #1a2540; text-align: right; }
        .sale-table td:first-child { text-align: left; font-weight: 600; }
        .sale-table tr:hover td { background: #1a2a40; }
        ${sharedStyle}
        .pagination { display: flex; gap: 6px; align-items: center; margin-top: 10px; justify-content: center; font-size: 12px; }
        .pagination button { background: #1a2235; border: 1px solid #2a3a55; border-radius: 4px;
          padding: 3px 10px; color: inherit; cursor: pointer; }
        .pagination button:disabled { opacity: .35; cursor: default; }
        .loading-bar { text-align: center; padding: 40px; opacity: .6; }
        .fetch-banner { background: #1a2a10; border: 1px solid #2d5a1a; border-radius: 8px;
          padding: 10px 14px; margin-bottom: 12px; font-size: 12px; }
        .err-banner { background: #2a1010; border: 1px solid #5a1a1a; border-radius: 8px;
          padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: #f87171; }
        .tbl-scroll { overflow-x: auto; }
        .actions { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; }
        .btn { background: #1a2235; border: 1px solid #2a3a55; border-radius: 6px;
          padding: 5px 12px; color: inherit; cursor: pointer; font-size: 12px; }
        .btn:hover { background: #243050; }
        .btn:disabled { opacity: .4; cursor: default; }
        .group-header th { background: #0a0f1c; font-size: 10px; text-align: center; border-bottom: 1px solid #2a3a55; opacity: .7; }
      `}</style>

      <h2 style={{ marginBottom: 14 }}>Store-wise Sale Dashboard</h2>

      {/* KPI strip */}
      <div className="kpi-strip">
        <div className="kpi">
          <div className="kpi-label">TY Sale</div>
          <div className="kpi-val">{fmt(tyTotal)}</div>
          <div className="kpi-sub">{allRows.length} stores</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">LY Sale</div>
          <div className="kpi-val">{fmt(lyTotal)}</div>
          <div className="kpi-sub">{allRows.filter(r => Number(r.LY_V) > 0).length} stores</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Target</div>
          <div className="kpi-val">{fmt(tgtTotal)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Achievement</div>
          <div className="kpi-val">{achvPct !== null ? `${achvPct.toFixed(1)}%` : '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">YoY Growth</div>
          <div className="kpi-val">{grwthPct !== null ? `${grwthPct > 0 ? '+' : ''}${grwthPct.toFixed(1)}%` : '—'}</div>
        </div>
      </div>

      {/* Banners */}
      {fetching && !error && (
        <div className="fetch-banner">
          ⏳ Fetching sale data from Oracle (~20 seconds first load)…
          {cacheInfo && <span style={{ opacity: .6, marginLeft: 8 }}>TY: {(cacheInfo.rows_ty || 0).toLocaleString()} rows cached</span>}
        </div>
      )}
      {error && <div className="err-banner">⚠ {error}</div>}

      {/* Filters */}
      <div className="filters">
        <div>
          <label>Zone</label>
          <select value={selCluster} onChange={e => setSelCluster(e.target.value)}>
            <option value=''>All</option>
            {(filters.cluster_type || []).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label>Region</label>
          <select value={selRegion} onChange={e => setSelRegion(e.target.value)}>
            <option value=''>All</option>
            {(filters.region_type || []).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select value={selStatus} onChange={e => setSelStatus(e.target.value)}>
            <option value=''>All</option>
            {(filters.store_status || ['ACTIVE', 'INACTIVE']).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        {/* Division dropdown */}
        {(filters.division || []).length > 0 && (
          <MultiSelectDropdown
            label="Division"
            options={filters.division || []}
            selected={selDivisions}
            onToggle={v => toggleMulti(selDivisions, v, setSelDivisions)}
            onClear={() => setSelDivisions([])}
          />
        )}
        {/* Campaign dropdown */}
        {(filters.attribute1 || []).length > 0 && (
          <MultiSelectDropdown
            label="Campaign"
            options={filters.attribute1 || []}
            selected={selAttrs}
            onToggle={v => toggleMulti(selAttrs, v, setSelAttrs)}
            onClear={() => setSelAttrs([])}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: '#ffffff08', borderRadius: 8, padding: '6px 10px', border: `1px solid ${(dateFrom || dateTo || (customLY && (lyDateFrom || lyDateTo))) ? '#3b82f6' : '#2a3a55'}` }}>
          <div className="date-group" style={{ gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#7dd3fc', minWidth: 22 }}>TY</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase' }}>From</span>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <span style={{ opacity: .4, alignSelf: 'flex-end', paddingBottom: 3 }}>→</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase' }}>To</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            {(dateFrom || dateTo) && <button className="btn" style={{ alignSelf: 'flex-end', padding: '2px 6px' }} onClick={() => { setDateFrom(''); setDateTo('') }}>✕</button>}
          </div>
          <div className="date-group" style={{ gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: customLY ? '#f59e0b' : '#64748b', minWidth: 22 }}>LY</span>
            {!customLY ? (
              <button className="btn" style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px dashed #3b82f6', color: '#7dd3fc' }} onClick={() => setCustomLY(true)}>+ Custom LY dates (festival)</button>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase' }}>From</span>
                  <input type="date" value={lyDateFrom} onChange={e => setLyDateFrom(e.target.value)} />
                </div>
                <span style={{ opacity: .4, alignSelf: 'flex-end', paddingBottom: 3 }}>→</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ fontSize: 9, opacity: 0.5, textTransform: 'uppercase' }}>To</span>
                  <input type="date" value={lyDateTo} onChange={e => setLyDateTo(e.target.value)} />
                </div>
                <button className="btn" style={{ alignSelf: 'flex-end', padding: '2px 6px', background: '#7c2d12' }} onClick={() => { setCustomLY(false); setLyDateFrom(''); setLyDateTo('') }}>✕</button>
              </>
            )}
          </div>
        </div>
        <input type="text" placeholder="Search store…" value={storeSearch} onChange={e => setStoreSearch(e.target.value)} style={{ minWidth: 150 }} />
      </div>

      {/* Actions */}
      <div className="actions">
        <button className="btn" onClick={loadData} disabled={loading || fetching}>{loading ? '…' : '⟳ Refresh'}</button>
        <button className="btn" onClick={forceReload} disabled={fetching}>↺ Reload from DB</button>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>⬇ CSV</button>
        {activeFilterCount > 0 && <button className="btn" onClick={() => { setSelCluster(''); setSelRegion(''); setSelStatus(''); setSelAttrs([]); setSelDivisions([]); setDateFrom(''); setDateTo(''); setCustomLY(false); setLyDateFrom(''); setLyDateTo('') }} style={{ color: '#f87171' }}>✕ Clear</button>}
        <span style={{ opacity: .4, fontSize: 11 }}>{rows.length} stores shown{allRows.length !== rows.length ? ` (of ${allRows.length})` : ''}</span>

        {/* Tab switcher */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 0, border: '1px solid #2a3a55', borderRadius: 8, overflow: 'hidden' }}>
          {([
            { key: 'summary',    label: 'Store Summary' },
            { key: 'daily',      label: 'Daily Trend' },
            { key: 'comparison', label: 'TY vs LY' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: activeTab === t.key ? '#0ea5e9' : '#0f1724',
              color: activeTab === t.key ? '#fff' : '#64748b',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── Summary Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'summary' && (loading && !fetching ? (
        <div className="loading-bar">Loading…</div>
      ) : (
        <div className="tbl-scroll">
          <table className="sale-table">
            <thead>
              <tr className="group-header">
                <th colSpan={5}></th>
                <th colSpan={4} style={{ borderLeft: '1px solid #2a3a55' }}>This Year (TY)</th>
                <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>Last Year (LY)</th>
                <th colSpan={1} style={{ borderLeft: '1px solid #2a3a55' }}>Perf</th>
              </tr>
              <tr>
                <Th col="STORE_NAME" label="Store" />
                <th>Division</th><th>Zone</th><th>Region</th><th>Oper Days</th>
                <Th col="TY_V" label="Sale ₹" /><Th col="TY_QTY" label="Sale Qty" /><Th col="TY_TGT_V" label="Target" /><th>Achv%</th>
                <Th col="LY_V" label="Sale ₹" /><Th col="LY_TGT_V" label="Target" /><th>LY Achv%</th>
                <th>Growth%</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && !loading && !fetching && (
                <tr><td colSpan={13} style={{ textAlign: 'center', opacity: .4, padding: 30 }}>
                  {allRows.length === 0 ? 'No data — click Refresh' : 'No stores match filters'}
                </td></tr>
              )}
              {paged.map((r, i) => {
                const tyAchv = r.TY_TGT_V ? Number(r.TY_V) / Number(r.TY_TGT_V) * 100 : null
                const lyAchv = r.LY_TGT_V ? Number(r.LY_V) / Number(r.LY_TGT_V) * 100 : null
                return (
                  <tr key={i}>
                    <td>{String(r.STORE_NAME || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.DIVISION || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.CLUSTER_TYPE || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.REGION_TYPE || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{r.OPERT_DAYS != null ? String(r.OPERT_DAYS) + 'd' : '—'}</td>
                    <td>{fmt(r.TY_V)}</td><td>{fmt(r.TY_QTY)}</td><td>{fmt(r.TY_TGT_V)}</td><td><AchvBadge val={tyAchv} /></td>
                    <td>{fmt(r.LY_V)}</td><td>{fmt(r.LY_TGT_V)}</td><td><AchvBadge val={lyAchv} /></td>
                    <td><GrowthBadge val={r.GRWTH_PCT} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* ── Daily Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'daily' && (
        dailyLoading ? <div className="loading-bar">Loading daily data…</div> : (
          <div className="tbl-scroll">
            {(() => {
              const today = new Date().toISOString().slice(0, 10) // 2026-08-25

              // ── Build Year → Month → rows hierarchy ─────────────────────────
              type MonthGroup  = { monthKey: string; label: string; rows: Row[] }
              type YearGroup   = { year: string; months: MonthGroup[] }

              const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

              const yearMap = new Map<string, Map<string, Row[]>>()
              for (const r of dailyRows) {
                const d = String(r.SALE_DATE || '')
                const [yr, mo] = d.split('-')
                if (!yr || !mo) continue
                if (!yearMap.has(yr)) yearMap.set(yr, new Map())
                const monthMap = yearMap.get(yr)!
                if (!monthMap.has(mo)) monthMap.set(mo, [])
                monthMap.get(mo)!.push(r)
              }

              const years: YearGroup[] = []
              for (const [year, monthMap] of yearMap) {
                const months: MonthGroup[] = []
                for (const [mo, rows] of monthMap) {
                  const mIdx = parseInt(mo, 10) - 1
                  months.push({ monthKey: mo, label: `${MONTHS[mIdx] ?? mo} ${year}`, rows })
                }
                months.sort((a, b) => a.monthKey.localeCompare(b.monthKey))
                years.push({ year, months })
              }
              years.sort((a, b) => a.year.localeCompare(b.year))

              function sumRow(rows: Row[]) {
                return rows.reduce((acc, r) => ({
                  TY_V:     (acc.TY_V     as number) + Number(r.TY_V     || 0),
                  TY_QTY:   (acc.TY_QTY   as number) + Number(r.TY_QTY   || 0),
                  TY_TGT_V: (acc.TY_TGT_V as number) + Number(r.TY_TGT_V || 0),
                  LY_V:     (acc.LY_V     as number) + Number(r.LY_V     || 0),
                  LY_TGT_V: (acc.LY_TGT_V as number) + Number(r.LY_TGT_V || 0),
                }), { TY_V: 0, TY_QTY: 0, TY_TGT_V: 0, LY_V: 0, LY_TGT_V: 0 })
              }

              const GH: React.CSSProperties = { background: '#0f172a', fontWeight: 700, fontSize: 11, color: '#94a3b8', borderBottom: '1px solid #2a3a55' }
              const YH: React.CSSProperties = { background: '#0a1020', fontWeight: 800, fontSize: 12, color: '#e2e8f0', borderBottom: '2px solid #2a3a55', borderTop: '2px solid #1e3a5f' }

              return (
                <table className="sale-table">
                  <thead>
                    <tr className="group-header">
                      <th colSpan={1}></th>
                      <th colSpan={4} style={{ borderLeft: '1px solid #2a3a55' }}>This Year (TY)</th>
                      <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>Last Year (LY)</th>
                      <th colSpan={1} style={{ borderLeft: '1px solid #2a3a55' }}>Perf</th>
                    </tr>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Date</th>
                      <th style={{ borderLeft: '1px solid #2a3a55' }}>Sale ₹</th><th>Sale Qty</th><th>Target</th><th>Achv%</th>
                      <th style={{ borderLeft: '1px solid #2a3a55' }}>LY Sale ₹</th><th>LY Target</th><th>LY Achv%</th>
                      <th style={{ borderLeft: '1px solid #2a3a55' }}>Growth%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', opacity: .4, padding: 30 }}>
                        No data — apply a date filter and refresh
                      </td></tr>
                    )}

                    {years.map(yg => {
                      const ys = sumRow(yg.months.flatMap(m => m.rows))
                      const yAchv = ys.TY_TGT_V ? ys.TY_V / ys.TY_TGT_V * 100 : null
                      const yLyAchv = ys.LY_TGT_V ? ys.LY_V / ys.LY_TGT_V * 100 : null
                      const yGrowth = ys.LY_V ? (ys.TY_V - ys.LY_V) / ys.LY_V * 100 : null

                      return [
                        /* ── Year header row ── */
                        <tr key={`y-${yg.year}`} style={YH}>
                          <td style={{ paddingLeft: 10, letterSpacing: 1 }}>📅 {yg.year}</td>
                          <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(ys.TY_V)}</td>
                          <td>{fmt(ys.TY_QTY)}</td>
                          <td>{fmt(ys.TY_TGT_V)}</td>
                          <td><AchvBadge val={yAchv} /></td>
                          <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(ys.LY_V)}</td>
                          <td>{fmt(ys.LY_TGT_V)}</td>
                          <td><AchvBadge val={yLyAchv} /></td>
                          <td style={{ borderLeft: '1px solid #2a3a55' }}><GrowthBadge val={yGrowth} /></td>
                        </tr>,

                        ...yg.months.map(mg => {
                          const ms = sumRow(mg.rows)
                          const mAchv   = ms.TY_TGT_V ? ms.TY_V / ms.TY_TGT_V * 100 : null
                          const mLyAchv = ms.LY_TGT_V ? ms.LY_V / ms.LY_TGT_V * 100 : null
                          const mGrowth = ms.LY_V ? (ms.TY_V - ms.LY_V) / ms.LY_V * 100 : null

                          return [
                            /* ── Month header row ── */
                            <tr key={`m-${yg.year}-${mg.monthKey}`} style={GH}>
                              <td style={{ paddingLeft: 22 }}>▸ {mg.label}</td>
                              <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(ms.TY_V)}</td>
                              <td>{fmt(ms.TY_QTY)}</td>
                              <td>{fmt(ms.TY_TGT_V)}</td>
                              <td><AchvBadge val={mAchv} /></td>
                              <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(ms.LY_V)}</td>
                              <td>{fmt(ms.LY_TGT_V)}</td>
                              <td><AchvBadge val={mLyAchv} /></td>
                              <td style={{ borderLeft: '1px solid #2a3a55' }}><GrowthBadge val={mGrowth} /></td>
                            </tr>,

                            /* ── Date rows ── */
                            ...mg.rows.map((r, i) => {
                              const dateStr = String(r.SALE_DATE || '')
                              const isToday = dateStr === today
                              const tyAchv = r.TY_TGT_V ? Number(r.TY_V) / Number(r.TY_TGT_V) * 100 : null
                              const lyAchv = r.LY_TGT_V ? Number(r.LY_V) / Number(r.LY_TGT_V) * 100 : null
                              const rowStyle: React.CSSProperties = isToday
                                ? { background: '#0f2a1a', outline: '1.5px solid #4ade80', outlineOffset: -1 }
                                : { background: i % 2 === 0 ? 'transparent' : '#ffffff03' }
                              return (
                                <tr key={dateStr} id={isToday ? 'today-row' : undefined} style={rowStyle}>
                                  <td style={{ paddingLeft: 38, fontVariantNumeric: 'tabular-nums', color: isToday ? '#4ade80' : '#94a3b8', fontWeight: isToday ? 700 : 400 }}>
                                    {dateStr.slice(5)} {/* show MM-DD */}
                                    {isToday && <span style={{ marginLeft: 6, fontSize: 9, background: '#16532d', color: '#4ade80', border: '1px solid #166534', borderRadius: 4, padding: '1px 5px' }}>TODAY</span>}
                                  </td>
                                  <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(r.TY_V)}</td>
                                  <td>{fmt(r.TY_QTY)}</td>
                                  <td>{fmt(r.TY_TGT_V)}</td>
                                  <td><AchvBadge val={tyAchv} /></td>
                                  <td style={{ borderLeft: '1px solid #2a3a55' }}>{fmt(r.LY_V)}</td>
                                  <td>{fmt(r.LY_TGT_V)}</td>
                                  <td><AchvBadge val={lyAchv} /></td>
                                  <td style={{ borderLeft: '1px solid #2a3a55' }}><GrowthBadge val={r.GRWTH_PCT} /></td>
                                </tr>
                              )
                            }),
                          ]
                        }),
                      ]
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
        )
      )}

      {/* ── TY vs LY Comparison Tab ──────────────────────────────────────────── */}
      {activeTab === 'comparison' && (loading && !fetching ? (
        <div className="loading-bar">Loading…</div>
      ) : (
        <div className="tbl-scroll">
          <table className="sale-table">
            <thead>
              <tr className="group-header">
                <th colSpan={2}></th>
                <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>This Year (TY)</th>
                <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>Last Year (LY)</th>
                <th colSpan={1} style={{ borderLeft: '1px solid #2a3a55' }}>Growth</th>
              </tr>
              <tr>
                <Th col="STORE_NAME" label="Store" />
                <th>Zone</th>
                <th style={{ borderLeft: '1px solid #2a3a55' }}>Sale ₹</th><Th col="TY_TGT_V" label="Target" /><th>Achv%</th>
                <th style={{ borderLeft: '1px solid #2a3a55' }}>Sale ₹</th><Th col="LY_TGT_V" label="Target" /><th>LY Achv%</th>
                <th style={{ borderLeft: '1px solid #2a3a55' }}>Growth%</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && !loading && !fetching && (
                <tr><td colSpan={9} style={{ textAlign: 'center', opacity: .4, padding: 30 }}>
                  {allRows.length === 0 ? 'No data — click Refresh' : 'No stores match filters'}
                </td></tr>
              )}
              {paged.map((r, i) => {
                const tyAchv = r.TY_TGT_V ? Number(r.TY_V) / Number(r.TY_TGT_V) * 100 : null
                const lyAchv = r.LY_TGT_V ? Number(r.LY_V) / Number(r.LY_TGT_V) * 100 : null
                return (
                  <tr key={i}>
                    <td>{String(r.STORE_NAME || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.CLUSTER_TYPE || '—')}</td>
                    <td>{fmt(r.TY_V)}</td><td>{fmt(r.TY_TGT_V)}</td><td><AchvBadge val={tyAchv} /></td>
                    <td>{fmt(r.LY_V)}</td><td>{fmt(r.LY_TGT_V)}</td><td><AchvBadge val={lyAchv} /></td>
                    <td><GrowthBadge val={r.GRWTH_PCT} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          <button disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      )}
    </div>
  )
}
