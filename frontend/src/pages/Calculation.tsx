/**
 * Calculation — Phase 7
 *
 * Configure and launch a replenishment calculation run.
 * Polls for status, shows step-by-step progress, then renders summary + result grid + exceptions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}
import { useNavigate, useSearchParams } from 'react-router-dom'
import ExportPanel from '@/components/ExportPanel'
import http from '@/api/http'
import { DataGrid } from '@/components/DataGrid'

async function apiFetch<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await http.request<{ success: boolean; data: T; message: string | null }>({ method, url, data })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FactorSetMeta {
  id: string; name: string; attribute1: string | null; season: string | null; is_active: boolean
}

interface StepLog {
  step: number; name: string; status: string; rows: number | null; message: string | null
}

interface RunSummary {
  total_rows: number; stores: number; departments: number
  total_req: number; total_pbs: number; fill_rate_achieved: number
  zero_req_rows: number; capped_rows: number
}

interface RunRecord {
  run_id: string; status: string; label: string | null
  factor_set_name: string | null; started_at: string | null; completed_at: string | null
  duration_s: number | null; steps: StepLog[]; summary: RunSummary | null
  error: string | null; result_rows: number
}

interface ResultRow { [key: string]: string | number }

interface ExceptionRecord {
  rule: string; severity: 'error' | 'warning' | 'info'; title: string
  message: string; row_count: number; sample_rows: ResultRow[]
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', gap: 16, height: 'calc(100vh - 100px)', minHeight: 0 },
  sidebar: { width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, overflowY: 'auto' },
  card: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' },
  cardHead: {
    padding: '10px 14px', borderBottom: '1px solid #334155',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#e2e8f0' },
  cardBody: { padding: '14px' },
  label: { fontSize: 11, color: '#64748b', fontWeight: 500, letterSpacing: 0.3, marginBottom: 4, display: 'block' },
  select: { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '6px 10px', width: '100%', marginBottom: 12 },
  input: { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '6px 10px', width: '100%', boxSizing: 'border-box' as const, marginBottom: 12 },
  btn: { background: '#0ea5e9', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700, padding: '8px 20px', cursor: 'pointer', width: '100%' },
  btnSm: { background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 12, padding: '4px 12px', cursor: 'pointer' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#94a3b8', cursor: 'pointer' },
  // steps
  step: (status: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0',
    borderBottom: '1px solid #1e293b', fontSize: 12,
    color: status === 'ok' ? '#4ade80' : status === 'error' ? '#f87171' : '#94a3b8',
  }),
  stepNum: { width: 20, fontWeight: 700, flexShrink: 0 },
  stepName: { flex: 1 },
  stepRows: { color: '#64748b', fontSize: 11 },
  // summary KPIs
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '14px' },
  kpi: { background: '#0f172a', borderRadius: 8, padding: '12px 14px' },
  kpiVal: { fontSize: 22, fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' as const },
  kpiLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
  // result table
  tblWrap: { overflowX: 'auto', overflowY: 'auto', maxHeight: 400 },
  tbl: { borderCollapse: 'collapse' as const, width: '100%', fontSize: 11 },
  th: { background: '#0f172a', color: '#94a3b8', fontWeight: 600, padding: '6px 10px', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, borderBottom: '1px solid #334155', fontSize: 10, letterSpacing: 0.3 },
  td: { padding: '5px 10px', color: '#cbd5e1', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' as const },
  tdNum: { padding: '5px 10px', color: '#7dd3fc', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  tdReq: { padding: '5px 10px', color: '#4ade80', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  empty: { padding: 40, textAlign: 'center' as const, color: '#64748b', fontSize: 13 },
}

const NUM_COLS = new Set(['pbs', 'fnl_pbs', 'mdq', 'bgt_mc_str', 'bgt_cap', 'ttl_stk_q', 'l4w_sl', 'daily_sales', 'stock_cover_days', 'fill_req', 'net_req', 'req', 'pbs_multiplier'])
const REQ_COLS = new Set(['req'])

function fmtNum(v: string | number): string {
  if (v === '' || v === null || v === undefined) return '—'
  const n = Number(v)
  if (isNaN(n)) return String(v)
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)
}

// ── History sidebar item ───────────────────────────────────────────────────────
function RunHistoryItem({ run, selected, onClick }: { run: RunRecord; selected: boolean; onClick: () => void }) {
  const statusColor = run.status === 'complete' ? '#4ade80' : run.status === 'error' ? '#f87171' : '#fbbf24'
  return (
    <div onClick={onClick} style={{
      padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #1e293b',
      background: selected ? '#0f172a' : 'transparent',
      borderLeft: selected ? '3px solid #38bdf8' : '3px solid transparent',
    }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.label}</div>
      <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 8 }}>
        <span style={{ color: statusColor, fontWeight: 600 }}>{run.status.toUpperCase()}</span>
        {run.duration_s && <span>{run.duration_s}s</span>}
        {run.summary && <span>{run.summary.total_req.toLocaleString()} REQ</span>}
      </div>
    </div>
  )
}

// ── Step list ─────────────────────────────────────────────────────────────────
function StepList({ steps, running }: { steps: StepLog[]; running: boolean }) {
  const ALL_STEPS = [
    'Load factor set', 'Fetch store master', 'Fetch MDQ / capacity grid',
    'Fetch PBS targets', 'Fetch stock position', 'Fetch last-4-week sales',
    'Apply scope filter', 'Join all data sources', 'Apply grade PBS multiplier',
    'Compute stock position (TTL_STK_Q)', 'Compute sales metrics (L4W, daily rate)',
    'Compute requirement (REQ)', 'Run validation checks',
  ]
  const doneNames = new Set(steps.map(s => s.name))

  return (
    <div style={{ padding: '12px 14px' }}>
      {ALL_STEPS.map((name, i) => {
        const done = steps.find(s => s.name === name)
        const isPending = !done
        const isCurrent = running && !done && i === steps.length
        return (
          <div key={name} style={S.step(done?.status ?? 'pending')}>
            <span style={S.stepNum}>{done ? (done.status === 'ok' ? '✓' : '✗') : isCurrent ? '⋯' : String(i + 1)}</span>
            <span style={S.stepName}>
              {name}
              {done?.message && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{done.message}</div>}
            </span>
            {done?.rows != null && <span style={S.stepRows}>{done.rows.toLocaleString()} rows</span>}
          </div>
        )
      })}
      {/* suppress unused var lint */}
      {doneNames.size === 0 && null}
    </div>
  )
}

