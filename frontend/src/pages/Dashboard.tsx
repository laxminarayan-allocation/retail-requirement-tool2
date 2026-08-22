/**
 * Dashboard — Phase 9
 *
 * Live KPI aggregation from Oracle (cached), calculation history (SQLite),
 * and the most recent in-memory run result.
 */
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import http from '@/api/http'

// ── Pinned widgets (from MasterData VizPanel) ─────────────────────────────────

type VizMode = 'card' | 'pivot'
type AggFunc = 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'

interface PinnedWidget {
  id: string; label: string; color: string; isCustom: boolean; mode: VizMode
  cardField?: string; cardFunc?: AggFunc
  pivotRow?: string; pivotValue?: string; pivotFunc?: AggFunc
  pinnedAt: string
}

const PINNED_KEY = 'dashboard_widgets'
function getPinned(): PinnedWidget[] {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') } catch { return [] }
}

interface PinnedCardData { field: string; func: string; value: number | string | null; total_rows: number }
interface PinnedPivotData { row_col: string; value_col: string; func: string; rows: Record<string, unknown>[]; total_groups: number }

function PinnedTile({ w, onRemove }: { w: PinnedWidget; onRemove: () => void }) {
  const [cardData, setCardData] = useState<PinnedCardData | null>(null)
  const [pivotData, setPivotData] = useState<PinnedPivotData | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const base = w.isCustom ? `/master/custom/${w.id}` : `/master/table/${w.id}`
    setLoading(true); setErr('')
    if (w.mode === 'card' && w.cardField) {
      http.get(`${base}/aggregate`, { params: { field: w.cardField, func: w.cardFunc ?? 'SUM' } })
        .then(r => { if (r.data.success) setCardData(r.data.data); else setErr(r.data.message || 'Error') })
        .catch(() => setErr('Failed'))
        .finally(() => setLoading(false))
    } else if (w.mode === 'pivot' && w.pivotRow && w.pivotValue) {
      http.get(`${base}/pivot`, { params: { row_col: w.pivotRow, value_col: w.pivotValue, func: w.pivotFunc ?? 'SUM' } })
        .then(r => { if (r.data.success) setPivotData(r.data.data); else setErr(r.data.message || 'Error') })
        .catch(() => setErr('Failed'))
        .finally(() => setLoading(false))
    } else { setLoading(false) }
  }, [w.id, w.mode, w.cardField, w.cardFunc, w.pivotRow, w.pivotValue, w.pivotFunc, w.isCustom])

  function fmtV(v: number | string | null, func: string) {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'number') return v.toLocaleString('en-IN', { maximumFractionDigits: func === 'AVG' ? 2 : 0 })
    return String(v)
  }

  return (
    <div style={{
      background: '#0f172a', border: `1px solid ${w.color}30`, borderRadius: 10,
      padding: '14px 16px', minWidth: 180, position: 'relative', flexShrink: 0,
    }}>
      <button onClick={onRemove} title="Unpin" style={{
        position: 'absolute', top: 8, right: 8, background: 'none', border: 'none',
        color: '#334155', cursor: 'pointer', fontSize: 13, lineHeight: 1,
      }}>✕</button>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
        {w.label}
      </div>
      {loading && <div style={{ color: '#334155', fontSize: 11 }}>Loading…</div>}
      {!loading && err && <div style={{ color: '#f87171', fontSize: 11 }}>{err}</div>}
      {!loading && !err && w.mode === 'card' && cardData && (
        <>
          <div style={{ fontSize: 26, fontWeight: 800, color: w.color, fontFamily: 'monospace', letterSpacing: '-.02em' }}>
            {fmtV(cardData.value, cardData.func)}
          </div>
          <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>
            {cardData.func}({cardData.field})
          </div>
        </>
      )}
      {!loading && !err && w.mode === 'pivot' && pivotData && (
        <>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
            {pivotData.func}({pivotData.value_col}) by {pivotData.row_col}
          </div>
          {pivotData.rows.slice(0, 5).map((r, i) => {
            const rv = r[pivotData.row_col]
            const vv = r[pivotData.value_col]
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#94a3b8' }}>{rv == null ? '—' : String(rv)}</span>
                <span style={{ color: w.color, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
                  {vv == null ? '—' : typeof vv === 'number' ? vv.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(vv)}
                </span>
              </div>
            )
          })}
          {pivotData.total_groups > 5 && (
            <div style={{ fontSize: 10, color: '#334155', marginTop: 4 }}>+{pivotData.total_groups - 5} more groups</div>
          )}
        </>
      )}
    </div>
  )
}

