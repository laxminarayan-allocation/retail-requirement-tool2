import { useCallback, useEffect, useRef, useState } from 'react'
import http from '@/api/http'
import { DataGrid } from '@/components/DataGrid'

// ── Default descriptions for known custom views ───────────────────────────────
const VIEW_DESC: Record<string, string> = {
  V_WH_STOCK:                    'Warehouse stock — quantity on hand at each stockpoint (GRC/MSA/WMS/ALLOCATED)',
  V_MC_REQ_GM:                   'MC-level requirement: gross margin, sell-thru & cover by merch category',
  V_ART_REQ_APPS:                'Article-level requirement for APPS allocation — qty, cover & distribution plan',
  V_ART_REQ_GM:                  'Article-level requirement: gross margin view with buy vs sell comparison',
  V_MRP_REQ_APPS:                'MRP requirement for APPS — material requirement planning by article',
  V_BARCODE_REQ_APPS:            'Barcode-level requirement for APPS — SKU/EAN wise allocation qty',
  V_BARCODE_REQ_A:               'Barcode requirement (alternate) — EAN level store-wise distribution',
  V_SZ_REQ_APPS:                 'Size-level requirement for APPS — size curve & qty break-up per article',
  V_SPARKY_PBS_REQ:              'Sparky PBS requirement — pattern-based store distribution with PBS logic',
  V_TABLE_REQ_APPS:              'Tabular requirement view for APPS — flat row format for bulk review',
  V_OPTION_REQ_AP:               'Option-level requirement — option count & width planning per MC/division',
  V_LIST_PBS_REQ:                'List view PBS requirement — store-wise PBS allocation list with filters',
  V_MC_REQ_APPS_2:               'MC-level requirement for APPS (v2) — updated merch category allocation plan',
  V_MC_STK_SUM:                  'Merch category stock — current inventory by MC across all stores',
  V_MC_SALES:                    'Merch category sales — store-wise sales data by MC for analysis',
  V_DC_STOCK:                    'DC/warehouse stock — distribution centre inventory by article',
  V_NSO:                         'NSO store data — new store opening details and timeline',
  V_ALL_WITH_NSO:                'All stores including NSO — full store universe with new openings',
  SALE_TY_STORE_DATE:            'Current year sales — store & date level TY sales transactions',
  SALE_LY_STORE_DATE:            'Last year sales — store & date level LY sales for YoY comparison',
  T_ALLOCATION_TGT_DATA:         'Allocation target data — store-wise quantity targets for allocation',
  T_ALLOCATION_FOR_ALL_DIVISION: 'Allocation data across all divisions — division-wise allocation summary',
  T_STORE_OPENING_DATE:          'Store opening dates — master list of store launch and opening dates',
}

