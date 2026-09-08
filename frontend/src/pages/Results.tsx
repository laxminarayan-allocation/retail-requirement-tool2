/**
 * Result Explorer — Phase 10
 *
 * Full-page explorer for any completed calculation run.
 * Features: run picker, rich filter sidebar, column visibility,
 * sortable grid, group-by aggregate view, KPI bar, export.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ExportPanel from '@/components/ExportPanel'
import http from '@/api/http'
import NumFilterDropdown, { NumFilterIcon, useNumFilter } from '@/components/NumFilterDropdown'

function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(value), delay)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, delay])
  return debounced
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryRun {
  run_id: string; label: string | null; status: string
  started_at: string | null; total_req: number; attribute1: string | null
  factor_set_name: string | null; stores: number; departments_count: number
  fill_rate_achieved: number; duration_s: number | null
}

interface FilterOptions {
  divisions: string[]; attribute1s: string[]; departments: string[]; store_grades: string[]
  display_types: string[]; columns: string[]; total_rows: number
}

interface ScopeRow { division: string; div_op: '=' | '<>'; attribute1: string; attr_op: '=' | '<>' }

interface FilteredSummary {
  total_req: number; total_pbs: number; stores: number; zero_req: number; capped: number
}

interface AggRow {
  [key: string]: string | number
  total_req: number; total_pbs: number; rows: number; stores: number
  zero_req: number; capped: number; avg_cover: number
}

type SortDir = 'asc' | 'desc'

// ── Column definitions ─────────────────────────────────────────────────────────

const COL_GROUPS: Record<string, string[]> = {
  Identity: ['store_name', 'store_grade', 'zone', 'division', 'department', 'attribute1', 'display_type'],
  PBS: ['pbs_multiplier', 'pbs', 'fnl_pbs'],
  Capacity: ['mdq', 'bgt_mc_str', 'bgt_cap'],
  Stock: ['ttl_stk_q', 'l4w_sl', 'daily_sales', 'stock_cover_days'],
  Result: ['fill_req', 'net_req', 'req', 'req_capped'],
}
const ALL_COLS = Object.values(COL_GROUPS).flat()
const DEFAULT_VISIBLE = new Set([
  'store_name', 'store_grade', 'division', 'department',
  'pbs', 'fnl_pbs', 'ttl_stk_q', 'l4w_sl', 'stock_cover_days',
  'fill_req', 'net_req', 'req', 'req_capped',
])
const NUM_COLS = new Set([
  'pbs_multiplier', 'pbs', 'fnl_pbs', 'mdq', 'bgt_mc_str', 'bgt_cap',
  'ttl_stk_q', 'l4w_sl', 'daily_sales', 'stock_cover_days',
  'fill_req', 'net_req', 'req', 'req_capped',
])

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100vh - 100px)', minHeight: 0 },
  body: { display: 'flex', gap: 10, flex: 1, minHeight: 0 },
  sidebar: { width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, minHeight: 0 },
  card: { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' },
  cardHead: { padding: '8px 12px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: 0.4, textTransform: 'uppercase' as const },
  sideSection: { fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 5, marginTop: 3 },
  label: { fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, display: 'block' },
  input: { background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', width: '100%', boxSizing: 'border-box' as const, marginBottom: 6 },
  select: { background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', width: '100%', boxSizing: 'border-box' as const, marginBottom: 6 },
  btnSm: { background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  btnBlue: { background: '#0ea5e9', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 12px', cursor: 'pointer' },
  // KPI bar
  kpiBar: { display: 'flex', gap: 8, padding: '8px 12px', flexWrap: 'wrap' as const },
  kpiChip: (accent: string): React.CSSProperties => ({
    background: 'var(--content-bg)', border: `1px solid ${accent}44`, borderRadius: 6,
    padding: '5px 10px', display: 'flex', flexDirection: 'column', gap: 1,
  }),
  kpiVal: (accent: string): React.CSSProperties => ({
    fontSize: 16, fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums' as const, lineHeight: 1,
  }),
  kpiLabel: { fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  // Grid
  tblWrap: { overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 },
  tbl: { borderCollapse: 'collapse' as const, fontSize: 11 },
  th: (sorted: boolean): React.CSSProperties => ({
    background: 'var(--content-bg)', color: sorted ? '#38bdf8' : '#64748b', fontWeight: 600,
    padding: '5px 10px', textAlign: 'left' as const, whiteSpace: 'nowrap' as const,
    position: 'sticky' as const, top: 0, borderBottom: '1px solid var(--card-border)',
    fontSize: 10, letterSpacing: 0.3, cursor: 'pointer', userSelect: 'none' as const,
  }),
  td: { padding: '4px 10px', color: 'var(--text-secondary)', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' as const },
  tdNum: { padding: '4px 10px', color: '#7dd3fc', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  tdReq: { padding: '4px 10px', color: '#4ade80', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  // Agg table
  aggTh: { background: 'var(--content-bg)', color: 'var(--text-muted)', fontWeight: 600, padding: '6px 12px', textAlign: 'left' as const, borderBottom: '1px solid var(--card-border)', fontSize: 10, letterSpacing: 0.3 },
  aggTd: { padding: '6px 12px', color: 'var(--text-secondary)', borderBottom: '1px solid #1e293b', fontSize: 12 },
  aggTdNum: { padding: '6px 12px', color: '#7dd3fc', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontSize: 12 },
  aggTdReq: { padding: '6px 12px', color: '#4ade80', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const, fontSize: 12 },
  // Tab
  tab: (active: boolean): React.CSSProperties => ({
    background: 'none', border: 'none',
    borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
    color: active ? '#e2e8f0' : '#64748b', fontSize: 12, fontWeight: 600,
    padding: '6px 14px', cursor: 'pointer',
  }),
  empty: { padding: 40, textAlign: 'center' as const, color: 'var(--text-muted)', fontSize: 13 },
}

function fmtNum(v: string | number, dec = 0) {
  if (v === '' || v == null) return '—'
  const n = Number(v)
  if (isNaN(n)) return String(v)
  return n.toLocaleString(undefined, { maximumFractionDigits: dec })
}
function pct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

// ── Run picker ────────────────────────────────────────────────────────────────

function RunPicker({ selectedId, onChange }: { selectedId: string; onChange: (id: string, label: string) => void }) {
  const [runs, setRuns] = useState<HistoryRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    http.get<{ success: boolean; data: { runs: HistoryRun[] } }>(
      '/calculation/history', { params: { status: 'complete', limit: '50' } }
    ).then(r => {
      if (r.data.success) setRuns(r.data.data.runs)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>Run:</span>
      <select
        style={{ ...S.select, flex: 1, marginBottom: 0, fontSize: 12 }}
        value={selectedId}
        onChange={e => {
          const run = runs.find(r => r.run_id === e.target.value)
          onChange(e.target.value, run?.label ?? '')
        }}
      >
        <option value="">— pick a completed run —</option>
        {loading && <option disabled>Loading…</option>}
        {runs.map(r => (
          <option key={r.run_id} value={r.run_id}>
            {r.label ?? r.run_id.slice(0, 12)} · {fmtDate(r.started_at)} · REQ {fmtNum(r.total_req)}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Column visibility panel ───────────────────────────────────────────────────

function ColVisPanel({ visible, onChange }: { visible: Set<string>; onChange: (v: Set<string>) => void }) {
  function toggle(col: string) {
    const next = new Set(visible)
    if (next.has(col)) { if (next.size > 1) next.delete(col) }
    else next.add(col)
    onChange(next)
  }
  function setGroup(cols: string[], on: boolean) {
    const next = new Set(visible)
    cols.forEach(c => on ? next.add(c) : (next.size > 1 && next.delete(c)))
    onChange(next)
  }

  return (
    <div>
      {Object.entries(COL_GROUPS).map(([group, cols]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={S.sideSection}>{group}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...S.btnSm, fontSize: 9, padding: '1px 5px' }} onClick={() => setGroup(cols, true)}>all</button>
              <button style={{ ...S.btnSm, fontSize: 9, padding: '1px 5px' }} onClick={() => setGroup(cols, false)}>none</button>
            </div>
          </div>
          {cols.map(col => (
            <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: visible.has(col) ? '#e2e8f0' : '#475569', cursor: 'pointer', marginBottom: 2 }}>
              <input type="checkbox" checked={visible.has(col)} onChange={() => toggle(col)} style={{ cursor: 'pointer' }} />
              {col}
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── KPI summary bar ───────────────────────────────────────────────────────────

function KpiBar({ s, total, filtered }: { s: FilteredSummary; total: number; filtered: number }) {
  const chips = [
    { label: 'Total REQ', val: fmtNum(s.total_req), accent: '#4ade80' },
    { label: 'Stores', val: fmtNum(s.stores), accent: '#38bdf8' },
    { label: 'Rows shown', val: `${filtered.toLocaleString()} / ${total.toLocaleString()}`, accent: '#818cf8' },
    { label: 'Zero REQ', val: fmtNum(s.zero_req), accent: '#64748b' },
    { label: 'Capped', val: fmtNum(s.capped), accent: '#f59e0b' },
    { label: 'Total PBS', val: fmtNum(s.total_pbs), accent: '#94a3b8' },
  ]
  return (
    <div style={{ ...S.card }}>
      <div style={S.kpiBar}>
        {chips.map(c => (
          <div key={c.label} style={S.kpiChip(c.accent)}>
            <div style={S.kpiVal(c.accent)}>{c.val}</div>
            <div style={S.kpiLabel}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Aggregate view ────────────────────────────────────────────────────────────

function AggView({ runId, groupBy, totalReq }: { runId: string; groupBy: string; totalReq: number }) {
  const [rows, setRows] = useState<AggRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!runId) return
    setLoading(true)
    http.get<{ success: boolean; data: { rows: AggRow[] } }>(
      `/calculation/runs/${runId}/results/aggregate`, { params: { group_by: groupBy } }
    ).then(r => { if (r.data.success) setRows(r.data.data.rows) })
      .catch(console.error).finally(() => setLoading(false))
  }, [runId, groupBy])

  if (loading) return <div style={S.empty}>Loading…</div>
  if (!rows.length) return <div style={S.empty}>No data.</div>

  const AggCols: Array<{ key: string; label: string; style: React.CSSProperties; fmt: (v: number) => string }> = [
    { key: groupBy, label: groupBy.toUpperCase(), style: S.aggTd, fmt: v => String(v) },
    { key: 'total_req', label: 'TOTAL REQ', style: S.aggTdReq, fmt: v => fmtNum(v) },
    { key: 'stores', label: 'STORES', style: S.aggTdNum, fmt: v => fmtNum(v) },
    { key: 'rows', label: 'ROWS', style: S.aggTdNum, fmt: v => fmtNum(v) },
    { key: 'total_pbs', label: 'TOTAL PBS', style: S.aggTdNum, fmt: v => fmtNum(v) },
    { key: 'zero_req', label: 'ZERO REQ', style: S.aggTdNum, fmt: v => fmtNum(v) },
    { key: 'capped', label: 'CAPPED', style: S.aggTdNum, fmt: v => fmtNum(v) },
    { key: 'avg_cover', label: 'AVG COVER', style: S.aggTdNum, fmt: v => v > 990 ? '∞' : fmtNum(v, 1) },
    { key: '_pct', label: '% OF REQ', style: S.aggTdNum, fmt: (_v, row?: AggRow) => row ? pct((row.total_req as number) / (totalReq || 1)) : '—' },
  ]

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <table style={{ ...S.tbl, width: '100%' }}>
        <thead>
          <tr>
            {AggCols.map(c => <th key={c.key} style={S.aggTh}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0f172a22' }}>
              {AggCols.map(c => (
                <td key={c.key} style={c.style}>
                  {c.key === '_pct'
                    ? pct((row.total_req as number) / (totalReq || 1))
                    : c.fmt ? c.fmt(row[c.key] as number) : String(row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Results() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const numFilter = useNumFilter()

  // Run state
  const [runId, setRunId] = useState(searchParams.get('run_id') ?? '')
  const [runLabel, setRunLabel] = useState('')
  const [filterOpts, setFilterOpts] = useState<FilterOptions | null>(null)

  // Scope builder (Division × Attribute1 rows, OR-combined)
  const [scopes, setScopes] = useState<ScopeRow[]>([{ division: '', div_op: '=', attribute1: '', attr_op: '=' }])
  const addScope = () => setScopes(s => [...s, { division: '', div_op: '=', attribute1: '', attr_op: '=' }])
  const removeScope = (i: number) => setScopes(s => s.filter((_, idx) => idx !== i))
  const updateScope = (i: number, field: keyof ScopeRow, val: string) =>
    setScopes(s => s.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  // Other filters
  const [deptFilter, setDeptFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [minReq, setMinReq] = useState('')
  const [maxReq, setMaxReq] = useState('')
  const [reqOnly, setReqOnly] = useState(false)

  // Debounced versions of free-text inputs — avoids firing on every keystroke
  const debouncedStore = useDebounce(storeFilter, 400)
  const debouncedMinReq = useDebounce(minReq, 400)
  const debouncedMaxReq = useDebounce(maxReq, 400)

  // Column visibility
  const [visibleCols, setVisibleCols] = useState<Set<string>>(DEFAULT_VISIBLE)

  // Sort
  const [sortBy, setSortBy] = useState('req')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  function startResizeCol(col: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX; const startW = colWidths[col] ?? 100
    function onMove(me: MouseEvent) { setColWidths(p => ({ ...p, [col]: Math.max(40, startW + me.clientX - startX) })) }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // Data
  const [rows, setRows] = useState<Record<string, string | number>[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filteredSummary, setFilteredSummary] = useState<FilteredSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const limit = 300

  // Tab
  const [tab, setTab] = useState<'grid' | 'aggregate'>('grid')
  const [groupBy, setGroupBy] = useState('division')

  // Load filter options when run changes
  useEffect(() => {
    if (!runId) { setFilterOpts(null); setRows([]); setTotal(0); return }
    http.get<{ success: boolean; data: FilterOptions }>(
      `/calculation/runs/${runId}/results/filter-options`
    ).then(r => { if (r.data.success) setFilterOpts(r.data.data) })
      .catch(console.error)
  }, [runId])

  const loadData = useCallback(async (off = 0) => {
    if (!runId) return
    setLoading(true); setDataError(null)
    try {
      const params: Record<string, string> = {
        offset: String(off), limit: String(limit),
        sort_by: sortBy, sort_desc: sortDir === 'desc' ? 'true' : 'false',
        req_only: reqOnly ? 'true' : 'false',
      }
      const activeScopes = scopes.filter(s => s.division || s.attribute1)
      if (activeScopes.length > 0) params.scopes = JSON.stringify(activeScopes)
      if (deptFilter) params.department = deptFilter
      if (gradeFilter) params.store_grade = gradeFilter
      if (debouncedStore) params.store_name = debouncedStore
      if (debouncedMinReq) params.min_req = debouncedMinReq
      if (debouncedMaxReq) params.max_req = debouncedMaxReq

      const res = await http.get<{ success: boolean; data: { total: number; rows: Record<string, string | number>[]; filtered_summary: FilteredSummary } }>(
        `/calculation/runs/${runId}/results`, { params }
      )
      if (res.data.success) {
        setRows(res.data.data.rows)
        setTotal(res.data.data.total)
        setFilteredSummary(res.data.data.filtered_summary)
        setOffset(off)
      } else {
        setDataError('Failed to load results')
      }
    } catch (e: unknown) {
      setDataError(e instanceof Error ? e.message : 'Error')
    } finally { setLoading(false) }
  }, [runId, sortBy, sortDir, scopes, deptFilter, gradeFilter, debouncedStore, debouncedMinReq, debouncedMaxReq, reqOnly])

  useEffect(() => { if (runId) loadData(0) }, [loadData, runId])

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  function resetFilters() {
    setScopes([{ division: '', div_op: '=', attribute1: '', attr_op: '=' }])
    setDeptFilter(''); setGradeFilter('')
    setStoreFilter(''); setMinReq(''); setMaxReq(''); setReqOnly(false)
  }

  const visColList = ALL_COLS.filter(c => visibleCols.has(c) && (filterOpts ? filterOpts.columns.includes(c) : true))

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Result Explorer</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Detailed allocation results with filtering, sorting and grouping</div>
        </div>
        <div style={{ flex: 1 }}>
          <RunPicker selectedId={runId} onChange={(id, label) => { setRunId(id); setRunLabel(label) }} />
        </div>
        {runId && (
          <>
            <button style={S.btnSm} onClick={() => navigate(`/calculation`)}>← Calc</button>
            <ExportPanel runId={runId} runLabel={runLabel} />
          </>
        )}
      </div>

      {!runId && (
        <div style={{ ...S.card, padding: 40, textAlign: 'center' as const, color: 'var(--text-muted)', fontSize: 13 }}>
          Select a completed calculation run above to explore its results.
          <br /><br />
          <button style={S.btnBlue} onClick={() => navigate('/history')}>Browse run history →</button>
        </div>
      )}

      {runId && (
        <>
          {/* KPI bar */}
          {filteredSummary && (
            <KpiBar s={filteredSummary} total={filterOpts?.total_rows ?? 0} filtered={total} />
          )}

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--card-border)' }}>
            <button style={S.tab(tab === 'grid')} onClick={() => setTab('grid')}>
              Grid ({total.toLocaleString()} rows)
            </button>
            <button style={S.tab(tab === 'aggregate')} onClick={() => setTab('aggregate')}>
              Group By
            </button>
            {tab === 'aggregate' && (
              <select style={{ ...S.select, width: 130, marginBottom: 0, marginLeft: 8, alignSelf: 'center', fontSize: 11 }}
                value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                {['division', 'department', 'store_grade', 'store_name'].map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            )}
          </div>

          {/* Body: sidebar + main */}
          <div style={S.body}>
            {/* Filter + column sidebar */}
            <div style={S.sidebar}>
              {/* Filters */}
              <div style={{ ...S.card, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={S.sideSection}>Filters</span>
                  <button style={{ ...S.btnSm, fontSize: 9, padding: '1px 6px' }} onClick={resetFilters}>reset</button>
                </div>

                {/* Scope Builder: Division × Attribute1 rows, OR-combined */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ ...S.label, marginBottom: 0 }}>Scope (Division × Attribute1)</label>
                  <button style={{ ...S.btnSm, fontSize: 9, padding: '1px 6px' }} onClick={addScope}>+ Add</button>
                </div>
                {scopes.map((sc, i) => (
                  <div key={i} style={{ background: 'var(--content-bg)', border: '1px solid #1e3a5f', borderRadius: 5, padding: '5px 7px', marginBottom: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Scope {i + 1}</span>
                      {scopes.length > 1 && (
                        <button onClick={() => removeScope(i)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 11, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
                      )}
                    </div>
                    {/* Division row: operator + value */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                      <select style={{ ...S.select, width: 44, marginBottom: 0, padding: '4px 4px', fontWeight: 700, color: sc.div_op === '<>' ? '#f87171' : '#38bdf8' }}
                        value={sc.div_op} onChange={e => updateScope(i, 'div_op', e.target.value)}>
                        <option value="=">=</option>
                        <option value="<>">&lt;&gt;</option>
                      </select>
                      <select style={{ ...S.select, flex: 1, marginBottom: 0 }} value={sc.division} onChange={e => updateScope(i, 'division', e.target.value)}>
                        <option value="">Division</option>
                        {(filterOpts?.divisions ?? []).map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                    {/* Attribute1 row: operator + value */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select style={{ ...S.select, width: 44, marginBottom: 0, padding: '4px 4px', fontWeight: 700, color: sc.attr_op === '<>' ? '#f87171' : '#38bdf8' }}
                        value={sc.attr_op} onChange={e => updateScope(i, 'attr_op', e.target.value)}>
                        <option value="=">=</option>
                        <option value="<>">&lt;&gt;</option>
                      </select>
                      <select style={{ ...S.select, flex: 1, marginBottom: 0 }} value={sc.attribute1} onChange={e => updateScope(i, 'attribute1', e.target.value)}>
                        <option value="">Attribute1</option>
                        {(filterOpts?.attribute1s ?? []).map(a => <option key={a}>{a}</option>)}
                      </select>
                    </div>
                  </div>
                ))}

                <label style={S.label}>Department</label>
                <select style={S.select} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                  <option value="">All</option>
                  {(filterOpts?.departments ?? []).map(d => <option key={d}>{d}</option>)}
                </select>

                <label style={S.label}>Store Grade</label>
                <select style={S.select} value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}>
                  <option value="">All</option>
                  {(filterOpts?.store_grades ?? []).map(g => <option key={g}>{g}</option>)}
                </select>

                <label style={S.label}>Store name contains</label>
                <input style={S.input} value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
                  placeholder="search…" onKeyDown={e => e.key === 'Enter' && loadData(0)} />

                <label style={S.label}>Min REQ</label>
                <input style={S.input} value={minReq} onChange={e => setMinReq(e.target.value)}
                  placeholder="0" type="number" onKeyDown={e => e.key === 'Enter' && loadData(0)} />

                <label style={S.label}>Max REQ</label>
                <input style={S.input} value={maxReq} onChange={e => setMaxReq(e.target.value)}
                  placeholder="∞" type="number" onKeyDown={e => e.key === 'Enter' && loadData(0)} />

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={reqOnly} onChange={e => setReqOnly(e.target.checked)} />
                  REQ &gt; 0 only
                </label>

                <button style={{ ...S.btnBlue, width: '100%' }} onClick={() => loadData(0)}>Apply</button>
              </div>

              {/* Column visibility */}
              {tab === 'grid' && (
                <div style={{ ...S.card, padding: '10px 12px', flex: 1, overflowY: 'auto' }}>
                  <div style={{ ...S.sideSection, marginBottom: 8 }}>Columns</div>
                  <ColVisPanel visible={visibleCols} onChange={setVisibleCols} />
                </div>
              )}
            </div>

            {/* Main content */}
            <div style={S.main}>
              {dataError && (
                <div style={{ padding: '8px 12px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#f87171', fontSize: 12 }}>
                  {dataError}
                </div>
              )}

              {tab === 'grid' && (
                <div style={{ ...S.card, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  {loading && <div style={S.empty}>Loading…</div>}
                  {!loading && rows.length === 0 && <div style={S.empty}>No rows match the current filters.</div>}
                  {!loading && rows.length > 0 && (
                    <>
                      <div style={S.tblWrap}>
                        <table style={S.tbl}>
                          <thead>
                            <tr>
                              {visColList.map(col => (
                                <th key={col} style={{ ...S.th(sortBy === col), position: 'relative', width: colWidths[col] }} onClick={() => handleSort(col)}>
                                  {col.toUpperCase().replace(/_/g, ' ')}
                                  {sortBy === col ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                                  {NUM_COLS.has(col) && <NumFilterIcon col={col} active={!!numFilter.numFilters[col]} onOpen={numFilter.openFilter} />}
                                  <span onMouseDown={e => startResizeCol(col, e)} onClick={e => e.stopPropagation()}
                                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent', borderRight: '2px solid transparent' }}
                                    onMouseEnter={e => (e.currentTarget.style.borderRightColor = '#334155')}
                                    onMouseLeave={e => (e.currentTarget.style.borderRightColor = 'transparent')} />
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(numFilter.applyToRows(rows as Record<string, unknown>[]) as typeof rows).map((row, i) => {
                              const reqVal = Number(row['req'] ?? 0)
                              const rowBg = i % 2 === 0 ? 'transparent' : '#0f172a22'
                              const isCapped = row['req_capped'] === 1 || row['req_capped'] === '1'
                              return (
                                <tr key={i} style={{
                                  background: rowBg,
                                  borderLeft: isCapped ? '2px solid #f59e0b44' : '2px solid transparent',
                                }}>
                                  {visColList.map(col => {
                                    const v = row[col]
                                    const isReq = col === 'req'
                                    const isNum = NUM_COLS.has(col)
                                    const display = (v === '' || v == null) ? '—' : (isNum ? fmtNum(v, col === 'daily_sales' || col === 'pbs_multiplier' ? 3 : col === 'stock_cover_days' ? 1 : 0) : String(v))
                                    return (
                                      <td key={col} style={isReq ? S.tdReq : isNum ? S.tdNum : S.td}>
                                        {isReq && reqVal > 0 ? (
                                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                            {isCapped && <span style={{ fontSize: 8, color: '#f59e0b' }} title="Capped by capacity">⚑</span>}
                                            {display}
                                          </span>
                                        ) : display}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      <div style={{ padding: '6px 12px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                        <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
                        <button style={S.btnSm} disabled={offset === 0} onClick={() => loadData(Math.max(0, offset - limit))}>← Prev</button>
                        <button style={S.btnSm} disabled={offset + limit >= total} onClick={() => loadData(offset + limit)}>Next →</button>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>
                          Sort: {sortBy} {sortDir} · ⚑ = capped by capacity
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'aggregate' && (
                <div style={{ ...S.card, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                  <div style={S.cardHead}>
                    <span style={S.cardTitle}>REQ by {groupBy}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {filteredSummary ? `Total REQ: ${fmtNum(filteredSummary.total_req)}` : ''}
                    </span>
                  </div>
                  <AggView
                    runId={runId}
                    groupBy={groupBy}
                    totalReq={filteredSummary?.total_req ?? 0}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {numFilter.openCol && numFilter.anchor && (
        <NumFilterDropdown
          col={numFilter.openCol}
          value={numFilter.numFilters[numFilter.openCol]}
          onChange={v => numFilter.applyFilter(numFilter.openCol!, v)}
          onClose={() => numFilter.setOpenCol(null)}
          anchor={numFilter.anchor}
        />
      )}
    </div>
  )
}
