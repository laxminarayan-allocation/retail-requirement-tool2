import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import http from '@/api/http'
import { useTheme } from '@/context/ThemeContext'
import { useAuth } from '@/context/AuthContext'

type Row = { [key: string]: any }
type Agg = 'sum' | 'count' | 'avg' | 'max' | 'min'
type SortDir = 'asc' | 'desc' | null
type NumOp = '=' | '≠' | '>' | '>=' | '<' | '<=' | 'between'
type ColFilter =
  | { type: 'multi'; selected: string[] }
  | { type: 'num'; op: NumOp; val: string; val2: string }

// ── helpers ───────────────────────────────────────────────────────────────────
function toNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/,/g, ''))
  return isFinite(n) ? n : 0
}
function fmt(v: any, decimals = 2): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v))))
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: decimals })
  return String(v)
}
function aggregate(vals: number[], agg: Agg): number {
  if (!vals.length) return 0
  switch (agg) {
    case 'sum':   return vals.reduce((a, b) => a + b, 0)
    case 'count': return vals.length
    case 'avg':   return vals.reduce((a, b) => a + b, 0) / vals.length
    case 'max':   return Math.max(...vals)
    case 'min':   return Math.min(...vals)
  }
}
function cellColor(val: number, lo: number, hi: number, enabled: boolean): string | undefined {
  if (!enabled || (!lo && !hi)) return undefined
  if (hi && val >= hi) return '#14532d'
  if (lo && val <= lo) return '#450a0a'
  return '#78350f'
}
function isNumericCol(col: string, rows: Row[]): boolean {
  const sample = rows.slice(0, 50).map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '')
  if (!sample.length) return false
  return sample.filter(v => !isNaN(Number(v))).length / sample.length > 0.7
}
function applyColFilter(cellVal: any, f: ColFilter): boolean {
  if (f.type === 'multi') {
    if (!f.selected.length) return true
    return f.selected.includes(String(cellVal ?? ''))
  }
  const n = toNum(cellVal)
  const v = parseFloat(f.val)
  if (isNaN(v)) return true
  const v2 = parseFloat(f.val2)
  switch (f.op) {
    case '=':       return n === v
    case '≠':       return n !== v
    case '>':       return n > v
    case '>=':      return n >= v
    case '<':       return n < v
    case '<=':      return n <= v
    case 'between': return !isNaN(v2) ? n >= v && n <= v2 : n >= v
  }
}
function activeFiltersCount(filters: Record<string, ColFilter>): number {
  return Object.values(filters).filter(f =>
    f.type === 'multi' ? f.selected.length > 0 : f.val !== ''
  ).length
}

const PIVOT_DIMS = ['division','section','department','article_name','sitecode','sitealias',
  'stockpoint','attribute1','cat1','cat2','cat3','cat4','cat5','sz_grp','season','partyname','item_color','item_desc','icode']
const PIVOT_VALS = ['stock_qty','stock_v','mrp']
const NUM_OPS: NumOp[] = ['=','≠','>','>=','<','<=','between']

// ── Module-level page cache (survives navigation, cleared on explicit refresh) ─
const _cache: {
  rows: Row[]; columns: string[]; total: number; truncated: boolean
  queryTime: number | null; fromCache: boolean
  warehouse: string; itemCode: string; division: string
} | null = { rows: [], columns: [], total: 0, truncated: false, queryTime: null, fromCache: false, warehouse: '', itemCode: '', division: '' }
let _cacheReady = false

// ── Column resize ─────────────────────────────────────────────────────────────
const DEFAULT_WIDTH = 130
const MIN_WIDTH = 50

function loadWidths(key: string): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function saveWidths(key: string, w: Record<string, number>) {
  try { localStorage.setItem(key, JSON.stringify(w)) } catch {}
}

function useColResize(lsKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(lsKey))
  const dragging = useRef<{ col: string; startX: number; startW: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const { col, startX, startW } = dragging.current
      const newW = Math.max(MIN_WIDTH, startW + e.clientX - startX)
      setWidths(prev => ({ ...prev, [col]: newW }))
    }
    function onUp() {
      if (!dragging.current) return
      const { col } = dragging.current
      dragging.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidths(prev => { saveWidths(lsKey, prev); return prev })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [lsKey])

  function startResize(col: string, e: React.MouseEvent, currentW: number) {
    e.preventDefault(); e.stopPropagation()
    dragging.current = { col, startX: e.clientX, startW: currentW }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  function getW(col: string) { return widths[col] ?? DEFAULT_WIDTH }
  function resetWidths() { setWidths({}); saveWidths(lsKey, {}) }
  function applyWidths(w: Record<string, number>) {
    setWidths(prev => {
      // user-stored widths override auto-fit
      const merged = { ...w, ...prev }
      return merged
    })
  }
  return { getW, startResize, resetWidths, applyWidths }
}

function Resizer({ col, getW, startResize }: { col: string; getW: (c: string) => number; startResize: (c: string, e: React.MouseEvent, w: number) => void }) {
  return (
    <div
      onMouseDown={e => startResize(col, e, getW(col))}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 10, background: 'transparent' }}
    />
  )
}

