import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

// ── Palette (matches app theme) ────────────────────────────────────────────────
const C = {
  bg:     '#0f172a',
  surf1:  '#1e293b',
  surf2:  '#0f172a',
  surf3:  '#243447',
  border: '#334155',
  border2:'#3b4f6a',
  text:   '#e2e8f0',
  sub:    '#94a3b8',
  muted:  '#64748b',
  accent: '#38bdf8',
  green:  '#22c55e',
  amber:  '#f59e0b',
  red:    '#ef4444',
}

// ── Number formatters ─────────────────────────────────────────────────────────
function fmtV(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr'
  if (Math.abs(v) >= 1e5) return '₹' + (v / 1e5).toFixed(1) + 'L'
  return '₹' + v.toFixed(0)
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—'
  return Number(n).toFixed(1) + '%'
}
function achvClass(n: number | null | undefined): string {
  if (n == null) return 'neutral'
  const v = Number(n)
  if (v >= 100) return 'high'
  if (v >= 80)  return 'mid'
  return 'low'
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Row {
  [key: string]: unknown
}

interface Filters {
  attribute1: string[]
  cluster_type: string[]
  district: string[]
  division: string[]
  store_status: string[]
}

const KPI_COLS: { key: string; label: string; fmt: 'v' | 'p' }[] = [
  { key: 'sl_v',       label: 'TY Sale Value',    fmt: 'v' },
  { key: 'lm_sl_v',   label: 'LY Sale Value',     fmt: 'v' },
  { key: 'achv_per',  label: 'TY Achv %',         fmt: 'p' },
  { key: 'lm_achv_per', label: 'LY Achv %',       fmt: 'p' },
  { key: 'mtd_sl_v',  label: 'MTD Sale',          fmt: 'v' },
  { key: 'to_v',      label: 'TO Value',          fmt: 'v' },
]

const PAGE_SIZE = 20

export default function SaleDashboard() {
  const isMobile = useIsMobile()

  // ── State ──────────────────────────────────────────────────────────────────
  const [rows, setRows]               = useState<Row[]>([])
  const [allRows, setAllRows]         = useState<Row[]>([])
  const [filters, setFilters]         = useState<Filters>({ attribute1: [], cluster_type: [], district: [], division: [], store_status: [] })
  const [selAttr1, setSelAttr1]       = useState('')
  const [selZone,  setSelZone]        = useState('')
  const [selDist,  setSelDist]        = useState('')
  const [selDiv,   setSelDiv]         = useState('')
  const [selStatus,setSelStatus]      = useState('')
  const [storeSearch, setStoreSearch] = useState('')
  const [loading, setLoading]         = useState(false)
  const [cacheInfo, setCacheInfo]     = useState<{ total: number; elapsed: number; from: string } | null>(null)
  const [page, setPage]               = useState(1)
  const [sortCol, setSortCol]         = useState<string>('')
  const [sortDir, setSortDir]         = useState<1 | -1>(1)
  const [error, setError]             = useState('')

  // ── Load filters on mount ──────────────────────────────────────────────────
  useEffect(() => {
    axios.get('/api/sale/filters').then(r => {
      const d = r.data.data
      setFilters({
        attribute1:   d.attribute1   || [],
        cluster_type: d.cluster_type || [],
        district:     d.district     || [],
        division:     d.division     || [],
        store_status: d.store_status || [],
      })
    }).catch(() => {})
  }, [])

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, string> = {}
      if (selAttr1)    params.attribute1   = selAttr1
      if (selZone)     params.cluster_type = selZone
      if (selDist)     params.district     = selDist
      if (selDiv)      params.division     = selDiv
      if (selStatus)   params.store_status = selStatus
      if (storeSearch) params.store_search = storeSearch
      if (forceRefresh) params.force_refresh = 'true'

      const r = await axios.get('/api/sale/data', { params, timeout: 300000 })
      const d = r.data.data
      setAllRows(d.rows || [])
      setCacheInfo({ total: d.total_cached, elapsed: d.elapsed_ms, from: d.served_from })
      setPage(1)
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [selAttr1, selZone, selDist, selDiv, selStatus, storeSearch])

  useEffect(() => { load() }, [selAttr1, selZone, selDist, selDiv, selStatus]) // eslint-disable-line

  // ── Client-side search filter + sort ──────────────────────────────────────
  useEffect(() => {
    let data = allRows
    if (storeSearch.trim()) {
      const q = storeSearch.toLowerCase()
      data = data.filter(r => String(r.store_name ?? '').toLowerCase().includes(q))
    }
    if (sortCol) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir
        return String(av).localeCompare(String(bv)) * sortDir
      })
    }
    setRows(data)
    setPage(1)
  }, [allRows, storeSearch, sortCol, sortDir])

  // ── KPI aggregation ────────────────────────────────────────────────────────
  function sumCol(key: string) {
    return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
  }

  const kpiValues: Record<string, number> = {
    sl_v:       sumCol('sl_v'),
    lm_sl_v:    sumCol('lm_sl_v'),
    achv_per:   rows.length ? sumCol('achv_per') / rows.length : 0,
    lm_achv_per:rows.length ? sumCol('lm_achv_per') / rows.length : 0,
    mtd_sl_v:   sumCol('mtd_sl_v'),
    to_v:       sumCol('to_v'),
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows   = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Sort handler ───────────────────────────────────────────────────────────
  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1)
    else { setSortCol(col); setSortDir(-1) }  // default descending for numbers
  }
  function sortIcon(col: string) {
    if (sortCol !== col) return ' ↕'
    return sortDir === 1 ? ' ↑' : ' ↓'
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!rows.length) return
    const cols = Object.keys(rows[0])
    const lines = [cols.join(','), ...rows.map(r => cols.map(c => String(r[c] ?? '')).join(','))]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = 'sale_data.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const S: Record<string, React.CSSProperties> = {
    page:    { display: 'flex', flexDirection: 'column', gap: 12, height: '100%' },
    header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    title:   { fontSize: 16, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 8 },
    badge:   { fontSize: 10, background: C.accent, color: '#fff', padding: '2px 8px', borderRadius: 20, fontWeight: 600 },
    alert:   { background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)', borderLeft: `3px solid ${C.amber}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.amber, lineHeight: 1.5 },
    filters: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'flex-end' },
    fg:      { display: 'flex', flexDirection: 'column' as const, gap: 3 },
    flabel:  { fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '.5px' },
    sel:     { background: C.surf1, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12, padding: '5px 8px', borderRadius: 6, outline: 'none', fontFamily: 'inherit', minWidth: 110 },
    sinput:  { background: C.surf1, border: `1px solid ${C.border2}`, color: C.text, fontSize: 12, padding: '5px 8px', borderRadius: 6, outline: 'none', fontFamily: 'inherit', minWidth: 160 },
    kpiGrid: { display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6,1fr)', gap: 8 },
    kpiCard: { background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' },
    kpiLbl:  { fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '.5px', marginBottom: 4 },
    kpiVal:  { fontSize: isMobile ? 15 : 18, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' },
    tableWrap: { overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, flex: 1 },
    btn:     { display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit' },
    row:     { borderBottom: `1px solid ${C.border}` },
    th:      { textAlign: 'left' as const, padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '.5px', whiteSpace: 'nowrap' as const, cursor: 'pointer', background: C.surf3, userSelect: 'none' as const },
    td:      { padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums', verticalAlign: 'middle' as const },
  }

  function AchvBadge({ val }: { val: number | null | undefined }) {
    const cls = achvClass(val)
    const color = cls === 'high' ? C.green : cls === 'mid' ? C.amber : C.red
    const bg    = cls === 'high' ? 'rgba(34,197,94,.12)' : cls === 'mid' ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)'
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, color, background: bg, minWidth: 54, textAlign: 'center' }}>
        {fmtPct(val)}
      </span>
    )
  }

  function StatusChip({ val }: { val: string }) {
    const active = String(val).toUpperCase() === 'ACTIVE'
    return (
      <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: active ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)', color: active ? C.green : C.red }}>
        {val}
      </span>
    )
  }

  const TH = ({ col, label }: { col: string; label: string }) => (
    <th style={S.th} onClick={() => handleSort(col)}>{label}{sortIcon(col)}</th>
  )

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.title}>
          📊 Store-wise Sale Dashboard
          {cacheInfo && (
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>
              {cacheInfo.from === 'cache' ? '⚡' : '🔄'} {cacheInfo.total.toLocaleString()} rows · {cacheInfo.elapsed}ms · {cacheInfo.from}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...S.btn, background: C.surf1, color: C.sub, border: `1px solid ${C.border2}` }} onClick={exportCSV} disabled={!rows.length}>
            ⬇ Export CSV
          </button>
          <button
            style={{ ...S.btn, background: loading ? C.muted : C.accent, color: '#fff', opacity: loading ? 0.7 : 1 }}
            onClick={() => load(true)}
            disabled={loading}
          >
            {loading ? '⏳ Loading…' : '🔄 Refresh Oracle'}
          </button>
        </div>
      </div>

      {/* Alert banner */}
      <div style={S.alert}>
        ⚠️ <strong>Period comparison (TY vs LY):</strong> These views are season-period aggregates.
        Columns available: <strong>SL_V (TY Sale), LM_SL_V (LY Sale), ACHV_PER (TY%), LM_ACHV_PER (LY%), MTD_SL_V, TO_V, PROJ_V.</strong>
        &nbsp;Day-wise / festive-date filtering requires a separate daily transaction table — confirm the Oracle table name to add it.
      </div>

      {/* Filters */}
      <div style={S.filters}>
        <div style={S.fg}>
          <span style={S.flabel}>Campaign</span>
          <select style={S.sel} value={selAttr1} onChange={e => setSelAttr1(e.target.value)}>
            <option value="">All</option>
            {filters.attribute1.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={S.fg}>
          <span style={S.flabel}>Zone / Cluster</span>
          <select style={S.sel} value={selZone} onChange={e => setSelZone(e.target.value)}>
            <option value="">All</option>
            {filters.cluster_type.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={S.fg}>
          <span style={S.flabel}>District</span>
          <select style={S.sel} value={selDist} onChange={e => setSelDist(e.target.value)}>
            <option value="">All</option>
            {filters.district.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={S.fg}>
          <span style={S.flabel}>Division</span>
          <select style={S.sel} value={selDiv} onChange={e => setSelDiv(e.target.value)}>
            <option value="">All</option>
            {filters.division.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={S.fg}>
          <span style={S.flabel}>Store Status</span>
          <select style={S.sel} value={selStatus} onChange={e => setSelStatus(e.target.value)}>
            <option value="">All</option>
            {filters.store_status.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={S.fg}>
          <span style={S.flabel}>Search Store</span>
          <input
            style={S.sinput}
            placeholder="Store name…"
            value={storeSearch}
            onChange={e => setStoreSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: `1px solid ${C.red}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.red }}>
          ❌ {error}
        </div>
      )}

      {/* KPI Strip */}
      <div style={S.kpiGrid}>
        {KPI_COLS.map(k => (
          <div key={k.key} style={S.kpiCard}>
            <div style={S.kpiLbl}>{k.label}</div>
            <div style={S.kpiVal}>
              {k.fmt === 'v' ? fmtV(kpiValues[k.key]) : fmtPct(kpiValues[k.key])}
            </div>
            {k.key === 'sl_v' && kpiValues['lm_sl_v'] > 0 && (
              <div style={{ fontSize: 11, marginTop: 3 }}>
                {(() => {
                  const g = ((kpiValues['sl_v'] - kpiValues['lm_sl_v']) / kpiValues['lm_sl_v']) * 100
                  return <span style={{ color: g >= 0 ? C.green : C.red, fontWeight: 600 }}>{g >= 0 ? '+' : ''}{g.toFixed(1)}% vs LY</span>
                })()}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Store-wise TY vs LY Comparison</span>
        <span style={{ fontSize: 11, color: C.sub }}>
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} stores · Page ${page} / ${totalPages}`}
        </span>
      </div>

      <div style={S.tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: C.surf3, borderBottom: `2px solid ${C.border}` }}>
              <TH col="store_name"   label="Store" />
              <TH col="cluster_type" label="Zone" />
              <TH col="district"     label="District" />
              <TH col="store_status" label="Status" />
              <th style={{ ...S.th, borderLeft: `1px solid ${C.border2}`, color: '#38bdf8' }}>TY Sale ₹</th>
              <th style={{ ...S.th, color: '#38bdf8' }}>TY Target ₹</th>
              <th style={{ ...S.th, color: '#38bdf8' }} onClick={() => handleSort('achv_per')}>TY Achv%{sortIcon('achv_per')}</th>
              <th style={{ ...S.th, borderLeft: `1px solid ${C.border2}`, color: '#4ade80' }}>LY Sale ₹</th>
              <th style={{ ...S.th, color: '#4ade80' }}>LY Target ₹</th>
              <th style={{ ...S.th, color: '#4ade80' }} onClick={() => handleSort('lm_achv_per')}>LY Achv%{sortIcon('lm_achv_per')}</th>
              <th style={{ ...S.th, borderLeft: `1px solid ${C.border2}`, color: '#fcd34d' }}>MTD Sale ₹</th>
              <th style={{ ...S.th, color: '#fcd34d' }}>TO Value ₹</th>
              <th style={{ ...S.th, borderLeft: `1px solid ${C.border2}` }} onClick={() => handleSort('proj_v')}>Proj ₹{sortIcon('proj_v')}</th>
              <th style={S.th} onClick={() => handleSort('_growth')}>Growth%{sortIcon('_growth')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !pageRows.length ? (
              <tr><td colSpan={14} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.sub }}>⏳ Fetching data from Oracle…<br /><span style={{ fontSize: 11 }}>First load may take 2–3 minutes</span></td></tr>
            ) : !pageRows.length ? (
              <tr><td colSpan={14} style={{ ...S.td, textAlign: 'center', padding: 32, color: C.sub }}>No data. Apply filters or refresh Oracle.</td></tr>
            ) : pageRows.map((r, i) => {
              const ty  = Number(r.sl_v)   || 0
              const ly  = Number(r.lm_sl_v) || 0
              const growth = ly ? ((ty - ly) / ly * 100) : null
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 1 ? 'rgba(255,255,255,.015)' : 'transparent' }}>
                  <td style={{ ...S.td, fontWeight: 600, color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {String(r.store_name ?? '—')}
                    {!!r.store_f_name && r.store_f_name !== r.store_name && (
                      <div style={{ fontSize: 10, color: C.sub }}>{String(r.store_f_name)}</div>
                    )}
                  </td>
                  <td style={S.td}>{String(r.cluster_type ?? '—')}</td>
                  <td style={S.td}>{String(r.district ?? '—')}</td>
                  <td style={S.td}><StatusChip val={String(r.store_status ?? '')} /></td>
                  <td style={{ ...S.td, borderLeft: `1px solid ${C.border2}` }}>{fmtV(r.sl_v as number)}</td>
                  <td style={S.td}>{fmtV(r.tgt_v as number)}</td>
                  <td style={S.td}><AchvBadge val={r.achv_per as number} /></td>
                  <td style={{ ...S.td, borderLeft: `1px solid ${C.border2}` }}>{fmtV(r.lm_sl_v as number)}</td>
                  <td style={S.td}>{fmtV(r.lm_tgt_v as number)}</td>
                  <td style={S.td}><AchvBadge val={r.lm_achv_per as number} /></td>
                  <td style={{ ...S.td, borderLeft: `1px solid ${C.border2}` }}>{fmtV(r.mtd_sl_v as number)}</td>
                  <td style={S.td}>{fmtV(r.to_v as number)}</td>
                  <td style={{ ...S.td, borderLeft: `1px solid ${C.border2}` }}>{fmtV(r.proj_v as number)}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: growth == null ? C.sub : growth >= 0 ? C.green : C.red }}>
                    {growth == null ? '—' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                width: 30, height: 30, borderRadius: 6, border: `1px solid ${p === page ? C.accent : C.border}`,
                background: p === page ? C.accent : C.surf1, color: p === page ? '#fff' : C.sub,
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
              }}
            >{p}</button>
          ))}
        </div>
      )}
    </div>
  )
}