function viewDesc(objectName: string, saved?: string | null): string {
  const trimmed = saved?.trim() ?? ''
  // skip saved value if it's just the object name or schema.objectname (default DB value)
  const upper = trimmed.toUpperCase()
  const objUpper = objectName.toUpperCase()
  const isDefault = upper === objUpper || upper.endsWith('.' + objUpper)
  if (trimmed && !isDefault) return trimmed
  const key = objectName.toUpperCase().replace(/\s+/g, '_')
  // exact match first
  if (VIEW_DESC[key]) return VIEW_DESC[key]
  // prefix match
  const match = Object.keys(VIEW_DESC).find(k => key.startsWith(k) || k.startsWith(key))
  return match ? VIEW_DESC[match] : ''
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TableKey = 'sales' | 'stock' | 'mdq' | string

interface TableStatus {
  key?: TableKey
  id?: string
  label: string
  oracle_view?: string
  stale_hours?: number
  exists: boolean
  rows?: number
  size_bytes?: number
  age_seconds?: number
  age_label?: string
  stale?: boolean
  access_count?: number
  last_accessed?: string
}

interface CustomTable {
  id: string
  schema_owner: string
  object_name: string
  label: string
  added_by: string
  added_at: string
  description?: string | null
}

interface PreviewData {
  key: TableKey
  label: string
  oracle_view: string
  rows_in_file: number
  rows_returned: number
  columns: string[]
  records: Record<string, unknown>[]
  served_from: 'parquet' | 'oracle'
  fetched_at: string
  age_seconds: number
  age_label: string
  stale: boolean
  stale_hours: number
  size_bytes: number
  access_count: number
}

interface TableKpi {
  available: boolean
  stores?: number
  articles?: number
  date_from?: string
  date_to?: string
}

interface ItemMasterStatus { ready: boolean; rows: number; cached_at: string | null }

// ── Per-window state ──────────────────────────────────────────────────────────

interface WinState {
  data: PreviewData | null
  loading: boolean
  error: string | null
  limit: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABLE_KEYS: TableKey[] = ['sales', 'stock', 'mdq']

const TABLE_META: Record<string, { color: string; desc: string; schema: string; view: string }> = {
  sales: { color: '#38bdf8', desc: 'Last 4-week store-level sales data',       schema: 'CK_A2166', view: 'V_MC_SALES / V_MC_SL_SUM' },
  stock: { color: '#34d399', desc: 'Current stock position across all stores', schema: 'CK_A2166', view: 'V_MC_STK_SUM' },
  mdq:   { color: '#a78bfa', desc: 'MDQ & store capacity constraints',         schema: 'CK_A2166', view: 'V_MDQ_STR' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSize(b: number) {
  if (b > 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`
  return `${(b / 1024).toFixed(0)} KB`
}

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}



// ── Viz types ─────────────────────────────────────────────────────────────────

type VizMode = 'card' | 'pivot'
const FUNCS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'] as const
type AggFunc = typeof FUNCS[number]

interface CardResult { field: string; func: AggFunc; value: number | string | null; total_rows: number }
interface PivotResult { row_col: string; row_cols: string[]; value_col: string; func: AggFunc; rows: Record<string, unknown>[]; total_groups: number }

// ── Searchable column selector ─────────────────────────────────────────────────

function ColSelect({ value, options, onChange, minWidth = 160, placeholder = 'Select column…' }: {
  value: string; options: string[]; onChange: (v: string) => void; minWidth?: number; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', minWidth }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
          color: value ? '#94a3b8' : '#475569', fontSize: 11, padding: '4px 28px 4px 8px',
          outline: 'none', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', position: 'relative',
        }}
      >
        {value || placeholder}
        <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 9, pointerEvents: 'none' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 999,
          background: '#0f1c2e', border: '1px solid var(--card-border)', borderRadius: 6,
          minWidth: Math.max(minWidth, 200), maxHeight: 260, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0,0,0,.6)', marginTop: 3,
        }}>
          {/* Search input */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search columns…"
              style={{
                width: '100%', background: '#070d1a', border: '1px solid #253761', borderRadius: 4,
                color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          {/* Options list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No match</div>
            ) : filtered.map(o => (
              <div
                key={o}
                onMouseDown={() => { onChange(o); setOpen(false) }}
                style={{
                  padding: '5px 12px', fontSize: 11, cursor: 'pointer',
                  color: o === value ? '#38bdf8' : '#94a3b8',
                  background: o === value ? 'rgba(56,189,248,.08)' : 'transparent',
                  borderLeft: o === value ? '2px solid #38bdf8' : '2px solid transparent',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,.04)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = o === value ? 'rgba(56,189,248,.08)' : 'transparent' }}
              >
                {o}
              </div>
            ))}
          </div>
          {/* Count footer */}
          <div style={{ padding: '4px 10px', borderTop: '1px solid #1e293b', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {filtered.length} of {options.length} columns
          </div>
        </div>
      )}
    </div>
  )
}

// ── Multi-column searchable selector ──────────────────────────────────────────

function MultiColSelect({ value, options, onChange, minWidth = 200 }: {
  value: string[]; options: string[]; onChange: (v: string[]) => void; minWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => { if (!open) setQuery('') }, [open])
  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  function toggle(col: string) {
    onChange(value.includes(col) ? value.filter(v => v !== col) : [...value, col])
  }
  function remove(col: string) { onChange(value.filter(v => v !== col)) }
  function moveUp(i: number) {
    if (i === 0) return
    const next = [...value]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; onChange(next)
  }
  function moveDown(i: number) {
    if (i === value.length - 1) return
    const next = [...value]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; onChange(next)
  }

  return (
    <div ref={ref} style={{ minWidth, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Selected chips */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {value.map((col, i) => (
            <span key={col} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              background: 'rgba(56,189,248,.12)', border: '1px solid rgba(56,189,248,.35)',
              borderRadius: 4, padding: '2px 5px', fontSize: 10, color: '#7dd3fc',
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer', userSelect: 'none' }} onClick={() => moveUp(i)}>▲</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer', userSelect: 'none' }} onClick={() => moveDown(i)}>▼</span>
              {col}
              <span onClick={() => remove(col)} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1, marginLeft: 2 }}>×</span>
            </span>
          ))}
        </div>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
          color: 'var(--text-muted)', fontSize: 11, padding: '4px 28px 4px 8px',
          outline: 'none', cursor: 'pointer', textAlign: 'left', position: 'relative',
        }}
      >
        {value.length === 0 ? 'Add group-by column…' : `+ Add another column`}
        <span style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', fontSize: 9, pointerEvents: 'none' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 999,
          background: '#0f1c2e', border: '1px solid var(--card-border)', borderRadius: 6,
          minWidth: Math.max(minWidth, 220), maxHeight: 280, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 24px rgba(0,0,0,.6)', marginTop: 2,
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search columns…"
              style={{
                width: '100%', background: '#070d1a', border: '1px solid #253761', borderRadius: 4,
                color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0
              ? <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No match</div>
              : filtered.map(o => {
                const checked = value.includes(o)
                return (
                  <div
                    key={o}
                    onMouseDown={() => toggle(o)}
                    style={{
                      padding: '5px 12px', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      color: checked ? '#38bdf8' : '#94a3b8',
                      background: checked ? 'rgba(56,189,248,.08)' : 'transparent',
                      borderLeft: checked ? '2px solid #38bdf8' : '2px solid transparent',
                    }}
                  >
                    <span style={{ fontSize: 10, color: checked ? '#38bdf8' : '#334155' }}>{checked ? '☑' : '☐'}</span>
                    {o}
                  </div>
                )
              })
            }
          </div>
          <div style={{ padding: '4px 10px', borderTop: '1px solid #1e293b', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, display: 'flex', justifyContent: 'space-between' }}>
            <span>{value.length} selected · {filtered.length} of {options.length}</span>
            {value.length > 0 && (
              <span onClick={() => onChange([])} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>Clear all</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── VizPanel ──────────────────────────────────────────────────────────────────

interface PinnedWidget {
  id: string
  label: string
  color: string
  isCustom: boolean
  mode: VizMode
  // card
  cardField?: string
  cardFunc?: AggFunc
  // pivot
  pivotRow?: string
  pivotValue?: string
  pivotFunc?: AggFunc
  pinnedAt: string
}

const PINNED_KEY = 'dashboard_widgets'

function getPinned(): PinnedWidget[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') } catch { return [] }
}
function savePinned(list: PinnedWidget[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(list))
}

function VizPanel({
  rowId, rowLabel, color, isCustom,
  onClose,
}: {
  rowId: string; rowLabel: string; color: string; isCustom: boolean; onClose: () => void
}) {
  const [columns, setColumns]     = useState<string[]>([])
  const [colsLoading, setColsLoading] = useState(true)
  const [mode, setMode]           = useState<VizMode>('card')

  // Card state
  const [cardField, setCardField] = useState('')
  const [cardFunc,  setCardFunc]  = useState<AggFunc>('SUM')
  const [cardResult, setCardResult] = useState<CardResult | null>(null)
  const [cardLoading, setCardLoading] = useState(false)
  const [cardErr, setCardErr] = useState('')

  // Pivot state
  const [pivotRow,   setPivotRow]   = useState<string[]>([])
  const [pivotValue, setPivotValue] = useState('')
  const [pivotFunc,  setPivotFunc]  = useState<AggFunc>('SUM')
  const [pivotResult, setPivotResult] = useState<PivotResult | null>(null)
  const [pivotLoading, setPivotLoading] = useState(false)
  const [pivotErr, setPivotErr] = useState('')

  const [pinned, setPinned] = useState(() => getPinned().some(w => w.id === rowId && w.mode === mode))

  useEffect(() => {
    setPinned(getPinned().some(w => w.id === rowId && w.mode === mode))
  }, [rowId, mode])

  function pinWidget() {
    const widget: PinnedWidget = {
      id: rowId, label: rowLabel, color, isCustom, mode,
      cardField: mode === 'card' ? cardField : undefined,
      cardFunc:  mode === 'card' ? cardFunc  : undefined,
      pivotRow:   mode === 'pivot' ? pivotRow.join(',') : undefined,
      pivotValue: mode === 'pivot' ? pivotValue : undefined,
      pivotFunc:  mode === 'pivot' ? pivotFunc  : undefined,
      pinnedAt: new Date().toISOString(),
    }
    const existing = getPinned().filter(w => !(w.id === rowId && w.mode === mode))
    savePinned([widget, ...existing])
    setPinned(true)
  }

  function unpinWidget() {
    savePinned(getPinned().filter(w => !(w.id === rowId && w.mode === mode)))
    setPinned(false)
  }

  const baseUrl = isCustom ? `/master/custom/${rowId}` : `/master/table/${rowId}`

  useEffect(() => {
    setColsLoading(true)
    http.get(`${baseUrl}/columns`).then(r => {
      if (r.data.success) {
        const cols: string[] = r.data.data.columns
        setColumns(cols)
        setCardField(cols[0] ?? '')
        setPivotRow(cols[0] ? [cols[0]] : [])
        setPivotValue(cols[1] ?? cols[0] ?? '')
      }
    }).catch(() => {}).finally(() => setColsLoading(false))
  }, [rowId, baseUrl])

  async function runCard() {
    if (!cardField) return
    setCardLoading(true); setCardErr(''); setCardResult(null)
    try {
      const r = await http.get(`${baseUrl}/aggregate`, { params: { field: cardField, func: cardFunc } })
      if (r.data.success) setCardResult(r.data.data)
      else setCardErr(r.data.message || 'Error')
    } catch { setCardErr('Request failed') }
    setCardLoading(false)
  }

  async function runPivot() {
    if (pivotRow.length === 0 || !pivotValue) return
    setPivotLoading(true); setPivotErr(''); setPivotResult(null)
    try {
      const r = await http.get(`${baseUrl}/pivot`, { params: { row_col: pivotRow.join(','), value_col: pivotValue, func: pivotFunc } })
      if (r.data.success) setPivotResult(r.data.data)
      else setPivotErr(r.data.message || 'Error')
    } catch { setPivotErr('Request failed') }
    setPivotLoading(false)
  }

  const sel: React.CSSProperties = {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
    color: 'var(--text-secondary)', fontSize: 11, padding: '4px 8px', outline: 'none',
  }
  const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 3 }
  const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
  const runBtn = (onClick: () => void, loading: boolean): React.CSSProperties => ({
    padding: '5px 16px', borderRadius: 6, border: '1px solid #1e40af',
    background: loading ? '#1e293b' : '#1e3a5f', color: '#7dd3fc',
    fontSize: 11, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
    alignSelf: 'flex-end',
  })

  function fmtVal(v: number | string | null, func: AggFunc) {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'number') {
      if (func === 'AVG') return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
      if (func === 'COUNT') return v.toLocaleString('en-IN')
      return v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    }
    return String(v)
  }

  return (
    <div style={{
      flex: '1 1 0', minHeight: 0,
      background: 'var(--card-bg)',
      border: `1px solid ${color}40`,
      borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>📊 {rowLabel} — Visualize</span>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 0, marginLeft: 12, border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
          {(['card', 'pivot'] as VizMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                padding: '3px 14px', fontSize: 11, fontWeight: mode === m ? 700 : 400,
                background: mode === m ? '#1e3a5f' : 'transparent',
                color: mode === m ? '#38bdf8' : '#64748b',
                border: 'none', cursor: 'pointer',
              }}>
              {m === 'card' ? '⬛ Card' : '⊞ Pivot'}
            </button>
          ))}
        </div>
        <button onClick={onClose}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1 }}>
        {colsLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading columns…</div>
        ) : columns.length === 0 ? (
          <div style={{ color: '#f87171', fontSize: 12 }}>No column data — download this table first.</div>
        ) : mode === 'card' ? (
          <>
            {/* Card config */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={field}>
                <span style={label}>Field</span>
                <ColSelect value={cardField} options={columns} onChange={setCardField} minWidth={180} />
              </div>
              <div style={field}>
                <span style={label}>Function</span>
                <select value={cardFunc} onChange={e => setCardFunc(e.target.value as AggFunc)} style={sel}>
                  {FUNCS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <button onClick={runCard} disabled={cardLoading} style={runBtn(runCard, cardLoading)}>
                {cardLoading ? '…' : '▶ Run'}
              </button>
            </div>
            {cardErr && <div style={{ color: '#f87171', fontSize: 11 }}>{cardErr}</div>}

            {/* Card result */}
            {cardResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <div style={{
                  background: 'var(--content-bg)', border: `1px solid ${color}40`, borderRadius: 10,
                  padding: '20px 28px', display: 'inline-flex', flexDirection: 'column', gap: 4, minWidth: 200,
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    {cardResult.func}({cardResult.field})
                  </span>
                  <span style={{ fontSize: 32, fontWeight: 800, color, fontFamily: 'monospace', letterSpacing: '-.02em' }}>
                    {fmtVal(cardResult.value, cardResult.func)}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    across {cardResult.total_rows.toLocaleString()} rows
                  </span>
                </div>
                <button
                  onClick={pinned ? unpinWidget : pinWidget}
                  style={{
                    padding: '4px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: pinned ? '1px solid #a78bfa' : '1px solid #334155',
                    background: pinned ? 'rgba(167,139,250,.12)' : 'transparent',
                    color: pinned ? '#c4b5fd' : '#64748b',
                  }}>
                  {pinned ? '📌 Pinned to Dashboard' : 'Pin to Dashboard'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Pivot config */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={field}>
                <span style={label}>Group by (row)</span>
                <MultiColSelect value={pivotRow} options={columns} onChange={setPivotRow} minWidth={200} />
              </div>
              <div style={field}>
                <span style={label}>Value column</span>
                <ColSelect value={pivotValue} options={columns} onChange={setPivotValue} minWidth={160} />
              </div>
              <div style={field}>
                <span style={label}>Function</span>
                <select value={pivotFunc} onChange={e => setPivotFunc(e.target.value as AggFunc)} style={sel}>
                  {FUNCS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <button onClick={runPivot} disabled={pivotLoading} style={runBtn(runPivot, pivotLoading)}>
                {pivotLoading ? '…' : '▶ Run'}
              </button>
            </div>
            {pivotErr && <div style={{ color: '#f87171', fontSize: 11 }}>{pivotErr}</div>}

            {/* Pivot result */}
            {pivotResult && (
              <div style={{ overflowX: 'auto', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {pivotResult.func}({pivotResult.value_col}) grouped by {(pivotResult.row_cols ?? [pivotResult.row_col]).join(' › ')} — {pivotResult.total_groups} groups
                  </div>
                  <button
                    onClick={pinned ? unpinWidget : pinWidget}
                    style={{
                      padding: '3px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      border: pinned ? '1px solid #a78bfa' : '1px solid #334155',
                      background: pinned ? 'rgba(167,139,250,.12)' : 'transparent',
                      color: pinned ? '#c4b5fd' : '#64748b',
                    }}>
                    {pinned ? '📌 Pinned' : 'Pin to Dashboard'}
                  </button>
                </div>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: 'var(--content-bg)' }}>
                      {(pivotResult.row_cols ?? [pivotResult.row_col]).map(rc => (
                        <th key={rc} style={{ padding: '5px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #334155', letterSpacing: '.05em', textTransform: 'uppercase', borderRight: '1px solid #1e293b' }}>
                          {rc}
                        </th>
                      ))}
                      <th style={{ padding: '5px 12px', textAlign: 'right', color: '#38bdf8', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #334155', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                        {pivotResult.func}({pivotResult.value_col})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivotResult.rows.map((r, i) => {
                      const vv = r[pivotResult.value_col]
                      const rowCols = pivotResult.row_cols ?? [pivotResult.row_col]
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #1e293b', background: i % 2 === 0 ? 'transparent' : '#ffffff04' }}>
                          {rowCols.map(rc => (
                            <td key={rc} style={{ padding: '4px 12px', color: 'var(--text-secondary)', borderRight: '1px solid #1e293b' }}>
                              {r[rc] == null ? <i>NULL</i> : String(r[rc])}
                            </td>
                          ))}
                          <td style={{ padding: '4px 12px', textAlign: 'right', color: '#7dd3fc', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
                            {vv == null ? '—' : typeof vv === 'number' ? vv.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(vv)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ exists, stale }: { exists: boolean; stale?: boolean }) {
  if (!exists) return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--card-bg)', color: 'var(--text-muted)', border: '1px solid var(--card-border)' }}>No file</span>
  )
  if (stale) return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(251,191,36,.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.35)' }}>⚠ Stale</span>
  )
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(52,211,153,.1)', color: '#34d399', border: '1px solid rgba(52,211,153,.3)' }}>● Fresh</span>
  )
}

// ── Action Buttons ────────────────────────────────────────────────────────────

function ActionBtn({ onClick, accent, children }: { onClick: () => void; accent?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${accent ? '#1e40af' : '#334155'}`, background: 'transparent', color: accent ? '#7dd3fc' : '#64748b', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}

function DangerBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MasterData() {
  const [statuses, setStatuses]   = useState<Record<string, TableStatus | null>>({})
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({ sales: true, stock: true, mdq: true })
  const [kpis, setKpis]           = useState<Record<string, TableKpi | null>>({})
  const [customTables, setCustomTables] = useState<CustomTable[]>([])

  const [vizKey, setVizKey]         = useState<TableKey | null>(null)
  const [wins, setWins]             = useState<Record<string, WinState>>({})
  const [activeWin, setActiveWin]   = useState<string | null>(null)
  const [refreshingWin, setRefreshingWin] = useState<string | null>(null)

  // ── Item Master (Distribution) ─────────────────────────────────────────────
  const [imStatus,  setImStatus]  = useState<ItemMasterStatus | null>(null)
  const [imLoading, setImLoading] = useState(false)
  const [imMsg,     setImMsg]     = useState<string | null>(null)

  const fetchImStatus = useCallback(async () => {
    try {
      const res = await http.get('/distribution/item-master/status')
      if (res.data.success) setImStatus(res.data.data)
    } catch { /* silent */ }
  }, [])

  const downloadItemMaster = async () => {
    setImLoading(true); setImMsg(null)
    try {
      const res = await http.post('/distribution/item-master/download')
      if (res.data.success) {
        const d = res.data.data as { rows: number; elapsed_ms: number }
        setImMsg(`✓ Downloaded ${d.rows.toLocaleString('en-IN')} rows in ${Math.round(d.elapsed_ms / 1000)}s`)
        await fetchImStatus()
      } else {
        setImMsg(`✗ ${res.data.message ?? 'Error'}`)
      }
    } catch (e: unknown) {
      setImMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally { setImLoading(false) }
  }

  useEffect(() => {
    // Load status only on mount — KPIs load lazily on first expand/click
    TABLE_KEYS.forEach(k => loadStatus(k))
    loadCustomTables()
    fetchImStatus()
    // Load KPIs in background after a short delay so status renders first
    setTimeout(() => TABLE_KEYS.forEach(k => loadKpi(k)), 1500)
  }, [fetchImStatus])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setActiveWin(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function loadStatus(key: TableKey) {
    setStatusLoading(p => ({ ...p, [key]: true }))
    try {
      const res = await http.get(`/master/table/${key}/status`, { timeout: 8000 })
      if (res.data.success) setStatuses(p => ({ ...p, [key]: res.data.data }))
    } catch { /* ignore */ } finally {
      setStatusLoading(p => ({ ...p, [key]: false }))
    }
  }

  async function loadKpi(key: TableKey) {
    try {
      const res = await http.get(`/master/table/${key}/kpi`, { timeout: 15000 })
      if (res.data.success) setKpis(p => ({ ...p, [key]: res.data.data }))
    } catch { /* ignore */ }
  }

  async function loadCustomTables() {
    try {
      const res = await http.get('/master/custom', { timeout: 8000 })
      if (res.data.success) {
        const tables: CustomTable[] = res.data.data.tables
        setCustomTables(tables)
        // Stagger custom status loads to avoid hammering backend all at once
        tables.forEach((t, i) => setTimeout(() => loadCustomStatus(t.id), i * 200))
      }
    } catch { /* ignore */ }
  }

  async function loadCustomStatus(id: string) {
    setStatusLoading(p => ({ ...p, [id]: true }))
    try {
      const res = await http.get(`/master/custom/${id}/status`, { timeout: 8000 })
      if (res.data.success) setStatuses(p => ({ ...p, [id]: res.data.data }))
    } catch { /* ignore */ } finally {
      setStatusLoading(p => ({ ...p, [id]: false }))
    }
  }

  async function removeCustomTable(id: string) {
    await http.delete(`/master/custom/${id}`)
    setCustomTables(p => p.filter(t => t.id !== id))
    setStatuses(p => { const n = { ...p }; delete n[id]; return n })
    setWins(p => { const n = { ...p }; delete n[id]; return n })
    if (activeWin === id) setActiveWin(null)
  }

  const isCustom = (key: TableKey) => !TABLE_KEYS.includes(key as 'sales' | 'stock' | 'mdq')

  async function loadWinPreview(key: string, forceRefresh: boolean, limit: number) {
    setWins(p => ({ ...p, [key]: { ...(p[key] ?? { data: null, error: null, limit }), loading: true, error: null } }))
    try {
      const url = isCustom(key)
        ? `/master/custom/${key}/preview?limit=${limit}&force_refresh=${forceRefresh}`
        : `/master/table/${key}/preview?limit=${limit}&force_refresh=${forceRefresh}`
      const res = await http.get(url, { timeout: 180_000 })
      if (res.data.success) {
        setWins(p => ({ ...p, [key]: { ...p[key], data: { ...res.data.data, key }, loading: false } }))
        if (forceRefresh || !statuses[key]?.exists) {
          isCustom(key) ? loadCustomStatus(key) : loadStatus(key as 'sales' | 'stock' | 'mdq')
        }
      } else {
        setWins(p => ({ ...p, [key]: { ...p[key], loading: false, error: res.data.message || 'Server returned an error.' } }))
      }
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown; message?: unknown } } })?.response?.data?.detail
        ?? (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
        ?? (err as { message?: string })?.message ?? 'Request failed.'
      const msg = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? (raw as { msg?: string }[]).map(e => e?.msg ?? JSON.stringify(e)).join('; ')
        : JSON.stringify(raw)
      setWins(p => ({ ...p, [key]: { ...p[key], loading: false, error: msg } }))
    }
  }

  async function handleRefresh(key: TableKey) {
    const limit = wins[key]?.limit ?? statuses[key]?.rows ?? 200
    if (!wins[key]) setWins(p => ({ ...p, [key]: { data: null, loading: false, error: null, limit } }))
    setActiveWin(key)
    setRefreshingWin(key)

    if (!wins[key]?.data && statuses[key]?.exists) {
      const cachedUrl = isCustom(key)
        ? `/master/custom/${key}/preview?limit=${limit}&force_refresh=false`
        : `/master/table/${key}/preview?limit=${limit}&force_refresh=false`
      http.get(cachedUrl, { timeout: 30_000 }).then(res => {
        if (res.data.success) setWins(p => ({ ...p, [key]: { ...p[key], data: { ...res.data.data, key } } }))
      }).catch(() => {})
    }

    try {
      const url = isCustom(key)
        ? `/master/custom/${key}/preview?limit=${limit}&force_refresh=true`
        : `/master/table/${key}/preview?limit=${limit}&force_refresh=true`
      const res = await http.get(url, { timeout: 180_000 })
      if (res.data.success) {
        setWins(p => ({ ...p, [key]: { ...p[key], data: { ...res.data.data, key }, error: null } }))
        isCustom(key) ? loadCustomStatus(key) : loadStatus(key as 'sales' | 'stock' | 'mdq')
      } else {
        setWins(p => ({ ...p, [key]: { ...p[key], error: res.data.message || 'Refresh failed.' } }))
      }
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown; message?: unknown } } })?.response?.data?.detail
        ?? (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
        ?? (err as { message?: string })?.message ?? 'Refresh failed.'
      const msg = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? (raw as { msg?: string }[]).map(e => e?.msg ?? JSON.stringify(e)).join('; ')
        : JSON.stringify(raw)
      setWins(p => ({ ...p, [key]: { ...p[key], error: msg } }))
    } finally {
      setRefreshingWin(null)
    }
    if (!isCustom(key)) loadKpi(key)
  }

  async function openWindow(key: string) {
    if (activeWin === key) { setActiveWin(null); return }
    setActiveWin(key)
    if (!wins[key]) {
      const limit = Math.min(statuses[key]?.rows ?? 200, 2000)
      setWins(p => ({ ...p, [key]: { data: null, loading: false, error: null, limit } }))
      await loadWinPreview(key, false, limit)
    }
  }

  function closeWindow(key: string) {
    setWins(p => { const n = { ...p }; delete n[key]; return n })
    if (activeWin === key) setActiveWin(null)
  }

  function handleViz(key: TableKey) {
    if (vizKey === key) { setVizKey(null); return }
    setVizKey(key)
  }

  function downloadCsv(pqOwner: string, pqName: string, label: string) {
    const url = `/api/database/output/download/${encodeURIComponent(pqOwner)}/${encodeURIComponent(pqName)}`
    const a = document.createElement('a')
    a.href = url
    a.download = `${label}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // ── Column config ──────────────────────────────────────────────────────────

  const ALL_COL_DEFS = [
    { col: 'name',        label: 'Name',         sortable: true,  divider: false, align: 'left',  group: 'Table'        },
    { col: 'schema',      label: 'Schema / view',sortable: true,  divider: false, align: 'left',  group: 'Table'        },
    { col: 'desc',        label: 'Description',  sortable: false, divider: false, align: 'left',  group: 'Table'        },
    { col: 'actions',     label: 'Actions',      sortable: false, divider: true,  align: 'left',  group: 'Table'        },
    { col: 'status',      label: 'Status',       sortable: true,  divider: false, align: 'left',  group: 'Cache status' },
    { col: 'rows',        label: 'Rows',         sortable: true,  divider: false, align: 'right', group: 'Cache status' },
    { col: 'size',        label: 'Size',         sortable: true,  divider: false, align: 'right', group: 'Cache status' },
    { col: 'age',         label: 'Age',          sortable: true,  divider: true,  align: 'left',  group: 'Cache status' },
    { col: 'stores',      label: 'Stores',       sortable: true,  divider: false, align: 'right', group: 'Quick stats'  },
    { col: 'articles',    label: 'Articles',     sortable: true,  divider: false, align: 'right', group: 'Quick stats'  },
    { col: 'daterange',   label: 'Date range',   sortable: false, divider: true,  align: 'left',  group: 'Quick stats'  },
    { col: 'access',      label: 'Access',       sortable: true,  divider: false, align: 'right', group: 'Usage'        },
    { col: 'lastaccess',  label: 'Last access',  sortable: false, divider: false, align: 'left',  group: 'Usage'        },
  ] as const

  type ColKey = typeof ALL_COL_DEFS[number]['col']

  const DEFAULT_WIDTHS: Record<ColKey, number> = {
    name: 140, schema: 170, desc: 150, actions: 240, status: 80, rows: 80, size: 65,
    age: 120, stores: 70, articles: 80, daterange: 180, access: 65, lastaccess: 90,
  }

  const [colOrder,  setColOrder]  = useState<ColKey[]>(ALL_COL_DEFS.map(d => d.col))
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>({ ...DEFAULT_WIDTHS })

  // ── Editable descriptions ──────────────────────────────────────────────────

  const [editingDesc, setEditingDesc] = useState<string | null>(null)
  const [editDraft,   setEditDraft]   = useState('')

  function startEditDesc(id: string, current: string) {
    setEditingDesc(id); setEditDraft(current)
  }

  function saveDesc(id: string) {
    const trimmed = editDraft.trim()
    setEditingDesc(null)
    // Optimistically update local customTables state
    setCustomTables(prev => prev.map(ct =>
      ct.id === id ? { ...ct, description: trimmed || null } : ct
    ))
    // Persist to backend (fire-and-forget; row was already optimistically updated)
    http.patch(`/master/custom/${id}/description`, { description: trimmed }).catch(() => {
      // Revert on failure
      setCustomTables(prev => prev.map(ct =>
        ct.id === id ? { ...ct, description: ct.description } : ct
      ))
    })
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  const resizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizeRef.current) return
      const { col, startX, startW } = resizeRef.current
      setColWidths(p => ({ ...p, [col]: Math.max(40, startW + (e.clientX - startX)) }))
    }
    function onUp() { resizeRef.current = null; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  function startResize(col: ColKey, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { col, startX: e.clientX, startW: colWidths[col] }
    document.body.style.cursor = 'col-resize'
  }

  // ── Drag-to-reorder ────────────────────────────────────────────────────────

  const dragFrom = useRef<ColKey | null>(null)
  const [dragOver, setDragOver] = useState<ColKey | null>(null)

  function onDragStart(col: ColKey, e: React.DragEvent) {
    dragFrom.current = col
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(col: ColKey, e: React.DragEvent) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    setDragOver(col)
  }
  function onDrop(col: ColKey) {
    if (!dragFrom.current || dragFrom.current === col) { setDragOver(null); return }
    setColOrder(prev => {
      const next = [...prev]
      const from = next.indexOf(dragFrom.current!)
      const to   = next.indexOf(col)
      next.splice(from, 1); next.splice(to, 0, dragFrom.current!)
      return next
    })
    dragFrom.current = null; setDragOver(null)
  }
  function onDragEnd() { dragFrom.current = null; setDragOver(null) }

  // ── Sort state ─────────────────────────────────────────────────────────────

  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleColSort(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') }
    } else { setSortCol(col); setSortDir('asc') }
  }

  // ── Unified row model for sorting ──────────────────────────────────────────

  type RowData = {
    id: string
    isCustom: boolean
    name: string
    schema: string
    view: string
    desc: string
    color: string
    status: TableStatus | null
    loading: boolean
    kpi: TableKpi | null
    ct?: CustomTable
    pqOwner: string
    pqName: string
  }

  const _CORE_PQ: Record<string, { owner: string; name: string }> = {
    sales: { owner: 'CK_A2166', name: 'V_MC_SALES' },
    stock: { owner: 'CK_A2166', name: 'V_MC_STK_SUM' },
    mdq:   { owner: 'CK_A2166', name: 'V_MDQ_STR'  },
  }

  const coreRows: RowData[] = TABLE_KEYS.map(key => ({
    id: key, isCustom: false,
    name: statuses[key]?.label ?? key.toUpperCase(),
    schema: TABLE_META[key].schema,
    view: TABLE_META[key].view.split(' / ')[0],
    desc: TABLE_META[key].desc,
    color: TABLE_META[key].color,
    status: statuses[key] ?? null,
    loading: statusLoading[key] ?? false,
    kpi: kpis[key] ?? null,
    pqOwner: _CORE_PQ[key]?.owner ?? '',
    pqName:  _CORE_PQ[key]?.name ?? '',
  }))

  const customRows: RowData[] = customTables.map(ct => ({
    id: ct.id ?? `custom::${ct.object_name}`, isCustom: true,
    name: ct.object_name,
    schema: ct.schema_owner,
    view: ct.object_name,
    desc: viewDesc(ct.object_name, ct.description) || ct.label,
    color: '#f59e0b',
    status: statuses[ct.id] ?? null,
    loading: statusLoading[ct.id] ?? false,
    kpi: null,
    ct,
    pqOwner: ct.schema_owner,
    pqName:  ct.object_name,
  }))

  function sortVal(row: RowData, col: string): string | number {
    const st = row.status
    switch (col) {
      case 'name':    return row.name.toLowerCase()
      case 'schema':  return row.schema.toLowerCase()
      case 'status':  return !st?.exists ? 0 : st.stale ? 1 : 2
      case 'rows':    return st?.rows ?? -1
      case 'size':    return st?.size_bytes ?? -1
      case 'age':     return st?.age_seconds ?? Infinity
      case 'stores':  return row.kpi?.stores ?? -1
      case 'articles':return row.kpi?.articles ?? -1
      case 'access':  return st?.access_count ?? -1
      case 'lastaccess': return st?.last_accessed ?? ''
      default: return ''
    }
  }

  const allRows = [...coreRows, ...customRows]
  const sortedRows = sortCol ? [...allRows].sort((a, b) => {
    const av = sortVal(a, sortCol), bv = sortVal(b, sortCol)
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  }) : allRows

  // ── Table styles ───────────────────────────────────────────────────────────

  function thStyle(col: string, divider?: boolean): React.CSSProperties {
    const active = sortCol === col
    return {
      padding: '6px 10px', fontSize: 10, fontWeight: 700,
      color: active ? '#38bdf8' : '#475569',
      textAlign: 'left', letterSpacing: '.05em', textTransform: 'uppercase',
      borderBottom: `2px solid ${active ? '#38bdf8' : '#334155'}`,
      borderRight: divider ? '1px solid #1e293b' : undefined,
      whiteSpace: 'nowrap', background: active ? '#0c1829' : '#0f172a',
      cursor: 'pointer', userSelect: 'none',
      zIndex: 2,
    }
  }

  const THGroup: React.CSSProperties = {
    padding: '0 10px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
    textAlign: 'left', letterSpacing: '.08em', textTransform: 'uppercase',
    background: '#0a0f1a', borderBottom: '1px solid #1e293b',
    height: 24, lineHeight: '24px',
  }
  const TD: React.CSSProperties = {
    padding: '7px 10px', fontSize: 12, color: 'var(--text-secondary)',
    borderBottom: '1px solid #1e293b', verticalAlign: 'middle',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }
  const TDVal: React.CSSProperties = { ...TD, color: 'var(--text-primary)', fontWeight: 500 }

  function rowBg(exists: boolean, stale?: boolean, isActive?: boolean) {
    if (isActive) return 'rgba(56,189,248,.05)'
    if (exists && stale) return 'rgba(251,191,36,.04)'
    return 'transparent'
  }

  function SortIcon({ col }: { col: string }) {
    if (sortCol !== col) return <span style={{ marginLeft: 3, opacity: 0.25, fontSize: 8 }}>⇅</span>
    return <span style={{ marginLeft: 3, fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', gap: 12, minHeight: 0 }}>

      {/* Page header */}
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>📊 Master Data</h1>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          Core Oracle tables — auto-loaded from local Parquet cache.
        </p>
      </div>

      {/* Master table */}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--card-border)', borderRadius: 10, background: 'var(--card-bg)' }}>
        <div style={{ height: '100%', overflowY: 'auto', overflowX: 'auto', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: colOrder.reduce((s, k) => s + colWidths[k], 0) }}>
            <colgroup>
              {colOrder.map(k => <col key={k} style={{ width: colWidths[k] }} />)}
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
              <tr>
                {(() => {
                  const groups: { label: string; count: number }[] = []
                  for (const k of colOrder) {
                    const def = ALL_COL_DEFS.find(d => d.col === k)!
                    if (groups.length && groups[groups.length - 1].label === def.group) groups[groups.length - 1].count++
                    else groups.push({ label: def.group, count: 1 })
                  }
                  return groups.map((g, i) => (
                    <th key={i} colSpan={g.count}
                      style={{ ...THGroup, borderRight: i < groups.length - 1 ? '1px solid #1e293b' : undefined }}>
                      {g.label}
                    </th>
                  ))
                })()}
              </tr>
              <tr>
                {colOrder.map(col => {
                  const def = ALL_COL_DEFS.find(d => d.col === col)!
                  const { label, sortable, align } = def
                  const isDragTarget = dragOver === col
                  return (
                  <th key={col}
                    draggable
                    onDragStart={e => onDragStart(col, e)}
                    onDragOver={e => onDragOver(col, e)}
                    onDrop={() => onDrop(col)}
                    onDragEnd={onDragEnd}
                    onClick={sortable ? () => handleColSort(col) : undefined}
                    style={{
                      ...thStyle(sortable ? col : ''),
                      cursor: sortable ? 'pointer' : 'grab',
                      textAlign: align as 'left' | 'right',
                      borderLeft: isDragTarget ? '2px solid #38bdf8' : undefined,
                      position: 'relative', overflow: 'hidden',
                      padding: '6px 18px 6px 10px',
                      opacity: dragFrom.current === col ? 0.4 : 1,
                    }}>
                    {label}{sortable && <SortIcon col={col} />}
                    <span
                      onMouseDown={e => startResize(col, e)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute', right: 0, top: 0, bottom: 0,
                        width: 6, cursor: 'col-resize', background: 'transparent',
                        borderRight: '2px solid transparent',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderRightColor = '#334155')}
                      onMouseLeave={e => (e.currentTarget.style.borderRightColor = 'transparent')}
                    />
                  </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const { id, isCustom: ic, name, schema, view, desc, color, status: st, loading, kpi, ct, pqOwner, pqName } = row
                const exists  = st?.exists ?? false
                const stale   = st?.stale ?? false
                const isActive = !!wins[id]

                function renderCell(col: ColKey) {
                  switch (col) {
                    case 'name': return (
                      <td key={col} style={{ ...TDVal, color }}>
                        {name}
                        {ic && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text-muted)', background: 'var(--content-bg)', padding: '1px 6px', borderRadius: 8, border: '1px solid var(--card-border)' }}>custom</span>}
                      </td>
                    )
                    case 'schema': return (
                      <td key={col} style={{ ...TD, fontFamily: 'monospace', fontSize: 10 }}>
                        {ic ? schema : `${schema} / ${view}`}
                      </td>
                    )
                    case 'desc': {
                      const displayed = desc || name
                      const isEditing = editingDesc === id
                      return (
                        <td key={col}
                          title={ic && !isEditing ? 'Click to edit description' : undefined}
                          onClick={() => ic && !isEditing && startEditDesc(id, viewDesc(name, row.ct?.description) || '')}
                          style={{ ...TD, color: 'var(--text-muted)', cursor: ic ? 'text' : 'default', padding: isEditing ? '4px 6px' : TD.padding }}>
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editDraft}
                              onChange={e => setEditDraft(e.target.value)}
                              onBlur={() => saveDesc(id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveDesc(id)
                                if (e.key === 'Escape') setEditingDesc(null)
                              }}
                              style={{
                                width: '100%', background: 'var(--content-bg)', border: '1px solid #38bdf8',
                                borderRadius: 4, color: 'var(--text-primary)', fontSize: 11, padding: '3px 6px',
                                outline: 'none',
                              }}
                            />
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayed}</span>
                              <span style={{ opacity: 0.3, fontSize: 10, flexShrink: 0 }}>✎</span>
                            </span>
                          )}
                        </td>
                      )
                    }
                    case 'actions': return (
                      <td key={col} style={{ ...TD, padding: '5px 8px' }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                          {exists && (
                            <ActionBtn onClick={() => openWindow(id)}>
                              {activeWin === id ? 'Close' : wins[id] ? 'View ✓' : 'View'}
                            </ActionBtn>
                          )}
                          {exists && (
                            <ActionBtn onClick={() => downloadCsv(pqOwner, pqName, name)}>
                              CSV
                            </ActionBtn>
                          )}
                          {exists && (
                            <ActionBtn onClick={() => handleViz(id)}>
                              {vizKey === id ? '▲ Viz' : 'Viz'}
                            </ActionBtn>
                          )}
                          {ic && ct && <DangerBtn onClick={() => removeCustomTable(id)}>✕</DangerBtn>}
                        </div>
                      </td>
                    )
                    case 'status': return (
                      <td key={col} style={TD}>
                        {loading ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>…</span> : <StatusBadge exists={exists} stale={stale} />}
                      </td>
                    )
                    case 'rows': return (
                      <td key={col} style={{ ...TDVal, fontFamily: 'monospace', textAlign: 'right' }}>
                        {!loading && exists ? (st?.rows?.toLocaleString() ?? '—') : '—'}
                      </td>
                    )
                    case 'size': return (
                      <td key={col} style={{ ...TD, textAlign: 'right' }}>
                        {!loading && exists ? fmtSize(st?.size_bytes ?? 0) : '—'}
                      </td>
                    )
                    case 'age': return (
                      <td key={col} style={{ ...TD, color: stale ? '#fbbf24' : '#64748b' }}>
                        {!loading && exists ? (st?.age_label ?? '—') : '—'}
                      </td>
                    )
                    case 'stores': return (
                      <td key={col} style={{ ...TD, textAlign: 'right', color: '#7dd3fc', fontFamily: 'monospace' }}>
                        {!ic && kpi?.available && kpi.stores != null ? kpi.stores.toLocaleString() : '—'}
                      </td>
                    )
                    case 'articles': return (
                      <td key={col} style={{ ...TD, textAlign: 'right', color: '#7dd3fc', fontFamily: 'monospace' }}>
                        {!ic && kpi?.available && kpi.articles != null ? kpi.articles.toLocaleString() : '—'}
                      </td>
                    )
                    case 'daterange': return (
                      <td key={col} style={{ ...TD, fontSize: 11 }}>
                        {!ic && kpi?.available && kpi.date_from ? `${kpi.date_from} → ${kpi.date_to}` : '—'}
                      </td>
                    )
                    case 'access': return (
                      <td key={col} style={{ ...TD, textAlign: 'right', color: '#a78bfa' }}>
                        {st?.access_count != null ? `${st.access_count}×` : '—'}
                      </td>
                    )
                    case 'lastaccess': return (
                      <td key={col} style={{ ...TD, fontSize: 11 }}>{fmtDate(st?.last_accessed)}</td>
                    )
                    default: return <td key={col} style={TD}>—</td>
                  }
                }

                return (
                  <tr key={id} style={{ background: rowBg(exists, stale, isActive) }}>
                    {colOrder.map(col => renderCell(col))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Viz panel */}
      {vizKey && (() => {
        const vRow = sortedRows.find(r => r.id === vizKey)
        if (!vRow) return null
        return (
          <VizPanel
            rowId={vizKey}
            rowLabel={vRow.name}
            color={vRow.color}
            isCustom={vRow.isCustom}
            onClose={() => setVizKey(null)}
          />
        )
      })()}


      {/* Active full-screen modal */}
      {activeWin && wins[activeWin] && (() => {
        const key   = activeWin
        const win   = wins[key]
        const accent = isCustom(key) ? '#f59e0b' : (TABLE_META[key]?.color ?? '#38bdf8')
        const isRefreshing = refreshingWin === key
        const winBtnSt: React.CSSProperties = { width: 26, height: 26, border: '1px solid var(--card-border)', borderRadius: 5, background: '#1e2030', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
        const { data, loading, error, limit } = win

        return (
          <div onClick={e => { if (e.target === e.currentTarget) setActiveWin(null) }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,8,20,0.72)' }}>
            <div style={{ width: 'calc(100vw - 32px)', height: 'calc(100vh - 32px)', background: '#131e30', border: `1.5px solid ${accent}55`, borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 32px 64px rgba(0,0,0,.85)' }}>

              {/* header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#0f1827', flexWrap: 'wrap' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: accent, whiteSpace: 'nowrap' }}>
                  {data?.label ?? key.toUpperCase()}
                </span>
                {data && (
                  <>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{data.oracle_view}</span>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap', background: data.served_from === 'oracle' ? '#052e16' : '#0f172a', color: data.served_from === 'oracle' ? '#4ade80' : '#64748b', border: `1px solid ${data.served_from === 'oracle' ? '#166534' : '#334155'}` }}>
                      {data.served_from === 'oracle' ? '⚡ fresh' : '💾 cache'}
                    </span>
                    <span style={{ fontSize: 10, color: data.stale ? '#fbbf24' : '#64748b', whiteSpace: 'nowrap' }}>{data.age_label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{data.rows_in_file.toLocaleString()} rows · {data.columns.length} cols</span>
                  </>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Show</label>
                  <select value={limit} onChange={e => {
                    const nl = Number(e.target.value)
                    setWins(p => ({ ...p, [key]: { ...p[key], limit: nl } }))
                  }} style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: 11, padding: '3px 6px' }}>
                    {(() => {
                      const total = data?.rows_in_file ?? statuses[key]?.rows
                      const fixed = [100, 200, 500, 1000, 2000]
                      const opts = total && !fixed.includes(total) ? [...fixed, total].sort((a, b) => a - b) : fixed
                      return opts.map(n => <option key={n} value={n}>{n === total ? `${n.toLocaleString()} (all)` : `${n}`}</option>)
                    })()}
                  </select>
                  <button onClick={() => loadWinPreview(key, false, limit)}
                    style={{ padding: '4px 9px', background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #1e40af', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    ↻ Reload
                  </button>
                  <button title="Minimize" onClick={() => setActiveWin(null)} style={winBtnSt}>▬</button>
                  <button title="Close" onClick={() => closeWindow(key)} style={{ ...winBtnSt, color: 'var(--text-secondary)' }}>✕</button>
                </div>
              </div>

              {/* Stale warning */}
              {data?.stale && !loading && !isRefreshing && (
                <div style={{ flexShrink: 0, margin: '8px 16px 0', padding: '6px 10px', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 6, fontSize: 11, color: '#fcd34d' }}>
                  ⚠️ File is <strong>{data.age_label}</strong> — older than {data.stale_hours >= 24 ? `${data.stale_hours / 24}d` : `${data.stale_hours}hr`} threshold.
                </div>
              )}

              {/* Refresh banner */}
              {isRefreshing && (
                <div style={{ flexShrink: 0, margin: '8px 16px 0', padding: '7px 12px', background: 'rgba(56,189,248,.06)', border: '1px solid rgba(56,189,248,.25)', borderRadius: 6, fontSize: 11, color: '#7dd3fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <style>{`@keyframes md-spin { to { transform: rotate(360deg) } }`}</style>
                  <span style={{ animation: 'md-spin 1.2s linear infinite', display: 'inline-block', fontSize: 13 }}>↻</span>
                  Downloading fresh data from Oracle…
                  {data && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>Showing cached ({data.age_label} old).</span>}
                </div>
              )}

              {/* Grid / error */}
              <div style={{ flex: 1, minHeight: 0 }}>
                {error ? (
                  <div style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
                    <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Failed to load data</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, maxWidth: 480, margin: '0 auto', lineHeight: 1.6 }}>{error}</div>
                    <button onClick={() => loadWinPreview(key, false, limit)}
                      style={{ marginTop: 16, padding: '7px 20px', background: '#1e3a5f', border: '1px solid var(--card-border)', borderRadius: 6, color: '#7dd3fc', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      ↻ Retry
                    </button>
                  </div>
                ) : (
                  <DataGrid records={data?.records ?? []} columns={data?.columns ?? []} loading={loading && !isRefreshing} />
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Distribution Cache — Item Master */}
      <div style={{ flexShrink: 0, border: '1px solid var(--card-border)', borderRadius: 10, background: 'var(--card-bg)', padding: '14px 18px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Distribution Cache · REPORT.V_ITEM_MASTER
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
            background: imStatus?.ready ? '#065f4620' : '#92400e20',
            color: imStatus?.ready ? '#34d399' : '#f59e0b',
          }}>
            {imStatus === null ? '…' : imStatus.ready ? '✓ Cached' : '⚠ Not Downloaded'}
          </span>
          {imStatus?.ready && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {imStatus.rows.toLocaleString('en-IN')} rows
              {imStatus.cached_at ? ` · ${new Date(imStatus.cached_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
            </span>
          )}
          <button
            onClick={downloadItemMaster}
            disabled={imLoading}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none',
              cursor: imLoading ? 'not-allowed' : 'pointer',
              background: imLoading ? '#334155' : '#6366f1', color: '#fff', opacity: imLoading ? 0.6 : 1,
            }}>
            {imLoading ? 'Downloading…' : imStatus?.ready ? '↻ Re-download' : '⬇ Download'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Used by Distribution Model — fetches: <code style={{ fontSize: 10 }}>icode, option_level, allocation_option, sz_grp</code>
          </span>
        </div>
        {imMsg && (
          <div style={{ marginTop: 8, fontSize: 12, color: imMsg.startsWith('✓') ? '#34d399' : '#f87171' }}>{imMsg}</div>
        )}
      </div>

      {/* Minimized windows taskbar */}
      {Object.keys(wins).filter(k => k !== activeWin).length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, display: 'flex', gap: 4, alignItems: 'flex-end', padding: '0 8px' }}>
          {Object.keys(wins).filter(k => k !== activeWin).map(key => {
            const win   = wins[key]
            const accent = isCustom(key) ? '#f59e0b' : (TABLE_META[key]?.color ?? '#38bdf8')
            const label  = win.data?.label ?? key.toUpperCase()
            return (
              <div key={key}
                style={{ background: '#131e30', border: `1.5px solid ${accent}55`, borderBottom: 'none', borderRadius: '8px 8px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,.55)', flex: '1 1 0', minWidth: 80, maxWidth: 280, cursor: 'pointer', overflow: 'hidden' }}
                onClick={() => setActiveWin(key)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 8px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{label}</span>
                  {win.data && <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{win.data.rows_in_file.toLocaleString()}</span>}
                  {win.loading && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>…</span>}
                  <button title="Restore" onClick={e => { e.stopPropagation(); setActiveWin(key) }}
                    style={{ width: 20, height: 20, border: '1px solid var(--card-border)', borderRadius: 4, background: '#1e2030', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>▲</button>
                  <button title="Close" onClick={e => { e.stopPropagation(); closeWindow(key) }}
                    style={{ width: 20, height: 20, border: '1px solid var(--card-border)', borderRadius: 4, background: '#1e2030', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}