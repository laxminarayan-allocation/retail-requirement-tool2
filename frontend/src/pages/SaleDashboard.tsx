import { useEffect, useState, useMemo, useRef } from 'react'
import http from '@/api/http'

// ── 8-Week types ──────────────────────────────────────────────────────────────
interface WeekGroup {
  week: number; label: string; dates: string[]; start: string; end: string
}
interface SaleRow {
  store_name: string; store_name_short: string; store_name_f: string
  zone: string; state: string; grade: string
  yesterday_val: number; yesterday_qty: number
  six_w_val: number; six_w_qty: number
  week_sums: number[]
  mtd_val: number; lm_val: number
  dates: Record<string, number>
}
interface Summary {
  rows: SaleRow[]; count: number; sale_date: string
  period_start: string; mtd_start: string; lm_start: string; lm_end: string
  dates: string[]; weeks: WeekGroup[]
}

// ── 2Y Weekly types ───────────────────────────────────────────────────────────
interface WeekMeta  { key: string; start: string; store_count?: number }
interface MonthMeta { key: string; label: string; store_count?: number; weeks: WeekMeta[] }
interface WRow {
  store_name: string; total_val: number; total_qty: number
  month_val: Record<string, number>; month_qty: Record<string, number>
  week_val: Record<string, number>; week_qty: Record<string, number>
}
interface WSummary { rows: WRow[]; count: number; months: MonthMeta[] }

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt  = (n: number) => n.toLocaleString('en-IN')
const fmtV = (n: number) =>
  n >= 1_00_00_000 ? `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  : n >= 1_00_000   ? `₹${(n / 1_00_000).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`
const fmtQ = (n: number) =>
  n >= 1_00_000 ? `${(n / 1_00_000).toFixed(1)}L`
  : n >= 1000   ? `${(n / 1000).toFixed(1)}K`
  : String(Math.round(n))
const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getDate()}-${dt.toLocaleString('en', { month: 'short' })}`
}
const wkLabel = (k: string) => k.split('-')[1] ?? k

type SortKey8 = 'store_name' | 'yesterday_val' | 'six_w_val' | 'max_week_val' | 'mtd_val' | 'lm_val' | string
type SortKeyW = 'store_name' | 'total_val' | string

// ── Sale Pivot Component ──────────────────────────────────────────────────────
type PivotRow = { [key: string]: any }
type PivotAgg = 'sum' | 'count' | 'avg' | 'max' | 'min' | 'pct'
type PivotValSpec = { col: string; agg: string }
type PivotPreset = {
  name: string; rowDims: string[]; colDims: string[]; valSpecs: PivotValSpec[]
  colFilters: Record<string, any>; search: string; showTop: number
  condEnabled: boolean; condLo: string; condHi: string
}

const SALE_PIVOT_DIMS = [
  'division','section','department','article_name','attribute1','color','cat1','season','sz_grp',
  'sitecode','store_name','store_name_f','city_name','state','cluster_type','zone',
  'sale_year','sale_month','sale_month_label','sale_week','icode',
]
const SALE_PIVOT_VALS = ['sale_netamt','sale_qty']
const PIVOT_AGG_OPTIONS: PivotAgg[] = ['sum','count','avg','max','min','pct']

function toNumP(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return isFinite(n) ? n : 0
}
function fmtP(v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))))
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return String(v)
}