function DefaultStoreTile({ totalStores }: { totalStores: number }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #38bdf830', borderRadius: 10,
      padding: '14px 16px', minWidth: 180, flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
        Store Master
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', letterSpacing: '-.02em' }}>
        {totalStores.toLocaleString('en-IN')}
      </div>
      <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>Active Stores</div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OracleStats {
  oracle_ok: boolean
  oracle_cache_ms: number | null
  total_items: number
  total_stores: number
  upcoming_stores: number
  total_all_stores: number
  active_nso: number
  nso_from_date: string | null
  store_status_distribution: Record<string, number>
  divisions: number
  departments: number
  articles: number
  attributes: string[]
  items_by_attribute1: Record<string, number>
  store_grade_distribution: Record<string, number>
  store_zone_distribution: Record<string, number>
}

interface DivBreak { division: string; total_req: number; stores: number; rows: number }

interface LastRun {
  has_last_run: boolean
  run_id?: string
  label?: string
  factor_set_name?: string
  completed_at?: string
  duration_s?: number
  attribute1?: string
  division?: string
  department?: string
  total_rows?: number
  total_req?: number
  total_pbs?: number
  stores?: number
  departments?: number
  fill_rate_achieved?: number
  zero_req_rows?: number
  capped_rows?: number
  result_rows?: number
  division_breakdown?: DivBreak[]
}

interface HistoryStats {
  total_complete: number
  total_error: number
  avg_duration_s: number | null
  avg_total_req: number | null
  recent_runs: Array<{
    run_id: string; label: string | null; status: string
    started_at: string | null; duration_s: number | null; total_req: number
    attribute1: string | null; exception_errors: number; exception_warnings: number
  }>
}

interface FactorStats {
  total_factor_sets: number
  active_factor_set_id: string | null
  active_factor_set_name: string | null
  active_fill_rate: number | null
  active_safety_days: number | null
}

interface DashboardData {
  oracle: OracleStats
  last_run: LastRun
  history: HistoryStats
  factors: FactorStats
  summary_ms: number
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 16 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 },
  grid5: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 },
  grid6: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' },
  cardHead: { padding: '10px 14px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  cardBody: { padding: '14px' },
  // Hero KPI tile
  kpiTile: (accent: string): React.CSSProperties => ({
    background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
    padding: '16px 18px', borderTop: `3px solid ${accent}`,
  }),
  kpiVal: { fontSize: 28, fontWeight: 800, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' as const, lineHeight: 1.1 },
  kpiLabel: { fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 4 },
  kpiSub: { fontSize: 11, color: '#475569', marginTop: 4 },
  // Small KPI (inside card)
  smKpi: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid #0f172a' },
  smKpiLabel: { fontSize: 12, color: '#64748b' },
  smKpiVal: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' as const },
  // Bar chart
  barRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 },
  barLabel: { width: 100, color: '#94a3b8', textAlign: 'right' as const, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  barTrack: { flex: 1, background: '#0f172a', borderRadius: 4, height: 14, overflow: 'hidden' },
  barFill: (pct: number, color: string): React.CSSProperties => ({
    width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s',
  }),
  barNum: { width: 60, color: '#7dd3fc', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, flexShrink: 0 },
  // Run history micro-list
  runRow: (status: string): React.CSSProperties => ({
    padding: '8px 0', borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
  }),
  // Status dot
  dot: (status: string): React.CSSProperties => ({
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
    background: status === 'complete' ? '#4ade80' : status === 'error' ? '#f87171' : '#fbbf24',
  }),
  // Action buttons
  actionBtn: (accent: string): React.CSSProperties => ({
    background: `${accent}18`, border: `1px solid ${accent}55`, borderRadius: 8,
    padding: '14px 16px', cursor: 'pointer', textAlign: 'left' as const, width: '100%',
    transition: 'background 0.15s',
  }),
  actionTitle: { fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 },
  actionSub: { fontSize: 11, color: '#64748b' },
  // Grade pill
  grade: (g: string): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, marginRight: 4, marginBottom: 4,
    background: g === 'A+' ? '#14532d' : g === 'A' ? '#1a4a2a' : g === 'B+' ? '#1a3a4a' : g === 'B' ? '#1e3a5f' : '#2d1f63',
    color: g === 'A+' ? '#4ade80' : g === 'A' ? '#34d399' : g === 'B+' ? '#38bdf8' : g === 'B' ? '#60a5fa' : '#a78bfa',
    border: `1px solid ${g === 'A+' ? '#16a34a' : g === 'A' ? '#059669' : g === 'B+' ? '#0284c7' : g === 'B' ? '#2563eb' : '#7c3aed'}`,
  }),
}

