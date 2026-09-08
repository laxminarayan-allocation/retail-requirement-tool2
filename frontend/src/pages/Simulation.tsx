/**
 * Allocation Simulation V7 — React port (Option 2)
 * Full client-side simulation engine mirroring ALLOCATION_STIMULATION_V7_FULL.html
 * Data served from /api/simulation/data (compact row arrays)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import http from '@/api/http'

// ── Column index constants (mirror backend C map) ─────────────────────────────
const C = {
  ST:       0,   // store_name code
  SN:       1,   // store full name
  STC:      2,   // store_tag
  GR:       3,   // store_grade
  ZN:       4,   // zone
  LST:      5,   // state
  CITY:     6,   // city_name
  AT:       7,   // attribute1
  DI:       8,   // division
  SE:       9,   // section
  DE:       10,  // department
  DT:       11,  // display_type
  MCL:      12,  // mc_listing
  SA:       13,  // store_status
  OD:       14,  // opening_date
  P1:       15,  // proj_1
  P2:       16,  // proj_2
  P3:       17,  // proj_3
  P4:       18,  // proj_4
  P5:       19,  // proj_5
  PBS:      20,  // pbs
  PBS_FILL: 21,  // pbs_fill
  PBS_ACHV: 22,  // pbs_achv
  FNL_PBS:  23,  // fnl_pbs
  LM_SL:    24,  // lm_sl_q
  SL_7D:    25,  // sl_7d_q
  STK:      26,  // stk_q (fresh)
  INTR:     27,  // intr_q (transit)
  PRD:      28,  // prd_q (pack pending)
  TO:       29,  // to_q (transfer out)
  ADJ_STK:  30,  // adj_stk_q
  ADJ_INTR: 31,  // adj_intr_q
  TTL_STK:  32,  // adj_ttl_stk_q
  TGT_Q:    33,  // tgt_q
  TGT_V:    34,  // tgt_v
  SL_Q:     35,  // sl_q
  SL_V:     36,  // sl_v
  ACHV:     37,  // achv_per
  USE_ACH:  38,  // use_ach
  MC_STR:   39,  // mc_str
  REQ_ORG:  40,  // req (original)
  FILL:     41,  // fill_rate
  FR_RANK:  42,  // fill_rate_rank
  MIN_WK:   43,  // min_wk_str
  MAX_WK:   44,  // max_wk_str
  MDQ:      45,  // mdq
  SURGE:    46,  // v3_surge
  EXCESS:   47,  // excess
  P1S:      48,  // proj_1_surge
  P2S:      49,  // proj_2_surge
  P3S:      50,  // proj_3_surge
  P4S:      51,  // proj_4_surge
  P5S:      52,  // proj_5_surge
} as const

// ── Types ─────────────────────────────────────────────────────────────────────
type Row = (string | number | null)[]

interface RawPayload {
  C: Record<string, number>
  LU: {
    stores: string[]; stcs: string[]; grades: string[]; zones: string[]
    attrs: string[]; divs: string[]; secs: string[]; depts: string[]
    dts: string[]; states: string[]
  }
  SM: Record<string, string>
  D: Row[]
  meta: { total_rows: number; generated: string }
}

interface Factors {
  // A — Achievement multiplier
  achvMin: number; achvMax: number; achvUse: boolean
  // B — WK (weeks cover) bounds
  wkMin: number; wkMax: number; wkUse: boolean
  // C — PBS multiplier
  pbsMult: number; pbsUse: boolean
  // D — Projection period (which proj slot)
  projPeriod: number; projSurgeUse: boolean
  // E — Inventory safety days
  safetyDays: number
  // Inclusions
  inclTransit: boolean; inclPack: boolean; inclTO: boolean
}

const DEFAULT_FACTORS: Factors = {
  achvMin: 0, achvMax: 100, achvUse: true,
  wkMin: 4, wkMax: 20, wkUse: true,
  pbsMult: 1.0, pbsUse: true,
  projPeriod: 1, projSurgeUse: false,
  safetyDays: 14,
  inclTransit: true, inclPack: true, inclTO: true,
}

// ── Simulation Engine ─────────────────────────────────────────────────────────

function n(v: unknown): number {
  const x = Number(v)
  return isNaN(x) ? 0 : x
}

function computeReq(row: Row, f: Factors): { req: number; pbs: number; inv: number; wk: number } {
  const sl7d   = n(row[C.SL_7D])
  const fnlPbs = n(row[C.FNL_PBS])

  // Available stock
  let avail = n(row[C.ADJ_STK])
  if (f.inclTransit) avail += n(row[C.ADJ_INTR])
  if (f.inclPack)    avail += n(row[C.PRD])
  if (f.inclTO)      avail -= n(row[C.TO])
  avail = Math.max(0, avail)

  // PBS: use fnl_pbs directly (already computed by Oracle view with grade/factors)
  let pbs = fnlPbs * f.pbsMult
  if (!f.pbsUse) pbs = fnlPbs

  // WK-adjusted PBS
  if (f.wkUse) {
    const minWk = n(row[C.MIN_WK]) || f.wkMin
    const maxWk = n(row[C.MAX_WK]) || f.wkMax
    const wkPbs = Math.min(Math.max(pbs, minWk), maxWk)
    pbs = wkPbs
  }

  // Projection-based need: daily rate × safety days
  const dailySales = sl7d / 7
  const safetyNeed = dailySales * f.safetyDays

  // Requirement = max(PBS, safetyNeed) - avail
  const need = Math.max(pbs, safetyNeed)
  const req  = Math.max(0, need - avail)

  // WK cover = avail / daily sales
  const wk = dailySales > 0 ? avail / dailySales / 7 : 0

  return { req: Math.round(req), pbs: Math.round(pbs), inv: Math.round(avail), wk: Math.round(wk * 10) / 10 }
}

function runSimulation(rows: Row[], f: Factors) {
  const results = rows.map(row => {
    const { req, pbs, inv, wk } = computeReq(row, f)
    return { row, req, pbs, inv, wk }
  })
  return results
}

// ── Components ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 14px',
      minWidth: 110, flex: '1 1 110px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#f1f5f9', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function FactorSlider({ label, value, min, max, step = 1, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 130, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#3b82f6', opacity: disabled ? 0.4 : 1 }} />
      <span style={{ fontSize: 12, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums', width: 40, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Simulation() {
  const [raw, setRaw] = useState<RawPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  // Scope rows (Division × Attribute1) — server-side filter
  interface ScopeRow { division: string; div_op: '=' | '<>'; attribute1: string; attr_op: '=' | '<>' }
  const [scopes, setScopes] = useState<ScopeRow[]>([{ division: '', div_op: '=', attribute1: '', attr_op: '=' }])
  const addScope    = () => setScopes(s => [...s, { division: '', div_op: '=', attribute1: '', attr_op: '=' }])
  const removeScope = (i: number) => setScopes(s => s.filter((_, idx) => idx !== i))
  const updateScope = (i: number, field: keyof ScopeRow, val: string) =>
    setScopes(s => s.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  // Client-side filters
  const [fSec, setFSec]   = useState('')
  const [fSt, setFSt]     = useState('')
  const [fGr, setFGr]     = useState('')

  // Factors
  const [factors, setFactors] = useState<Factors>(DEFAULT_FACTORS)

  // Table
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 200

  const setF = useCallback(<K extends keyof Factors>(k: K, v: Factors[K]) =>
    setFactors(f => ({ ...f, [k]: v })), [])

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      // Collect active scopes (at least one field filled)
      const active = scopes.filter(s => s.division || s.attribute1)
      const params: Record<string, string> = {}
      if (fSec) params.sec = fSec
      // If single scope use simple query params; multi-scope handled client-side after full load
      if (active.length === 1) {
        if (active[0].division)   params.div  = active[0].division
        if (active[0].attribute1) params.attr = active[0].attribute1
      }
      const qs = new URLSearchParams(params).toString()
      const url = `/simulation/data${qs ? '?' + qs : ''}`
      const res = await http.get<{ success: boolean; data: RawPayload; message: string }>(url)
      if (!res.data.success) throw new Error(res.data.message)
      setRaw(res.data.data)
      setPage(0)
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load simulation data')
    } finally {
      setLoading(false)
    }
  }, [scopes, fSec])

  useEffect(() => { loadData() }, []) // initial load without filters

  // ── Run simulation ─────────────────────────────────────────────────────────
  const simResults = useMemo(() => {
    if (!raw) return []
    let rows = raw.D

    // Multi-scope OR filter (Division × Attribute1) with = / <> operators
    const activeScopes = scopes.filter(s => s.division || s.attribute1)
    if (activeScopes.length > 1) {
      rows = rows.filter(r => activeScopes.some(s => {
        const divMatch = !s.division ? true :
          s.div_op === '<>' ? String(r[C.DI]) !== s.division : String(r[C.DI]) === s.division
        const attrMatch = !s.attribute1 ? true :
          s.attr_op === '<>' ? String(r[C.AT]) !== s.attribute1 : String(r[C.AT]) === s.attribute1
        return divMatch && attrMatch
      }))
    }

    // Client-side store/grade filters
    if (fSt) rows = rows.filter(r => String(r[C.ST]) === fSt)
    if (fGr) rows = rows.filter(r => String(r[C.GR]) === fGr)

    return runSimulation(rows, factors)
  }, [raw, scopes, fSt, fGr, factors])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!simResults.length) return null
    const totalReq  = simResults.reduce((s, r) => s + r.req, 0)
    const totalPbs  = simResults.reduce((s, r) => s + r.pbs, 0)
    const orgReq    = simResults.reduce((s, r) => s + n(r.row[C.REQ_ORG]), 0)
    const zeroReq   = simResults.filter(r => r.req === 0).length
    const nonZero   = simResults.filter(r => r.req > 0).length
    const avgWk     = simResults.reduce((s, r) => s + r.wk, 0) / (simResults.length || 1)
    return { totalReq, totalPbs, orgReq, zeroReq, nonZero, avgWk, rows: simResults.length }
  }, [simResults])

  const pagedResults = useMemo(() =>
    simResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
  [simResults, page])

  const totalPages = Math.ceil(simResults.length / PAGE_SIZE)

  // ── Unique values for client-side dropdowns ─────────────────────────────
  const grades = useMemo(() => raw ? [...new Set(raw.D.map(r => String(r[C.GR])).filter(Boolean))].sort() : [], [raw])
  const stores = useMemo(() => raw?.LU.stores ?? [], [raw])

  // ── Render ─────────────────────────────────────────────────────────────────

  const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }
  const selectStyle: React.CSSProperties = {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', color: '#f1f5f9',
    borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', overflow: 'hidden', background: '#020617' }}>

      {/* ── Header ── */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Allocation Simulation</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>V7 · Real Oracle Data</span>
        {raw && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {raw.meta.total_rows.toLocaleString()} rows · {raw.meta.generated.slice(0, 10)}
        </span>}
      </div>

      {/* ── Main Layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left panel: Filters + Factors ── */}
        <div style={{
          width: 260, flexShrink: 0, borderRight: '1px solid #1e293b',
          display: 'flex', flexDirection: 'column', overflow: 'auto',
          background: '#080f1e',
        }}>

          {/* Filters */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #1e293b' }}>

            {/* Scope Builder */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ ...labelStyle }}>Division × Attribute1</div>
              <button onClick={addScope} style={{
                background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff',
                fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontWeight: 700,
              }}>+ Add</button>
            </div>
            {scopes.map((sc, i) => (
              <div key={i} style={{
                background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6,
                padding: '7px 8px', marginBottom: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>SCOPE {i + 1}</span>
                  {scopes.length > 1 && (
                    <button onClick={() => removeScope(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                  )}
                </div>
                <div style={{ ...labelStyle, marginBottom: 2 }}>Division</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
                  <select value={sc.div_op} onChange={e => updateScope(i, 'div_op', e.target.value)}
                    style={{ ...selectStyle, width: 44, padding: '4px 3px', fontWeight: 700,
                      color: sc.div_op === '<>' ? '#f87171' : '#38bdf8', flexShrink: 0 }}>
                    <option value="=">=</option>
                    <option value="<>">&lt;&gt;</option>
                  </select>
                  <select value={sc.division} onChange={e => updateScope(i, 'division', e.target.value)}
                    style={{ ...selectStyle, flex: 1 }}>
                    <option value="">All</option>
                    {(raw?.LU.divs ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ ...labelStyle, marginBottom: 2 }}>Attribute1</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select value={sc.attr_op} onChange={e => updateScope(i, 'attr_op', e.target.value)}
                    style={{ ...selectStyle, width: 44, padding: '4px 3px', fontWeight: 700,
                      color: sc.attr_op === '<>' ? '#f87171' : '#38bdf8', flexShrink: 0 }}>
                    <option value="=">=</option>
                    <option value="<>">&lt;&gt;</option>
                  </select>
                  <select value={sc.attribute1} onChange={e => updateScope(i, 'attribute1', e.target.value)}
                    style={{ ...selectStyle, flex: 1 }}>
                    <option value="">All</option>
                    {(raw?.LU.attrs ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            ))}

            {/* Section + Load */}
            <div style={{ ...labelStyle, marginBottom: 2, marginTop: 4 }}>Section</div>
            <select value={fSec} onChange={e => setFSec(e.target.value)} style={{ ...selectStyle, width: '100%', marginBottom: 8 }}>
              <option value="">All</option>
              {(raw?.LU.secs ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <button onClick={loadData} disabled={loading} style={{
              background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6,
              padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              opacity: loading ? 0.6 : 1, width: '100%',
            }}>
              {loading ? 'Loading…' : 'Apply & Load'}
            </button>

            {/* Client filters */}
            <div style={{ ...labelStyle, marginTop: 10, marginBottom: 6 }}>Filters (Client)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <div style={{ ...labelStyle, marginBottom: 2 }}>Store</div>
                <select value={fSt} onChange={e => { setFSt(e.target.value); setPage(0) }} style={{ ...selectStyle, width: '100%' }}>
                  <option value="">All</option>
                  {stores.map(s => <option key={s} value={s}>{s}{raw?.SM[s] ? ` — ${raw.SM[s].slice(0, 15)}` : ''}</option>)}
                </select>
              </div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 2 }}>Grade</div>
                <select value={fGr} onChange={e => { setFGr(e.target.value); setPage(0) }} style={{ ...selectStyle, width: '100%' }}>
                  <option value="">All</option>
                  {grades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Factors */}
          <div style={{ padding: '10px 12px', flex: 1, overflow: 'auto' }}>
            <div style={{ ...labelStyle, marginBottom: 10 }}>Simulation Factors</div>

            {/* Factor A: Achievement */}
            <FactorSection label="A — Achievement" color="#3b82f6">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input type="checkbox" checked={factors.achvUse} onChange={e => setF('achvUse', e.target.checked)} style={{ accentColor: '#3b82f6' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Apply achievement cap</span>
              </div>
              <FactorSlider label="Min Achv %" value={factors.achvMin} min={0} max={100} onChange={v => setF('achvMin', v)} disabled={!factors.achvUse} />
              <FactorSlider label="Max Achv %" value={factors.achvMax} min={0} max={150} onChange={v => setF('achvMax', v)} disabled={!factors.achvUse} />
            </FactorSection>

            {/* Factor B: WK Cover */}
            <FactorSection label="B — WK Cover Bounds" color="#10b981">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input type="checkbox" checked={factors.wkUse} onChange={e => setF('wkUse', e.target.checked)} style={{ accentColor: '#10b981' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Apply WK min/max bounds</span>
              </div>
              <FactorSlider label="Min WK" value={factors.wkMin} min={1} max={52} onChange={v => setF('wkMin', v)} disabled={!factors.wkUse} />
              <FactorSlider label="Max WK" value={factors.wkMax} min={1} max={52} onChange={v => setF('wkMax', v)} disabled={!factors.wkUse} />
            </FactorSection>

            {/* Factor C: PBS */}
            <FactorSection label="C — PBS Multiplier" color="#f59e0b">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <input type="checkbox" checked={factors.pbsUse} onChange={e => setF('pbsUse', e.target.checked)} style={{ accentColor: '#f59e0b' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Apply PBS multiplier</span>
              </div>
              <FactorSlider label="PBS Multiplier" value={factors.pbsMult} min={0.5} max={3} step={0.1} onChange={v => setF('pbsMult', v)} disabled={!factors.pbsUse} />
            </FactorSection>

            {/* Factor D: Projection */}
            <FactorSection label="D — Projection Period" color="#8b5cf6">
              <FactorSlider label="Proj Period (P1-P5)" value={factors.projPeriod} min={1} max={5} onChange={v => setF('projPeriod', v)} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input type="checkbox" checked={factors.projSurgeUse} onChange={e => setF('projSurgeUse', e.target.checked)} style={{ accentColor: '#8b5cf6' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Use surge projection</span>
              </div>
            </FactorSection>

            {/* Factor E: Safety Days */}
            <FactorSection label="E — Safety Days" color="#ef4444">
              <FactorSlider label="Safety Days" value={factors.safetyDays} min={0} max={60} onChange={v => setF('safetyDays', v)} />
            </FactorSection>

            {/* Inclusions */}
            <FactorSection label="Inclusions" color="#64748b">
              {([
                ['inclTransit', 'Include Transit (Intr)'],
                ['inclPack',    'Include Pack Pending'],
                ['inclTO',      'Include Transfer Out'],
              ] as const).map(([key, lbl]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <input type="checkbox" checked={factors[key]} onChange={e => setF(key, e.target.checked)} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{lbl}</span>
                </div>
              ))}
            </FactorSection>

            <button onClick={() => setFactors(DEFAULT_FACTORS)} style={{
              background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)',
              borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', width: '100%', marginTop: 8,
            }}>Reset Factors</button>
          </div>
        </div>

        {/* ── Right panel: KPIs + Table ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {loadError && (
            <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '8px 16px', fontSize: 12 }}>
              {loadError}
            </div>
          )}

          {loading && (
            <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              Loading simulation data…
            </div>
          )}

          {/* KPI Bar */}
          {kpis && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid #1e293b', flexWrap: 'wrap', flexShrink: 0 }}>
              <KpiCard label="Sim Rows" value={kpis.rows.toLocaleString()} />
              <KpiCard label="Total Req" value={kpis.totalReq.toLocaleString()} color="#60a5fa" />
              <KpiCard label="Original Req" value={kpis.orgReq.toLocaleString()} color="#94a3b8" sub="from Oracle" />
              <KpiCard label="Δ vs Oracle" value={(kpis.totalReq - kpis.orgReq > 0 ? '+' : '') + (kpis.totalReq - kpis.orgReq).toLocaleString()} color={kpis.totalReq > kpis.orgReq ? '#f87171' : '#4ade80'} />
              <KpiCard label="Zero Req" value={kpis.zeroReq.toLocaleString()} color="#fbbf24" sub={`${((kpis.zeroReq / kpis.rows) * 100).toFixed(1)}%`} />
              <KpiCard label="Avg WK Cover" value={kpis.avgWk.toFixed(1)} color="#a78bfa" sub="weeks" />
            </div>
          )}

          {/* Table */}
          {!loading && raw && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
              }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--content-bg)', zIndex: 2 }}>
                    {['Store', 'Grade', 'Zone', 'Attr', 'Division', 'Section', 'Dept', 'STC',
                      'Inv', 'PBS', 'WK', 'Org.Req', 'Sim.Req', 'Δ'].map(h => (
                      <th key={h} style={{
                        padding: '6px 8px',
                        textAlign: (['Store','Attr','Division','Section','Dept'].includes(h) ? 'left' : 'right') as 'left' | 'right',
                        color: 'var(--text-muted)', fontWeight: 600,
                        borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedResults.map((r, i) => {
                    const delta = r.req - n(r.row[C.REQ_ORG])
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #0f172a', background: i % 2 === 0 ? '#020617' : '#080f1e' }}>
                        <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>
                          {String(r.row[C.ST])}
                          {raw.SM[String(r.row[C.ST])] && (
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>
                              {raw.SM[String(r.row[C.ST])].slice(0, 12)}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '4px 8px', color: gradeColor(String(r.row[C.GR])), textAlign: 'center' }}>{String(r.row[C.GR])}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{String(r.row[C.ZN] ?? '')}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{String(r.row[C.AT])}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>{String(r.row[C.DI])}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{String(r.row[C.SE])}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{String(r.row[C.DE])}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--text-muted)', textAlign: 'center' }}>{String(r.row[C.STC] ?? '')}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.inv.toLocaleString()}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.pbs.toLocaleString()}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: r.wk < 2 ? '#f87171' : r.wk > 12 ? '#fbbf24' : '#4ade80' }}>
                          {r.wk.toFixed(1)}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{n(r.row[C.REQ_ORG]).toLocaleString()}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: r.req > 0 ? '#60a5fa' : '#334155', fontWeight: r.req > 0 ? 600 : 400 }}>
                          {r.req.toLocaleString()}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right', color: delta > 0 ? '#f87171' : delta < 0 ? '#4ade80' : '#334155' }}>
                          {delta !== 0 ? (delta > 0 ? '+' : '') + delta.toLocaleString() : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              borderTop: '1px solid #1e293b', flexShrink: 0, background: '#080f1e',
            }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                style={pagerBtn(page === 0)}>‹ Prev</button>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, textAlign: 'center' }}>
                Page {page + 1} / {totalPages} &nbsp;·&nbsp; {simResults.length.toLocaleString()} rows
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                style={pagerBtn(page >= totalPages - 1)}>Next ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeColor(g: string): string {
  const m: Record<string, string> = { A: '#fbbf24', B: '#60a5fa', C: '#4ade80', D: '#a78bfa', E: '#f87171' }
  return m[g?.toUpperCase()] ?? '#64748b'
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#1e293b' : '#1d4ed8', color: disabled ? '#334155' : '#fff',
    border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: disabled ? 'default' : 'pointer',
  }
}

function FactorSection({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #1e293b' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