function SalePivot() {
  const [rowDims,   setRowDims]   = useState<string[]>(['division'])
  const [colDims,   setColDims]   = useState<string[]>([])
  const [valSpecs,  setValSpecs]  = useState<PivotValSpec[]>([{ col: 'sale_netamt', agg: 'sum' }])
  const [sortCol,   setSortCol]   = useState('')
  const [sortDir,   setSortDir]   = useState<'asc'|'desc'>('desc')
  const [search,    setSearch]    = useState('')
  const [showTop,   setShowTop]   = useState(0)
  const [condEnabled, setCondEnabled] = useState(false)
  const [condLo,    setCondLo]    = useState('')
  const [condHi,    setCondHi]    = useState('')

  // filters
  const [divFilter, setDivFilter] = useState('')
  const [seasonFilter, setSeasonFilter] = useState('')
  const [attr1Filter, setAttr1Filter] = useState('')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')

  const [pivotRows, setPivotRows] = useState<PivotRow[]>([])
  const [pivotCols, setPivotCols] = useState<string[]>([])
  const [grandTotal, setGrandTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchRef = useRef(0)

  // Presets
  const [presets, setPresets] = useState<PivotPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [showPresets, setShowPresets] = useState(false)

  useEffect(() => {
    http.get('/sale/pivot/presets').then(r => setPresets(r.data?.data?.presets ?? [])).catch(() => {})
  }, [])

  async function savePreset() {
    const name = presetName.trim(); if (!name) return
    const preset: PivotPreset = { name, rowDims, colDims, valSpecs, colFilters: {}, search, showTop, condEnabled, condLo, condHi }
    try { const r = await http.post('/sale/pivot/presets', preset); setPresets(r.data?.data?.presets ?? []) } catch {}
    setPresetName('')
  }
  function loadPreset(p: PivotPreset) {
    setRowDims(p.rowDims); setColDims(p.colDims); setValSpecs(p.valSpecs)
    setSearch(p.search ?? ''); setShowTop(p.showTop ?? 0)
    setCondEnabled(p.condEnabled ?? false); setCondLo(p.condLo ?? ''); setCondHi(p.condHi ?? '')
    setShowPresets(false)
  }
  async function deletePreset(name: string) {
    try { const r = await http.delete(`/sale/pivot/presets/${encodeURIComponent(name)}`); setPresets(r.data?.data?.presets ?? []) } catch {}
  }

  const valSpecsStr = valSpecs.map(v => `${v.col}:${v.agg}`).join(',')

  async function runPivot() {
    if (!rowDims.length) return
    const id = ++fetchRef.current
    setLoading(true); setError(null)
    try {
      const params: any = {
        rows: rowDims.join(','), cols: colDims.join(','), values: valSpecsStr,
        division: divFilter, season: seasonFilter, attribute1: attr1Filter,
        year_from: yearFrom, year_to: yearTo,
      }
      const res = await http.get('/sale/pivot', { params, timeout: 120000 })
      if (id !== fetchRef.current) return
      const d = res.data?.data ?? {}
      setPivotRows(d.rows ?? [])
      setPivotCols(d.columns ?? [])
      setGrandTotal(d.grand_total ?? 0)
      const firstNum = (d.columns ?? []).find((c: string) => (d.rows ?? []).length > 0 && typeof (d.rows ?? [])[0][c] === 'number')
      if (firstNum) { setSortCol(firstNum); setSortDir('desc') }
    } catch (e: any) {
      if (id !== fetchRef.current) return
      setError(e?.response?.data?.message || 'Pivot failed')
    } finally { if (id === fetchRef.current) setLoading(false) }
  }

  const toggleRowDim = (c: string) => { setColDims(d => d.filter(x => x !== c)); setRowDims(d => d.includes(c) ? d.filter(x => x !== c) : [...d, c]) }
  const toggleColDim = (c: string) => { setRowDims(d => d.filter(x => x !== c)); setColDims(d => d.includes(c) ? d.filter(x => x !== c) : [...d, c]) }

  const filtered = useMemo(() => {
    let data = pivotRows
    if (search) data = data.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    if (sortCol) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
        return sortDir === 'asc' ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''))
      })
    }
    return showTop > 0 ? data.slice(0, showTop) : data
  }, [pivotRows, search, sortCol, sortDir, showTop])

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const pth: React.CSSProperties = {
    padding: '7px 8px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
    borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'right',
  }
  const ptd: React.CSSProperties = { padding: '5px 8px', fontSize: 11, borderBottom: '1px solid var(--card-border)', whiteSpace: 'nowrap', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
  const ptdL: React.CSSProperties = { ...ptd, textAlign: 'left' }
  const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, padding: '5px 9px', fontSize: 12, color: 'var(--input-color)', outline: 'none' }
  const chip = (on: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 20,
    fontSize: 11, fontWeight: on ? 700 : 400, cursor: 'pointer', userSelect: 'none',
    border: `1px solid ${on ? '#818cf8' : 'var(--card-border)'}`,
    background: on ? '#818cf833' : 'transparent', color: on ? '#818cf8' : 'var(--text-muted)', margin: 2,
  })
  const chipC = (on: boolean): React.CSSProperties => ({
    ...chip(on), border: `1px solid ${on ? '#f59e0b' : 'var(--card-border)'}`,
    background: on ? '#f59e0b22' : 'transparent', color: on ? '#f59e0b' : 'var(--text-muted)',
  })

  return (
    <div>
      {/* ── Builder ── */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        {/* Top row: title + preset + run */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Sale Pivot Builder &nbsp;<span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>T_CUSTOM_COGS × V_ITEM_MASTER</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input value={presetName} onChange={e => setPresetName(e.target.value)} onKeyDown={e => e.key === 'Enter' && savePreset()} placeholder="Preset naam…" style={{ ...inp, width: 130 }} />
            <button onClick={savePreset} disabled={!presetName.trim()} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #4ade8066', background: presetName.trim() ? '#4ade8022' : 'transparent', color: presetName.trim() ? '#4ade80' : 'var(--text-muted)', fontWeight: 700, fontSize: 12, cursor: presetName.trim() ? 'pointer' : 'default' }}>💾 Save</button>
            {presets.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowPresets(v => !v)} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--card-border)', background: showPresets ? '#4f46e522' : 'var(--input-bg)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  📂 Presets <span style={{ background: '#4f46e5', color: '#fff', borderRadius: 10, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>{presets.length}</span>
                </button>
                {showPresets && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 200, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, minWidth: 200, boxShadow: '0 8px 24px #0006', overflow: 'hidden' }}>
                    {presets.map(p => (
                      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--card-border)' }}>
                        <span onClick={() => loadPreset(p)} style={{ flex: 1, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }} title={`Rows: ${p.rowDims.join(', ')}`}>{p.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.rowDims.join('+')}</span>
                        <span onClick={() => deletePreset(p.name)} style={{ cursor: 'pointer', color: '#f87171', fontSize: 13, padding: '0 2px' }}>✕</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button onClick={runPivot} disabled={loading} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: loading ? '#374151' : '#4f46e5', color: loading ? 'var(--text-muted)' : '#fff', fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 2px 8px #4f46e566' }}>
              {loading ? '⏳ Running…' : '▶ Run Pivot'}
            </button>
          </div>
        </div>

        {/* Dims + values */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: '#1d4ed811', border: '1px solid #1d4ed844', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 6 }}><span style={{ background: '#1d4ed833', borderRadius: 4, padding: '1px 6px' }}>ROW</span> <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>dimension</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', maxHeight: 110, overflowY: 'auto' }}>
              {SALE_PIVOT_DIMS.map(c => <span key={c} onClick={() => toggleRowDim(c)} style={chip(rowDims.includes(c))}>{c}</span>)}
            </div>
          </div>
          <div style={{ background: '#f59e0b0d', border: '1px solid #f59e0b33', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}><span style={{ background: '#f59e0b22', borderRadius: 4, padding: '1px 6px' }}>COLUMN</span> <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>cross-tab (optional)</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', maxHeight: 110, overflowY: 'auto' }}>
              {SALE_PIVOT_DIMS.map(c => <span key={c} onClick={() => toggleColDim(c)} style={chipC(colDims.includes(c))}>{c}</span>)}
            </div>
          </div>
          <div style={{ background: '#4ade800d', border: '1px solid #4ade8033', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#4ade8022', borderRadius: 4, padding: '1px 6px' }}>VALUES</span>
              <span onClick={() => setValSpecs(v => [...v, { col: 'sale_netamt', agg: 'sum' }])} style={{ fontSize: 10, fontWeight: 600, cursor: 'pointer', color: '#4ade80', border: '1px solid #4ade8044', borderRadius: 10, padding: '1px 8px', marginLeft: 'auto' }}>+ Add</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {valSpecs.map((vs, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <select style={{ ...inp, flex: 1, fontSize: 11 }} value={vs.col} onChange={e => setValSpecs(v => v.map((s, idx) => idx === i ? { ...s, col: e.target.value } : s))}>
                    {SALE_PIVOT_VALS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select style={{ ...inp, width: 70, fontSize: 11 }} value={vs.agg} onChange={e => setValSpecs(v => v.map((s, idx) => idx === i ? { ...s, agg: e.target.value } : s))}>
                    {PIVOT_AGG_OPTIONS.map(a => <option key={a} value={a}>{a === 'pct' ? 'cont%' : a.toUpperCase()}</option>)}
                  </select>
                  {valSpecs.length > 1 && <span onClick={() => setValSpecs(v => v.filter((_, idx) => idx !== i))} style={{ cursor: 'pointer', color: '#f87171', fontSize: 13 }}>✕</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pre-filters */}
        <div style={{ borderTop: '1px solid var(--card-border)', paddingTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Division</div><input style={{ ...inp, width: 120 }} placeholder="e.g. KIDS" value={divFilter} onChange={e => setDivFilter(e.target.value)} /></div>
          <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Season (contains)</div><input style={{ ...inp, width: 100 }} placeholder="e.g. SS26" value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)} /></div>
          <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Attribute1</div><input style={{ ...inp, width: 110 }} placeholder="PREWINTER" value={attr1Filter} onChange={e => setAttr1Filter(e.target.value)} /></div>
          <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Year from</div><input style={{ ...inp, width: 70 }} placeholder="2024" value={yearFrom} onChange={e => setYearFrom(e.target.value)} /></div>
          <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Year to</div><input style={{ ...inp, width: 70 }} placeholder="2026" value={yearTo} onChange={e => setYearTo(e.target.value)} /></div>
          <div style={{ borderLeft: '1px solid var(--card-border)', paddingLeft: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Search result</div><input style={{ ...inp, width: 140 }} placeholder="Filter rows…" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Top N (0=all)</div><input type="number" style={{ ...inp, width: 65 }} min={0} value={showTop} onChange={e => setShowTop(Number(e.target.value))} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Color</div>
              <span style={{ ...chip(condEnabled), padding: '3px 10px' }} onClick={() => setCondEnabled(v => !v)}>{condEnabled ? 'ON' : 'OFF'}</span>
            </div>
            {condEnabled && <>
              <div><div style={{ fontSize: 10, color: '#f87171', marginBottom: 3 }}>Red ≤</div><input type="number" style={{ ...inp, width: 70 }} value={condLo} onChange={e => setCondLo(e.target.value)} /></div>
              <div><div style={{ fontSize: 10, color: '#4ade80', marginBottom: 3 }}>Green ≥</div><input type="number" style={{ ...inp, width: 70 }} value={condHi} onChange={e => setCondHi(e.target.value)} /></div>
            </>}
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Pivot chal raha hai… (pehli baar 10-30s lag sakta hai)</div>}
      {error && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}
      {!loading && !error && pivotRows.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Dimensions choose karo aur ▶ Run Pivot click karo.</div>
      )}

      {!loading && pivotRows.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--card-border)' }}>
          <div style={{ padding: '8px 12px', background: 'var(--card-bg)', borderBottom: '1px solid var(--card-border)', display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{filtered.length.toLocaleString()} / {pivotRows.length.toLocaleString()} rows</span>
            <span>Value: <b style={{ color: '#818cf8' }}>{valSpecs.map(v => `${v.col}(${v.agg})`).join(', ')}</b></span>
            <span>Grand Total: <b style={{ color: '#4ade80' }}>{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b></span>
          </div>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'auto', width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr>
                {pivotCols.map(h => (
                  <th key={h} onClick={() => handleSort(h)} style={{ ...pth, textAlign: 'left' }}>
                    {h.toUpperCase()} {sortCol === h ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--sidebar-bg)44' }}>
                  {pivotCols.map(h => {
                    const val = row[h]
                    const isNum = typeof val === 'number'
                    const bg = isNum && condEnabled ? (val >= Number(condHi || 0) && condHi ? '#14532d' : val <= Number(condLo || 0) && condLo ? '#450a0a' : undefined) : undefined
                    return <td key={h} style={{ ...(isNum ? ptd : ptdL), background: bg, color: isNum && val < 0 ? '#f87171' : undefined }}>{isNum ? fmtP(val) : (val ?? '—')}</td>
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--sidebar-bg)', fontWeight: 700 }}>
                {pivotCols.map((h, i) => {
                  const total = i === 0 ? null : typeof filtered[0]?.[h] === 'number' ? filtered.reduce((s, r) => s + toNumP(r[h]), 0) : null
                  return <td key={h} style={{ ...ptd, borderTop: '2px solid var(--card-border)' }}>{i === 0 ? `TOTAL (${filtered.length})` : total !== null ? fmtP(total) : ''}</td>
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

export default function SaleDashboard() {
  const [view, setView] = useState<'8week' | '2year' | 'pivot'>('8week')

  // ── 8-Week state ────────────────────────────────────────────────────────────
  const [data,     setData]     = useState<Summary | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [search,   setSearch]   = useState('')
  const [sort,     setSort]     = useState<SortKey8>('yesterday_val')
  const [asc,      setAsc]      = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set([2, 3, 4, 5, 6, 7, 8]))
  const [selectedWeeks, setSelectedWeeks] = useState<Set<number>>(new Set([1]))

  // ── 2Y Weekly state ─────────────────────────────────────────────────────────
  const [wData,    setWData]    = useState<WSummary | null>(null)
  const [wLoading, setWLoading] = useState(false)
  const [wError,   setWError]   = useState('')
  const [wSearch,  setWSearch]  = useState('')
  const [wSort,    setWSort]    = useState<SortKeyW>('total_val')
  const [wAsc,     setWAsc]     = useState(false)
  const [wMode,    setWMode]    = useState<'val' | 'qty'>('val')
  const [wCollapsed, setWCollapsed] = useState<Set<string>>(new Set())

  // Load 8-week data on mount
  useEffect(() => {
    http.get('/sale/store-summary')
      .then(r => { if (r.data.success) setData(r.data.data); else setError(r.data.message || 'Load failed') })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Load 2Y weekly data when tab switched
  useEffect(() => {
    if (view !== '2year' || wData || wLoading) return
    setWLoading(true)
    http.get('/sale/weekly-summary')
      .then(r => {
        if (r.data.success) {
          setWData(r.data.data)
          if (r.data.data?.months)
            setWCollapsed(new Set(r.data.data.months.map((m: MonthMeta) => m.key)))
        } else setWError(r.data.message || 'Load failed')
      })
      .catch(e => setWError(String(e)))
      .finally(() => setWLoading(false))
  }, [view])

  // ── 8-Week helpers ──────────────────────────────────────────────────────────
  const toggleWeek = (w: number) => setCollapsed(prev => { const n = new Set(prev); n.has(w) ? n.delete(w) : n.add(w); return n })
  const weekSum = (row: SaleRow, wk: WeekGroup) => wk.dates.reduce((s, d) => s + (row.dates[d] ?? 0), 0)
  const topNVal = (row: SaleRow) => row.week_sums.reduce((s, v, i) => selectedWeeks.has(i + 1) ? s + v : s, 0)
  const toggleSelWk = (w: number) => setSelectedWeeks(prev => {
    const n = new Set(prev); if (n.has(w)) { if (n.size > 1) n.delete(w) } else n.add(w); return n
  })

  const rows = useMemo(() => {
    if (!data) return []
    let r = data.rows
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(s => s.store_name.toLowerCase().includes(q) || s.store_name_f.toLowerCase().includes(q) || s.zone.toLowerCase().includes(q) || s.state.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      let av: number | string, bv: number | string
      if (sort === 'store_name')         { av = a.store_name; bv = b.store_name }
      else if (sort === 'yesterday_val') { av = a.yesterday_val; bv = b.yesterday_val }
      else if (sort === 'six_w_val')     { av = a.six_w_val; bv = b.six_w_val }
      else if (sort === 'max_week_val')  { av = topNVal(a); bv = topNVal(b) }
      else if (sort === 'mtd_val')       { av = a.mtd_val; bv = b.mtd_val }
      else if (sort === 'lm_val')        { av = a.lm_val; bv = b.lm_val }
      else                               { av = a.dates[sort] ?? 0; bv = b.dates[sort] ?? 0 }
      if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [data, search, sort, asc])

  // ── 2Y Weekly helpers ───────────────────────────────────────────────────────
  const toggleMonth = (mk: string) => setWCollapsed(prev => { const n = new Set(prev); n.has(mk) ? n.delete(mk) : n.add(mk); return n })
  const wVal = (r: WRow, key: string, type: 'week' | 'month') =>
    wMode === 'val' ? (type === 'week' ? r.week_val[key] ?? 0 : r.month_val[key] ?? 0)
                    : (type === 'week' ? r.week_qty[key] ?? 0 : r.month_qty[key] ?? 0)
  const wFmt = (n: number) => wMode === 'val' ? fmtV(n) : fmtQ(n)

  const wRows = useMemo(() => {
    if (!wData) return []
    let r = wData.rows
    if (wSearch.trim()) { const q = wSearch.toLowerCase(); r = r.filter(s => s.store_name.toLowerCase().includes(q)) }
    return [...r].sort((a, b) => {
      let av: number | string, bv: number | string
      if (wSort === 'store_name')  { av = a.store_name; bv = b.store_name }
      else if (wSort === 'total_val') { av = wMode === 'val' ? a.total_val : a.total_qty; bv = wMode === 'val' ? b.total_val : b.total_qty }
      else { av = wVal(a, wSort, 'month'); bv = wVal(b, wSort, 'month') }
      if (typeof av === 'number' && typeof bv === 'number') return wAsc ? av - bv : bv - av
      return wAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [wData, wSearch, wSort, wAsc, wMode])

  const weeks  = data?.weeks ?? []
  const t1     = data?.sale_date ?? ''
  const months = wData?.months ?? []

  const totYday = rows.reduce((s, r) => s + r.yesterday_val, 0)
  const totSixW = rows.reduce((s, r) => s + r.six_w_val, 0)
  const totMtd  = rows.reduce((s, r) => s + r.mtd_val, 0)
  const totLm   = rows.reduce((s, r) => s + r.lm_val, 0)

  const toggleSort  = (k: SortKey8) => { if (sort === k) setAsc(a => !a); else { setSort(k); setAsc(false) } }
  const arrow       = (k: SortKey8) => sort === k ? (asc ? ' ↑' : ' ↓') : ''
  const wToggleSort = (k: SortKeyW) => { if (wSort === k) setWAsc(a => !a); else { setWSort(k); setWAsc(false) } }
  const wArrow      = (k: SortKeyW) => wSort === k ? (wAsc ? ' ↑' : ' ↓') : ''

  const thBase: React.CSSProperties = {
    padding: '7px 6px', fontSize: 10, fontWeight: 700,
    color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase',
    borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'right',
  }
  const td: React.CSSProperties = {
    padding: '5px 6px', fontSize: 11, borderBottom: '1px solid var(--card-border)',
    fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap',
  }
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-muted)', fontSize: 14 }}>
      Loading sale data...
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12, padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontWeight: 700 }}>Could not load sale data</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440 }}>{error}</div>
    </div>
  )

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Sale Dashboard</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            T-1: <strong style={{ color: '#38bdf8' }}>{fmtDate(t1)} ({t1})</strong>
            &nbsp;·&nbsp; 6 Weeks: <strong style={{ color: '#818cf8' }}>{fmtDate(data?.period_start ?? '')} – {fmtDate(t1)}</strong>
            &nbsp;·&nbsp; {data?.count} stores
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
            {([['8week', '8-Week Sale'], ['2year', '2Y Weekly'], ['pivot', '📊 Pivot']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 14px', fontSize: 11, cursor: 'pointer', border: 'none',
                background: view === v ? (v === 'pivot' ? '#818cf8' : '#22d3ee') : 'transparent',
                color: view === v ? (v === 'pivot' ? '#fff' : '#000') : 'var(--text-muted)',
                fontWeight: view === v ? 800 : 400,
              }}>{label}</button>
            ))}
          </div>
          {view === '2year' && (
            <div style={{ display: 'flex', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['val', 'qty'] as const).map(m => (
                <button key={m} onClick={() => setWMode(m)} style={{
                  padding: '5px 12px', fontSize: 11, cursor: 'pointer', border: 'none',
                  background: wMode === m ? '#818cf8' : 'transparent',
                  color: wMode === m ? '#fff' : 'var(--text-muted)',
                  fontWeight: wMode === m ? 700 : 400,
                }}>{m === 'val' ? '₹ Value' : 'Qty'}</button>
              ))}
            </div>
          )}
          {view !== 'pivot' && (
            <input
              placeholder="Search store..."
              value={view === '8week' ? search : wSearch}
              onChange={e => view === '8week' ? setSearch(e.target.value) : setWSearch(e.target.value)}
              style={{
                background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                borderRadius: 6, padding: '5px 10px', fontSize: 12,
                color: 'var(--text-primary)', outline: 'none', width: 190,
              }}
            />
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* 8-WEEK VIEW                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === '8week' && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { label: `${fmtDate(t1)} Sale`, val: fmtV(totYday), sub: `${fmt(rows.reduce((s,r)=>s+r.yesterday_qty,0))} pcs`, color: '#38bdf8' },
              { label: 'MTD Sale',            val: fmtV(totMtd),  sub: fmtDate(data?.mtd_start ?? '') + ' – ' + fmtDate(t1), color: '#818cf8' },
              { label: 'Last Month',          val: fmtV(totLm),   sub: fmtDate(data?.lm_start ?? '') + ' – ' + fmtDate(data?.lm_end ?? ''), color: '#a78bfa' },
              { label: '8-Week Sale',         val: fmtV(totSixW), sub: `${fmt(rows.reduce((s,r)=>s+r.six_w_qty,0))} pcs`, color: '#22d3ee' },
              { label: 'Stores Selling',      val: String(rows.filter(r => r.yesterday_val > 0).length), sub: `of ${data?.count}`, color: '#34d399' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${k.color}` }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{k.val}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Collapse legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Weeks:</span>
            {weeks.map(wk => (
              <button key={wk.week} onClick={() => toggleWeek(wk.week)} style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                background: collapsed.has(wk.week) ? 'var(--card-bg)' : '#1e293b',
                border: `1px solid ${collapsed.has(wk.week) ? 'var(--card-border)' : '#818cf8'}`,
                color: collapsed.has(wk.week) ? 'var(--text-muted)' : '#818cf8',
                fontWeight: collapsed.has(wk.week) ? 400 : 700,
              }}>{wk.label} {fmtDate(wk.end)}–{fmtDate(wk.start)} {collapsed.has(wk.week) ? '▶' : '▼'}</button>
            ))}
            <button onClick={() => setCollapsed(new Set(weeks.map(w => w.week)))}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
              Collapse All</button>
            <button onClick={() => setCollapsed(new Set())}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
              Expand All</button>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>Max Wk weeks:</span>
            {Array.from({ length: weeks.length }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => toggleSelWk(n)} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                background: selectedWeeks.has(n) ? '#f59e0b' : 'transparent',
                border: `1px solid ${selectedWeeks.has(n) ? '#f59e0b' : 'var(--card-border)'}`,
                color: selectedWeeks.has(n) ? '#000' : 'var(--text-muted)',
                fontWeight: selectedWeeks.has(n) ? 800 : 400,
              }}>W{n}</button>
            ))}
            <button onClick={() => setSelectedWeeks(new Set(weeks.map(w => w.week)))}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: '#f59e0b' }}>
              All</button>
          </div>

          {/* 8-Week Table */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, textAlign: 'left', width: 24 }}>#</th>
                    <th style={{ ...thBase, textAlign: 'left', minWidth: 90 }} onClick={() => toggleSort('store_name')}>Store{arrow('store_name')}</th>
                    <th onClick={() => toggleSort('yesterday_val')} style={{ ...thBase, color: '#38bdf8', fontWeight: 800, minWidth: 76, borderLeft: '2px solid #38bdf826' }}>
                      {fmtDate(t1)}{arrow('yesterday_val')}
                    </th>
                    {weeks.map(wk => {
                      const isCollapsed = collapsed.has(wk.week)
                      if (isCollapsed) return (
                        <th key={`wk-${wk.week}`} onClick={() => toggleWeek(wk.week)}
                          style={{ ...thBase, color: '#818cf8', minWidth: 76, borderLeft: '2px solid #818cf826', background: '#0f172a' }}>
                          {wk.label} ▶
                        </th>
                      )
                      return wk.dates.filter(d => d !== t1).map((d, di) => (
                        <th key={d} onClick={() => di === 0 ? toggleWeek(wk.week) : toggleSort(d)}
                          style={{ ...thBase, color: di === 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: di === 0 ? 700 : 400, minWidth: 66, borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>
                          {di === 0 ? `${wk.label} ▼ ` : ''}{fmtDate(d)}{di > 0 ? arrow(d) : ''}
                        </th>
                      ))
                    })}
                    <th onClick={() => toggleSort('max_week_val')} style={{ ...thBase, color: '#f59e0b', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #f59e0b26' }}>
                      {selectedWeeks.size === weeks.length ? 'All' : `W${[...selectedWeeks].sort().join('+W')}`} ₹{arrow('max_week_val')}
                    </th>
                    <th onClick={() => toggleSort('mtd_val')} style={{ ...thBase, color: '#818cf8', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #818cf826' }}>MTD{arrow('mtd_val')}</th>
                    <th onClick={() => toggleSort('lm_val')} style={{ ...thBase, color: '#a78bfa', minWidth: 80, fontWeight: 800 }}>LM{arrow('lm_val')}</th>
                    <th onClick={() => toggleSort('six_w_val')} style={{ ...thBase, color: '#22d3ee', minWidth: 80, fontWeight: 800 }}>8W ₹{arrow('six_w_val')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Total row */}
                  <tr style={{ background: '#0f172a' }}>
                    <td style={{ ...tdL, color: 'var(--text-muted)' }}></td>
                    <td style={{ ...tdL, fontWeight: 700, fontSize: 10, color: 'var(--text-secondary)' }}>TOTAL ({rows.length})</td>
                    <td style={{ ...td, fontWeight: 800, color: '#38bdf8', borderLeft: '2px solid #38bdf826' }}>{fmtV(totYday)}</td>
                    {weeks.map(wk => {
                      const isCollapsed = collapsed.has(wk.week)
                      const wkTotal = rows.reduce((s, r) => s + weekSum(r, wk), 0)
                      if (isCollapsed) return <td key={`wk-${wk.week}`} style={{ ...td, fontWeight: 700, color: '#818cf8', borderLeft: '2px solid #818cf826', background: '#0f172a' }}>{fmtV(wkTotal)}</td>
                      return wk.dates.filter(d => d !== t1).map((d, di) => {
                        const dTotal = rows.reduce((s, r) => s + (r.dates[d] ?? 0), 0)
                        return <td key={d} style={{ ...td, fontWeight: 700, color: di === 0 ? '#818cf8' : 'var(--text-secondary)', borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>{fmtV(dTotal)}</td>
                      })
                    })}
                    <td style={{ ...td, fontWeight: 800, color: '#f59e0b', borderLeft: '2px solid #f59e0b26' }}>{fmtV(rows.reduce((s, r) => s + topNVal(r), 0))}</td>
                    <td style={{ ...td, fontWeight: 800, color: '#818cf8', borderLeft: '2px solid #818cf826' }}>{fmtV(totMtd)}</td>
                    <td style={{ ...td, fontWeight: 800, color: '#a78bfa' }}>{fmtV(totLm)}</td>
                    <td style={{ ...td, fontWeight: 800, color: '#22d3ee' }}>{fmtV(totSixW)}</td>
                  </tr>
                  {/* Store count row */}
                  {(() => {
                    const cntStyle: React.CSSProperties = { ...td, fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }
                    const cntBadge = (n: number, total: number) => {
                      const pct = total > 0 ? n / total : 0
                      const color = pct >= 0.9 ? '#34d399' : pct >= 0.7 ? '#f59e0b' : '#f87171'
                      return <span style={{ color, fontWeight: 700, fontSize: 10 }}>{n}</span>
                    }
                    const t = rows.length
                    return (
                      <tr style={{ background: '#080d18', borderTop: '1px dashed #1e293b' }}>
                        <td style={{ ...tdL, fontSize: 9 }}></td>
                        <td style={{ ...tdL, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>stores &gt;0</td>
                        <td style={{ ...cntStyle, borderLeft: '2px solid #38bdf826' }}>{cntBadge(rows.filter(r => r.yesterday_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                        {weeks.map(wk => {
                          const isCollapsed = collapsed.has(wk.week)
                          if (isCollapsed) return <td key={`cnt-wk-${wk.week}`} style={{ ...cntStyle, borderLeft: '2px solid #818cf826', background: '#080d18' }}>{cntBadge(rows.filter(r => weekSum(r, wk) > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                          return wk.dates.filter(d => d !== t1).map((d, di) => <td key={`cnt-${d}`} style={{ ...cntStyle, borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>{cntBadge(rows.filter(r => (r.dates[d] ?? 0) > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>)
                        })}
                        <td style={{ ...cntStyle, borderLeft: '2px solid #f59e0b26' }}>{cntBadge(rows.filter(r => topNVal(r) > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                        <td style={{ ...cntStyle, borderLeft: '2px solid #818cf826' }}>{cntBadge(rows.filter(r => r.mtd_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                        <td style={cntStyle}>{cntBadge(rows.filter(r => r.lm_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                        <td style={cntStyle}>{cntBadge(rows.filter(r => r.six_w_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                      </tr>
                    )
                  })()}
                  {rows.map((r, i) => (
                    <tr key={r.store_name}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'var(--content-bg)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--content-bg)')}>
                      <td style={{ ...tdL, color: 'var(--text-muted)', fontSize: 10 }}>{i + 1}</td>
                      <td style={tdL}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>{r.store_name_f || r.store_name_short || r.store_name}</div>
                        {(r.store_name_f || r.store_name_short) && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>#{r.store_name}</div>}
                      </td>
                      <td style={{ ...td, color: r.yesterday_val > 0 ? '#38bdf8' : 'var(--text-muted)', fontWeight: r.yesterday_val > 0 ? 700 : 400, opacity: r.yesterday_val === 0 ? 0.35 : 1, borderLeft: '2px solid #38bdf826' }}>
                        {r.yesterday_val > 0 ? fmtV(r.yesterday_val) : '—'}
                      </td>
                      {weeks.map(wk => {
                        const isCollapsed = collapsed.has(wk.week)
                        const ws = weekSum(r, wk)
                        if (isCollapsed) return <td key={`wk-${wk.week}`} style={{ ...td, color: ws > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: ws > 0 ? 600 : 400, opacity: ws === 0 ? 0.35 : 1, borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>{ws > 0 ? fmtV(ws) : '—'}</td>
                        return wk.dates.filter(d => d !== t1).map((d, di) => {
                          const v = r.dates[d] ?? 0
                          return <td key={d} style={{ ...td, color: v > 0 ? (di === 0 ? '#818cf8' : 'var(--text-secondary)') : 'var(--text-muted)', fontWeight: di === 0 && v > 0 ? 600 : 400, opacity: v === 0 ? 0.35 : 1, borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>{v > 0 ? fmtV(v) : '—'}</td>
                        })
                      })}
                      {(() => { const v = topNVal(r); return <td style={{ ...td, color: v > 0 ? '#f59e0b' : 'var(--text-muted)', fontWeight: v > 0 ? 700 : 400, borderLeft: '2px solid #f59e0b26' }}>{v > 0 ? fmtV(v) : '—'}</td> })()}
                      <td style={{ ...td, color: r.mtd_val > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: r.mtd_val > 0 ? 600 : 400, borderLeft: '2px solid #818cf826' }}>{r.mtd_val > 0 ? fmtV(r.mtd_val) : '—'}</td>
                      <td style={{ ...td, color: r.lm_val > 0 ? '#a78bfa' : 'var(--text-muted)', fontWeight: r.lm_val > 0 ? 600 : 400 }}>{r.lm_val > 0 ? fmtV(r.lm_val) : '—'}</td>
                      <td style={{ ...td, color: r.six_w_val > 0 ? '#22d3ee' : 'var(--text-muted)', fontWeight: r.six_w_val > 0 ? 700 : 400 }}>{fmtV(r.six_w_val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* 2Y WEEKLY VIEW                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === '2year' && (
        wLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: 'var(--text-muted)', fontSize: 14 }}>
            Loading 2-year weekly data...
          </div>
        ) : wError ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#f87171' }}>{wError}</div>
        ) : (
          <>
            {/* Sub-header */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {wData?.count} stores · {months.length} months · TY + LY
            </div>

            {/* Month collapse bar */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Months:</span>
              {months.map(m => (
                <button key={m.key} onClick={() => toggleMonth(m.key)} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
                  background: wCollapsed.has(m.key) ? 'var(--card-bg)' : '#1e293b',
                  border: `1px solid ${wCollapsed.has(m.key) ? 'var(--card-border)' : '#818cf8'}`,
                  color: wCollapsed.has(m.key) ? 'var(--text-muted)' : '#818cf8',
                  fontWeight: wCollapsed.has(m.key) ? 400 : 700,
                }}>{m.label} {wCollapsed.has(m.key) ? '▶' : '▼'}</button>
              ))}
              <button onClick={() => setWCollapsed(new Set(months.map(m => m.key)))}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
                Collapse All</button>
              <button onClick={() => setWCollapsed(new Set())}
                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
                Expand All</button>
            </div>

            {/* 2Y Table */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thBase, textAlign: 'left', width: 24 }}>#</th>
                      <th style={{ ...thBase, textAlign: 'left', minWidth: 80 }} onClick={() => wToggleSort('store_name')}>Store{wArrow('store_name')}</th>
                      {months.map(m => {
                        const isCollapsed = wCollapsed.has(m.key)
                        if (isCollapsed) return (
                          <th key={m.key} onClick={() => toggleMonth(m.key)}
                            style={{ ...thBase, color: '#818cf8', minWidth: 76, borderLeft: '2px solid #818cf826', background: '#0a0f1a', cursor: 'pointer' }}>
                            {m.label} ▶{wArrow(m.key)}
                          </th>
                        )
                        return m.weeks.map((wk, wi) => (
                          <th key={wk.key} onClick={() => wi === 0 ? toggleMonth(m.key) : wToggleSort(wk.key)}
                            style={{ ...thBase, color: wi === 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: wi === 0 ? 700 : 400, minWidth: 60, borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>
                            {wi === 0 ? `${m.label} ▼ ` : ''}{wkLabel(wk.key)}{wi > 0 ? wArrow(wk.key) : ''}
                          </th>
                        ))
                      })}
                      <th style={{ ...thBase, color: '#34d399', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #34d39926' }} onClick={() => wToggleSort('total_val')}>
                        2Y Total{wArrow('total_val')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Total row */}
                    <tr style={{ background: '#0f172a' }}>
                      <td style={{ ...tdL, color: 'var(--text-muted)' }}></td>
                      <td style={{ ...tdL, fontWeight: 700, fontSize: 10 }}>TOTAL ({wRows.length})</td>
                      {months.map(m => {
                        const isCollapsed = wCollapsed.has(m.key)
                        if (isCollapsed) return <td key={m.key} style={{ ...td, fontWeight: 700, color: '#818cf8', borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>{wFmt(wRows.reduce((s, r) => s + wVal(r, m.key, 'month'), 0))}</td>
                        return m.weeks.map((wk, wi) => <td key={wk.key} style={{ ...td, fontWeight: 700, color: wi === 0 ? '#818cf8' : 'var(--text-secondary)', borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>{wFmt(wRows.reduce((s, r) => s + wVal(r, wk.key, 'week'), 0))}</td>)
                      })}
                      <td style={{ ...td, fontWeight: 800, color: '#34d399', borderLeft: '2px solid #34d39926' }}>{wFmt(wRows.reduce((s, r) => s + (wMode === 'val' ? r.total_val : r.total_qty), 0))}</td>
                    </tr>
                    {/* Store count row — denominator = active stores that period (from opening_date) */}
                    {(() => {
                      const cntBadge = (n: number, total: number) => {
                        const pct = total > 0 ? n / total : 0
                        const color = pct >= 0.9 ? '#34d399' : pct >= 0.7 ? '#f59e0b' : '#f87171'
                        return <span style={{ color, fontWeight: 700, fontSize: 10 }}>{n}</span>
                      }
                      const totalEver = wRows.length
                      return (
                        <tr style={{ background: '#080d18', borderTop: '1px dashed #1e293b' }}>
                          <td style={{ ...tdL, fontSize: 9 }}></td>
                          <td style={{ ...tdL, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>stores &gt;0</td>
                          {months.map(m => {
                            const isCollapsed = wCollapsed.has(m.key)
                            if (isCollapsed) {
                              const denom = (m.store_count != null && m.store_count > 0) ? m.store_count : totalEver
                              return <td key={m.key} style={{ ...td, fontSize: 10, borderLeft: '2px solid #818cf826', background: '#080d18' }}>{cntBadge(wRows.filter(r => wVal(r, m.key, 'month') > 0).length, denom)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{denom}</span></td>
                            }
                            return m.weeks.map((wk, wi) => {
                              const denom = (wk.store_count != null && wk.store_count > 0) ? wk.store_count : totalEver
                              return <td key={wk.key} style={{ ...td, fontSize: 10, borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>{cntBadge(wRows.filter(r => wVal(r, wk.key, 'week') > 0).length, denom)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{denom}</span></td>
                            })
                          })}
                          <td style={{ ...td, fontSize: 10, borderLeft: '2px solid #34d39926' }}>{cntBadge(wRows.filter(r => (wMode === 'val' ? r.total_val : r.total_qty) > 0).length, totalEver)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{totalEver}</span></td>
                        </tr>
                      )
                    })()}
                    {wRows.map((r, i) => {
                      const rowTotal = wMode === 'val' ? r.total_val : r.total_qty
                      return (
                        <tr key={r.store_name}
                          style={{ background: i % 2 === 0 ? 'transparent' : 'var(--content-bg)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                          onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--content-bg)')}>
                          <td style={{ ...tdL, color: 'var(--text-muted)', fontSize: 10 }}>{i + 1}</td>
                          <td style={{ ...tdL, fontWeight: 600, color: 'var(--text-primary)' }}>{r.store_name}</td>
                          {months.map(m => {
                            const isCollapsed = wCollapsed.has(m.key)
                            if (isCollapsed) {
                              const v = wVal(r, m.key, 'month')
                              return <td key={m.key} style={{ ...td, color: v > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: v > 0 ? 600 : 400, opacity: v === 0 ? 0.3 : 1, borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>{v > 0 ? wFmt(v) : '—'}</td>
                            }
                            return m.weeks.map((wk, wi) => {
                              const v = wVal(r, wk.key, 'week')
                              return <td key={wk.key} style={{ ...td, color: v > 0 ? (wi === 0 ? '#818cf8' : 'var(--text-secondary)') : 'var(--text-muted)', fontWeight: wi === 0 && v > 0 ? 600 : 400, opacity: v === 0 ? 0.3 : 1, borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>{v > 0 ? wFmt(v) : '—'}</td>
                            })
                          })}
                          <td style={{ ...td, color: rowTotal > 0 ? '#34d399' : 'var(--text-muted)', fontWeight: 700, borderLeft: '2px solid #34d39926' }}>{wFmt(rowTotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PIVOT VIEW                                                             */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'pivot' && <SalePivot />}
    </div>
  )
}
