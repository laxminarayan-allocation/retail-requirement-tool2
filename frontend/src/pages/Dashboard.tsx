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
  const cityDist = oracle.store_city_distribution ?? {}
  const cityUpDist = oracle.store_city_upcoming ?? {}
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
  const allKeys = Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist)]))
    .filter(k => k !== '—' && k !== '-')
    .sort((a, b) => ((activeDist[b] ?? 0) + (upcomingDist[b] ?? 0)) - ((activeDist[a] ?? 0) + (upcomingDist[a] ?? 0)))
  const mx = Math.max(...allKeys.map(k => (activeDist[k] ?? 0) + (upcomingDist[k] ?? 0)), 1)

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
          </div>
          {allKeys.map(key => {
            const a = activeDist[key] ?? 0
            const u = upcomingDist[key] ?? 0
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
                </div>
                <span style={{ color: 'var(--text-muted)', minWidth: 28, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 9 }}>
                  <span style={{ color: '#38bdf8' }}>{a}</span>{u > 0 && <span style={{ color: '#f59e0b' }}> +{u}</span>}
                </span>
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
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>Store Network</span>
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
        <div style={{ width: '100%' }}>
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
                {(oracle.unique_state_count > 0 || oracle.unique_city_count > 0) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    {oracle.unique_state_count > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>States</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#818cf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{oracle.unique_state_count}</div>
                      </div>
                    )}
                    {oracle.unique_state_count > 0 && oracle.unique_city_count > 0 && <div style={{ width: 1, background: 'var(--card-bg)', alignSelf: 'stretch' }} />}
                    {oracle.unique_city_count > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Cities</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#818cf8', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{oracle.unique_city_count}</div>
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
            const allZones = Array.from(new Set([...Object.keys(activeDist), ...Object.keys(upcomingDist)]))
              .sort((a, b) => ((activeDist[b] ?? 0) + (upcomingDist[b] ?? 0)) - ((activeDist[a] ?? 0) + (upcomingDist[a] ?? 0)))
            const mx = Math.max(...allZones.map(z => (activeDist[z] ?? 0) + (upcomingDist[z] ?? 0)), 1)
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
                  </div>
                </div>
                {allZones.map(zone => {
                  const a = activeDist[zone] ?? 0
                  const u = upcomingDist[zone] ?? 0
                  return (
                    <div key={zone} onClick={() => setDrillDown({ split: 'zone', value: zone })} title={`Click to see all ${zone} stores`} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '1px 2px' }} onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ width: 56, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 8 }}>{zone}</span>
                      <div style={{ flex: 1, minWidth: 10, height: 5, background: 'var(--card-bg)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${(a / mx) * 100}%`, height: '100%', background: '#38bdf8' }} />
                        <div style={{ width: `${(u / mx) * 100}%`, height: '100%', background: '#f59e0b' }} />
                      </div>
                      <span style={{ fontSize: 9, flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>
                        <span style={{ color: '#38bdf8' }}>{a}</span>{u > 0 && <span style={{ color: '#f59e0b' }}> +{u}</span>}
                      </span>
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
