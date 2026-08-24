import { useState, useEffect, useCallback } from 'react'
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
  const [selCluster, setSelCluster] = useState('')
  const [selRegion, setSelRegion]   = useState('')
  const [selStatus, setSelStatus]   = useState('')
  const [selAttr, setSelAttr]       = useState('')
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
      if (selCluster) params.cluster_type = selCluster
      if (selRegion)  params.region_type  = selRegion
      if (selStatus && selStatus !== '-') params.store_status = selStatus
      if (selAttr)    params.attribute1   = selAttr
      if (storeSearch) params.store_search = storeSearch
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
  }, [selCluster, selRegion, selStatus, selAttr, storeSearch, dateFrom, dateTo, stopPolling])

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
  }, [selCluster, selRegion, selStatus, selAttr, dateFrom, dateTo, lyDateFrom, lyDateTo, customLY]) // eslint-disable-line react-hooks/exhaustive-deps

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
        .achv-green { color: #22c55e; font-weight: 600; }
        .achv-amber { color: #f59e0b; font-weight: 600; }
        .achv-red   { color: #ef4444; font-weight: 600; }
        .achv-na    { opacity: .35; }
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
        <div>
          <label>Attribute</label>
          <select value={selAttr} onChange={e => setSelAttr(e.target.value)}>
            <option value=''>All</option>
            {(filters.attribute1 || []).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: '#ffffff08', borderRadius: 8, padding: '6px 10px', border: `1px solid ${(dateFrom || dateTo || (customLY && (lyDateFrom || lyDateTo))) ? '#3b82f6' : '#2a3a55'}` }}>
          {/* TY row */}
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
          {/* LY row — toggle */}
          <div className="date-group" style={{ gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: customLY ? '#f59e0b' : '#64748b', minWidth: 22 }}>LY</span>
            {!customLY ? (
              <button
                className="btn"
                style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px dashed #3b82f6', color: '#7dd3fc' }}
                onClick={() => setCustomLY(true)}
                title="Set custom LY date range (e.g. for Holi, Diwali shifted dates)"
              >+ Custom LY dates (festival)</button>
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
                <button className="btn" style={{ alignSelf: 'flex-end', padding: '2px 6px', background: '#7c2d12' }} onClick={() => { setCustomLY(false); setLyDateFrom(''); setLyDateTo('') }} title="Remove custom LY dates">✕</button>
              </>
            )}
          </div>
        </div>
        <input
          type="text"
          placeholder="Search store…"
          value={storeSearch}
          onChange={e => setStoreSearch(e.target.value)}
          style={{ minWidth: isMobile ? 100 : 150 }}
        />
      </div>

      {/* Actions */}
      <div className="actions">
        <button className="btn" onClick={loadData} disabled={loading || fetching}>
          {loading ? '…' : '⟳ Refresh'}
        </button>
        <button className="btn" onClick={forceReload} disabled={fetching} title="Re-fetch from Oracle">
          ↺ Reload from DB
        </button>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>⬇ CSV</button>
        <span style={{ opacity: .4, fontSize: 11 }}>
          {rows.length} stores shown{allRows.length !== rows.length ? ` (of ${allRows.length})` : ''}
        </span>
      </div>

      {/* Table */}
      {loading && !fetching ? (
        <div className="loading-bar">Loading…</div>
      ) : (
        <div className="tbl-scroll">
          <table className="sale-table">
            <thead>
              <tr className="group-header">
                <th colSpan={3}></th>
                <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>This Year (TY)</th>
                <th colSpan={3} style={{ borderLeft: '1px solid #2a3a55' }}>Last Year (LY)</th>
                <th colSpan={2} style={{ borderLeft: '1px solid #2a3a55' }}>Performance</th>
              </tr>
              <tr>
                <Th col="STORE_NAME"  label="Store" />
                <th>Zone</th>
                <th>Region</th>
                <Th col="TY_V"     label="Sale ₹" />
                <Th col="TY_TGT_V" label="Target" />
                <th>Achv%</th>
                <Th col="LY_V"     label="Sale ₹" />
                <Th col="LY_TGT_V" label="Target" />
                <th>LY Achv%</th>
                <th>Growth%</th>
                <Th col="TY_QTY"   label="TY Qty" />
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && !loading && !fetching && (
                <tr><td colSpan={11} style={{ textAlign: 'center', opacity: .4, padding: 30 }}>
                  {allRows.length === 0 ? 'No data — click Refresh' : 'No stores match filters'}
                </td></tr>
              )}
              {paged.map((r, i) => {
                const tyAchv  = r.TY_TGT_V ? Number(r.TY_V) / Number(r.TY_TGT_V) * 100 : null
                const lyAchv  = r.LY_TGT_V ? Number(r.LY_V) / Number(r.LY_TGT_V) * 100 : null
                return (
                  <tr key={i}>
                    <td>{String(r.STORE_NAME || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.CLUSTER_TYPE || '—')}</td>
                    <td style={{ textAlign: 'center' }}>{String(r.REGION_TYPE || '—')}</td>
                    <td>{fmt(r.TY_V)}</td>
                    <td>{fmt(r.TY_TGT_V)}</td>
                    <td><AchvBadge val={tyAchv} /></td>
                    <td>{fmt(r.LY_V)}</td>
                    <td>{fmt(r.LY_TGT_V)}</td>
                    <td><AchvBadge val={lyAchv} /></td>
                    <td><GrowthBadge val={r.GRWTH_PCT} /></td>
                    <td>{fmt(r.TY_QTY)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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