// ── Summary KPIs ──────────────────────────────────────────────────────────────
function SummaryKPIs({ s }: { s: RunSummary }) {
  const kpis = [
    { label: 'Total REQ Qty', val: s.total_req.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
    { label: 'Stores', val: s.stores.toLocaleString() },
    { label: 'Departments', val: s.departments.toLocaleString() },
    { label: 'Total Rows', val: s.total_rows.toLocaleString() },
    { label: 'Fill Rate Achieved', val: `${(s.fill_rate_achieved * 100).toFixed(1)}%` },
    { label: 'Zero REQ Rows', val: s.zero_req_rows.toLocaleString() },
    { label: 'Capped Rows', val: s.capped_rows.toLocaleString() },
    { label: 'Total PBS', val: s.total_pbs.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, padding: '14px' }}>
      {kpis.map(k => (
        <div key={k.label} style={S.kpi}>
          <div style={S.kpiVal}>{k.val}</div>
          <div style={S.kpiLabel}>{k.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Result grid ───────────────────────────────────────────────────────────────
function ResultGrid({ runId }: { runId: string }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ResultRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [minReq, setMinReq] = useState('')
  const [sortBy, setSortBy] = useState('req')
  const [offset, setOffset] = useState(0)
  const limit = 200

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ offset: String(off), limit: String(limit), sort_by: sortBy, sort_desc: 'true' })
      if (minReq) params.set('min_req', minReq)
      const res = await http.get<{ success: boolean; data: { total: number; rows: ResultRow[] } }>(
        `/calculation/runs/${runId}/results?${params}`
      )
      if (res.data.success) {
        setRows(res.data.data.rows)
        setTotal(res.data.data.total)
        setOffset(off)
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [runId, sortBy, minReq])

  useEffect(() => { load(0) }, [load])

  const cols = rows.length ? Object.keys(rows[0]) : []

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Results — {total.toLocaleString()} rows</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Min REQ:</span>
          <input style={{ ...S.input, width: 70, marginBottom: 0, padding: '3px 6px' }}
            value={minReq} onChange={e => setMinReq(e.target.value)} placeholder="0"
            onKeyDown={e => e.key === 'Enter' && load(0)} />
          <span style={{ fontSize: 11, color: '#64748b' }}>Sort by:</span>
          <select style={{ ...S.select, width: 120, marginBottom: 0, padding: '3px 6px' }}
            value={sortBy} onChange={e => { setSortBy(e.target.value); load(0) }}>
            {['req', 'net_req', 'ttl_stk_q', 'l4w_sl', 'fnl_pbs', 'store_name', 'department'].map(c =>
              <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={S.btnSm} onClick={() => load(0)}>Refresh</button>
          <button style={S.btnSm} onClick={() => navigate(`/results?run_id=${runId}`)}>
            Open in Explorer
          </button>
          <ExportPanel runId={runId} />
        </div>
      </div>

      <div style={{ height: 420 }}>
        <DataGrid
          records={rows as Record<string, unknown>[]}
          columns={cols}
          loading={loading}
          loadingMessage="Loading results…"
        />
      </div>
      {!loading && rows.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #334155', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
          <button style={S.btnSm} disabled={offset === 0} onClick={() => load(Math.max(0, offset - limit))}>← Prev</button>
          <button style={S.btnSm} disabled={offset + limit >= total} onClick={() => load(offset + limit)}>Next →</button>
        </div>
      )}
    </div>
  )
}

// ── Exceptions panel ──────────────────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = { error: '#f87171', warning: '#fbbf24', info: '#60a5fa' }
const SEV_BG: Record<string, string> = { error: '#450a0a', warning: '#1c1400', info: '#0c1a2e' }
const SEV_BORDER: Record<string, string> = { error: '#ef4444', warning: '#d97706', info: '#3b82f6' }

function ExceptionsPanel({ runId }: { runId: string }) {
  const [exceptions, setExceptions] = useState<ExceptionRecord[]>([])
  const [counts, setCounts] = useState({ total: 0, error: 0, warning: 0, info: 0 })
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    http.get<{ success: boolean; data: { exceptions: ExceptionRecord[]; count: number; error_count: number; warning_count: number; info_count: number } }>(
      `/calculation/runs/${runId}/exceptions`
    ).then(res => {
      if (res.data.success) {
        setExceptions(res.data.data.exceptions)
        setCounts({ total: res.data.data.count, error: res.data.data.error_count, warning: res.data.data.warning_count, info: res.data.data.info_count })
      }
    }).catch(console.error).finally(() => setLoading(false))
  }, [runId])

  if (loading) return <div style={{ ...S.card, padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading exceptions…</div>

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Validation Exceptions</span>
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          {counts.error > 0 && <span style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 12, padding: '1px 8px', color: '#f87171', fontWeight: 700 }}>
            {counts.error} Error{counts.error !== 1 ? 's' : ''}
          </span>}
          {counts.warning > 0 && <span style={{ background: '#1c1400', border: '1px solid #d97706', borderRadius: 12, padding: '1px 8px', color: '#fbbf24', fontWeight: 700 }}>
            {counts.warning} Warning{counts.warning !== 1 ? 's' : ''}
          </span>}
          {counts.info > 0 && <span style={{ background: '#0c1a2e', border: '1px solid #3b82f6', borderRadius: 12, padding: '1px 8px', color: '#60a5fa', fontWeight: 700 }}>
            {counts.info} Info
          </span>}
          {counts.total === 0 && <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ No exceptions</span>}
        </div>
      </div>

      {exceptions.length === 0 && (
        <div style={{ padding: '30px 14px', textAlign: 'center', color: '#4ade80', fontSize: 13 }}>
          ✓ All validation checks passed. No anomalies detected.
        </div>
      )}

      {exceptions.map(exc => (
        <div key={exc.rule} style={{ borderBottom: '1px solid #1e293b' }}>
          <div
            onClick={() => setExpanded(expanded === exc.rule ? null : exc.rule)}
            style={{
              padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
              background: expanded === exc.rule ? '#0f172a' : 'transparent',
              transition: 'background 0.15s',
            }}
          >
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, flexShrink: 0, marginTop: 1,
              background: SEV_BG[exc.severity], border: `1px solid ${SEV_BORDER[exc.severity]}`,
              color: SEV_COLOR[exc.severity], textTransform: 'uppercase' as const, letterSpacing: 0.5,
            }}>
              {exc.severity}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{exc.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{exc.message}</div>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', flexShrink: 0, textAlign: 'right' as const }}>
              <div style={{ fontWeight: 600, color: SEV_COLOR[exc.severity] }}>{exc.row_count.toLocaleString()} rows</div>
              <div style={{ marginTop: 2 }}>{expanded === exc.rule ? '▲ hide' : '▼ show'} samples</div>
            </div>
          </div>

          {expanded === exc.rule && exc.sample_rows.length > 0 && (
            <div style={{ padding: '0 14px 12px', overflowX: 'auto' }}>
              <table style={{ ...S.tbl, marginTop: 6 }}>
                <thead>
                  <tr>{Object.keys(exc.sample_rows[0]).map(c => <th key={c} style={S.th}>{c.toUpperCase()}</th>)}</tr>
                </thead>
                <tbody>
                  {exc.sample_rows.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0f172a22' }}>
                      {Object.entries(row).map(([c, v]) => (
                        <td key={c} style={REQ_COLS.has(c) ? S.tdReq : NUM_COLS.has(c) ? S.tdNum : S.td}>
                          {v === '' || v === null || v === undefined ? '—' : (NUM_COLS.has(c) ? fmtNum(v as string | number) : String(v))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {exc.sample_rows.length === 50 && (
                <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>Showing first 50 sample rows</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Calculation() {
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const [factorSets, setFactorSets] = useState<FactorSetMeta[]>([])
  const [selectedFs, setSelectedFs] = useState(searchParams.get('factor_set_id') ?? '')
  const [attribute1, setAttribute1] = useState(searchParams.get('attribute1') ?? 'PREWINTER')
  const [division, setDivision] = useState(searchParams.get('division') ?? '')
  const [department, setDepartment] = useState(searchParams.get('department') ?? '')
  const [inclTransit, setInclTransit] = useState(true)
  const [inclPack, setInclPack] = useState(true)
  const [inclTransferOut, setInclTransferOut] = useState(true)

  const [runs, setRuns] = useState<RunRecord[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null)
  const [launching, setLaunching] = useState(false)
  const [resultTab, setResultTab] = useState<'results' | 'exceptions'>('results')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load factor sets; if arriving from History re-run, honour URL params, else default to active
  useEffect(() => {
    const preFilledFs = searchParams.get('factor_set_id')
    apiFetch<{ factor_sets: FactorSetMeta[] }>('GET', '/factors').then(d => {
      setFactorSets(d.factor_sets)
      if (!preFilledFs) {
        const active = d.factor_sets.find(f => f.is_active)
        if (active) setSelectedFs(active.id)
      }
    })
    // Clear URL params so they don't re-apply on next mount
    if (searchParams.toString()) setSearchParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load run history
  const loadRuns = useCallback(async () => {
    const d = await apiFetch<{ runs: RunRecord[] }>('GET', '/calculation/runs')
    setRuns(d.runs)
  }, [])

  useEffect(() => { loadRuns() }, [loadRuns])

  // Poll active run
  useEffect(() => {
    if (!activeRunId) return
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch<RunRecord>('GET', `/calculation/runs/${activeRunId}`)
        setActiveRun(r)
        if (r.status === 'complete' || r.status === 'error') {
          clearInterval(pollRef.current!)
          loadRuns()
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeRunId, loadRuns])

  async function launchRun() {
    if (!selectedFs) { alert('Select a factor set'); return }
    setLaunching(true)
    try {
      const d = await apiFetch<{ run_id: string }>('POST', '/calculation/run', {
        factor_set_id: selectedFs,
        attribute1: attribute1 || null,
        division: division || null,
        department: department || null,
        include_transit: inclTransit,
        include_pack_pending: inclPack,
        include_transfer_out: inclTransferOut,
      })
      setActiveRunId(d.run_id)
      setActiveRun(null)
      loadRuns()
    } catch (e) {
      alert('Launch failed: ' + e)
    } finally {
      setLaunching(false)
    }
  }

  function selectRun(run: RunRecord) {
    setActiveRunId(run.run_id)
    setActiveRun(run)
    if (run.status === 'running' || run.status === 'pending') return // already polling
    if (pollRef.current) clearInterval(pollRef.current)
  }

  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'pending'

  return (
    <div style={{ ...S.page, flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 'calc(100vh - 100px)', overflowY: isMobile ? 'auto' : undefined }}>
      {/* ── Sidebar ── */}
      <div style={{ ...S.sidebar, width: isMobile ? '100%' : 300, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>Calculation</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Configure and run replenishment</div>
        </div>

        {/* Config card */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Run Configuration</span></div>
          <div style={S.cardBody}>
            <label style={S.label}>FACTOR SET</label>
            <select style={S.select} value={selectedFs} onChange={e => setSelectedFs(e.target.value)}>
              <option value="">— select —</option>
              {factorSets.map(f => (
                <option key={f.id} value={f.id}>
                  {f.is_active ? '★ ' : ''}{f.name}
                </option>
              ))}
            </select>

            <label style={S.label}>ATTRIBUTE1 (CAMPAIGN)</label>
            <input style={S.input} value={attribute1} onChange={e => setAttribute1(e.target.value)} placeholder="e.g. PREWINTER" />

            <label style={S.label}>DIVISION (optional)</label>
            <input style={S.input} value={division} onChange={e => setDivision(e.target.value)} placeholder="e.g. MENS" />

            <label style={S.label}>DEPARTMENT (optional)</label>
            <input style={S.input} value={department} onChange={e => setDepartment(e.target.value)} placeholder="leave blank for all" />

            <div style={{ borderTop: '1px solid #334155', paddingTop: 10, marginTop: 2, marginBottom: 10 }}>
              <label style={S.label}>STOCK COMPONENTS</label>
              {[
                { label: 'Include In-Transit', val: inclTransit, set: setInclTransit },
                { label: 'Include Pack Pending', val: inclPack, set: setInclPack },
                { label: 'Include Transfer Out', val: inclTransferOut, set: setInclTransferOut },
              ].map(({ label, val, set }) => (
                <label key={label} style={S.checkRow}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>

            <button style={{ ...S.btn, opacity: launching ? 0.6 : 1 }} onClick={launchRun} disabled={launching || isRunning}>
              {launching ? 'Launching…' : isRunning ? '⋯ Running' : '▶ Run Calculation'}
            </button>
          </div>
        </div>

        {/* Run history */}
        <div style={{ ...S.card, flex: 1, overflowY: 'auto' }}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>Recent Runs</span>
            <button style={S.btnSm} onClick={loadRuns}>↻</button>
          </div>
          {runs.length === 0 && <div style={{ padding: '20px 14px', fontSize: 12, color: '#64748b' }}>No runs yet.</div>}
          {runs.map(r => (
            <RunHistoryItem key={r.run_id} run={r} selected={activeRunId === r.run_id} onClick={() => selectRun(r)} />
          ))}
        </div>
      </div>

      {/* ── Main panel ── */}
      <div style={S.main}>
        {!activeRun && (
          <div style={{ ...S.card, flex: 1 }}>
            <div style={S.empty}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>▶️</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
                Configure and run a calculation
              </div>
              <div style={{ fontSize: 12 }}>
                Select a factor set, optionally filter by attribute / division / department,<br />
                then click Run Calculation.
              </div>
            </div>
          </div>
        )}

        {activeRun && (
          <>
            {/* Run header */}
            <div style={S.card}>
              <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{activeRun.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    Factor set: {activeRun.factor_set_name}
                    {activeRun.duration_s && ` · ${activeRun.duration_s}s`}
                    {activeRun.result_rows > 0 && ` · ${activeRun.result_rows.toLocaleString()} rows`}
                  </div>
                </div>
                <div style={{
                  background: activeRun.status === 'complete' ? '#14532d' : activeRun.status === 'error' ? '#450a0a' : '#1c1917',
                  border: `1px solid ${activeRun.status === 'complete' ? '#16a34a' : activeRun.status === 'error' ? '#ef4444' : '#78716c'}`,
                  borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700,
                  color: activeRun.status === 'complete' ? '#4ade80' : activeRun.status === 'error' ? '#f87171' : '#a8a29e',
                }}>
                  {activeRun.status.toUpperCase()}
                  {isRunning && ' ⋯'}
                </div>
              </div>
            </div>

            {/* Error */}
            {activeRun.error && (
              <div style={{ ...S.card, background: '#450a0a', border: '1px solid #ef4444' }}>
                <div style={{ padding: '12px 14px', color: '#f87171', fontSize: 13 }}>
                  <strong>Error:</strong> {activeRun.error}
                </div>
              </div>
            )}

            {/* Steps + Summary side by side */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...S.card, flex: 1, minWidth: isMobile ? '100%' : 220 }}>
                <div style={S.cardHead}><span style={S.cardTitle}>Pipeline Steps</span></div>
                <StepList steps={activeRun.steps} running={isRunning} />
              </div>

              {activeRun.summary && (
                <div style={{ ...S.card, flex: 1, minWidth: isMobile ? '100%' : 220 }}>
                  <div style={S.cardHead}><span style={S.cardTitle}>Summary</span></div>
                  <SummaryKPIs s={activeRun.summary} />
                </div>
              )}
            </div>

            {/* Results / Exceptions tabs */}
            {activeRun.status === 'complete' && (
              <>
                <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #334155' }}>
                  {(['results', 'exceptions'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setResultTab(tab)}
                      style={{
                        background: resultTab === tab ? '#1e293b' : 'transparent',
                        border: 'none', borderBottom: resultTab === tab ? '2px solid #38bdf8' : '2px solid transparent',
                        color: resultTab === tab ? '#e2e8f0' : '#64748b',
                        fontSize: 12, fontWeight: 600, padding: '8px 16px', cursor: 'pointer',
                        textTransform: 'capitalize' as const,
                      }}
                    >
                      {tab === 'results' ? `Results (${activeRun.result_rows.toLocaleString()})` : 'Exceptions'}
                    </button>
                  ))}
                </div>
                {resultTab === 'results' && <ResultGrid runId={activeRun.run_id} />}
                {resultTab === 'exceptions' && <ExceptionsPanel runId={activeRun.run_id} />}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
