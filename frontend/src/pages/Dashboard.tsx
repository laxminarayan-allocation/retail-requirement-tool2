/**
 * Dashboard — Phase 9
 *
 * Live KPI aggregation from Oracle (cached), calculation history (SQLite),
 * and the most recent in-memory run result.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import http from '@/api/http'
import FilterableTable from '@/components/FilterableTable'
import StaleBanner from '@/components/StaleBanner'
import { useAuth } from '@/context/AuthContext'

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
      background: 'var(--content-bg)', border: `1px solid ${w.color}30`, borderRadius: 10,
      padding: '14px 16px', minWidth: 180, position: 'relative', flexShrink: 0,
    }}>
      <button onClick={onRemove} title="Unpin" style={{
        position: 'absolute', top: 8, right: 8, background: 'none', border: 'none',
        color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
      }}>✕</button>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
        {w.label}
      </div>
      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Loading…</div>}
      {!loading && err && <div style={{ color: '#f87171', fontSize: 11 }}>{err}</div>}
      {!loading && !err && w.mode === 'card' && cardData && (
        <>
          <div style={{ fontSize: 26, fontWeight: 800, color: w.color, fontFamily: 'monospace', letterSpacing: '-.02em' }}>
            {fmtV(cardData.value, cardData.func)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            {cardData.func}({cardData.field})
          </div>
        </>
      )}
      {!loading && !err && w.mode === 'pivot' && pivotData && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            {pivotData.func}({pivotData.value_col}) by {pivotData.row_col}
          </div>
          {pivotData.rows.slice(0, 5).map((r, i) => {
            const rv = r[pivotData.row_col]
            const vv = r[pivotData.value_col]
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{rv == null ? '—' : String(rv)}</span>
                <span style={{ color: w.color, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
                  {vv == null ? '—' : typeof vv === 'number' ? vv.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(vv)}
                </span>
              </div>
            )
          })}
          {pivotData.total_groups > 5 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>+{pivotData.total_groups - 5} more groups</div>
          )}
        </>
      )}
    </div>
  )
}

function DefaultStoreTile({ totalStores }: { totalStores: number }) {
  return (
    <div style={{
      background: 'var(--content-bg)', border: '1px solid #38bdf830', borderRadius: 10,
      padding: '14px 16px', minWidth: 180, flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
        Store Master
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace', letterSpacing: '-.02em' }}>
        {totalStores.toLocaleString('en-IN')}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Active Stores</div>
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
  opening_2026: number
  opening_60d: number
  last_opened_name: string
  last_opened_date: string
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
  upcoming_grade_distribution: Record<string, number>
  zone_grade_distribution: Record<string, Record<string, number>>
  store_zone_distribution: Record<string, number>
  store_zone_upcoming: Record<string, number>
  store_state_distribution: Record<string, number>
  store_state_upcoming: Record<string, number>
  store_tag_distribution: Record<string, number>
  store_tag_upcoming: Record<string, number>
  store_city_distribution: Record<string, number>
  store_city_upcoming: Record<string, number>
  state_city_distribution: Record<string, Record<string, number>>
  closed_stores: number
  closed_grade_distribution: Record<string, number>
  closed_zone_distribution: Record<string, number>
  closed_tag_distribution: Record<string, number>
  closed_state_distribution: Record<string, number>
  closed_city_distribution: Record<string, number>
  store_cal_year_closed: Record<string, number>
  store_fin_year_closed: Record<string, number>
  unique_state_count: number
  unique_city_count: number
  active_state_count: number
  active_city_count: number
  upcoming_state_count: number
  upcoming_city_count: number
  upcoming_new_city_count: number
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
  card: { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' },
  cardHead: { padding: '10px 14px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  cardBody: { padding: '14px' },
  // Hero KPI tile
  kpiTile: (accent: string): React.CSSProperties => ({
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8,
    padding: '16px 18px', borderTop: `3px solid ${accent}`,
  }),
  kpiVal: { fontSize: 28, fontWeight: 800, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' as const, lineHeight: 1.1 },
  kpiLabel: { fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 4 },
  kpiSub: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  // Small KPI (inside card)
  smKpi: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid #0f172a' },
  smKpiLabel: { fontSize: 12, color: 'var(--text-muted)' },
  smKpiVal: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' as const },
  // Bar chart
  barRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 },
  barLabel: { width: 100, color: 'var(--text-secondary)', textAlign: 'right' as const, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  barTrack: { flex: 1, background: 'var(--content-bg)', borderRadius: 4, height: 14, overflow: 'hidden' },
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
  actionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 },
  actionSub: { fontSize: 11, color: 'var(--text-muted)' },
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
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 4, marginTop: 4 }}>
      {children}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Allocation summary types ───────────────────────────────────────────────────

interface AllocRow {
  division?: string
  section?: string
  department?: string
  store_code?: number | string
  store_name?: string
  stores?: number
  articles?: number
  stk_qty?: number
  dc_stk_q?: number
  alloc_qty?: number
  lm_sale_q?: number
  mtd_sale_q?: number
  proj_qty?: number
  in_transit_q?: number
  [key: string]: unknown
}

interface AllocSummary {
  available: boolean
  total_rows?: number
  rows: AllocRow[]
  totals?: AllocRow
}

interface DetailData {
  available: boolean
  total: number
  page: number
  limit: number
  total_pages: number
  rows: Record<string, unknown>[]
  columns: string[]
}

const STATE_LABELS: Record<string, string> = {
  'UP': 'Uttar Pradesh', 'MP': 'Madhya Pradesh', 'CH': 'CHHATTISGARH',
  'AR': 'Arunachal', 'AP': 'Andhra Pradesh', 'TN': 'Tamil Nadu',
  'MH': 'Maharashtra', 'GJ': 'Gujarat', 'RJ': 'Rajasthan',
  'WB': 'West Bengal', 'HR': 'Haryana', 'PB': 'Punjab',
  'UK': 'Uttarakhand', 'HP': 'Himachal', 'GA': 'Goa',
  'KA': 'Karnataka', 'KL': 'Kerala', 'TG': 'Telangana',
  'JK': 'J&K', 'KASHMIR': 'KASHMIR', 'JAMMU': 'JAMMU',
  'ODISHA': 'ODISHA', 'NEW DELHI': 'Delhi', 'JH': 'Jharkhand',
  'ASSAM': 'Assam', 'GURGAON': 'Gurgaon', 'J&K': 'J&K',
}

const CITY_COLORS = ['#06b6d4','#38bdf8','#34d399','#a78bfa','#f59e0b','#fb923c','#ec4899','#10b981','#818cf8','#84cc16','#f87171','#67e8f9']

function StateCityCard({ oracle, onDrill, cardId, expanded, onToggle }: { oracle: OracleStats; onDrill: (split: string, value: string) => void; cardId: string; expanded: boolean; onToggle: (id: string) => void }) {
  const [viewMode, setViewMode] = useState<'state' | 'city' | 'combo'>('state')
  const stateDist = oracle.store_state_distribution ?? {}
  const stateUpDist = oracle.store_state_upcoming ?? {}
  const stateClDist = oracle.closed_state_distribution ?? {}
  const cityDist = oracle.store_city_distribution ?? {}
  const cityUpDist = oracle.store_city_upcoming ?? {}
  const cityClDist = oracle.closed_city_distribution ?? {}
  const stateCityDist = oracle.state_city_distribution ?? {}
  const hasCityData = Object.keys(cityDist).length > 0
  const hasComboData = Object.keys(stateCityDist).length > 0
  const hasStateData = Object.keys(stateDist).length > 0
  if (!hasStateData && !hasCityData) return null

  const tabs = [
    ...(hasStateData ? ['state'] : []),
    ...(hasCityData ? ['city'] : []),
    ...(hasComboData ? ['combo'] : []),
  ] as ('state' | 'city' | 'combo')[]

  const activeDist = viewMode === 'city' ? cityDist : stateDist
  const upcomingDist = viewMode === 'city' ? cityUpDist : stateUpDist
  const closedDistSC = viewMode === 'city' ? cityClDist : stateClDist
  const hasClosedSC = Object.keys(closedDistSC).length > 0
  const allKeys = Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist), ...Object.keys(closedDistSC)]))
    .filter(k => k !== '—' && k !== '-')
    .sort((a, b) => ((activeDist[b] ?? 0) + (upcomingDist[b] ?? 0)) - ((activeDist[a] ?? 0) + (upcomingDist[a] ?? 0)))
  const mx = Math.max(...allKeys.map(k => (activeDist[k] ?? 0) + (upcomingDist[k] ?? 0) + (closedDistSC[k] ?? 0)), 1)

  // combo: states sorted by total city count desc
  const comboStates = Object.keys(stateCityDist)
    .filter(s => s && s !== '—' && s !== '-')
    .sort((a, b) => {
      const ta = Object.values(stateCityDist[a] ?? {}).reduce((s, v) => s + v, 0)
      const tb = Object.values(stateCityDist[b] ?? {}).reduce((s, v) => s + v, 0)
      return tb - ta
    })

  const tabLabel: Record<string, string> = { state: 'State', city: 'City', combo: 'State×City' }
  return (
    <div style={{ background: 'var(--content-bg)', borderRadius: 8, padding: '12px 14px', borderLeft: '3px solid #06b6d4', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>State & City</div>
          <ExpandBtn id={cardId} expanded={expanded} onToggle={onToggle} />
        </div>
        {tabs.length > 1 && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {tabs.map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                fontSize: 8, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                background: viewMode === v ? '#06b6d422' : 'transparent',
                border: `1px solid ${viewMode === v ? '#06b6d4' : '#334155'}`,
                color: viewMode === v ? '#06b6d4' : '#475569',
              }}>{tabLabel[v]}</button>
            ))}
          </div>
        )}
      </div>

      {/* State / City flat list */}
      {viewMode !== 'combo' && (
        <>
          <div style={{ display: 'flex', gap: 8, fontSize: 9, marginBottom: 6 }}>
            <span style={{ color: '#38bdf8' }}>● Active</span>
            <span style={{ color: '#f59e0b' }}>● Upcoming</span>
            {hasClosedSC && <span style={{ color: '#f87171' }}>● Closed</span>}
          </div>
          {allKeys.map(key => {
            const a = activeDist[key] ?? 0
            const u = upcomingDist[key] ?? 0
            const c = closedDistSC[key] ?? 0
            return (
              <div key={key} onClick={() => onDrill(viewMode, key)} title={`Click to see all ${key} stores`}
                style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '1px 2px' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 72, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 8 }}>
                  {viewMode === 'state' ? (STATE_LABELS[key] ?? key) : key}
                </span>
                <div style={{ flex: 1, minWidth: 10, height: 5, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${(a / mx) * 100}%`, height: '100%', background: '#38bdf8' }} />
                  <div style={{ width: `${(u / mx) * 100}%`, height: '100%', background: '#f59e0b' }} />
                  <div style={{ width: `${(c / mx) * 100}%`, height: '100%', background: '#f87171', opacity: 0.7 }} />
                </div>
                <div style={{ display: 'flex', gap: 0, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 9 }}>
                  <span style={{ width: 28, textAlign: 'right', color: '#38bdf8' }}>{a > 0 ? a : ''}</span>
                  <span style={{ width: 26, textAlign: 'right', color: '#f59e0b' }}>{u > 0 ? `+${u}` : ''}</span>
                  {hasClosedSC && <span style={{ width: 24, textAlign: 'right', color: '#f87171' }}>{c > 0 ? `-${c}` : ''}</span>}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* State × City stacked combo */}
      {viewMode === 'combo' && comboStates.map(state => {
        const cityMap = stateCityDist[state] ?? {}
        const cities = Object.keys(cityMap).sort((a, b) => (cityMap[b] ?? 0) - (cityMap[a] ?? 0))
        const total = Object.values(cityMap).reduce((s, v) => s + v, 0)
        return (
          <div key={state} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0, width: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={STATE_LABELS[state] ?? state}>{STATE_LABELS[state] ?? state}</span>
              <div style={{ flex: 1, height: 6, background: 'var(--card-bg)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                {cities.map((city, ci) => {
                  const cnt = cityMap[city] ?? 0
                  return (
                    <div key={city} title={`${city}: ${cnt}`}
                      style={{ width: `${(cnt / total) * 100}%`, height: '100%', background: CITY_COLORS[ci % CITY_COLORS.length], cursor: 'pointer' }}
                      onClick={() => onDrill('state_city', `${state}|${city}`)}
                    />
                  )
                })}
              </div>
              <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0, minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 60 }}>
              {cities.slice(0, 6).map((city, ci) => (
                <span key={city} onClick={() => onDrill('state_city', `${state}|${city}`)} title={`${STATE_LABELS[state] ?? state} · ${city}`}
                  style={{ fontSize: 7, color: CITY_COLORS[ci % CITY_COLORS.length], cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
                  {city}:{cityMap[city]}
                </span>
              ))}
              {cities.length > 6 && <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>+{cities.length - 6}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ExpandBtn({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: (id: string) => void }) {
  return (
    <button onClick={() => onToggle(id)} title={expanded ? 'Collapse' : 'Expand width'} style={{
      background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px',
      color: expanded ? '#818cf8' : '#475569', fontSize: 11, lineHeight: 1, flexShrink: 0,
    }}>{expanded ? '⟵⟶' : '⟶⟵'}</button>
  )
}

const GRADE_COLORS: Record<string, string> = {
  'A+': '#818cf8', 'A': '#38bdf8', 'B+': '#34d399', 'B': '#4ade80',
  'C': '#f59e0b', 'D': '#fb923c', 'E': '#f87171',
}
const GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D', 'E']

function GradeCard({ oracle, onDrill, cardId, expanded, onToggle }: { oracle: OracleStats; onDrill: (split: string, value: string) => void; cardId: string; expanded: boolean; onToggle: (id: string) => void }) {
  const [tab, setTab] = useState<'grade' | 'zone'>('grade')
  const activeGrade = Object.entries(oracle.store_grade_distribution ?? {}).filter(([k]) => k !== '—' && k !== '-')
  const upcomingGrade = Object.entries(oracle.upcoming_grade_distribution ?? {}).filter(([k]) => k !== '—' && k !== '-')
  const closedGrade = Object.entries(oracle.closed_grade_distribution ?? {}).filter(([k]) => k !== '—' && k !== '-')
  const zoneGrade = oracle.zone_grade_distribution ?? {}
  if (activeGrade.length === 0 && upcomingGrade.length === 0) return null

  const allGrades = Array.from(new Set([...activeGrade.map(([k]) => k), ...upcomingGrade.map(([k]) => k), ...closedGrade.map(([k]) => k)]))
    .sort((a, b) => {
      const ai = GRADE_ORDER.indexOf(a); const bi = GRADE_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
  const activeMap = Object.fromEntries(activeGrade)
  const upcomingMap = Object.fromEntries(upcomingGrade)
  const closedMap = Object.fromEntries(closedGrade)
  const maxGrade = Math.max(...allGrades.map(g => (activeMap[g] ?? 0) + (upcomingMap[g] ?? 0) + (closedMap[g] ?? 0)), 1)
  const hasClosedGrade = closedGrade.length > 0

  const zones = Object.keys(zoneGrade).filter(z => z && z !== '—' && z !== '-').sort()
  const hasZoneGrade = zones.length > 0

  return (
    <div style={{ background: 'var(--content-bg)', borderRadius: 8, padding: '12px 14px', borderLeft: '3px solid #818cf8', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Grade Split</div>
          <ExpandBtn id={cardId} expanded={expanded} onToggle={onToggle} />
        </div>
        {hasZoneGrade && (
          <div style={{ display: 'flex', gap: 4 }}>
            {(['grade', 'zone'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                background: tab === t ? '#818cf822' : 'transparent',
                border: `1px solid ${tab === t ? '#818cf8' : '#334155'}`,
                color: tab === t ? '#818cf8' : '#475569',
              }}>{t === 'grade' ? 'Grade' : 'Zone×Grade'}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, fontSize: 9, marginBottom: 8 }}>
        <span style={{ color: '#38bdf8' }}>● Active</span>
        {tab === 'grade' && <span style={{ color: '#f59e0b' }}>● Upcoming</span>}
        {tab === 'grade' && hasClosedGrade && <span style={{ color: '#f87171' }}>● Closed</span>}
      </div>

      {tab === 'grade' && allGrades.map(grade => {
        const aVal = activeMap[grade] ?? 0
        const uVal = upcomingMap[grade] ?? 0
        const cVal = closedMap[grade] ?? 0
        const color = GRADE_COLORS[grade] ?? '#64748b'
        return (
          <div key={grade} onClick={() => onDrill('grade', grade)} title={`Click to see all Grade ${grade} stores`}
            style={{ marginBottom: 7, cursor: 'pointer', borderRadius: 4, padding: '2px 3px' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ width: 22, fontWeight: 700, fontSize: 11, color, flexShrink: 0 }}>{grade}</span>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ height: 5, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${(aVal / maxGrade) * 100}%`, height: '100%', background: '#38bdf8', borderRadius: 2 }} />
                  <div style={{ width: `${(uVal / maxGrade) * 100}%`, height: '100%', background: '#f59e0b', opacity: 0.85 }} />
                  <div style={{ width: `${(cVal / maxGrade) * 100}%`, height: '100%', background: '#f87171', opacity: 0.8 }} />
                </div>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', gap: 0, fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
                <span style={{ width: 22, textAlign: 'right', color: '#38bdf8' }}>{aVal > 0 ? aVal : ''}</span>
                <span style={{ width: 22, textAlign: 'right', color: '#f59e0b' }}>{uVal > 0 ? `+${uVal}` : ''}</span>
                {hasClosedGrade && <span style={{ width: 22, textAlign: 'right', color: '#f87171' }}>{cVal > 0 ? `-${cVal}` : ''}</span>}
              </div>
            </div>
          </div>
        )
      })}

      {tab === 'zone' && zones.map(zone => {
        const gradeMap = zoneGrade[zone] ?? {}
        const gradesInZone = Object.keys(gradeMap).sort((a, b) => {
          const ai = GRADE_ORDER.indexOf(a); const bi = GRADE_ORDER.indexOf(b)
          if (ai === -1 && bi === -1) return a.localeCompare(b)
          if (ai === -1) return 1; if (bi === -1) return -1
          return ai - bi
        })
        const total = Object.values(gradeMap).reduce((s, v) => s + v, 0)
        return (
          <div key={zone} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0, width: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone}</span>
              <div style={{ flex: 1, height: 6, background: 'var(--card-bg)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                {gradesInZone.map(g => {
                  const cnt = gradeMap[g] ?? 0
                  return (
                    <div key={g} title={`${zone} · Grade ${g}: ${cnt}`}
                      style={{ width: `${(cnt / total) * 100}%`, height: '100%', background: GRADE_COLORS[g] ?? '#64748b', cursor: 'pointer' }}
                      onClick={() => onDrill('zone_grade', `${zone}|${g}`)}
                    />
                  )
                })}
              </div>
              <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0, minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 56 }}>
              {gradesInZone.map(g => (
                <span key={g} onClick={() => onDrill('zone_grade', `${zone}|${g}`)} title={`${zone} · Grade ${g}`}
                  style={{ fontSize: 8, color: GRADE_COLORS[g] ?? '#64748b', cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}>
                  {g}:{gradeMap[g]}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function YearSplitCard({ oracle, onDrill, cardId, expanded, onToggle }: { oracle: Record<string, Record<string, number>>; onDrill: (split: string, value: string) => void; cardId: string; expanded: boolean; onToggle: (id: string) => void }) {
  const [tab, setTab] = useState<'fy' | 'cy' | 'tag'>('fy')
  const cy = oracle.store_cal_year_dist ?? {}
  const fy = oracle.store_fin_year_dist ?? {}
  const cyUp = oracle.store_cal_year_upcoming ?? {}
  const fyUp = oracle.store_fin_year_upcoming ?? {}
  const cyCl = oracle.store_cal_year_closed ?? {}
  const fyCl = oracle.store_fin_year_closed ?? {}
  const tag = oracle.store_tag_distribution ?? {}
  const tagUp = oracle.store_tag_upcoming ?? {}
  const tagCl = oracle.closed_tag_distribution ?? {}
  if (!Object.keys(cy).length && !Object.keys(fy).length && !Object.keys(tag).length) return null

  const activeDist = tab === 'cy' ? cy : tab === 'tag' ? tag : fy
  const upcomingDist = tab === 'cy' ? cyUp : tab === 'tag' ? tagUp : fyUp
  const closedDist = tab === 'cy' ? cyCl : tab === 'tag' ? tagCl : fyCl

  const allKeys = tab === 'tag'
    ? Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist), ...Object.keys(closedDist)]))
        .filter(t => t !== '-' && t !== '—')
        .sort((a, b) => {
          const fyA = a.match(/^FY(\d+)\s*-\s*Q(\d)/); const fyB = b.match(/^FY(\d+)\s*-\s*Q(\d)/)
          if (fyA && fyB) return (parseInt(fyA[1]) * 10 + parseInt(fyA[2])) - (parseInt(fyB[1]) * 10 + parseInt(fyB[2]))
          if (fyA) return 1; if (fyB) return -1
          return a.localeCompare(b)
        })
    : Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist), ...Object.keys(closedDist)])).sort()

  const mx = Math.max(...allKeys.map(k => (activeDist[k] ?? 0) + (upcomingDist[k] ?? 0) + (closedDist[k] ?? 0)), 1)
  const COLORS = ['#f59e0b', '#fb923c', '#34d399', '#38bdf8', '#818cf8', '#ec4899', '#a78bfa', '#10b981', '#06b6d4', '#84cc16']
  const hasClosed = Object.keys(closedDist).length > 0
  return (
    <div style={{ background: 'var(--content-bg)', borderRadius: 8, padding: '12px 14px', borderLeft: '3px solid #f59e0b', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Store Openings</div>
            <ExpandBtn id={cardId} expanded={expanded} onToggle={onToggle} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['fy', 'cy', 'tag'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                background: tab === t ? '#f59e0b22' : 'transparent',
                border: `1px solid ${tab === t ? '#f59e0b' : '#334155'}`,
                color: tab === t ? '#f59e0b' : '#475569',
              }}>{t === 'cy' ? 'CY' : t === 'fy' ? 'FY' : 'Tag'}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 9 }}>
          <span style={{ color: 'var(--text-secondary)' }}>● Active</span>
          <span style={{ color: '#f59e0b' }}>● Upcoming</span>
          {hasClosed && <span style={{ color: '#f87171' }}>● Closed</span>}
        </div>
      </div>
      {allKeys.map((key, i) => {
        const a = activeDist[key] ?? 0
        const u = upcomingDist[key] ?? 0
        const c = closedDist[key] ?? 0
        return (
          <div key={key} onClick={() => onDrill(tab, key)} title={`Click to see ${tab === 'tag' ? key : `stores opened in ${key}`}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '1px 2px' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <span style={{ width: tab === 'tag' ? 72 : 36, color: 'var(--text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: tab === 'tag' ? 8 : 10 }}>{key}</span>
            <div style={{ flex: 1, height: 4, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${(a / mx) * 100}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 2 }} />
              <div style={{ width: `${(u / mx) * 100}%`, height: '100%', background: '#f59e0b', opacity: 0.6 }} />
              <div style={{ width: `${(c / mx) * 100}%`, height: '100%', background: '#f87171', opacity: 0.7 }} />
            </div>
            <div style={{ flexShrink: 0, display: 'flex', gap: 0, fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ width: 22, textAlign: 'right', color: 'var(--text-secondary)' }}>{a > 0 ? a : ''}</span>
              <span style={{ width: 22, textAlign: 'right', color: '#f59e0b' }}>{u > 0 ? `+${u}` : ''}</span>
              {hasClosed && <span style={{ width: 22, textAlign: 'right', color: '#f87171' }}>{c > 0 ? `-${c}` : ''}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Skeleton shimmer styles injected once ─────────────────────────────────────
const SKEL_STYLE = `
@keyframes sk-shimmer {
  0%   { background-position: -600px 0 }
  100% { background-position:  600px 0 }
}
.sk-box {
  background: linear-gradient(90deg, #1e293b 25%, #263348 50%, #1e293b 75%);
  background-size: 600px 100%;
  animation: sk-shimmer 1.4s infinite linear;
  border-radius: 4px;
}
`

function SkBox({ w, h, style }: { w: number | string; h: number; style?: React.CSSProperties }) {
  return <div className="sk-box" style={{ width: w, height: h, flexShrink: 0, borderRadius: 4, ...style }} />
}

function SkBarRows({ count, labelW }: { count: number; labelW: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <SkBox w={labelW} h={7} />
          <SkBox w="100%" h={5} style={{ flex: 1 }} />
          <SkBox w={22} h={7} />
        </div>
      ))}
    </>
  )
}

function DashboardSkeleton() {
  return (
    <>
      <style>{SKEL_STYLE}</style>

      {/* topbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #1e293b' }}>
        <div>
          <SkBox w={200} h={16} style={{ marginBottom: 8 }} />
          <SkBox w={300} h={10} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <SkBox w={70} h={28} style={{ borderRadius: 6 }} />
          <SkBox w={70} h={28} style={{ borderRadius: 6 }} />
        </div>
      </div>

      {/* Store Network */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <SkBox w={110} h={10} />
          <SkBox w={60} h={10} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>

          {/* Left card */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={80} h={9} style={{ marginBottom: 10 }} />
            <SkBox w={60} h={28} style={{ marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <SkBox w={40} h={30} style={{ borderRadius: 6 }} />
              <SkBox w={40} h={30} style={{ borderRadius: 6 }} />
            </div>
            <SkBox w="100%" h={9} style={{ marginBottom: 5 }} />
            <SkBox w="80%" h={9} style={{ marginBottom: 5 }} />
            <SkBox w="90%" h={9} />
          </div>

          {/* Zone Split */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={70} h={9} style={{ marginBottom: 10 }} />
            <SkBarRows count={7} labelW={52} />
          </div>

          {/* FY Openings */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={80} h={9} style={{ marginBottom: 10 }} />
            <SkBarRows count={10} labelW={28} />
          </div>

          {/* State & City */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={75} h={9} style={{ marginBottom: 10 }} />
            <SkBarRows count={10} labelW={68} />
          </div>

          {/* Grade Split */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={70} h={9} style={{ marginBottom: 10 }} />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <SkBox w={8} h={8} style={{ borderRadius: '50%' }} />
                <SkBox w={18} h={8} />
                <SkBox w="100%" h={4} style={{ flex: 1 }} />
                <SkBox w={26} h={8} />
              </div>
            ))}
          </div>

          {/* Store Tag */}
          <div style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px' }}>
            <SkBox w={60} h={9} style={{ marginBottom: 10 }} />
            <SkBarRows count={6} labelW={52} />
          </div>
        </div>
      </div>

      {/* Allocation Summary */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <SkBox w={160} h={11} />
          <SkBox w={80} h={9} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <SkBox w={50} h={28} style={{ borderRadius: 6 }} />
          <SkBox w={85} h={28} style={{ borderRadius: 6 }} />
          <SkBox w={115} h={28} style={{ borderRadius: 6 }} />
        </div>
        <SkBox w={260} h={30} style={{ borderRadius: 6, marginBottom: 14 }} />
        {/* table rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 140px 1fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            {Array.from({ length: 7 }).map((_, j) => (
              <SkBox key={j} w="100%" h={12} style={{ opacity: 1 - j * 0.04 }} />
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Store Drill-Down Modal ────────────────────────────────────────────────────

interface DrillStore { code: string; name: string; status: string; grade: string; zone: string; state: string; area: number | null; opening_date?: string }
interface DrillState { split: string; value: string }

// ── Store Map ─────────────────────────────────────────────────────────────────
interface MapStore { code: string; name: string; lat: number; lon: number; zone: string; cluster: string; status: string; grade: string; state: string; city: string; isWarehouse?: boolean }

const WAREHOUSES: MapStore[] = [
  { code: '123', name: 'KHETAWAS DC', lat: 28.574, lon: 76.534, zone: 'NORTH', cluster: '-', status: 'ACTIVE', grade: '-', state: 'HARYANA', city: 'REWARI', isWarehouse: true },
  { code: '420', name: 'FARUKHNAGAR DC', lat: 28.458, lon: 76.817, zone: 'NCR', cluster: '-', status: 'ACTIVE', grade: '-', state: 'HARYANA', city: 'GURUGRAM', isWarehouse: true },
]

const ZONE_COLORS: Record<string, string> = {
  'NORTH': '#2563eb', 'BIHAR': '#d97706', 'BIHAR-PUJA': '#ea580c',
  'EAST': '#16a34a', 'NORTH EAST': '#7c3aed', 'NCR': '#db2777', 'JK': '#0891b2',
}
const CLUSTER_COLORS: Record<string, string> = {
  'BR1':'#b45309','BR2':'#d97706','BR3':'#ea580c','BR4':'#dc2626','BR5':'#991b1b',
  'UP1':'#1d4ed8','UP2':'#2563eb','UP3':'#4338ca','UP4':'#6d28d9','UP5':'#7c3aed','UP6':'#9333ea',
  'CH1':'#15803d','JH1':'#16a34a','MP1':'#0e7490','NCR':'#be185d',
  'NE':'#0891b2','OD':'#4d7c0f','NSO':'#a16207',
}
const FALLBACK_COLOR = '#6b7280'

function hashColor(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xfffffff
  return `hsl(${h % 360},60%,50%)`
}

function getColor(store: MapStore, mode: 'zone' | 'cluster'): string {
  if (mode === 'zone') return ZONE_COLORS[store.zone] ?? FALLBACK_COLOR
  return CLUSTER_COLORS[store.cluster] ?? FALLBACK_COLOR
}

function haversineKm(a: MapStore, b: MapStore): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const aa = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa))
}

function fmtDuration(roadKm: number): string {
  const hrs = roadKm / 50
  return hrs < 1 ? `${Math.round(hrs * 60)} min` : `${hrs.toFixed(1)} hr`
}

function convexHull(pts: [number,number][]): [number,number][] {
  if (pts.length < 3) return pts
  const sorted = [...pts].sort((a,b) => a[1]-b[1] || a[0]-b[0])
  const cross = (O: [number,number], A: [number,number], B: [number,number]) =>
    (A[0]-O[0])*(B[1]-O[1]) - (A[1]-O[1])*(B[0]-O[0])
  const lower: [number,number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number,number][] = []
  for (let i = sorted.length-1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

function bufferedHull(pts: [number,number][], buf = 0.5): [number,number][] {
  const hull = convexHull(pts)
  if (hull.length < 2) return hull
  const cx = hull.reduce((s,p) => s+p[0], 0) / hull.length
  const cy = hull.reduce((s,p) => s+p[1], 0) / hull.length
  return hull.map(([lat,lon]): [number,number] => {
    const dlat = lat-cx, dlon = lon-cy
    const d = Math.sqrt(dlat*dlat + dlon*dlon) || 1
    return [lat + dlat/d*buf, lon + dlon/d*buf]
  })
}

// ── Zone Multi-Select Dropdown ────────────────────────────────────────────────
function ZoneDropdown({ allKeys, selected, onToggle, colorMap, colorFn, label }: {
  allKeys: string[]; selected: Set<string>
  onToggle: (k: string) => void; colorMap?: Record<string, string>; colorFn?: (k: string) => string; label: string
}) {
  const getCol = (k: string) => colorFn ? colorFn(k) : (colorMap?.[k] ?? FALLBACK_COLOR)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = allKeys.filter(k => k.toLowerCase().includes(search.toLowerCase()))
  const selCount = selected.size

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        fontSize: 10, padding: '3px 10px 3px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
        background: selCount > 0 ? '#818cf822' : 'transparent',
        border: `1px solid ${selCount > 0 ? '#818cf8' : '#334155'}`,
        color: selCount > 0 ? '#818cf8' : '#64748b',
        display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      }}>
        <span>{label}</span>
        {selCount > 0 && <span style={{ background: '#818cf8', color: '#fff', borderRadius: 8, padding: '0 5px', fontSize: 9, fontWeight: 700 }}>{selCount}</span>}
        <span style={{ fontSize: 8, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 9999,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
          boxShadow: '0 8px 24px #0006', minWidth: 200, maxHeight: 280, display: 'flex', flexDirection: 'column',
        }}>
          {/* Search */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #334155' }}>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              style={{
                width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 4,
                color: '#e2e8f0', fontSize: 11, padding: '4px 8px', outline: 'none',
              }}
            />
          </div>
          {/* Select All / Clear */}
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #1e3a5f' }}>
            <button onClick={() => filtered.forEach(k => !selected.has(k) && onToggle(k))} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>All</button>
            <button onClick={() => Array.from(selected).forEach(k => onToggle(k))} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>Clear</button>
            <span style={{ fontSize: 9, color: '#475569', marginLeft: 'auto', alignSelf: 'center' }}>{filtered.length} items</span>
          </div>
          {/* Options */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(k => {
              const col = getCol(k)
              const active = selected.has(k)
              return (
                <div key={k} onClick={() => onToggle(k)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                  background: active ? '#0f172a' : 'transparent',
                  borderLeft: active ? `3px solid ${col}` : '3px solid transparent',
                  transition: 'background 0.1s',
                }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: col, border: '1.5px solid #fff', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: active ? '#e2e8f0' : '#94a3b8', fontWeight: active ? 700 : 400, flex: 1 }}>{k}</span>
                  {active && <span style={{ fontSize: 9, color: col }}>✓</span>}
                </div>
              )
            })}
            {filtered.length === 0 && <div style={{ padding: '10px', fontSize: 10, color: '#475569', textAlign: 'center' }}>No match</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function StoreMapCard() {
  const [stores, setStores] = useState<MapStore[]>([])
  const [loading, setLoading] = useState(true)
  const [temps, setTemps] = useState<Record<string, number>>({})
  const [colorBy, setColorBy] = useState<'zone' | 'cluster'>('zone')
  const [filterStatus, setFilterStatus] = useState<'all' | 'ACTIVE' | 'UPCOMING_STORE'>('all')
  // Zone/Cluster/State/City multi-select filter (empty = show all)
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set())
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set())
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set())
  const [selectedCities, setSelectedCities] = useState<Set<string>>(new Set())
  const [distMode, setDistMode] = useState(false)
  const [distPoints, setDistPoints] = useState<MapStore[]>([])
  const [distSearch, setDistSearch] = useState('')
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const boundsLayersRef = useRef<any[]>([])
  const ckBoundaryRef = useRef<any>(null)
  const distLayerRef = useRef<any>(null)
  const distModeRef = useRef(false)
  const distPointsRef = useRef<MapStore[]>([])
  const onClickRef = useRef<((s: MapStore) => void) | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  useEffect(() => { distModeRef.current = distMode }, [distMode])
  useEffect(() => { distPointsRef.current = distPoints }, [distPoints])

  // Escape key exits fullscreen; invalidateSize after transition
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMapFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    setTimeout(() => { leafletMap.current?.invalidateSize() }, 50)
  }, [mapFullscreen])

  function addDistPoint(s: MapStore) {
    setDistPoints(prev => prev.find(p => p.code === s.code) ? prev : [...prev, s])
  }
  function removeDistPoint(code: string) {
    setDistPoints(prev => prev.filter(p => p.code !== code))
  }

  onClickRef.current = (s: MapStore) => {
    if (!distModeRef.current) return
    addDistPoint(s)
  }

  function openMapWindow() {
    const storesJson = JSON.stringify(stores)
    const distJson   = JSON.stringify(distPoints)
    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>CityKart Store Map</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;flex-direction:column;height:100vh}
#tb{display:flex;gap:6px;padding:7px 10px;background:#0a1220;border-bottom:1px solid #1e293b;align-items:center;flex-wrap:wrap;flex-shrink:0}
.btn{font-size:10px;font-weight:700;padding:3px 9px;border-radius:5px;cursor:pointer;border:1px solid #334155;background:transparent;color:#94a3b8;white-space:nowrap}
.btn.on{border-color:#38bdf8;color:#38bdf8;background:#38bdf822}
.btn.dist-on{border-color:#ef4444;color:#ef4444;background:#ef444422}
.btn.bound-on{border-color:#34d399;color:#34d399;background:#34d39922}
.btn.sat-on{border-color:#fbbf24;color:#fbbf24;background:#fbbf2422}
.sep{width:1px;height:18px;background:#334155;flex-shrink:0}
#srch{background:#1e293b;border:1px solid #334155;border-radius:5px;color:#e2e8f0;font-size:11px;padding:4px 9px;outline:none;width:180px}
.ddwrap{position:relative}
#dd{position:absolute;top:100%;left:0;background:#1e293b;border:1px solid #334155;border-radius:5px;z-index:9999;width:260px;max-height:200px;overflow-y:auto;display:none;margin-top:2px}
.ddi{padding:5px 10px;cursor:pointer;font-size:11px;border-bottom:1px solid #0f172a;display:flex;gap:8px;align-items:center}
.ddi:hover{background:#0f172a}
.zdrop{position:relative}
.zmenu{position:absolute;top:100%;left:0;background:#1e293b;border:1px solid #334155;border-radius:5px;z-index:9998;min-width:140px;max-height:240px;overflow-y:auto;display:none;margin-top:2px;padding:4px 0}
.zitem{padding:4px 10px;cursor:pointer;font-size:10px;display:flex;align-items:center;gap:6px}
.zitem:hover{background:#0f172a}
#map{flex:1;min-height:0}
#distbar{background:#0a1220;border-top:1px solid #ef444466;padding:6px 10px;font-size:10px;display:none;flex-wrap:wrap;gap:6px;align-items:center;flex-shrink:0}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:#1e293b;border:1px solid #475569;color:#7dd3fc;cursor:grab;user-select:none}
.chip.wh{background:#14532d33;border-color:#4ade80;color:#4ade80}
.seg{font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;white-space:nowrap}
#tot{font-size:11px;font-weight:800;color:#fff;margin-left:auto;white-space:nowrap}
</style></head><body>
<div id="tb">
  <span style="font-size:12px;font-weight:700;color:#7dd3fc;margin-right:4px">CityKart Map</span>
  <div class="sep"></div>
  <button class="btn on" id="bZ" onclick="setColor('zone')">Zone</button>
  <button class="btn" id="bC" onclick="setColor('cluster')">Cluster</button>
  <div class="sep"></div>
  <button class="btn on" id="bAll" onclick="setStatus('all')">All</button>
  <button class="btn" id="bAct" onclick="setStatus('ACTIVE')">Active</button>
  <button class="btn" id="bUp" onclick="setStatus('UPCOMING_STORE')">Upcoming</button>
  <div class="sep"></div>
  <div class="zdrop"><button class="btn" id="bZone" onclick="toggleMenu('zmZ')">Zone ▾</button><div class="zmenu" id="zmZ"></div></div>
  <div class="zdrop"><button class="btn" id="bClust" onclick="toggleMenu('zmC')">Cluster ▾</button><div class="zmenu" id="zmC"></div></div>
  <button class="btn" id="bBound" onclick="toggleBound()">⬡ Boundary</button>
  <button class="btn" id="bSat" onclick="toggleSat()">🛰 Satellite</button>
  <div class="sep"></div>
  <button class="btn dist-on" id="bDist" onclick="toggleDist()">📏 Distance</button>
  <button class="btn" onclick="addWH('123','KHETAWAS DC',28.574,76.534)">🏭 KHETAWAS</button>
  <button class="btn" onclick="addWH('420','FARUKHNAGAR DC',28.458,76.817)">🏭 FARUKHNAGAR</button>
  <div class="ddwrap">
    <input id="srch" placeholder="🔍 Store code / name / city" oninput="onSearch(this.value)" autocomplete="off"/>
    <div id="dd"></div>
  </div>
  <button class="btn" onclick="resetDist()">Reset Route</button>
  <span id="cnt" style="font-size:10px;color:#64748b;margin-left:2px"></span>
</div>
<div id="map"></div>
<div id="distbar">
  <span style="font-size:9px;color:#64748b;font-weight:700">ROUTE:</span>
  <span style="font-size:8px;color:#475569;font-style:italic">drag to reorder</span>
  <span id="chips"></span><span id="segs"></span><span id="tot"></span>
</div>
<script>
var STORES=${storesJson};
var DIST_INIT=${distJson};
var ZC={NORTH:"#2563eb",BIHAR:"#d97706","BIHAR-PUJA":"#ea580c",EAST:"#16a34a","NORTH EAST":"#7c3aed",NCR:"#db2777",JK:"#0891b2"};
var CC={BR1:"#b45309",BR2:"#d97706",BR3:"#ea580c",BR4:"#dc2626",BR5:"#991b1b",UP1:"#1d4ed8",UP2:"#2563eb",UP3:"#4338ca",UP4:"#6d28d9",UP5:"#7c3aed",UP6:"#9333ea",CH1:"#15803d",JH1:"#16a34a",MP1:"#0e7490",NCR:"#be185d",NE:"#0891b2",OD:"#4d7c0f",NSO:"#a16207"};
var FB="#6b7280";
var colorBy="zone",filterStatus="all",distMode=true,showBound=false,satMode=false;
var selZones=new Set(),selClusters=new Set();
var distPoints=DIST_INIT.slice();
var leafMap,markers=[],distLayer=null,boundLayers=[],dragFrom=null;
var allZones=[],allClusters=[];
var tileOSM,tileSat,tileLabels;

function gc(s){return colorBy==="zone"?(ZC[s.zone]||FB):(CC[s.cluster]||FB)}
function hav(a,b){var R=6371,dL=(b.lat-a.lat)*Math.PI/180,dN=(b.lon-a.lon)*Math.PI/180,aa=Math.sin(dL/2)*Math.sin(dL/2)+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dN/2)*Math.sin(dN/2);return R*2*Math.atan2(Math.sqrt(aa),Math.sqrt(1-aa))}
function fmt(km){var h=km/50;return h<1?Math.round(h*60)+" min":h.toFixed(1)+" hr"}

function convexHull(pts){
  if(pts.length<3)return pts;
  var sorted=pts.slice().sort(function(a,b){return a[1]-b[1]||a[0]-b[0]});
  var cross=function(O,A,B){return(A[0]-O[0])*(B[1]-O[1])-(A[1]-O[1])*(B[0]-O[0])};
  var lower=[];
  for(var i=0;i<sorted.length;i++){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],sorted[i])<=0)lower.pop();lower.push(sorted[i]);}
  var upper=[];
  for(var i=sorted.length-1;i>=0;i--){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],sorted[i])<=0)upper.pop();upper.push(sorted[i]);}
  lower.pop();upper.pop();
  return lower.concat(upper);
}
function bufferedHull(pts){
  var hull=convexHull(pts);if(hull.length<2)return hull;
  var cx=0,cy=0;hull.forEach(function(p){cx+=p[0];cy+=p[1]});cx/=hull.length;cy/=hull.length;
  return hull.map(function(p){var dl=p[0]-cx,dn=p[1]-cy,d=Math.sqrt(dl*dl+dn*dn)||1;return[p[0]+dl/d*0.4,p[1]+dn/d*0.4]});
}

window.onload=function(){
  leafMap=L.map("map",{zoomControl:true,scrollWheelZoom:true,maxBounds:[[6,67],[38,99]],minZoom:4});
  tileOSM=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:18});
  tileSat=L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",{subdomains:["0","1","2","3"],attribution:"© Google",maxZoom:20});
  tileLabels=L.tileLayer("https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}",{subdomains:["0","1","2","3"],attribution:"",maxZoom:20,opacity:0.8});
  tileOSM.addTo(leafMap);
  leafMap.setView([24,82],5);
  var zs=new Set(),cs=new Set();
  STORES.forEach(function(s){if(s.zone&&s.zone!=="-")zs.add(s.zone);if(s.cluster&&s.cluster!=="-")cs.add(s.cluster);});
  allZones=Array.from(zs).sort();allClusters=Array.from(cs).sort();
  buildMenus();
  setTimeout(function(){leafMap.invalidateSize();render();renderDist();},300);
  document.addEventListener("click",function(e){
    if(!e.target.closest(".zdrop")&&!e.target.closest(".ddwrap")){
      document.querySelectorAll(".zmenu").forEach(function(m){m.style.display="none"});
      document.getElementById("dd").style.display="none";
    }
  });
};

function buildMenus(){
  var zmZ=document.getElementById("zmZ");zmZ.innerHTML="";
  allZones.forEach(function(z){
    var d=document.createElement("div");d.className="zitem";
    var col=ZC[z]||FB;
    d.innerHTML="<span style='width:10px;height:10px;border-radius:50%;background:"+col+";display:inline-block;flex-shrink:0'></span><span>"+z+"</span>";
    d.style.color=selZones.has(z)?col:"#94a3b8";
    d.style.background=selZones.has(z)?col+"22":"";
    d.onclick=function(){if(selZones.has(z))selZones.delete(z);else selZones.add(z);buildMenus();render();};
    zmZ.appendChild(d);
  });
  var zmC=document.getElementById("zmC");zmC.innerHTML="";
  allClusters.forEach(function(c){
    var d=document.createElement("div");d.className="zitem";
    var col=CC[c]||FB;
    d.innerHTML="<span style='width:10px;height:10px;border-radius:50%;background:"+col+";display:inline-block;flex-shrink:0'></span><span>"+c+"</span>";
    d.style.color=selClusters.has(c)?col:"#94a3b8";
    d.style.background=selClusters.has(c)?col+"22":"";
    d.onclick=function(){if(selClusters.has(c))selClusters.delete(c);else selClusters.add(c);buildMenus();render();};
    zmC.appendChild(d);
  });
  document.getElementById("bZone").style.cssText=selZones.size?"border-color:#38bdf8;color:#38bdf8;background:#38bdf822":"";
  document.getElementById("bClust").style.cssText=selClusters.size?"border-color:#38bdf8;color:#38bdf8;background:#38bdf822":"";
}
function toggleMenu(id){
  var m=document.getElementById(id);
  m.style.display=m.style.display==="block"?"none":"block";
  var other=id==="zmZ"?"zmC":"zmZ";
  document.getElementById(other).style.display="none";
}

function filteredStores(){
  return STORES.filter(function(s){
    if(filterStatus!=="all"&&s.status!==filterStatus)return false;
    if(selZones.size>0&&!selZones.has(s.zone))return false;
    if(selClusters.size>0&&!selClusters.has(s.cluster))return false;
    return true;
  });
}

function render(){
  markers.forEach(function(m){m.remove()});markers=[];
  boundLayers.forEach(function(l){l.remove()});boundLayers=[];
  var vis=filteredStores();
  document.getElementById("cnt").textContent=vis.length+"/"+STORES.length+" stores";
  vis.forEach(function(s){
    var col=gc(s),up=s.status==="UPCOMING_STORE";
    var html="<div style='width:14px;height:14px;border-radius:50%;background:"+col+";border:2px solid "+(up?"transparent":"#fff")+";outline:"+(up?"2px dashed "+col:"none")+";box-shadow:0 1px 4px #0008'></div>";
    var icon=L.divIcon({className:"",iconAnchor:[7,7],html:html});
    var m=L.marker([s.lat,s.lon],{icon:icon}).addTo(leafMap);
    m.bindTooltip("<b>"+s.code+"</b> "+s.name+"<br>"+s.city+" · "+s.zone,{direction:"top",offset:[0,-8]});
    m.on("click",function(){if(distMode)addPoint(s)});
    markers.push(m);
  });
  if(showBound)renderBoundaries(vis);
}

function renderBoundaries(vis){
  var cmap=colorBy==="zone"?ZC:CC;
  var key=colorBy==="zone"?"zone":"cluster";
  var groups={};
  vis.forEach(function(s){
    var k=s[key];if(!k||k==="-")return;
    if(!groups[k])groups[k]=[];
    groups[k].push([s.lat,s.lon]);
  });
  Object.keys(groups).forEach(function(k){
    var pts=groups[k];if(pts.length<2)return;
    var hull=bufferedHull(pts);
    if(hull.length<3)return;
    var col=cmap[k]||FB;
    var poly=L.polygon(hull,{color:col,weight:2,fillColor:col,fillOpacity:0.08,dashArray:"6 4"}).addTo(leafMap);
    poly.bindTooltip(k,{permanent:false,direction:"center"});
    boundLayers.push(poly);
  });
}

function renderDist(){
  if(distLayer){distLayer.remove();distLayer=null;}
  var bar=document.getElementById("distbar");
  if(distPoints.length<1){bar.style.display="none";return;}
  bar.style.display="flex";
  var chips=document.getElementById("chips");chips.innerHTML="";
  distPoints.forEach(function(pt,i){
    if(i>0){var a=document.createElement("span");a.style.cssText="font-size:10px;color:#ef444488;margin:0 3px";a.textContent="→";chips.appendChild(a);}
    var chip=document.createElement("span");
    chip.className="chip"+(pt.isWarehouse?" wh":"");chip.draggable=true;
    chip.innerHTML="<span style='font-size:8px;color:#475569'>⠿</span>"+(pt.isWarehouse?"🏭 ":"")+pt.code+(pt.name?" "+pt.name:"")+"<span onclick='removePoint(\""+pt.code+"\")' style='margin-left:4px;color:#64748b;cursor:pointer;font-size:9px'>✕</span>";
    chip.addEventListener("dragstart",function(){dragFrom=i});
    chip.addEventListener("dragover",function(e){e.preventDefault()});
    chip.addEventListener("drop",function(){
      if(dragFrom!==null&&dragFrom!==i){
        var arr=distPoints.slice();var item=arr.splice(dragFrom,1)[0];arr.splice(i,0,item);
        distPoints=arr;dragFrom=null;renderDist();
      }
    });
    chip.addEventListener("dragend",function(){dragFrom=null});
    chips.appendChild(chip);
  });
  if(distPoints.length>=2){
    var segs=document.getElementById("segs");segs.innerHTML="";
    var SC=["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#818cf8"];
    var totalRoad=0;var group=L.layerGroup();
    distPoints.forEach(function(pt,i){
      if(i===0)return;
      var prev=distPoints[i-1],km=hav(prev,pt),road=km*1.3,col=SC[(i-1)%SC.length];
      totalRoad+=road;
      L.polyline([[prev.lat,prev.lon],[pt.lat,pt.lon]],{color:col,weight:2.5,dashArray:"8 6",opacity:0.9}).addTo(group);
      var ml=(prev.lat+pt.lat)/2,mn=(prev.lon+pt.lon)/2;
      var lbl="<div style='background:#1e293b;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;white-space:nowrap;border:1.5px solid "+col+"'>"+Math.round(km)+"km · ~"+Math.round(road)+"km road · "+fmt(road)+"</div>";
      L.marker([ml,mn],{icon:L.divIcon({className:"",iconAnchor:[70,14],html:lbl})}).addTo(group);
      var seg=document.createElement("span");seg.className="seg";
      seg.style.cssText="background:"+col+"15;border:1px solid "+col+"44;color:"+col;
      seg.textContent=prev.code+"→"+pt.code+": "+Math.round(km)+"km · ~"+Math.round(road)+"km road · "+fmt(road);
      segs.appendChild(seg);
    });
    distPoints.filter(function(p){return p.isWarehouse}).forEach(function(pt){
      L.marker([pt.lat,pt.lon],{icon:L.divIcon({className:"",iconAnchor:[14,28],html:"<div style='font-size:22px'>🏭</div>"})}).addTo(group);
    });
    group.addTo(leafMap);distLayer=group;
    document.getElementById("tot").textContent=distPoints.length>2?"Total: ~"+Math.round(totalRoad)+" km road · "+fmt(totalRoad):"";
  } else {document.getElementById("segs").innerHTML="";document.getElementById("tot").textContent="";}
}

function addPoint(s){if(!distPoints.find(function(p){return p.code===s.code})){distPoints.push(s);renderDist();}}
function addWH(code,name,lat,lon){addPoint({code:code,name:name,lat:lat,lon:lon,isWarehouse:true,zone:"",cluster:"",status:"",grade:"",state:"",city:""});}
function removePoint(code){distPoints=distPoints.filter(function(p){return p.code!==code});renderDist();}
function resetDist(){distPoints=[];renderDist();}
function toggleDist(){distMode=!distMode;document.getElementById("bDist").className="btn"+(distMode?" dist-on":"");}
function toggleBound(){
  showBound=!showBound;
  document.getElementById("bBound").className="btn"+(showBound?" bound-on":"");
  render();
}
function toggleSat(){
  satMode=!satMode;
  document.getElementById("bSat").className="btn"+(satMode?" sat-on":"");
  if(satMode){leafMap.removeLayer(tileOSM);tileSat.addTo(leafMap);tileLabels.addTo(leafMap);}
  else{leafMap.removeLayer(tileSat);leafMap.removeLayer(tileLabels);tileOSM.addTo(leafMap);}
}
function setColor(m){
  colorBy=m;
  document.getElementById("bZ").className="btn"+(m==="zone"?" on":"");
  document.getElementById("bC").className="btn"+(m==="cluster"?" on":"");
  render();
}
function setStatus(s){
  filterStatus=s;
  ["bAll","bAct","bUp"].forEach(function(id){document.getElementById(id).className="btn"});
  document.getElementById(s==="all"?"bAll":s==="ACTIVE"?"bAct":"bUp").className="btn on";
  render();
}
function onSearch(v){
  var dd=document.getElementById("dd");
  if(!v.trim()){dd.style.display="none";return;}
  var vl=v.toLowerCase();
  var res=STORES.filter(function(s){return s.code.toLowerCase().indexOf(vl)>=0||s.name.toLowerCase().indexOf(vl)>=0||s.city.toLowerCase().indexOf(vl)>=0}).slice(0,8);
  if(!res.length){dd.style.display="none";return;}
  dd.innerHTML=res.map(function(s){
    return "<div class='ddi' onclick='addPoint(STORES.find(function(x){return x.code===\""+s.code+"\"}));document.getElementById(\"srch\").value=\"\";document.getElementById(\"dd\").style.display=\"none\"'><b style='color:#7dd3fc;font-size:10px'>"+s.code+"</b><span>"+s.name+"</span><span style='font-size:9px;color:#64748b'>"+s.city+"</span></div>";
  }).join("");
  dd.style.display="block";
}
<\/script></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    window.open(url, '_blank', 'width=1280,height=820,menubar=no,toolbar=no,location=no,status=no')
    setTimeout(() => URL.revokeObjectURL(url), 15000)
  }

  // store search results (max 8)
  const distSearchResults = distSearch.trim().length >= 1
    ? stores.filter(s =>
        s.code.toLowerCase().includes(distSearch.toLowerCase()) ||
        s.name.toLowerCase().includes(distSearch.toLowerCase()) ||
        s.city.toLowerCase().includes(distSearch.toLowerCase())
      ).slice(0, 8)
    : []

  // legacy aliases for compat (used in existing derived vars below)
  const distA = distPoints[0] ?? null
  const distB = distPoints[1] ?? null

  useEffect(() => {
    http.get('/dashboard/store-map-data')
      .then(r => { if (r.data.success) setStores(r.data.data.stores ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
    // Fetch temperatures in background (non-blocking)
    http.get('/dashboard/store-temperatures')
      .then(r => { if (r.data.success) setTemps(r.data.data ?? {}) })
      .catch(() => {})
  }, [])

  // Derived: all available zones/clusters/states/cities
  const allZones = Array.from(new Set(stores.map(s => s.zone).filter(z => z && z !== '-'))).sort()
  const allClusters = Array.from(new Set(stores.map(s => s.cluster).filter(c => c && c !== '-'))).sort()
  const allStates = Array.from(new Set(stores.map(s => s.state).filter(v => v && v !== '-'))).sort()
  const allCities = Array.from(new Set(stores.map(s => s.city).filter(v => v && v !== '-'))).sort()

  // Toggle helpers
  const toggleZone = (k: string) => setSelectedZones(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleCluster = (k: string) => setSelectedClusters(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleState = (k: string) => {
    setSelectedStates(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
    // Auto-enable state boundary when any state is selected
    setBoundaryBy('state'); setShowAllBounds(true)
  }
  const toggleCity = (k: string) => {
    setSelectedCities(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
    setBoundaryBy('city'); setShowAllBounds(true)
  }

  // Filtered stores: apply all multi-select filters + status filter
  const filteredStores = stores.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (selectedZones.size > 0 && !selectedZones.has(s.zone)) return false
    if (selectedClusters.size > 0 && !selectedClusters.has(s.cluster)) return false
    if (selectedStates.size > 0 && !selectedStates.has(s.state)) return false
    if (selectedCities.size > 0 && !selectedCities.has(s.city)) return false
    return true
  })

  // Active boundary keys: zones or clusters selected (auto-show boundary when any selected)
  const activeBoundaryKeys = colorBy === 'zone'
    ? (selectedZones.size > 0 ? selectedZones : new Set<string>())
    : (selectedClusters.size > 0 ? selectedClusters : new Set<string>())

  // Init map once; destroy on unmount
  useEffect(() => {
    if (loading || !mapRef.current || leafletMap.current) return
    const L = (window as any).L
    if (!L) return
    leafletMap.current = L.map(mapRef.current, {
      zoomControl: true, scrollWheelZoom: true,
      maxBounds: [[6, 67], [38, 99]], maxBoundsViscosity: 1.0, minZoom: 5,
    }).setView([24, 83], 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap.current)
    return () => {
      if (leafletMap.current) { leafletMap.current.remove(); leafletMap.current = null }
    }
  }, [loading])

  // CityKart overall boundary — always shown, covers ALL stores, auto-updates on stores change
  useEffect(() => {
    if (!leafletMap.current || stores.length === 0) return
    const L = (window as any).L; if (!L) return
    if (ckBoundaryRef.current) { ckBoundaryRef.current.remove(); ckBoundaryRef.current = null }
    const pts: [number,number][] = stores.filter(s => s.lat && s.lon).map(s => [s.lat, s.lon])
    if (pts.length < 3) return
    const hull = bufferedHull(pts, 0.8)
    const poly = L.polygon(hull, {
      color: '#38bdf8', weight: 2, opacity: 0.7,
      fillColor: '#38bdf8', fillOpacity: 0.04,
      dashArray: '12 6',
    })
    poly.bindTooltip('<b>CityKart Network</b><br>' + stores.length + ' stores', {
      permanent: false, direction: 'center',
    })
    poly.addTo(leafletMap.current)
    ckBoundaryRef.current = poly
  }, [stores, loading])

  // Markers
  useEffect(() => {
    if (loading || !leafletMap.current) return
    const L = (window as any).L; if (!L) return
    markersRef.current.forEach(m => m.remove()); markersRef.current = []
    filteredStores.forEach(s => {
      const col = getColor(s, colorBy)
      const isUpcoming = s.status === 'UPCOMING_STORE'
      const isA = distA?.code === s.code, isB = distB?.code === s.code
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: isA || isB ? 12 : isUpcoming ? 8 : 9,
        fillColor: isA ? '#fbbf24' : isB ? '#f87171' : col,
        color: '#ffffff', weight: isA || isB ? 3 : 2,
        opacity: 1, fillOpacity: 1,
        dashArray: isUpcoming && !isA && !isB ? '5 3' : undefined,
      })
      if (distMode) {
        marker.on('click', () => { if (onClickRef.current) onClickRef.current(s) })
        const tipTemp = temps[s.code] != null ? ` · 🌡${temps[s.code]}°C` : ''
        marker.bindTooltip(`${s.name || s.code} · ${s.city}${tipTemp}`, { direction: 'top', offset: [0,-6] })
      } else {
        const tempC = temps[s.code]
        const tempBadge = tempC != null
          ? `<span style="display:inline-flex;align-items:center;gap:3px;background:#0f172a;color:${tempC >= 35 ? '#f87171' : tempC >= 25 ? '#fbbf24' : '#38bdf8'};border:1px solid #334155;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700">🌡 ${tempC}°C</span>`
          : ''
        marker.bindPopup(
          `<div style="font-size:12px;min-width:170px;line-height:1.7">
            <div style="font-size:14px;font-weight:800;color:${col};margin-bottom:2px">${s.name || s.code} <span style="font-size:10px;color:#888;font-weight:400">#${s.code}</span></div>
            <div><span style="color:#888">Zone:</span> <b>${s.zone}</b> &nbsp;·&nbsp; <span style="color:#888">Cluster:</span> <b>${s.cluster}</b></div>
            <div><span style="color:#888">Grade:</span> ${s.grade} &nbsp;·&nbsp; ${isUpcoming ? '<span style="color:#f59e0b">⬡ Upcoming</span>' : '<span style="color:#16a34a">● Active</span>'}</div>
            <div style="margin-top:2px;color:#555">📍 ${s.city}, ${s.state}</div>
            ${tempBadge ? `<div style="margin-top:4px">${tempBadge}</div>` : ''}
          </div>`
        )
      }
      marker.addTo(leafletMap.current)
      markersRef.current.push(marker)
    })
  }, [filteredStores, colorBy, loading, distMode, distA, distB, temps])

  // Boundaries — auto-show for selected zones/clusters; show all if none selected + explicit toggle
  const [showAllBounds, setShowAllBounds] = useState(false)
  const [boundaryBy, setBoundaryBy] = useState<'zone' | 'cluster' | 'state' | 'city'>('zone')

  function getBoundaryColor(key: string): string {
    if (boundaryBy === 'zone') return ZONE_COLORS[key] ?? FALLBACK_COLOR
    if (boundaryBy === 'cluster') return CLUSTER_COLORS[key] ?? FALLBACK_COLOR
    return hashColor(key)
  }

  useEffect(() => {
    if (!leafletMap.current) return
    const L = (window as any).L; if (!L) return
    boundsLayersRef.current.forEach(l => l.remove()); boundsLayersRef.current = []

    // ── State: real GeoJSON India state borders ──────────────────────────────
    if (boundaryBy === 'state' && showAllBounds) {
      // Count stores per state
      const storeCountByState: Record<string, number> = {}
      stores.forEach(s => {
        const st = s.state?.trim().toUpperCase()
        if (st) storeCountByState[st] = (storeCountByState[st] || 0) + 1
      })
      const storeStateNames = new Set(Object.keys(storeCountByState))

      const normalize = (n: string) => {
        const u = n.trim().toUpperCase()
        if (u === 'NCT OF DELHI' || u === 'NATIONAL CAPITAL TERRITORY OF DELHI') return 'DELHI'
        if (u === 'ORISSA') return 'ODISHA'
        if (u === 'JAMMU AND KASHMIR' || u === 'JAMMU & KASHMIR') return 'J&K'
        if (u === 'UTTARANCHAL') return 'UTTARAKHAND'
        if (u === 'UTTAR PRADESH') return 'UP'
        if (u === 'MADHYA PRADESH') return 'MP'
        if (u === 'HIMACHAL PRADESH') return 'HP'
        if (u === 'ARUNACHAL PRADESH') return 'ARUNACHAL PRADESH'
        if (u === 'WEST BENGAL') return 'WEST BENGAL'
        return u
      }

      const GJ_URL = '/india_states.geojson'  // served from frontend/public — proxy-safe
      fetch(GJ_URL)
        .then(r => { if (!r.ok) throw new Error('fetch ' + r.status); return r.json() })
        .then((gj: any) => {
          if (!leafletMap.current) return
          const features = (gj.features as any[]).filter(f => {
            const raw = f.properties.NAME_1 || f.properties.ST_NM || f.properties.name || ''
            const norm = normalize(raw)
            return storeStateNames.has(norm) || storeStateNames.has(raw.trim().toUpperCase())
          })
          console.log('[Boundary] Matched', features.length, 'states of', gj.features.length, '| Store states:', Array.from(storeStateNames))
          if (!features.length) return

          const filtered = { ...gj, features }
          const map = leafletMap.current

          // Halo layer
          const halo = L.geoJSON(filtered, {
            style: () => ({ color: '#c8b89a', weight: 8, opacity: 0.45, fillOpacity: 0 }),
          }).addTo(map)

          // Main colored border + store count tooltip + permanent label
          const main = L.geoJSON(filtered, {
            style: (f: any) => {
              const raw = f.properties.NAME_1 || f.properties.ST_NM || ''
              const col = hashColor(raw)
              return { color: col, weight: 2.5, opacity: 1, fillColor: col, fillOpacity: 0.07, lineCap: 'round', lineJoin: 'round' }
            },
            onEachFeature: (f: any, lyr: any) => {
              const raw = f.properties.NAME_1 || f.properties.ST_NM || ''
              const norm = normalize(raw)
              const cnt = storeCountByState[norm] ?? storeCountByState[raw.trim().toUpperCase()] ?? 0
              const col = hashColor(raw)
              lyr.bindTooltip(
                `<div style="font-size:12px;font-weight:700;color:${col}">${raw}</div>` +
                `<div style="font-size:11px;color:#94a3b8">${cnt} store${cnt !== 1 ? 's' : ''}</div>`,
                { sticky: true, direction: 'top' }
              )
            },
          }).addTo(map)

          boundsLayersRef.current.push(halo, main)
        })
        .catch(e => console.error('[Boundary] GeoJSON load failed:', e))
      return
    }

    // ── Zone / Cluster: convex hull ─────────────────────────────────────────
    let keysToShow: string[]
    if (boundaryBy === 'zone') {
      if (activeBoundaryKeys.size > 0) keysToShow = Array.from(activeBoundaryKeys)
      else if (showAllBounds) keysToShow = allZones
      else return
    } else if (boundaryBy === 'cluster') {
      if (activeBoundaryKeys.size > 0) keysToShow = Array.from(activeBoundaryKeys)
      else if (showAllBounds) keysToShow = allClusters
      else return
    } else {
      // City — convex hull with double stroke
      if (!showAllBounds) return
      const allKeys = new Set(stores.map(s => s.city).filter(k => k && k !== '-'))
      keysToShow = Array.from(allKeys).sort()
    }

    const groups: Record<string, [number,number][]> = {}
    stores.forEach(s => {
      const key = boundaryBy === 'zone' ? s.zone : boundaryBy === 'cluster' ? s.cluster : s.city
      if (!key || key === '-' || !keysToShow.includes(key)) return
      if (!groups[key]) groups[key] = []
      groups[key].push([s.lat, s.lon])
    })

    const isCity = boundaryBy === 'city'
    Object.entries(groups).forEach(([key, pts]) => {
      if (pts.length < 3) return
      const hull = bufferedHull(pts, isCity ? 0.15 : 0.45)
      const col = getBoundaryColor(key)

      if (isCity) {
        const outer = L.polygon(hull, { color: '#e2d9c8', weight: 6, opacity: 0.45, fillOpacity: 0, lineCap: 'round', lineJoin: 'round' }).addTo(leafletMap.current)
        const inner = L.polygon(hull, { color: col, weight: 2, opacity: 0.95, fillOpacity: 0, dashArray: '5 3', lineCap: 'round', lineJoin: 'round' }).addTo(leafletMap.current)
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
        const lbl = L.marker([cx, cy], { icon: L.divIcon({ className: '', iconAnchor: [30, 9], html: `<div style="background:#0f172acc;color:${col};font-size:8px;font-weight:800;padding:2px 6px;border-radius:4px;white-space:nowrap;border:1px solid ${col}66">${key}</div>` }), interactive: false }).addTo(leafletMap.current)
        boundsLayersRef.current.push(outer, inner, lbl)
      } else {
        const poly = L.polygon(hull, { color: col, weight: 2.5, opacity: 0.85, fillColor: col, fillOpacity: 0.1, dashArray: '7 5' })
        poly.bindTooltip(`<b style="font-size:12px">${key}</b>`, { permanent: true, direction: 'center', className: 'zone-label-tip' })
        poly.addTo(leafletMap.current)
        boundsLayersRef.current.push(poly)
      }
    })
  }, [showAllBounds, boundaryBy, stores, colorBy, loading, selectedZones, selectedClusters])

  // Distance line — multi-segment
  useEffect(() => {
    if (!leafletMap.current) return
    const L = (window as any).L; if (!L) return
    if (distLayerRef.current) { distLayerRef.current.remove(); distLayerRef.current = null }
    if (distPoints.length < 2) return
    const group = L.layerGroup()
    const segColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#818cf8']
    let totalStraight = 0
    distPoints.forEach((pt, i) => {
      if (i === 0) return
      const prev = distPoints[i - 1]
      const km = haversineKm(prev, pt)
      const roadKm = km * 1.3
      totalStraight += km
      const col = segColors[(i - 1) % segColors.length]
      L.polyline([[prev.lat, prev.lon], [pt.lat, pt.lon]], {
        color: col, weight: 2.5, dashArray: '8 6', opacity: 0.9,
      }).addTo(group)
      const midLat = (prev.lat + pt.lat) / 2, midLon = (prev.lon + pt.lon) / 2
      L.marker([midLat, midLon], {
        icon: L.divIcon({
          className: '', iconAnchor: [70, 14],
          html: `<div style="background:#1e293b;color:#fff;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;white-space:nowrap;border:1.5px solid ${col};box-shadow:0 2px 8px #0008">
            ${Math.round(km)}km · ~${Math.round(roadKm)}km road · ${fmtDuration(roadKm)}
          </div>`,
        })
      }).addTo(group)
    })
    // Warehouse markers (pin icon)
    distPoints.forEach((pt) => {
      if (!pt.isWarehouse) return
      L.marker([pt.lat, pt.lon], {
        icon: L.divIcon({
          className: '', iconAnchor: [14, 28],
          html: `<div style="font-size:22px;filter:drop-shadow(0 2px 4px #000)">🏭</div>`,
        })
      }).addTo(group)
    })
    group.addTo(leafletMap.current)
    distLayerRef.current = group
  }, [distPoints])

  const legendMap = colorBy === 'zone' ? ZONE_COLORS : CLUSTER_COLORS
  const usedKeys = Array.from(new Set(filteredStores.map(s => colorBy === 'zone' ? s.zone : s.cluster))).filter(k => k && k !== '-')
  // Multi-segment totals
  const segments = distPoints.length >= 2
    ? distPoints.slice(1).map((pt, i) => {
        const km = haversineKm(distPoints[i], pt)
        return { from: distPoints[i], to: pt, km, roadKm: km * 1.3 }
      })
    : []
  const totalStraightKm = segments.reduce((s, seg) => s + seg.km, 0)
  const totalRoadKm = segments.reduce((s, seg) => s + seg.roadKm, 0)
  // legacy
  const distKm = distA && distB ? Math.round(haversineKm(distA, distB)) : null
  const distRoadKm = distKm ? Math.round(distKm * 1.3) : null
  const distHrs = distRoadKm ? distRoadKm / 50 : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Row 1: Color mode + Status + Dropdowns */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', overflowX: 'auto', paddingBottom: 2 }}>
        {/* Color by */}
        <div style={{ display: 'flex', gap: 3 }}>
          {(['zone','cluster'] as const).map(m => (
            <button key={m} onClick={() => setColorBy(m)} style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
              background: colorBy === m ? '#818cf822' : 'transparent',
              border: `1px solid ${colorBy === m ? '#818cf8' : '#334155'}`,
              color: colorBy === m ? '#818cf8' : '#475569',
            }}>{m === 'zone' ? 'Zone' : 'Cluster'}</button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 3 }}>
          {([['all','All'],['ACTIVE','Active'],['UPCOMING_STORE','Upcoming']] as const).map(([v,l]) => (
            <button key={v} onClick={() => setFilterStatus(v as any)} style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
              background: filterStatus === v ? '#06b6d422' : 'transparent',
              border: `1px solid ${filterStatus === v ? '#06b6d4' : '#334155'}`,
              color: filterStatus === v ? '#06b6d4' : '#475569',
            }}>{l}</button>
          ))}
        </div>

        {/* Zone multi-select dropdown */}
        <ZoneDropdown
          allKeys={allZones} selected={selectedZones} onToggle={toggleZone}
          colorMap={ZONE_COLORS} label="Zone"
        />

        {/* Cluster multi-select dropdown */}
        <ZoneDropdown
          allKeys={allClusters} selected={selectedClusters} onToggle={toggleCluster}
          colorMap={CLUSTER_COLORS} label="Cluster"
        />

        {/* State multi-select dropdown */}
        <ZoneDropdown
          allKeys={allStates} selected={selectedStates} onToggle={toggleState}
          colorFn={hashColor} label="State"
        />

        {/* City multi-select dropdown */}
        <ZoneDropdown
          allKeys={allCities} selected={selectedCities} onToggle={toggleCity}
          colorFn={hashColor} label="City"
        />

        {/* Boundary toggle + by selector */}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <button onClick={() => setShowAllBounds(b => !b)} style={{
            fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
            background: showAllBounds ? '#34d39922' : 'transparent',
            border: `1px solid ${showAllBounds ? '#34d399' : '#334155'}`,
            color: showAllBounds ? '#34d399' : '#475569',
          }}>⬡ Boundary</button>
          {(['zone','cluster','state','city'] as const).map(m => (
            <button key={m} onClick={() => {
              setBoundaryBy(m); setShowAllBounds(true)
              // Auto-fit map to store locations
              if (leafletMap.current && stores.length > 0) {
                const L = (window as any).L
                const bounds = L.latLngBounds(stores.map((s: any) => [s.lat, s.lon]))
                leafletMap.current.fitBounds(bounds, { padding: [30, 30] })
              }
            }} style={{
              fontSize: 9, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
              background: boundaryBy === m && showAllBounds ? '#34d39933' : 'transparent',
              border: `1px solid ${boundaryBy === m && showAllBounds ? '#34d399' : '#1e293b'}`,
              color: boundaryBy === m && showAllBounds ? '#34d399' : '#475569',
            }}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>

        {/* Distance mode */}
        <button onClick={() => { const next = !distMode; setDistMode(next); if (!next) { setDistPoints([]); setDistSearch('') } }} style={{
          fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
          background: distMode ? '#ef444422' : 'transparent',
          border: `1px solid ${distMode ? '#ef4444' : '#334155'}`,
          color: distMode ? '#ef4444' : '#475569',
        }}>📏 Distance</button>

        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
          {filteredStores.length}{filteredStores.length < stores.length ? `/${stores.length}` : ''} stores
        </span>
      </div>

      {/* Active filter chips */}
      {(selectedZones.size > 0 || selectedClusters.size > 0) && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#475569', marginRight: 2 }}>Filter:</span>
          {Array.from(selectedZones).map(k => (
            <span key={k} onClick={() => toggleZone(k)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700,
              padding: '2px 7px 2px 5px', borderRadius: 10, cursor: 'pointer',
              background: (ZONE_COLORS[k] ?? FALLBACK_COLOR) + '22',
              border: `1px solid ${ZONE_COLORS[k] ?? FALLBACK_COLOR}`,
              color: ZONE_COLORS[k] ?? FALLBACK_COLOR,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: ZONE_COLORS[k] ?? FALLBACK_COLOR, display: 'inline-block' }} />
              {k} ×
            </span>
          ))}
          {Array.from(selectedClusters).map(k => (
            <span key={k} onClick={() => toggleCluster(k)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700,
              padding: '2px 7px 2px 5px', borderRadius: 10, cursor: 'pointer',
              background: (CLUSTER_COLORS[k] ?? FALLBACK_COLOR) + '22',
              border: `1px solid ${CLUSTER_COLORS[k] ?? FALLBACK_COLOR}`,
              color: CLUSTER_COLORS[k] ?? FALLBACK_COLOR,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: CLUSTER_COLORS[k] ?? FALLBACK_COLOR, display: 'inline-block' }} />
              {k} ×
            </span>
          ))}
          <span onClick={() => { setSelectedZones(new Set()); setSelectedClusters(new Set()) }} style={{ fontSize: 9, color: '#64748b', cursor: 'pointer', textDecoration: 'underline' }}>Clear all</span>
        </div>
      )}

      {/* Distance panel */}
      {distMode && (
        <div style={{ background: '#0a1220', border: '1px solid #ef444466', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Row 1: Warehouse quick-add + store search */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#64748b', fontWeight: 700, letterSpacing: '.05em' }}>ADD:</span>
            {WAREHOUSES.map(wh => (
              <button key={wh.code} onClick={() => addDistPoint(wh)}
                title={`${wh.name} (site ${wh.code})`}
                style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                  background: distPoints.find(p => p.code === wh.code) ? '#34d39922' : '#0f2a1a',
                  border: `1px solid ${distPoints.find(p => p.code === wh.code) ? '#34d399' : '#15803d'}`,
                  color: distPoints.find(p => p.code === wh.code) ? '#34d399' : '#4ade80' }}>
                🏭 {wh.name}
              </button>
            ))}
            {/* Store code / name search */}
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <input value={distSearch} onChange={e => setDistSearch(e.target.value)}
                placeholder="🔍 Store code / name / city…"
                style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', borderRadius: 5,
                  color: '#e2e8f0', fontSize: 11, padding: '4px 10px', outline: 'none', boxSizing: 'border-box' }} />
              {distSearchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b',
                  border: '1px solid #334155', borderRadius: 5, zIndex: 999, maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                  {distSearchResults.map(s => (
                    <div key={s.code} onClick={() => { addDistPoint(s); setDistSearch('') }}
                      style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 11, color: '#e2e8f0',
                        borderBottom: '1px solid #334155', display: 'flex', gap: 8, alignItems: 'center' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0f172a')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#7dd3fc', fontSize: 10 }}>{s.code}</span>
                      <span style={{ flex: 1 }}>{s.name}</span>
                      <span style={{ fontSize: 9, color: '#64748b' }}>{s.city}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {distPoints.length > 0 && (
              <button onClick={() => { setDistPoints([]); setDistSearch('') }}
                style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>
                Reset
              </button>
            )}
          </div>

          {/* Row 2: Selected point chips (drag to reorder) */}
          {distPoints.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#64748b', fontWeight: 700 }}>ROUTE:</span>
              <span style={{ fontSize: 8, color: '#475569', fontStyle: 'italic' }}>drag to reorder</span>
              {distPoints.map((pt, i) => (
                <span key={pt.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  draggable
                  onDragStart={() => { dragIndexRef.current = i }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    const from = dragIndexRef.current
                    if (from === null || from === i) return
                    setDistPoints(prev => {
                      const arr = [...prev]
                      const [item] = arr.splice(from, 1)
                      arr.splice(i, 0, item)
                      return arr
                    })
                    dragIndexRef.current = null
                  }}
                  onDragEnd={() => { dragIndexRef.current = null }}>
                  {i > 0 && <span style={{ fontSize: 10, color: '#ef444488' }}>→</span>}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 6, cursor: 'grab',
                    background: pt.isWarehouse ? '#14532d33' : '#1e293b',
                    border: `1px solid ${pt.isWarehouse ? '#4ade80' : '#475569'}`,
                    color: pt.isWarehouse ? '#4ade80' : '#7dd3fc',
                    userSelect: 'none' }}>
                    <span style={{ fontSize: 8, color: '#475569', marginRight: 2 }}>⠿</span>
                    {pt.isWarehouse ? '🏭 ' : ''}{pt.code}{pt.name ? ` ${pt.name}` : ''}
                    <span onClick={() => removeDistPoint(pt.code)}
                      style={{ marginLeft: 2, color: '#64748b', cursor: 'pointer', fontSize: 9 }}>✕</span>
                  </span>
                </span>
              ))}
              {distPoints.length < 2 && (
                <span style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic' }}>
                  → ab dusra point add karo
                </span>
              )}
            </div>
          )}
          {distPoints.length === 0 && (
            <div style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic' }}>
              Warehouse buttons se ya search se stores add karo — ya map pe click karo. 2+ points ke baad distance dikhega.
            </div>
          )}

          {/* Row 3: Segment distances */}
          {segments.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid #1e293b', paddingTop: 6 }}>
              {segments.map((seg, i) => {
                const segColors = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#818cf8']
                const col = segColors[i % segColors.length]
                return (
                  <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
                    background: col + '15', border: `1px solid ${col}44`, color: col, whiteSpace: 'nowrap' }}>
                    {seg.from.code}→{seg.to.code}: {Math.round(seg.km)}km · ~{Math.round(seg.roadKm)}km road · {fmtDuration(seg.roadKm)}
                  </span>
                )
              })}
              {segments.length > 1 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  Total: ~{Math.round(totalRoadKm)} km road · {fmtDuration(totalRoadKm)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div style={mapFullscreen ? { position: 'fixed', inset: 0, zIndex: 9900, background: '#0f172a', display: 'flex', flexDirection: 'column' } : { position: 'relative' }}>
        {/* Fullscreen toggle button */}
        <button onClick={() => setMapFullscreen(f => !f)}
          title={mapFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 9910, fontSize: 10, fontWeight: 700,
            padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
            background: mapFullscreen ? '#1e3a5f' : '#0f172aee',
            border: mapFullscreen ? '1px solid #38bdf8' : '1px solid #334155',
            color: mapFullscreen ? '#38bdf8' : '#94a3b8',
            display: 'flex', alignItems: 'center', gap: 5 }}>
          {mapFullscreen ? '✕ Exit' : '⛶ Fullscreen'}
        </button>
        {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', zIndex: 10, borderRadius: 6, fontSize: 13, color: '#64748b' }}>Loading map…</div>}
        <div ref={mapRef} style={mapFullscreen ? { flex: 1, minHeight: 0 } : { height: 520, borderRadius: 6, border: '1px solid #334155', zIndex: 0 }} />
        {distMode && distPoints.length === 0 && <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#1e293bee', color: '#fbbf24', fontSize: 11, fontWeight: 700, padding: '6px 16px', borderRadius: 20, pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap' }}>Map pe koi bhi store click karo (ya upar search/warehouse use karo)</div>}
        {distMode && distPoints.length === 1 && <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#1e293bee', color: '#f87171', fontSize: 11, fontWeight: 700, padding: '6px 16px', borderRadius: 20, pointerEvents: 'none', zIndex: 500, whiteSpace: 'nowrap' }}>Ab dusra point add karo (map click / search)</div>}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {usedKeys.map(k => (
          <div key={k} onClick={() => colorBy === 'zone' ? toggleZone(k) : toggleCluster(k)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, cursor: 'pointer',
              opacity: (colorBy === 'zone' ? selectedZones : selectedClusters).size > 0 && !(colorBy === 'zone' ? selectedZones : selectedClusters).has(k) ? 0.35 : 1 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: legendMap[k] ?? FALLBACK_COLOR, border: '2px solid #fff', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{k}</span>
          </div>
        ))}
        <div style={{ borderLeft: '1px solid #334155', paddingLeft: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#6b7280', border: '2px solid #fff', flexShrink: 0 }} />
            <span style={{ color: '#64748b' }}>Active</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#6b7280', border: '2px dashed #fff', flexShrink: 0 }} />
            <span style={{ color: '#64748b' }}>Upcoming</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StoreListModal({ drill, onClose }: { drill: DrillState; onClose: () => void }) {
  const [stores, setStores] = useState<DrillStore[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  function onHeaderMouseDown(e: React.MouseEvent) {
    dragging.current = true
    const rect = (e.currentTarget.closest('[data-modal]') as HTMLElement)?.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
    e.preventDefault()
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    setLoading(true); setErr('')
    http.get('/dashboard/stores-by', { params: { split: drill.split, value: drill.value } })
      .then(r => {
        if (r.data.success) { setStores(r.data.data.stores ?? []); setCount(r.data.data.count ?? 0) }
        else setErr(r.data.message || 'Error')
      })
      .catch(() => setErr('Failed to load stores'))
      .finally(() => setLoading(false))
  }, [drill.split, drill.value])

  const filtered = stores.filter(s =>
    !q || s.code.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase())
  )

  const SPLIT_LABEL: Record<string, string> = { zone: 'Zone', state: 'State', city: 'City', grade: 'Grade', zone_grade: 'Zone × Grade', state_city: 'State × City', tag: 'Store Tag', fy: 'Financial Year', cy: 'Calendar Year' }
  const displayValue = drill.split === 'state' ? (STATE_LABELS[drill.value] ?? drill.value)
    : drill.split === 'zone_grade' || drill.split === 'state_city' ? drill.value.replace('|', ' · ')
    : drill.value

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: pos ? 'transparent' : 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: pos ? 'none' : 'auto',
    }} onClick={!pos ? onClose : undefined}>
      <div data-modal style={{
        background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 12,
        width: 560, maxWidth: '95vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        position: pos ? 'fixed' : 'relative',
        left: pos ? pos.x : undefined, top: pos ? pos.y : undefined,
        pointerEvents: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {/* Header — drag handle */}
        <div onMouseDown={onHeaderMouseDown} style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, cursor: 'grab', userSelect: 'none' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {SPLIT_LABEL[drill.split] ?? drill.split}: <span style={{ color: '#38bdf8' }}>{displayValue}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {loading ? 'Loading…' : `${count} store${count !== 1 ? 's' : ''}`}
            </div>
          </div>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search code / name…"
            style={{
              background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 6,
              color: 'var(--text-primary)', fontSize: 11, padding: '5px 9px', width: 160, outline: 'none',
            }}
          />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '10px 14px' }}>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 24 }}>Loading stores…</div>}
          {err && <div style={{ color: '#f87171', fontSize: 12, textAlign: 'center', padding: 24 }}>{err}</div>}
          {!loading && !err && filtered.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 24 }}>No stores found.</div>
          )}
          {!loading && !err && filtered.length > 0 && (
            <table style={{ width: '100%', minWidth: 500, borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Code', 'Name', 'Status', 'Grade',
                    ...(drill.split === 'fy' || drill.split === 'cy' ? ['Opened'] : []),
                    'Area (sqft)'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.code + i} style={{ borderBottom: '1px solid #1e293b22' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700, whiteSpace: 'nowrap' }}>{s.code}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name || '—'}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 10, fontWeight: 700,
                        background: s.status === 'ACTIVE' ? '#064e3b' : s.status === 'UPCOMING_STORE' ? '#1e3a5f' : '#1e293b',
                        color: s.status === 'ACTIVE' ? '#34d399' : s.status === 'UPCOMING_STORE' ? '#60a5fa' : '#94a3b8',
                      }}>{s.status || '—'}</span>
                    </td>
                    <td style={{ padding: '5px 8px', color: '#a78bfa', fontWeight: 700 }}>{s.grade || '—'}</td>
                    {(drill.split === 'fy' || drill.split === 'cy') && (
                      <td style={{ padding: '5px 8px', color: '#f59e0b', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {s.opening_date || '—'}
                      </td>
                    )}
                    <td style={{ padding: '5px 8px', color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {s.area != null ? s.area.toLocaleString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, pageAccess } = useAuth()
  const isViewer = user?.role === 'viewer'
  const showAllocation = ('dashboard#allocation' in pageAccess) ? pageAccess['dashboard#allocation'] : !isViewer
  const [drillDown, setDrillDown] = useState<DrillState | null>(null)
  const [dashTab, setDashTab] = useState<'store-network' | 'allocation'>('store-network')
  const effectiveDashTab = (!showAllocation && dashTab === 'allocation') ? 'store-network' : dashTab
  const [networkView, setNetworkView] = useState<'cards' | 'map'>('cards')
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dash_expanded_cards') ?? '[]')) } catch { return new Set() }
  })
  const toggleCard = (id: string) => setExpandedCards(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    try { localStorage.setItem('dash_expanded_cards', JSON.stringify([...next])) } catch {}
    return next
  })
  const cardSpan = (id: string): React.CSSProperties => expandedCards.has(id) ? { gridColumn: 'span 2' } : {}

  // ── Layer 1: stale-while-revalidate ──────────────────────────────────────
  // Load cached data from localStorage instantly so viewer sees data at 0ms.
  // Fresh API response replaces it silently in the background.
  const CACHE_KEY = 'dashboard_summary_v1'
  const CACHE_TTL = 4 * 60 * 60 * 1000  // 4 hours — stale after this

  function readCache(): DashboardData | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const { data: d, ts } = JSON.parse(raw)
      if (Date.now() - ts > CACHE_TTL) return null  // expired
      return d as DashboardData
    } catch { return null }
  }
  function writeCache(d: DashboardData) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: d, ts: Date.now() })) } catch {}
  }

  const cached = readCache()
  const [data, setData] = useState<DashboardData | null>(cached)
  const [loading, setLoading] = useState(cached === null)  // skip spinner if cache hit
  const [isStale, setIsStale] = useState(cached !== null)  // show "Updating…" badge if stale
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<string>(cached ? 'cached' : '')
  const [pinned, setPinned] = useState<PinnedWidget[]>(getPinned)
  const [allocView, setAllocView] = useState<'all' | 'store' | 'mc'>('all')
  const [alloc, setAlloc] = useState<AllocSummary | null>(null)
  const [allocLoading, setAllocLoading] = useState(true)
  // Detail view (All tab)
  const [detail, setDetail] = useState<DetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailPage, setDetailPage] = useState(0)
  const [selectedIcodes, setSelectedIcodes] = useState<string[]>([])
  const [icodeQuery, setIcodeQuery] = useState('')
  const [icodeSuggestions, setIcodeSuggestions] = useState<string[]>([])
  const [showSugg, setShowSugg] = useState(false)
  const icodeRef = useRef<HTMLDivElement>(null)

  function removePinned(id: string, mode: VizMode) {
    const next = getPinned().filter(w => !(w.id === id && w.mode === mode))
    localStorage.setItem(PINNED_KEY, JSON.stringify(next))
    setPinned(next)
  }

  const load = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) await http.post('/dashboard/cache/clear')
      const res = await http.get<{ success: boolean; data: DashboardData }>('/dashboard/summary', { timeout: 120_000 })
      if (res.data.success) {
        setData(res.data.data)
        writeCache(res.data.data)
        setError(null)
        setIsStale(false)
        setLastFetch(new Date().toLocaleTimeString('en-IN'))
      }
    } catch (e: unknown) {
      // If cache hit, keep showing stale data — don't show error to viewer
      if (!data) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setIsStale(false)
    }
  }, [data])

  const loadAlloc = useCallback(async (view: 'all' | 'store' | 'mc' = 'all') => {
    setAllocLoading(true)
    const ep = view === 'store' ? '/dashboard/allocation-store'
             : view === 'mc'   ? '/dashboard/allocation-mc'
             :                   '/dashboard/allocation-summary'
    try {
      const res = await http.get<{ success: boolean; data: AllocSummary }>(ep, { timeout: 60_000 })
      if (res.data.success) setAlloc(res.data.data)
    } catch { /* silent */ } finally {
      setAllocLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (icodes: string[], page = 0) => {
    setDetailLoading(true)
    try {
      const res = await http.get<{ success: boolean; data: DetailData }>('/dashboard/allocation-detail', {
        params: { icodes: icodes.join(','), page, limit: 500 }, timeout: 60_000,
      })
      if (res.data.success) { setDetail(res.data.data); setDetailPage(page) }
    } catch { /* silent */ } finally { setDetailLoading(false) }
  }, [])

  const searchIcodes = useCallback(async (q: string) => {
    try {
      const res = await http.get<{ success: boolean; data: { barcodes: string[] } }>('/dashboard/allocation-barcodes', { params: { q } })
      if (res.data.success) setIcodeSuggestions(res.data.data.barcodes)
    } catch { /* silent */ }
  }, [])

  // Outside click closes suggestion dropdown
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (icodeRef.current && !icodeRef.current.contains(e.target as Node)) setShowSugg(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { load(); loadAlloc('all'); loadDetail([], 0) }, [load, loadAlloc, loadDetail])

  if (loading) {
    return <DashboardSkeleton />
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
      <StaleBanner />
      {drillDown && <StoreListModal drill={drillDown} onClose={() => setDrillDown(null)} />}
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.5px' }}>CityKart Strongs</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Oracle: {oracle.oracle_ok
              ? <span style={{ color: '#4ade80' }}>✓ Connected ({oracle.oracle_cache_ms}ms cache)</span>
              : <span style={{ color: '#f87171' }}>✗ Unavailable</span>}
            &nbsp;·&nbsp;{isStale ? 'Refreshing in background…' : `Refreshed ${lastFetch}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isStale && (
            <span style={{ fontSize: 10, color: '#f59e0b', background: '#451a030a', border: '1px solid #78350f44', borderRadius: 4, padding: '2px 7px', animation: 'pulse 1.5s infinite' }}>
              ↻ Updating…
            </span>
          )}
          {!isStale && (data as DashboardData & { oracle?: { from_cache?: boolean } })?.oracle?.from_cache && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4, padding: '2px 7px' }}>
              ⚡ cached
            </span>
          )}
          <button style={{ background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }} onClick={() => { setLoading(true); load() }}>
            ↻ Refresh
          </button>
          <button style={{ background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }} title="Force re-fetch from Oracle (slow)" onClick={() => { setLoading(true); load(true) }}>
            ↻ Oracle
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--card-border)', marginBottom: 0 }}>
        {([
          { key: 'store-network', label: '🏪 Store Network' },
          ...(showAllocation ? [{ key: 'allocation', label: '📦 Allocation Report' }] : []),
        ] as const).map(t => (
          <button key={t.key} onClick={() => setDashTab(t.key as any)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 18px', fontSize: 12, fontWeight: effectiveDashTab === t.key ? 700 : 400,
            color: effectiveDashTab === t.key ? '#4ade80' : 'var(--text-muted)',
            borderBottom: effectiveDashTab === t.key ? '2px solid #4ade80' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Store Network section ── */}
      {effectiveDashTab === 'store-network' && <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Store Network</span>
          {(['cards','map'] as const).map(v => (
            <button key={v} onClick={() => setNetworkView(v)} style={{
              fontSize: 10, padding: '2px 10px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
              background: networkView === v ? '#4ade8022' : 'transparent',
              border: `1px solid ${networkView === v ? '#4ade80' : '#334155'}`,
              color: networkView === v ? '#4ade80' : '#475569',
            }}>{v === 'cards' ? '📊 Cards' : '🗺 Map'}</button>
          ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total: <strong style={{ color: '#818cf8' }}>{fmtNum(oracle.total_all_stores)}</strong></span>
            <button
              onClick={async () => {
                try {
                  const token = localStorage.getItem('ck_ss27_token') || ''
                  const res = await fetch('/api/dashboard/store-master-csv', {
                    headers: { Authorization: `Bearer ${token}` },
                  })
                  if (!res.ok) throw new Error('Download failed')
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = 'store_master.csv'; a.click()
                  URL.revokeObjectURL(url)
                } catch { alert('CSV download failed') }
              }}
              style={{
                fontSize: 10, fontWeight: 600, color: '#818cf8', border: '1px solid #818cf8',
                borderRadius: 4, padding: '2px 8px', background: 'transparent', cursor: 'pointer',
                letterSpacing: 0.4, display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              title="Download Store Master CSV"
            >
              ⬇ CSV
            </button>
          </div>
        </div>
        {networkView === 'map' && <StoreMapCard />}
        <div style={{ width: '100%', display: networkView === 'map' ? 'none' : undefined }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, width: '100%', alignItems: 'start' }}>
          {/* Combined Active + Upcoming + Total */}
          <div style={{ background: 'var(--content-bg)', borderRadius: 8, padding: '10px 12px', borderLeft: '3px solid #818cf8', display: 'flex', flexDirection: 'column', gap: 6, ...cardSpan('network') }}>
            {/* Total headline */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Store Network</div>
              <ExpandBtn id="network" expanded={expandedCards.has('network')} onToggle={toggleCard} />
              <div style={{ fontSize: 26, fontWeight: 900, color: '#818cf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtNum(oracle.total_all_stores)}</div>
            </div>
            {/* Stacked bar — Active | Upcoming | Closed */}
            {(() => {
              const tot = oracle.total_stores + oracle.upcoming_stores + (oracle.closed_stores ?? 0)
              return (
                <div style={{ height: 4, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ height: '100%', background: '#38bdf8', width: tot > 0 ? `${(oracle.total_stores / tot) * 100}%` : '0%' }} />
                  <div style={{ height: '100%', background: '#f59e0b', width: tot > 0 ? `${(oracle.upcoming_stores / tot) * 100}%` : '0%' }} />
                  <div style={{ height: '100%', background: '#f87171', width: tot > 0 ? `${((oracle.closed_stores ?? 0) / tot) * 100}%` : '0%' }} />
                </div>
              )
            })()}
            {/* Active | Upcoming | Closed row */}
            <div style={{ display: 'flex', gap: 0 }}>
              {/* ACTIVE */}
              <div style={{ flex: 3, paddingRight: 10 }}>
                <div style={{ fontSize: 9, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Active</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: '#38bdf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtNum(oracle.total_stores)}</div>
                {(oracle.active_state_count > 0 || oracle.active_city_count > 0) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    {oracle.active_state_count > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>States</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#818cf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{oracle.active_state_count}</div>
                      </div>
                    )}
                    {oracle.active_state_count > 0 && oracle.active_city_count > 0 && <div style={{ width: 1, background: 'var(--card-bg)', alignSelf: 'stretch' }} />}
                    {oracle.active_city_count > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Cities</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#818cf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{oracle.active_city_count}</div>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>TY Open</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{fmtNum(oracle.opening_2026 ?? 0)}</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--card-bg)', alignSelf: 'stretch' }} />
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>60d</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#7dd3fc', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{fmtNum(oracle.opening_60d ?? 0)}</div>
                  </div>
                </div>
                {oracle.last_opened_name && (
                  <div style={{ marginTop: 5, padding: '3px 6px', background: '#0a1628', borderRadius: 3, borderLeft: '2px solid #1e3a5f' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Last Open</div>
                    <div style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 600, whiteSpace: 'normal', wordBreak: 'break-word' }}>{oracle.last_opened_name}</div>
                    {oracle.last_opened_date && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{oracle.last_opened_date}</div>}
                  </div>
                )}
              </div>
              <div style={{ width: 1, background: 'var(--card-bg)' }} />
              {/* UPCOMING */}
              <div style={{ flex: 2, paddingLeft: 10, paddingRight: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Upcoming</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: '#f59e0b', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtNum(oracle.upcoming_stores)}</div>
                  {(oracle.upcoming_new_city_count ?? 0) > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>New Cities</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{oracle.upcoming_new_city_count}</div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 6, padding: '4px 6px', background: '#0a1628', borderRadius: 3, borderLeft: '2px solid #44300a' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>NSO Active</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(oracle.active_nso ?? 0)}</div>
                  {oracle.nso_from_date && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>from {oracle.nso_from_date}</div>}
                </div>
              </div>
              {(oracle.closed_stores ?? 0) > 0 && <>
                <div style={{ width: 1, background: 'var(--card-bg)' }} />
                {/* CLOSED */}
                <div style={{ flex: 2, paddingLeft: 10, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                  <div style={{ fontSize: 9, color: '#f87171', textTransform: 'uppercase', letterSpacing: 0.8 }}>Closed</div>
                  <div style={{ fontSize: 30, fontWeight: 900, color: '#f87171', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtNum(oracle.closed_stores)}</div>
                </div>
              </>}
            </div>
          </div>

          {/* Zone distribution mini */}
          {Object.keys(oracle.store_zone_distribution ?? {}).length > 0 && (() => {
            const activeDist = oracle.store_zone_distribution ?? {}
            const upcomingDist = oracle.store_zone_upcoming ?? {}
            const closedZoneDist = oracle.closed_zone_distribution ?? {}
            const hasClosedZ = Object.keys(closedZoneDist).length > 0
            const allZones = Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist), ...Object.keys(closedZoneDist)]))
              .sort((a, b) => ((activeDist[b] ?? 0) + (upcomingDist[b] ?? 0)) - ((activeDist[a] ?? 0) + (upcomingDist[a] ?? 0)))
            const mx = Math.max(...allZones.map(z => (activeDist[z] ?? 0) + (upcomingDist[z] ?? 0) + (closedZoneDist[z] ?? 0)), 1)
            return (
              <div style={{ background: 'var(--content-bg)', borderRadius: 8, padding: '12px 14px', borderLeft: '3px solid #818cf8', minWidth: 0, overflow: 'hidden', ...cardSpan('zone') }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Zone Split</div>
                    <ExpandBtn id="zone" expanded={expandedCards.has('zone')} onToggle={toggleCard} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 9 }}>
                    <span style={{ color: '#38bdf8' }}>● Active</span>
                    <span style={{ color: '#f59e0b' }}>● Upcoming</span>
                    {hasClosedZ && <span style={{ color: '#f87171' }}>● Closed</span>}
                  </div>
                </div>
                {allZones.map(zone => {
                  const a = activeDist[zone] ?? 0
                  const u = upcomingDist[zone] ?? 0
                  const c = closedZoneDist[zone] ?? 0
                  return (
                    <div key={zone} onClick={() => setDrillDown({ split: 'zone', value: zone })} title={`Click to see all ${zone} stores`} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '1px 2px' }} onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ width: 56, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 8 }}>{zone}</span>
                      <div style={{ flex: 1, minWidth: 10, height: 5, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${(a / mx) * 100}%`, height: '100%', background: '#38bdf8' }} />
                        <div style={{ width: `${(u / mx) * 100}%`, height: '100%', background: '#f59e0b' }} />
                        <div style={{ width: `${(c / mx) * 100}%`, height: '100%', background: '#f87171', opacity: 0.7 }} />
                      </div>
                      <div style={{ display: 'flex', gap: 0, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 9 }}>
                        <span style={{ width: 28, textAlign: 'right', color: '#38bdf8' }}>{a > 0 ? a : ''}</span>
                        <span style={{ width: 26, textAlign: 'right', color: '#f59e0b' }}>{u > 0 ? `+${u}` : ''}</span>
                        {hasClosedZ && <span style={{ width: 24, textAlign: 'right', color: '#f87171' }}>{c > 0 ? `-${c}` : ''}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Year-wise store opening card */}
          <div style={cardSpan('year')}>
            <YearSplitCard oracle={oracle as unknown as Record<string, Record<string, number>>} onDrill={(split, value) => setDrillDown({ split, value })} cardId="year" expanded={expandedCards.has('year')} onToggle={toggleCard} />
          </div>


          {/* ── Grade Split card ── */}
          <div style={cardSpan('grade')}>
            <GradeCard oracle={oracle} onDrill={(split, value) => setDrillDown({ split, value })} cardId="grade" expanded={expandedCards.has('grade')} onToggle={toggleCard} />
          </div>

          {/* ── State & City card ── */}
          <div style={cardSpan('statecity')}>
            <StateCityCard oracle={oracle} onDrill={(split, value) => setDrillDown({ split, value })} cardId="statecity" expanded={expandedCards.has('statecity')} onToggle={toggleCard} />
          </div>
        </div>
        </div>{/* scroll wrapper */}
      </div>}


      {/* ── Allocation Summary section ── */}
      {effectiveDashTab === 'allocation' && (() => {
        // Column definitions per view
        const viewDefs: Record<'all' | 'store' | 'mc', import('@/components/FilterableTable').FTColumn[]> = {
          all: [
            { key: 'division',     label: 'Division',   align: 'left' },
            { key: 'stores',       label: 'Stores',     align: 'right', color: '#7dd3fc' },
            { key: 'articles',     label: 'Articles',   align: 'right', color: '#7dd3fc' },
            { key: 'stk_qty',      label: 'Store Stock', align: 'right', color: 'var(--text-secondary)' },
            { key: 'dc_stk_q',     label: 'DC Stock',   align: 'right', color: '#67e8f9' },
            { key: 'alloc_qty',    label: 'Alloc Qty',  align: 'right', color: '#4ade80', bold: true },
            { key: 'in_transit_q', label: 'In-Transit', align: 'right', color: '#fb923c' },
            { key: 'lm_sale_q',    label: 'LM Sale',    align: 'right', color: 'var(--text-secondary)' },
            { key: 'mtd_sale_q',   label: 'MTD Sale',   align: 'right', color: '#38bdf8' },
            { key: 'proj_qty',     label: 'Proj Qty',   align: 'right', color: '#a78bfa' },
          ],
          store: [
            { key: 'loc',          label: 'Location',   align: 'left',  render: (v) => v === 'DC' ? <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 10 }}>DC</span> : <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: 10 }}>STORE</span> },
            { key: 'store_code',   label: 'Code',       align: 'left' },
            { key: 'store_name',   label: 'Store Name', align: 'left' },
            { key: 'articles',     label: 'Articles',   align: 'right', color: '#7dd3fc' },
            { key: 'stk_qty',      label: 'Store Stock', align: 'right', color: 'var(--text-secondary)' },
            { key: 'dc_stk_q',     label: 'DC Stock',   align: 'right', color: '#67e8f9' },
            { key: 'alloc_qty',    label: 'Alloc Qty',  align: 'right', color: '#4ade80', bold: true },
            { key: 'in_transit_q', label: 'In-Transit', align: 'right', color: '#fb923c' },
            { key: 'lm_sale_q',    label: 'LM Sale',    align: 'right', color: 'var(--text-secondary)' },
            { key: 'mtd_sale_q',   label: 'MTD Sale',   align: 'right', color: '#38bdf8' },
            { key: 'proj_qty',     label: 'Proj Qty',   align: 'right', color: '#a78bfa' },
          ],
          mc: [
            { key: 'loc', label: 'Location', align: 'left', render: (v) => v === 'DC' ? <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 10 }}>DC</span> : <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: 10 }}>STORE</span> },
            { key: 'division',     label: 'Division',   align: 'left' },
            { key: 'section',      label: 'Section',    align: 'left' },
            { key: 'department',   label: 'Department', align: 'left' },
            { key: 'stores',       label: 'Stores',     align: 'right', color: '#7dd3fc' },
            { key: 'articles',     label: 'Articles',   align: 'right', color: '#7dd3fc' },
            { key: 'stk_qty',      label: 'Store Stock', align: 'right', color: 'var(--text-secondary)' },
            { key: 'dc_stk_q',     label: 'DC Stock',   align: 'right', color: '#67e8f9' },
            { key: 'alloc_qty',    label: 'Alloc Qty',  align: 'right', color: '#4ade80', bold: true },
            { key: 'in_transit_q', label: 'In-Transit', align: 'right', color: '#fb923c' },
            { key: 'lm_sale_q',    label: 'LM Sale',    align: 'right', color: 'var(--text-secondary)' },
            { key: 'mtd_sale_q',   label: 'MTD Sale',   align: 'right', color: '#38bdf8' },
            { key: 'proj_qty',     label: 'Proj Qty',   align: 'right', color: '#a78bfa' },
          ],
        }
        const cols = viewDefs[allocView]

        const TABS: { key: 'all' | 'store' | 'mc'; label: string }[] = [
          { key: 'all',   label: 'All' },
          { key: 'store', label: 'Store Wise' },
          { key: 'mc',    label: 'Div · Section · Dept' },
        ]

        // ── "All" tab: full detail view ──────────────────────────────────────
        const NUM_QTY_COLS = [
          'total_stk_q','stk_q','adj_stk_q','alloc_regn_q',
          'pack_pend_q','adj_pack_pend_q','to_q','adj_to_q',
          'in_transit_q','adj_in_transit_q','ppo_q',
          'lm_sl_q','mtd_sl_q',
          'proj_mnth_1_q','proj_mnth_1a_q','proj_mnth_2_q','proj_mnth_2a_q',
          'proj_mnth_3_q','proj_mnth_3a_q','proj_q',
        ]

        const detailBody = allocView === 'all' ? (() => {
          const detailCols = detail?.columns ?? []
          return (
            <>
              {/* icode multi-select bar */}
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--card-border)', background: 'var(--content-bg)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {/* Selected chips */}
                  {selectedIcodes.map(ic => (
                    <span key={ic} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#1e3a5f', border: '1px solid #2563eb', borderRadius: 5, padding: '2px 8px', fontSize: 11, color: '#7dd3fc', fontFamily: 'monospace' }}>
                      {ic}
                      <button onClick={() => {
                        const next = selectedIcodes.filter(x => x !== ic)
                        setSelectedIcodes(next)
                        loadDetail(next, 0)
                      }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
                    </span>
                  ))}
                  {/* Search input */}
                  <div ref={icodeRef} style={{ position: 'relative' }}>
                    <input
                      value={icodeQuery}
                      onChange={e => {
                        setIcodeQuery(e.target.value)
                        setShowSugg(true)
                        searchIcodes(e.target.value)
                      }}
                      onFocus={() => { setShowSugg(true); searchIcodes(icodeQuery) }}
                      placeholder="Search icode / barcode…"
                      style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, padding: '4px 10px', outline: 'none', width: 200 }}
                    />
                    {showSugg && icodeSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.6)', minWidth: 220, maxHeight: 260, overflowY: 'auto', marginTop: 2 }}>
                        {icodeSuggestions.map(bc => {
                          const selected = selectedIcodes.includes(bc)
                          return (
                            <div key={bc} onClick={() => {
                              if (!selected) {
                                const next = [...selectedIcodes, bc]
                                setSelectedIcodes(next)
                                loadDetail(next, 0)
                              } else {
                                const next = selectedIcodes.filter(x => x !== bc)
                                setSelectedIcodes(next)
                                loadDetail(next, 0)
                              }
                              setIcodeQuery('')
                              setShowSugg(false)
                            }}
                              style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', color: selected ? '#38bdf8' : '#94a3b8', background: selected ? '#0f1f2e' : 'transparent', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 10, color: selected ? '#38bdf8' : '#334155' }}>{selected ? '✔' : '○'}</span>
                              {bc}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {selectedIcodes.length > 0 && (
                    <button onClick={() => { setSelectedIcodes([]); loadDetail([], 0) }}
                      style={{ background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>
                      Clear all
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {detail ? `${detail.total.toLocaleString()} rows · page ${detail.page + 1}/${detail.total_pages}` : ''}
                  </span>
                </div>
              </div>

              {/* Table */}
              {detailLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
              ) : !detail?.available ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Data not available.</div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                        <tr style={{ background: 'var(--content-bg)' }}>
                          {detailCols.map(c => (
                            <th key={c} style={{ padding: '6px 10px', fontWeight: 700, fontSize: 10, color: NUM_QTY_COLS.includes(c) ? '#7dd3fc' : '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid var(--card-border)', textAlign: NUM_QTY_COLS.includes(c) ? 'right' : 'left' }}>
                              {c.replace(/_/g, ' ')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.rows.map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff04', borderBottom: '1px solid #0f172a' }}>
                            {detailCols.map(c => {
                              const v = row[c]
                              const isNum = NUM_QTY_COLS.includes(c)
                              return (
                                <td key={c} style={{ padding: '5px 10px', textAlign: isNum ? 'right' : 'left', color: isNum ? (Number(v) < 0 ? '#f87171' : '#94a3b8') : c === 'store_name' || c === 'article_name' ? '#e2e8f0' : '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                                  {v === '' || v == null ? <span style={{ color: '#1e293b' }}>—</span> : isNum ? Number(v).toLocaleString() : String(v)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  {detail.total_pages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderTop: '1px solid var(--card-border)', background: 'var(--content-bg)' }}>
                      <button disabled={detailPage === 0} onClick={() => { const p = detailPage - 1; loadDetail(selectedIcodes, p) }}
                        style={{ padding: '3px 10px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, cursor: detailPage === 0 ? 'not-allowed' : 'pointer' }}>‹ Prev</button>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Page {detailPage + 1} / {detail.total_pages}</span>
                      <button disabled={detailPage >= detail.total_pages - 1} onClick={() => { const p = detailPage + 1; loadDetail(selectedIcodes, p) }}
                        style={{ padding: '3px 10px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, cursor: detailPage >= detail.total_pages - 1 ? 'not-allowed' : 'pointer' }}>Next ›</button>
                    </div>
                  )}
                </>
              )}
            </>
          )
        })() : null

        return (
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--card-border)', background: 'var(--content-bg)', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={S.cardTitle}>Allocation Summary</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>T_ALLOCATION_FOR_ALL_DIVISION</span>
                {alloc?.total_rows != null && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, padding: '1px 7px' }}>
                    {alloc.total_rows.toLocaleString()} rows
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ display: 'flex', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => {
                      setAllocView(t.key)
                      if (t.key === 'all') loadDetail(selectedIcodes, 0)
                      else loadAlloc(t.key)
                    }}
                      style={{ padding: '4px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                        background: allocView === t.key ? '#0ea5e9' : '#0f172a',
                        color: allocView === t.key ? '#fff' : '#64748b' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <button onClick={() => allocView === 'all' ? loadDetail(selectedIcodes, detailPage) : loadAlloc(allocView)}
                  style={{ background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 10, padding: '4px 9px', cursor: 'pointer' }}>↻</button>
              </div>
            </div>

            {/* All tab body */}
            {allocView === 'all' ? detailBody : (
              allocLoading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
              ) : !alloc?.available ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Allocation data not available — download from Master Data page first.</div>
              ) : (
                <FilterableTable
                  columns={cols}
                  rows={alloc.rows as Record<string, unknown>[]}
                  maxHeight={420}
                  globalSearch
                  footerRow={alloc.totals as Record<string, unknown> | null}
                  fontSize={12}
                />
              )
            )}
          </div>
        )
      })()}



    </div>

  )
}