function fmtNum(n: number | null | undefined, dec = 0) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: dec })
}
function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, accent = '#38bdf8' }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={S.kpiTile(accent)}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={S.kpiVal}>{value}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  )
}

function SmRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={S.smKpi}>
      <span style={S.smKpiLabel}>{label}</span>
      <span style={{ ...S.smKpiVal, color: valueColor ?? '#e2e8f0' }}>{value}</span>
    </div>
  )
}

function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pctW = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={S.barRow}>
      <span style={S.barLabel}>{label}</span>
      <div style={S.barTrack}><div style={S.barFill(pctW, color)} /></div>
      <span style={S.barNum}>{fmtNum(value)}</span>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 4 }}>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<string>('')
  const [pinned, setPinned] = useState<PinnedWidget[]>(getPinned)

  function removePinned(id: string, mode: VizMode) {
    const next = getPinned().filter(w => !(w.id === id && w.mode === mode))
    localStorage.setItem(PINNED_KEY, JSON.stringify(next))
    setPinned(next)
  }

  const load = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) await http.post('/dashboard/cache/clear')
      const res = await http.get<{ success: boolean; data: DashboardData }>('/dashboard/summary', { timeout: 90_000 })
      if (res.data.success) {
        setData(res.data.data)
        setError(null)
        setLastFetch(new Date().toLocaleTimeString('en-IN'))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 28, animation: 'spin 1s linear infinite' }}>⋯</div>
        <div style={{ color: '#64748b', fontSize: 13 }}>Loading dashboard…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24, background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, color: '#f87171' }}>
        Failed to load dashboard: {error}
        <button style={{ marginLeft: 16, background: 'transparent', border: '1px solid #ef4444', borderRadius: 5, color: '#f87171', padding: '4px 12px', cursor: 'pointer' }} onClick={load}>Retry</button>
      </div>
    )
  }

  const { oracle, last_run: lr, history: hist, factors: fct } = data

  // Division breakdown chart
  const divBreak = lr.division_breakdown ?? []
  const maxReq = divBreak.length ? Math.max(...divBreak.map(d => d.total_req)) : 1
  const DIV_COLORS = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f43f5e', '#a78bfa', '#fb923c', '#2dd4bf']

  // Grade distribution chart
  const gradeEntries = Object.entries(oracle.store_grade_distribution)
  const maxGrade = gradeEntries.length ? Math.max(...gradeEntries.map(([, v]) => v)) : 1

  // Items by attribute1
  const attrEntries = Object.entries(oracle.items_by_attribute1).sort(([, a], [, b]) => b - a)
  const maxAttr = attrEntries.length ? Math.max(...attrEntries.map(([, v]) => v)) : 1

  const phasesDone = [
    { label: 'Oracle connection', ok: oracle.oracle_ok },
    { label: 'Item master loaded', ok: oracle.total_items > 0 },
    { label: 'Store master loaded', ok: oracle.total_stores > 0 },
    { label: 'Factor set active', ok: !!fct.active_factor_set_id },
    { label: 'Calculation run', ok: lr.has_last_run },
    { label: 'History persisted', ok: hist.total_complete > 0 },
  ]

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>CityKart Replenishment</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Season: <strong style={{ color: '#38bdf8' }}>PREWINTER · AW26</strong>
            &nbsp;·&nbsp;Oracle: {oracle.oracle_ok
              ? <span style={{ color: '#4ade80' }}>✓ Connected ({oracle.oracle_cache_ms}ms cache)</span>
              : <span style={{ color: '#f87171' }}>✗ Unavailable</span>}
            &nbsp;·&nbsp;Refreshed {lastFetch}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {(data as DashboardData & { oracle?: { from_cache?: boolean } })?.oracle?.from_cache && (
            <span style={{ fontSize: 10, color: '#475569', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '2px 7px' }}>
              ⚡ cached
            </span>
          )}
          <button style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }} onClick={() => { setLoading(true); load() }}>
            ↻ Refresh
          </button>
          <button style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#64748b', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }} title="Force re-fetch from Oracle (slow)" onClick={() => { setLoading(true); load(true) }}>
            ↻ Oracle
          </button>
        </div>
      </div>

      {/* ── Pinned widgets ── */}
      <div>
        <div style={{ fontSize: 10, color: '#334155', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          📌 My Dashboard
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {pinned.length === 0 ? (
            <DefaultStoreTile totalStores={oracle.total_stores} />
          ) : (
            pinned.map(w => (
              <PinnedTile key={`${w.id}-${w.mode}`} w={w} onRemove={() => removePinned(w.id, w.mode)} />
            ))
          )}
        </div>
      </div>

      {/* ── Row 1: Top KPI tiles ── */}
      <div style={S.grid6}>
        <KpiTile
          label="Active Stores"
          value={fmtNum(oracle.total_stores)}
          sub={`${oracle.divisions} divisions`}
          accent="#38bdf8"
        />
        <KpiTile
          label="Active-NSO"
          value={fmtNum(oracle.active_nso)}
          sub={oracle.nso_from_date ? `Since ${oracle.nso_from_date}` : 'Recent openings'}
          accent="#fb923c"
        />
        <KpiTile
          label="Upcoming Stores"
          value={fmtNum(oracle.upcoming_stores)}
          sub={oracle.upcoming_stores > 0 ? 'Opening soon' : 'None planned'}
          accent="#f59e0b"
        />
        <KpiTile
          label="Total Stores"
          value={fmtNum(oracle.total_all_stores)}
          sub="Active + Upcoming"
          accent="#818cf8"
        />
        <KpiTile label="Total Items" value={fmtNum(oracle.total_items)} sub={`${oracle.articles.toLocaleString()} articles`} accent="#a78bfa" />
        <KpiTile label="Last REQ Qty" value={lr.has_last_run ? fmtNum(lr.total_req) : '—'} sub={lr.has_last_run ? `Fill rate: ${pct(lr.fill_rate_achieved)}` : 'No runs yet'} accent="#4ade80" />
      </div>

      {/* ── Row 2: Oracle data + Last run ── */}
      <div style={S.grid2}>

        {/* Oracle master data panel */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Oracle Master Data</span>
            <span style={{ fontSize: 10, color: oracle.oracle_ok ? '#4ade80' : '#f87171' }}>
              {oracle.oracle_ok ? '● Live' : '● Offline'}
            </span>
          </div>
          <div style={S.cardBody}>
            <SmRow label="Active stores" value={fmtNum(oracle.total_stores)} valueColor="#4ade80" />
            <SmRow label={`Active-NSO (since ${oracle.nso_from_date ?? '…'})`} value={fmtNum(oracle.active_nso)} valueColor="#fb923c" />
            <SmRow label="Upcoming stores" value={fmtNum(oracle.upcoming_stores)} valueColor="#f59e0b" />
            {Object.entries(oracle.store_status_distribution)
              .filter(([k]) => k !== 'ACTIVE' && k !== 'UPCOMING')
              .map(([k, v]) => <SmRow key={k} label={k.charAt(0) + k.slice(1).toLowerCase() + ' stores'} value={fmtNum(v)} />)
            }
            <SmRow label="Total stores (all)" value={fmtNum(oracle.total_all_stores)} valueColor="#818cf8" />
            <SmRow label="Total items (all)" value={fmtNum(oracle.total_items)} />
            <SmRow label="Unique articles" value={fmtNum(oracle.articles)} />
            <SmRow label="Divisions" value={fmtNum(oracle.divisions)} />
            <SmRow label="Departments" value={fmtNum(oracle.departments)} />

            {attrEntries.length > 0 && (
              <>
                <SectionHeading>Items by Campaign (ATTRIBUTE1)</SectionHeading>
                {attrEntries.slice(0, 8).map(([attr, cnt], i) => (
                  <HBar key={attr} label={attr} value={cnt} max={maxAttr} color={DIV_COLORS[i % DIV_COLORS.length]} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Last run summary */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>Last Calculation Run</span>
            {lr.has_last_run && (
              <button style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 10, padding: '2px 9px', cursor: 'pointer' }}
                onClick={() => navigate('/calculation')}>
                Open →
              </button>
            )}
          </div>
          <div style={S.cardBody}>
            {!lr.has_last_run ? (
              <div style={{ color: '#64748b', fontSize: 12, padding: '16px 0' }}>No completed runs in memory. Run a calculation to see results here.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {lr.label} &nbsp;·&nbsp; {fmtDate(lr.completed_at)}
                </div>
                <SmRow label="Total REQ Qty" value={fmtNum(lr.total_req)} valueColor="#4ade80" />
                <SmRow label="Stores covered" value={fmtNum(lr.stores)} />
                <SmRow label="Fill rate achieved" value={pct(lr.fill_rate_achieved)} valueColor="#38bdf8" />
                <SmRow label="Total PBS" value={fmtNum(lr.total_pbs)} />
                <SmRow label="Zero-REQ rows" value={fmtNum(lr.zero_req_rows)} />
                <SmRow label="Capped rows" value={fmtNum(lr.capped_rows)} />
                <SmRow label="Duration" value={lr.duration_s != null ? `${lr.duration_s}s` : '—'} />
                <SmRow label="Factor set" value={lr.factor_set_name ?? '—'} />

                {divBreak.length > 0 && (
                  <>
                    <SectionHeading>REQ by Division</SectionHeading>
                    {divBreak.map((d, i) => (
                      <HBar key={d.division} label={d.division} value={Math.round(d.total_req)} max={maxReq} color={DIV_COLORS[i % DIV_COLORS.length]} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 3: Store grades + Factor set + History stats ── */}
      <div style={S.grid3}>

        {/* Store grade distribution */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Store Grade Distribution</span></div>
          <div style={S.cardBody}>
            {gradeEntries.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No grade data available.</div>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>
                  {gradeEntries.map(([g, cnt]) => (
                    <span key={g} style={S.grade(g)}>{g}: {cnt}</span>
                  ))}
                </div>
                {gradeEntries.map(([g, cnt], i) => (
                  <HBar key={g} label={g} value={cnt} max={maxGrade} color={DIV_COLORS[i % DIV_COLORS.length]} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Active factor set */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>Factor Set</span>
            <button style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 10, padding: '2px 9px', cursor: 'pointer' }}
              onClick={() => navigate('/factors')}>
              Manage →
            </button>
          </div>
          <div style={S.cardBody}>
            {!fct.active_factor_set_name ? (
              <div style={{ color: '#f87171', fontSize: 12 }}>No active factor set. Create one to run calculations.</div>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>
                  ★ {fct.active_factor_set_name}
                </div>
                <SmRow label="Total factor sets" value={fmtNum(fct.total_factor_sets)} />
                {fct.active_fill_rate != null && <SmRow label="Fill rate target" value={pct(fct.active_fill_rate)} valueColor="#38bdf8" />}
                {fct.active_safety_days != null && <SmRow label="Safety days" value={`${fct.active_safety_days} days`} />}
              </>
            )}
          </div>
        </div>

        {/* History stats */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>Run Statistics</span>
            <button style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 10, padding: '2px 9px', cursor: 'pointer' }}
              onClick={() => navigate('/history')}>
              Full history →
            </button>
          </div>
          <div style={S.cardBody}>
            <SmRow label="Completed runs" value={fmtNum(hist.total_complete)} valueColor="#4ade80" />
            <SmRow label="Failed runs" value={fmtNum(hist.total_error)} valueColor={hist.total_error > 0 ? '#f87171' : '#64748b'} />
            <SmRow label="Avg duration" value={hist.avg_duration_s != null ? `${hist.avg_duration_s}s` : '—'} />
            <SmRow label="Avg total REQ" value={hist.avg_total_req != null ? fmtNum(hist.avg_total_req) : '—'} />
          </div>
        </div>
      </div>

      {/* ── Row 4: Recent runs + System status + Quick actions ── */}
      <div style={S.grid2}>

        {/* Recent run list */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Recent Runs</span></div>
          <div style={{ padding: '0 14px' }}>
            {hist.recent_runs.length === 0 ? (
              <div style={{ padding: '16px 0', color: '#64748b', fontSize: 12 }}>No runs yet.</div>
            ) : hist.recent_runs.map(r => (
              <div key={r.run_id} style={S.runRow(r.status)}>
                <div style={S.dot(r.status)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, color: '#e2e8f0', fontSize: 12 }}>
                    {r.label || r.run_id.slice(0, 12)}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569' }}>
                    {fmtDate(r.started_at)}
                    {r.attribute1 && ` · ${r.attribute1}`}
                    {r.duration_s && ` · ${r.duration_s}s`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' as const, flexShrink: 0 }}>
                  {r.status === 'complete' && (
                    <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtNum(r.total_req)}
                    </div>
                  )}
                  {(r.exception_errors > 0 || r.exception_warnings > 0) && (
                    <div style={{ fontSize: 10, color: r.exception_errors > 0 ? '#f87171' : '#fbbf24' }}>
                      {r.exception_errors > 0 ? `${r.exception_errors}E ` : ''}{r.exception_warnings > 0 ? `${r.exception_warnings}W` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: System status + Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* System status */}
          <div style={S.card}>
            <div style={S.cardHead}><span style={S.cardTitle}>System Status</span></div>
            <div style={S.cardBody}>
              {phasesDone.map(p => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #0f172a', fontSize: 12 }}>
                  <span style={{ color: p.ok ? '#4ade80' : '#f87171', fontSize: 14 }}>{p.ok ? '✔' : '✖'}</span>
                  <span style={{ color: p.ok ? '#94a3b8' : '#64748b' }}>{p.label}</span>
                </div>
              ))}
              <div style={{ fontSize: 10, color: '#334155', marginTop: 8 }}>
                Summary computed in {data.summary_ms}ms
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div style={S.card}>
            <div style={S.cardHead}><span style={S.cardTitle}>Quick Actions</span></div>
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button style={S.actionBtn('#4ade80')} onClick={() => navigate('/calculation')}>
                <div style={S.actionTitle}>▶ New Calculation</div>
                <div style={S.actionSub}>Run replenishment for PREWINTER campaign</div>
              </button>
              <button style={S.actionBtn('#f59e0b')} onClick={() => navigate('/factors')}>
                <div style={S.actionTitle}>⚙ Manage Factors</div>
                <div style={S.actionSub}>{fct.active_factor_set_name ? `Active: ${fct.active_factor_set_name}` : 'No active factor set'}</div>
              </button>
              <button style={S.actionBtn('#818cf8')} onClick={() => navigate('/master-data')}>
                <div style={S.actionTitle}>🗄 Master Data Explorer</div>
                <div style={S.actionSub}>{oracle.total_stores} stores · {oracle.total_items.toLocaleString()} items</div>
              </button>
              <button style={S.actionBtn('#38bdf8')} onClick={() => navigate('/history')}>
                <div style={S.actionTitle}>🕑 Calculation History</div>
                <div style={S.actionSub}>{hist.total_complete} completed · {hist.total_error} failed</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