// ── MultiSelectDropdown ───────────────────────────────────────────────────────
function MultiSelectDropdown({
  col, allValues, selected, onChange, tokens,
}: {
  col: string; allValues: string[]; selected: string[]; onChange: (v: string[]) => void; tokens: any
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        dropRef.current && !dropRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 220) })
    }
    setOpen(o => !o)
  }

  const filteredVals = useMemo(() => {
    const q = search.toLowerCase()
    return allValues.filter(v => !q || v.toLowerCase().includes(q)).slice(0, 300)
  }, [allValues, search])

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])

  const isActive = selected.length > 0
  const label = isActive ? `${col} (${selected.length})` : col

  return (
    <div style={{ display: 'inline-block', width: '100%' }}>
      <button
        ref={btnRef}
        onClick={openMenu}
        style={{
          width: '100%', padding: '3px 7px', fontSize: 11, textAlign: 'left', cursor: 'pointer',
          background: isActive ? '#1d4ed833' : tokens.inputBg,
          border: `1px solid ${isActive ? '#60a5fa' : tokens.inputBorder}`,
          borderRadius: 4, color: isActive ? '#60a5fa' : tokens.textMuted,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
          overflow: 'hidden',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && dropPos && (
        <div
          ref={dropRef}
          style={{
            position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width,
            zIndex: 9999, minWidth: 200, maxWidth: 300,
            background: '#0f172a', border: `1px solid ${tokens.cardBorder}`, borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.7)', padding: 6,
          }}
        >
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', fontSize: 11, marginBottom: 4,
              background: tokens.inputBg, border: `1px solid ${tokens.inputBorder}`, borderRadius: 4,
              color: tokens.inputColor, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <button onClick={() => onChange(allValues)} style={{ flex: 1, fontSize: 10, padding: '2px 0', background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#94a3b8', cursor: 'pointer' }}>All</button>
            <button onClick={() => onChange([])} style={{ flex: 1, fontSize: 10, padding: '2px 0', background: '#1e293b', border: '1px solid #334155', borderRadius: 3, color: '#94a3b8', cursor: 'pointer' }}>None</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filteredVals.map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', cursor: 'pointer', borderRadius: 3, fontSize: 11, color: tokens.textPrimary }}>
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} style={{ cursor: 'pointer' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '(empty)'}</span>
              </label>
            ))}
            {filteredVals.length === 0 && <div style={{ fontSize: 11, color: tokens.textMuted, padding: 4 }}>No match</div>}
            {allValues.length > 300 && <div style={{ fontSize: 10, color: tokens.textMuted, padding: '4px 4px 0' }}>+{allValues.length - 300} more — refine search</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── NumericFilterInput ────────────────────────────────────────────────────────
function NumericFilterInput({
  col, filter, onChange, tokens,
}: {
  col: string; filter: { op: NumOp; val: string; val2: string }; onChange: (f: { op: NumOp; val: string; val2: string }) => void; tokens: any
}) {
  const isActive = filter.val !== ''
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', width: '100%' }}>
      <select
        value={filter.op}
        onChange={e => onChange({ ...filter, op: e.target.value as NumOp })}
        style={{ fontSize: 10, padding: '3px 3px', background: isActive ? '#1d4ed833' : tokens.inputBg,
          border: `1px solid ${isActive ? '#60a5fa' : tokens.inputBorder}`, borderRadius: 4,
          color: isActive ? '#60a5fa' : tokens.textMuted, outline: 'none', flexShrink: 0 }}
      >
        {NUM_OPS.map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input
        type="number"
        value={filter.val}
        onChange={e => onChange({ ...filter, val: e.target.value })}
        placeholder={col}
        style={{ flex: 1, minWidth: 0, padding: '3px 5px', fontSize: 11,
          background: isActive ? '#1d4ed822' : tokens.inputBg,
          border: `1px solid ${isActive ? '#60a5fa' : tokens.inputBorder}`,
          borderRadius: 4, color: tokens.inputColor, outline: 'none' }}
      />
      {filter.op === 'between' && (
        <input
          type="number"
          value={filter.val2}
          onChange={e => onChange({ ...filter, val2: e.target.value })}
          placeholder="to"
          style={{ flex: 1, minWidth: 0, padding: '3px 5px', fontSize: 11,
            background: isActive ? '#1d4ed822' : tokens.inputBg,
            border: `1px solid ${isActive ? '#60a5fa' : tokens.inputBorder}`,
            borderRadius: 4, color: tokens.inputColor, outline: 'none' }}
        />
      )}
    </div>
  )
}

// ── Smart column filter (auto-detects type) ───────────────────────────────────
function ColFilterCell({
  col, rows, filter, onChange, tokens,
}: {
  col: string; rows: Row[]; filter: ColFilter | undefined; onChange: (f: ColFilter | undefined) => void; tokens: any
}) {
  const isNum = useMemo(() => isNumericCol(col, rows), [col, rows])
  const uniqueVals = useMemo(() => {
    if (isNum) return []
    const s = new Set(rows.map(r => String(r[col] ?? '')))
    return Array.from(s).sort()
  }, [col, rows, isNum])

  if (isNum) {
    const f = filter?.type === 'num' ? filter : { type: 'num' as const, op: '>' as NumOp, val: '', val2: '' }
    return (
      <NumericFilterInput
        col={col}
        filter={f}
        onChange={nf => onChange(nf.val === '' ? undefined : { type: 'num', ...nf })}
        tokens={tokens}
      />
    )
  }

  const sel = filter?.type === 'multi' ? filter.selected : []
  return (
    <MultiSelectDropdown
      col={col}
      allValues={uniqueVals}
      selected={sel}
      onChange={vals => onChange(vals.length ? { type: 'multi', selected: vals } : undefined)}
      tokens={tokens}
    />
  )
}

// ── Pivot Component ───────────────────────────────────────────────────────────
function PivotTable({ filters }: { filters: { warehouse: string; item_code: string; division: string } }) {
  const { tokens } = useTheme()

  type ValSpec = { col: string; agg: string }
  const AGG_OPTIONS = ['sum', 'count', 'avg', 'max', 'min', 'pct']

  const [rowDims, setRowDims]   = useState<string[]>(['division'])
  const [colDims, setColDims]   = useState<string[]>([])
  const [valSpecs, setValSpecs] = useState<ValSpec[]>([{ col: 'stock_qty', agg: 'sum' }])
  const [sortCol, setSortCol]   = useState<string>('')
  const [sortDir, setSortDir]   = useState<SortDir>('desc')
  const [search, setSearch]     = useState('')
  const [condEnabled, setCondEnabled] = useState(false)
  const [condLo, setCondLo]     = useState('')
  const [condHi, setCondHi]     = useState('')
  const [showTop, setShowTop]   = useState(0)
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({})

  const [pivotRows, setPivotRows]   = useState<Row[]>([])
  const [pivotCols, setPivotCols]   = useState<string[]>([])
  const [grandTotal, setGrandTotal] = useState(0)
  const [grandTotals, setGrandTotals] = useState<Record<string, number>>({})
  const [isCrossTab, setIsCrossTab] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const fetchRef = useRef(0)
  const { getW: getPW, startResize: startPResize, resetWidths: resetPWidths, applyWidths: applyPWidths } = useColResize('wh_col_widths_pivot_v1')

  // ── Presets (server-side) ─────────────────────────────────────────────────────
  type PivotPreset = { name: string; rowDims: string[]; colDims: string[]; valSpecs: ValSpec[]; colFilters: Record<string, ColFilter>; search: string; showTop: number; condEnabled: boolean; condLo: string; condHi: string }
  const [presets, setPresets] = useState<PivotPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [showPresetPanel, setShowPresetPanel] = useState(false)

  useEffect(() => {
    http.get('/warehouse-inventory/presets')
      .then(r => setPresets(r.data?.data?.presets ?? []))
      .catch(() => {})
  }, [])

  async function savePreset() {
    const name = presetName.trim()
    if (!name) return
    const preset: PivotPreset = { name, rowDims, colDims, valSpecs, colFilters, search, showTop, condEnabled, condLo, condHi }
    try {
      const r = await http.post('/warehouse-inventory/presets', preset)
      setPresets(r.data?.data?.presets ?? [])
    } catch {}
    setPresetName('')
  }
  function loadPreset(p: PivotPreset) {
    setRowDims(p.rowDims)
    setColDims(p.colDims)
    setValSpecs(p.valSpecs)
    setColFilters(p.colFilters ?? {})
    setSearch(p.search ?? '')
    setShowTop(p.showTop ?? 0)
    setCondEnabled(p.condEnabled ?? false)
    setCondLo(p.condLo ?? '')
    setCondHi(p.condHi ?? '')
    setShowPresetPanel(false)
  }
  async function deletePreset(name: string) {
    try {
      const r = await http.delete(`/warehouse-inventory/presets/${encodeURIComponent(name)}`)
      setPresets(r.data?.data?.presets ?? [])
    } catch {}
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const valSpecsStr = valSpecs.map(v => `${v.col}:${v.agg}`).join(',')

  async function runPivot() {
    if (!rowDims.length) return
    const id = ++fetchRef.current
    setLoading(true); setError(null)
    try {
      const params: any = { rows: rowDims.join(','), cols: colDims.join(','), values: valSpecsStr, ...filters }
      const res = await http.get('/warehouse-inventory/pivot', { params, timeout: 60000 })
      if (id !== fetchRef.current) return
      const d = res.data?.data ?? {}
      const rows: Row[] = d.rows ?? []
      const cols: string[] = d.columns ?? []
      setPivotRows(rows)
      setPivotCols(cols)
      setGrandTotal(d.grand_total ?? 0)
      setGrandTotals(d.grand_totals ?? {})
      setIsCrossTab((d.col_dims ?? []).length > 0)
      // auto-fit widths from content (user overrides kept via applyWidths merge)
      const autoW: Record<string, number> = {}
      cols.forEach(col => {
        const headerLen = col.length
        const maxValLen = rows.slice(0, 60).reduce((mx, r) => Math.max(mx, String(r[col] ?? '').length), 0)
        autoW[col] = Math.max(70, Math.min(280, Math.max(headerLen, maxValLen) * 8 + 24))
      })
      applyPWidths(autoW)
      // default sort: first numeric col high→low
      const firstNumCol = cols.find(c => rows.length > 0 && typeof rows[0][c] === 'number')
      if (firstNumCol) { setSortCol(firstNumCol); setSortDir('desc') }
    } catch (e: any) {
      if (id !== fetchRef.current) return
      setError(e?.response?.data?.message || 'Pivot failed')
    } finally { setLoading(false) }
  }

  // No auto-run — user must click Run Pivot manually to avoid repeated API calls on every chip click

  const toggleRowDim = (col: string) => {
    setColDims(d => d.filter(x => x !== col))
    setRowDims(d => d.includes(col) ? d.filter(x => x !== col) : [...d, col])
  }
  const toggleColDim = (col: string) => {
    setRowDims(d => d.filter(x => x !== col))
    setColDims(d => d.includes(col) ? d.filter(x => x !== col) : [...d, col])
  }
  const addValSpec    = () => setValSpecs(v => [...v, { col: 'stock_qty', agg: 'sum' }])
  const removeValSpec = (i: number) => setValSpecs(v => v.length > 1 ? v.filter((_, idx) => idx !== i) : v)
  const updateValSpec = (i: number, key: keyof ValSpec, val: string) =>
    setValSpecs(v => v.map((s, idx) => idx === i ? { ...s, [key]: val } : s))

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const setColFilter = useCallback((col: string, f: ColFilter | undefined) => {
    setColFilters(prev => {
      const next = { ...prev }
      if (f === undefined) delete next[col]
      else next[col] = f
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    let data = pivotRows
    const q = search.toLowerCase()
    if (q) data = data.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)))
    for (const [col, f] of Object.entries(colFilters)) {
      data = data.filter(r => applyColFilter(r[col], f))
    }
    if (sortCol && sortDir) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
        return sortDir === 'asc' ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''))
      })
    }
    return showTop > 0 ? data.slice(0, showTop) : data
  }, [pivotRows, search, colFilters, sortCol, sortDir, showTop])

  const activeCount = activeFiltersCount(colFilters)

  const S = {
    card: { background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 10, padding: 14, marginBottom: 14 },
    label: { fontSize: 11, color: tokens.textMuted, marginBottom: 5, fontWeight: 600 },
    input: { background: tokens.inputBg, border: `1px solid ${tokens.inputBorder}`, borderRadius: 6, padding: '5px 9px', fontSize: 12, color: tokens.inputColor, outline: 'none' },
    select: { background: tokens.inputBg, border: `1px solid ${tokens.inputBorder}`, borderRadius: 6, padding: '5px 9px', fontSize: 12, color: tokens.inputColor, outline: 'none' },
    chip: (on: boolean) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? tokens.accent : tokens.cardBorder}`, background: on ? tokens.accent + '33' : 'transparent', color: on ? tokens.accent : tokens.textMuted, margin: '2px', userSelect: 'none' as const }),
    th: { background: tokens.sidebarBg, color: tokens.textMuted, padding: '8px 10px', textAlign: 'left' as const, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' as const, borderBottom: `1px solid ${tokens.cardBorder}`, cursor: 'pointer', userSelect: 'none' as const },
    td: { padding: '6px 10px', fontSize: 12, color: tokens.textPrimary, borderBottom: `1px solid ${tokens.cardBorder}`, whiteSpace: 'nowrap' as const },
    tdNum: { padding: '6px 10px', fontSize: 12, color: tokens.textPrimary, borderBottom: `1px solid ${tokens.cardBorder}`, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  }

  return (
    <div>
      {/* ── Builder ── */}
      <div style={{ ...S.card, padding: 16 }}>
        {/* Header row with Run button + Presets */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary }}>Pivot Builder</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Preset save input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePreset()}
                placeholder="Preset naam…"
                style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${tokens.inputBorder}`, background: tokens.inputBg, color: tokens.inputColor, fontSize: 12, width: 130, outline: 'none' }}
              />
              <button
                onClick={savePreset}
                disabled={!presetName.trim()}
                title="Current setup save karo"
                style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid #4ade8066`, background: presetName.trim() ? '#4ade8022' : 'transparent', color: presetName.trim() ? '#4ade80' : tokens.textMuted, fontWeight: 700, fontSize: 12, cursor: presetName.trim() ? 'pointer' : 'default' }}
              >💾 Save</button>
            </div>

            {/* Load preset dropdown */}
            {presets.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowPresetPanel(v => !v)}
                  style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${tokens.cardBorder}`, background: showPresetPanel ? tokens.accent + '22' : tokens.inputBg, color: tokens.textPrimary, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  📂 Presets <span style={{ background: '#4f46e5', color: '#fff', borderRadius: 10, fontSize: 10, padding: '0 5px', fontWeight: 700 }}>{presets.length}</span>
                </button>
                {showPresetPanel && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 200, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 8, minWidth: 200, boxShadow: '0 8px 24px #0006', overflow: 'hidden' }}>
                    {presets.map(p => (
                      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${tokens.cardBorder}` }}>
                        <span
                          onClick={() => loadPreset(p)}
                          style={{ flex: 1, cursor: 'pointer', fontSize: 12, color: tokens.textPrimary, fontWeight: 600 }}
                          title={`Rows: ${p.rowDims.join(', ')} | Cols: ${p.colDims.join(', ') || 'none'} | Values: ${p.valSpecs.map(v => `${v.col}(${v.agg})`).join(', ')}`}
                        >
                          {p.name}
                        </span>
                        <span style={{ fontSize: 10, color: tokens.textMuted }}>{p.rowDims.join('+')}</span>
                        <span
                          onClick={() => deletePreset(p.name)}
                          style={{ cursor: 'pointer', color: '#f87171', fontSize: 13, padding: '0 2px', flexShrink: 0 }}
                          title="Delete"
                        >✕</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={runPivot}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 20px', borderRadius: 8, border: 'none',
                background: loading ? '#374151' : '#4f46e5',
                color: loading ? tokens.textMuted : '#fff',
                fontWeight: 700, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 2px 8px #4f46e566',
                transition: 'background 0.15s',
              }}
            >
              {loading ? '⏳ Running…' : '▶ Run Pivot'}
            </button>
          </div>
        </div>

        {/* Dimensions + Values row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* ROW dims */}
          <div style={{ background: '#1d4ed811', border: '1px solid #1d4ed844', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ background: '#1d4ed833', borderRadius: 4, padding: '1px 6px' }}>ROW</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: tokens.textMuted }}>dimension</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 110, overflowY: 'auto' }}>
              {PIVOT_DIMS.map(c => (
                <span key={c} onClick={() => toggleRowDim(c)} style={{
                  display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 20,
                  fontSize: 11, fontWeight: rowDims.includes(c) ? 700 : 400, cursor: 'pointer',
                  border: `1px solid ${rowDims.includes(c) ? '#60a5fa' : tokens.cardBorder}`,
                  background: rowDims.includes(c) ? '#1d4ed833' : 'transparent',
                  color: rowDims.includes(c) ? '#60a5fa' : tokens.textMuted,
                  userSelect: 'none',
                }}>{c}</span>
              ))}
            </div>
          </div>

          {/* COLUMN dims */}
          <div style={{ background: '#f59e0b0d', border: '1px solid #f59e0b33', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ background: '#f59e0b22', borderRadius: 4, padding: '1px 6px' }}>COLUMN</span>
              <span style={{ fontSize: 10, fontWeight: 400, color: tokens.textMuted }}>cross-tab (optional)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 110, overflowY: 'auto' }}>
              {PIVOT_DIMS.map(c => (
                <span key={c} onClick={() => toggleColDim(c)} style={{
                  display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 20,
                  fontSize: 11, fontWeight: colDims.includes(c) ? 700 : 400, cursor: 'pointer',
                  border: `1px solid ${colDims.includes(c) ? '#f59e0b' : tokens.cardBorder}`,
                  background: colDims.includes(c) ? '#f59e0b22' : 'transparent',
                  color: colDims.includes(c) ? '#f59e0b' : tokens.textMuted,
                  userSelect: 'none',
                }}>{c}</span>
              ))}
            </div>
          </div>

          {/* VALUES */}
          <div style={{ background: '#4ade800d', border: '1px solid #4ade8033', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4ade80', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#4ade8022', borderRadius: 4, padding: '1px 6px' }}>VALUES</span>
              <span onClick={addValSpec} style={{ fontSize: 10, fontWeight: 600, cursor: 'pointer', color: '#4ade80', border: '1px solid #4ade8044', borderRadius: 10, padding: '1px 8px', marginLeft: 'auto' }}>+ Add</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {valSpecs.map((vs, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <select style={{ ...S.select, flex: 1, fontSize: 11 }} value={vs.col} onChange={e => updateValSpec(i, 'col', e.target.value)}>
                    {PIVOT_VALS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select style={{ ...S.select, width: 65, fontSize: 11 }} value={vs.agg} onChange={e => updateValSpec(i, 'agg', e.target.value)}>
                    {AGG_OPTIONS.map(a => <option key={a} value={a}>{a === 'pct' ? 'cont%' : a.toUpperCase()}</option>)}
                  </select>
                  {valSpecs.length > 1 && (
                    <span style={{ cursor: 'pointer', color: '#f87171', fontSize: 13, padding: '0 3px' }} onClick={() => removeValSpec(i)}>✕</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Options row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 10, borderTop: `1px solid ${tokens.cardBorder}` }}>
          <div>
            <div style={{ ...S.label, marginBottom: 4 }}>Search result</div>
            <input style={{ ...S.input, width: 160 }} placeholder="Filter rows…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div>
            <div style={{ ...S.label, marginBottom: 4 }}>Top N <span style={{ fontWeight: 400 }}>(0=all)</span></div>
            <input type="number" style={{ ...S.input, width: 70 }} min={0} value={showTop} onChange={e => setShowTop(Number(e.target.value))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ ...S.label, marginBottom: 0 }}>Cond color</div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
              border: `1px solid ${condEnabled ? tokens.accent : tokens.cardBorder}`,
              background: condEnabled ? tokens.accent + '33' : 'transparent',
              color: condEnabled ? tokens.accent : tokens.textMuted,
            }} onClick={() => setCondEnabled(v => !v)}>{condEnabled ? 'ON' : 'OFF'}</span>
          </div>
          {condEnabled && (
            <>
              <div><div style={{ fontSize: 10, color: '#f87171', marginBottom: 3 }}>Red ≤</div><input type="number" style={{ ...S.input, width: 70 }} value={condLo} onChange={e => setCondLo(e.target.value)} placeholder="100" /></div>
              <div><div style={{ fontSize: 10, color: '#4ade80', marginBottom: 3 }}>Green ≥</div><input type="number" style={{ ...S.input, width: 70 }} value={condHi} onChange={e => setCondHi(e.target.value)} placeholder="1000" /></div>
            </>
          )}
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 30, color: tokens.textMuted }}>Pivot chal raha hai…</div>}
      {error && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}
      {!loading && !error && rowDims.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: tokens.textMuted }}>Row Dimension choose karo.</div>
      )}

      {!loading && pivotRows.length > 0 && (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${tokens.cardBorder}` }}>
          <div style={{ padding: '8px 12px', background: tokens.sidebarBg, borderBottom: `1px solid ${tokens.cardBorder}`, display: 'flex', gap: 12, fontSize: 11, color: tokens.textMuted, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: tokens.textPrimary }}>{filtered.length.toLocaleString()} / {pivotRows.length.toLocaleString()} rows</span>
            {isCrossTab && <span style={{ background: '#f59e0b33', color: '#f59e0b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>CROSS-TAB</span>}
            <span>Value: <b style={{ color: tokens.accent }}>{valSpecs.map(v => `${v.col}(${v.agg})`).join(', ')}</b></span>
            <span>Grand Total: <b style={{ color: '#4ade80' }}>{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</b></span>
            {activeCount > 0 && (
              <span style={{ cursor: 'pointer', color: '#f87171', fontSize: 11 }} onClick={() => setColFilters({})}>✕ Clear {activeCount} filter{activeCount > 1 ? 's' : ''}</span>
            )}
            <span style={{ cursor: 'pointer', color: tokens.textMuted, fontSize: 11, marginLeft: 'auto' }} onClick={resetPWidths}>↔ Reset widths</span>
          </div>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed' as const, width: 'max-content', minWidth: '100%' }}>
            <colgroup>
              {pivotCols.map(h => <col key={h} style={{ width: getPW(h) }} />)}
            </colgroup>
            <thead>
              <tr>
                {pivotCols.map(h => (
                  <th key={h} style={{ ...S.th, position: 'relative', width: getPW(h) }} onClick={() => handleSort(h)}>
                    <span style={{ display: 'block', paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.toUpperCase()} {sortCol === h ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                    <Resizer col={h} getW={getPW} startResize={startPResize} />
                  </th>
                ))}
              </tr>
              {/* ── Smart column filters ── */}
              <tr style={{ background: tokens.sidebarBg }}>
                {pivotCols.map(h => (
                  <th key={h} style={{ padding: '3px 5px', borderBottom: `2px solid ${tokens.cardBorder}`, width: getPW(h) }}>
                    <ColFilterCell col={h} rows={pivotRows} filter={colFilters[h]} onChange={f => setColFilter(h, f)} tokens={tokens} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : tokens.sidebarBg + '44' }}>
                  {pivotCols.map(h => {
                    const val = row[h]
                    const isNum = typeof val === 'number'
                    const isNeg = isNum && val < 0
                    const bg = isNum && condEnabled ? cellColor(val, Number(condLo || 0), Number(condHi || 0), condEnabled) : undefined
                    return (
                      <td key={h} style={{ ...(isNum ? S.tdNum : S.td), background: bg, color: isNeg ? '#f87171' : undefined }}>
                        {isNum ? fmt(val) : (val ?? '—')}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: tokens.sidebarBg, fontWeight: 700 }}>
                {pivotCols.map((h, i) => {
                  const total = i === 0 ? null : typeof filtered[0]?.[h] === 'number' ? filtered.reduce((s, r) => s + toNum(r[h]), 0) : null
                  return (
                    <td key={h} style={{ ...S.tdNum, borderTop: `2px solid ${tokens.cardBorder}`, color: total !== null && total < 0 ? '#f87171' : tokens.textPrimary }}>
                      {i === 0 ? `TOTAL (${filtered.length})` : total !== null ? fmt(total) : ''}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Data Table ───────────────────────────────────────────────────────────
function DataTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  const { tokens } = useTheme()
  const [search, setSearch]   = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [page, setPage]       = useState(1)
  const [colFilters, setColFilters] = useState<Record<string, ColFilter>>({})
  const [showFilters, setShowFilters] = useState(true)
  const PAGE_SIZE = 100
  const { getW, startResize, resetWidths } = useColResize('wh_col_widths_data_v1')

  function downloadCSV(data: Row[], cols: string[], filename: string) {
    const header = cols.join(',')
    const body = data.map(r =>
      cols.map(c => {
        const v = r[c] ?? ''
        const s = String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const setColFilter = useCallback((col: string, f: ColFilter | undefined) => {
    setColFilters(prev => {
      const next = { ...prev }
      if (f === undefined) delete next[col]
      else next[col] = f
      return next
    })
    setPage(1)
  }, [])

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
      if (sortDir === null) setSortCol(null)
    } else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }

  const filtered = useMemo(() => {
    let data = rows
    const q = search.toLowerCase()
    if (q) data = data.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)))
    for (const [col, f] of Object.entries(colFilters)) {
      data = data.filter(r => applyColFilter(r[col], f))
    }
    if (sortCol && sortDir) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        const an = Number(av), bn = Number(bv)
        if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an
        return sortDir === 'asc' ? String(av ?? '').localeCompare(String(bv ?? '')) : String(bv ?? '').localeCompare(String(av ?? ''))
      })
    }
    return data
  }, [rows, search, sortCol, sortDir, colFilters])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const activeCount = activeFiltersCount(colFilters)

  const S = {
    input:   { background: tokens.inputBg, border: `1px solid ${tokens.inputBorder}`, borderRadius: 6, padding: '5px 9px', fontSize: 12, color: tokens.inputColor, outline: 'none' },
    btnGhost:{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${tokens.cardBorder}`, cursor: 'pointer', fontSize: 12, background: 'transparent', color: tokens.textMuted },
    th:      { background: tokens.sidebarBg, color: tokens.textMuted, padding: '7px 9px', textAlign: 'left' as const, fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' as const, borderBottom: `1px solid ${tokens.cardBorder}`, cursor: 'pointer', userSelect: 'none' as const, position: 'sticky' as const, top: 0, overflow: 'hidden' as const },
    thFilter:{ background: tokens.sidebarBg, padding: '3px 4px', borderBottom: `2px solid ${tokens.cardBorder}`, position: 'sticky' as const, top: 33 },
    td:      { padding: '6px 9px', fontSize: 12, color: tokens.textPrimary, borderBottom: `1px solid ${tokens.cardBorder}`, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, maxWidth: 300 as const, textOverflow: 'ellipsis' as const },
    tdNum:   { padding: '6px 9px', fontSize: 12, color: tokens.textPrimary, borderBottom: `1px solid ${tokens.cardBorder}`, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  }

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...S.input, minWidth: 240 }} placeholder="🔍 Search all columns…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <button
          style={{ ...S.btnGhost, color: showFilters ? tokens.accent : tokens.textMuted, borderColor: showFilters ? tokens.accent : tokens.cardBorder }}
          onClick={() => setShowFilters(v => !v)}
        >
          🔽 Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {activeCount > 0 && (
          <button style={{ ...S.btnGhost, color: '#f87171', borderColor: '#f87171' }} onClick={() => { setColFilters({}); setPage(1) }}>✕ Clear filters</button>
        )}
        <button style={S.btnGhost} onClick={resetWidths} title="Reset column widths">↔ Reset widths</button>
        <button
          style={{ ...S.btnGhost, color: '#4ade80', borderColor: '#4ade80' }}
          onClick={() => downloadCSV(filtered, columns, `warehouse_filtered_${Date.now()}.csv`)}
          title="Download filtered rows as CSV"
        >⬇ CSV ({filtered.length.toLocaleString()})</button>
        <button
          style={S.btnGhost}
          onClick={() => downloadCSV(rows, columns, `warehouse_all_${Date.now()}.csv`)}
          title="Download all rows as CSV"
        >⬇ All CSV</button>
        <span style={{ fontSize: 12, color: tokens.textMuted, marginLeft: 'auto' }}>
          {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} rows · Page {page}/{totalPages}
        </span>
        <button style={S.btnGhost} disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
        <button style={S.btnGhost} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
        <button style={S.btnGhost} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
        <button style={S.btnGhost} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last »</button>
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${tokens.cardBorder}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' as const, width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {columns.map(col => <col key={col} style={{ width: getW(col) }} />)}
          </colgroup>
          <thead>
            {/* Sort row */}
            <tr>
              <th style={{ ...S.th, width: 36 }}>#</th>
              {columns.map(col => (
                <th key={col} style={{ ...S.th, position: 'relative', width: getW(col) }} onClick={() => { handleSort(col); setPage(1) }}>
                  <span style={{ display: 'block', paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {col.toUpperCase()} {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                  </span>
                  <Resizer col={col} getW={getW} startResize={startResize} />
                </th>
              ))}
            </tr>
            {/* Smart filter row */}
            {showFilters && (
              <tr>
                <th style={{ ...S.thFilter, width: 36 }} />
                {columns.map(col => (
                  <th key={col} style={{ ...S.thFilter, width: getW(col) }}>
                    <ColFilterCell col={col} rows={rows} filter={colFilters[col]} onChange={f => setColFilter(col, f)} tokens={tokens} />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : tokens.sidebarBg + '44' }}>
                  <td style={{ ...S.td, color: tokens.textMuted, textAlign: 'center' }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                  {columns.map(col => {
                    const val = row[col]
                    const isNum = val !== null && val !== undefined && !isNaN(Number(val)) && typeof val !== 'boolean'
                    return (
                      <td key={col} style={isNum ? S.tdNum : S.td}>
                        {val === null || val === undefined ? '—' : isNum ? fmt(val) : String(val)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WarehouseInventory() {
  const { tokens } = useTheme()
  const { user, pageAccess } = useAuth()
  const isViewer = user?.role === 'viewer'
  const showDataTable = ('warehouse#data' in pageAccess) ? pageAccess['warehouse#data'] : !isViewer
  const [rows, setRows]         = useState<Row[]>(_cacheReady ? _cache!.rows : [])
  const [columns, setColumns]   = useState<string[]>(_cacheReady ? _cache!.columns : [])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [total, setTotal]       = useState(_cacheReady ? _cache!.total : 0)
  const [truncated, setTruncated] = useState(_cacheReady ? _cache!.truncated : false)
  const [queryTime, setQueryTime] = useState<number | null>(_cacheReady ? _cache!.queryTime : null)
  const [fromCache, setFromCache] = useState(_cacheReady ? _cache!.fromCache : false)
  const [tab, setTab]           = useState<'data' | 'pivot'>('data')
  const effectiveTab = (!showDataTable && tab === 'data') ? 'pivot' : tab
  const [accessDenied, setAccessDenied] = useState(false)
  const [warehouse, setWarehouse] = useState(_cacheReady ? _cache!.warehouse : '')
  const [itemCode, setItemCode]   = useState(_cacheReady ? _cache!.itemCode : '')
  const [division, setDivision]   = useState(_cacheReady ? _cache!.division : '')
  const fetchRef = useRef(0)

  async function fetchData(refresh = false) {
    const id = ++fetchRef.current
    setLoading(true); setError(null)
    try {
      const params: any = { refresh }
      if (warehouse) params.warehouse = warehouse
      if (itemCode) params.item_code = itemCode
      if (division) params.division = division
      const res = await http.get('/warehouse-inventory', { params })
      if (id !== fetchRef.current) return
      const d = res.data?.data ?? {}
      const newRows = d.rows ?? []
      const newCols = d.columns ?? []
      const newTotal = d.total ?? 0
      const newTrunc = d.truncated ?? false
      const newQT = d.query_s ?? null
      const newFC = d.from_cache ?? false
      setRows(newRows); setColumns(newCols); setTotal(newTotal)
      setTruncated(newTrunc); setQueryTime(newQT); setFromCache(newFC)
      // update module cache
      Object.assign(_cache!, { rows: newRows, columns: newCols, total: newTotal,
        truncated: newTrunc, queryTime: newQT, fromCache: newFC,
        warehouse, itemCode, division })
      _cacheReady = true
    } catch (e: any) {
      if (id !== fetchRef.current) return
      setError(e?.response?.data?.message || 'Data fetch failed')
    } finally {
      if (id === fetchRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (_cacheReady) return   // already have data — don't reload
    http.get('/auth/my-page-access').then(r => {
      const pa: Record<string, boolean> = r.data?.data?.page_access ?? {}
      if (pa['/warehouse'] === false) { setAccessDenied(true); return }
      fetchData()
    }).catch(() => fetchData())
  }, []) // eslint-disable-line

  const S = {
    page:    { padding: '20px 24px', maxWidth: '100%', boxSizing: 'border-box' as const },
    header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap' as const, gap: 10 },
    title:   { fontSize: 20, fontWeight: 800, color: tokens.textPrimary },
    sub:     { fontSize: 12, color: tokens.textMuted, marginTop: 2 },
    card:    { background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 10, padding: 14, marginBottom: 14 },
    input:   { background: tokens.inputBg, border: `1px solid ${tokens.inputBorder}`, borderRadius: 6, padding: '6px 10px', fontSize: 13, color: tokens.inputColor, outline: 'none', width: '100%', boxSizing: 'border-box' as const },
    btn:     (color = tokens.accent) => ({ padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: color, color: '#fff' }),
    btnGhost:{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${tokens.cardBorder}`, cursor: 'pointer', fontSize: 12, background: 'transparent', color: tokens.textMuted },
    tab:     (on: boolean) => ({ padding: '7px 18px', borderRadius: '8px 8px 0 0', border: `1px solid ${on ? tokens.accent : tokens.cardBorder}`, borderBottom: on ? `1px solid ${tokens.cardBg}` : `1px solid ${tokens.cardBorder}`, cursor: 'pointer', fontSize: 13, fontWeight: on ? 700 : 400, background: on ? tokens.accent + '22' : 'transparent', color: on ? tokens.accent : tokens.textMuted }),
  }

  if (accessDenied) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tokens.textPrimary, marginBottom: 8 }}>Access Denied</div>
      <div style={{ fontSize: 13, color: tokens.textMuted }}>You do not have permission to view Warehouse Inventory. Contact your admin.</div>
    </div>
  )

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={S.title}>🏭 Warehouse Inventory</div>
          <div style={S.sub}>
            MISRETAIL.T_STK_REPORT_DC_STOCK
            {total > 0 && ` · ${total.toLocaleString()} rows`}
            {fromCache && ' · cached'}
            {queryTime != null && !fromCache && ` · ${queryTime}s`}
          </div>
        </div>
        <button style={S.btn()} onClick={() => fetchData(true)} disabled={loading}>
          {loading ? 'Loading…' : '↺ Refresh'}
        </button>
      </div>

      {/* Top-level filters */}
      <div style={{ ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 11, color: tokens.textMuted, marginBottom: 4 }}>Warehouse / Site</div>
          <input style={S.input} placeholder="e.g. KHTWS" value={warehouse} onChange={e => setWarehouse(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchData()} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: tokens.textMuted, marginBottom: 4 }}>Item Code</div>
          <input style={S.input} placeholder="partial match" value={itemCode} onChange={e => setItemCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchData()} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: tokens.textMuted, marginBottom: 4 }}>Division</div>
          <input style={S.input} placeholder="e.g. MENSWEAR" value={division} onChange={e => setDivision(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchData()} />
        </div>
        <button style={{ ...S.btn(), alignSelf: 'flex-end' }} onClick={() => fetchData()} disabled={loading}>{loading ? '…' : '🔍 Apply'}</button>
        <button style={{ ...S.btnGhost, alignSelf: 'flex-end' }} onClick={() => { setWarehouse(''); setItemCode(''); setDivision('') }}>Clear</button>
      </div>

      {truncated && (
        <div style={{ background: '#78350f', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 14px', color: '#fde68a', fontSize: 12, marginBottom: 10 }}>
          ⚠ Data bahut zyada hai — sirf pehle 50,000 rows dikh rahe hain (total: {total.toLocaleString()})। Filter lagao ya CSV download karo poora data lene ke liye.
        </div>
      )}
      {error && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}
      {loading && <div style={{ textAlign: 'center', padding: '60px 20px', color: tokens.textMuted, fontSize: 14 }}>Data load ho raha hai…</div>}
      {!loading && rows.length === 0 && !error && <div style={{ textAlign: 'center', padding: '60px 20px', color: tokens.textMuted, fontSize: 14 }}>No data. Filters apply karo ya Refresh karo.</div>}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: -1, position: 'relative', zIndex: 1 }}>
            {showDataTable && <button style={S.tab(effectiveTab === 'data')} onClick={() => setTab('data')}>📋 Data Table</button>}
            <button style={S.tab(effectiveTab === 'pivot')} onClick={() => setTab('pivot')}>📊 Pivot Analysis</button>
          </div>
          <div style={{ ...S.card, borderRadius: '0 10px 10px 10px', marginBottom: 0 }}>
            {effectiveTab === 'data' && <DataTable rows={rows} columns={columns} />}
            {effectiveTab === 'pivot' && <PivotTable filters={{ warehouse, item_code: itemCode, division }} />}
          </div>
        </>
      )}
    </div>
  )
}
