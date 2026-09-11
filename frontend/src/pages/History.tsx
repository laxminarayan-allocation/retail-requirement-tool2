/**
 * Calculation History — Phase 8
 *
 * Persistent audit trail of every calculation run stored in SQLite.
 * Features: filterable table, expandable run detail, side-by-side comparison,
 * re-run shortcut, Excel export.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import http from '@/api/http'

async function apiFetch<T>(url: string, params?: Record<string, string>): Promise<T> {
  const res = await http.get<{ success: boolean; data: T; message: string | null }>(url, { params })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepLog { step: number; name: string; status: string; rows: number | null; message: string | null }

interface HistoryRun {
  run_id: string
  label: string | null
  status: string
  factor_set_id: string | null
  factor_set_name: string | null
  attribute1: string | null
  season: string | null
  division: string | null
  department: string | null
  include_transit: number
  include_pack_pending: number
  include_transfer_out: number
  started_at: string | null
  completed_at: string | null
  duration_s: number | null
  total_rows: number
  stores: number
  departments_count: number
  total_req: number
  total_pbs: number
  fill_rate_achieved: number
  zero_req_rows: number
  capped_rows: number
  exception_errors: number
  exception_warnings: number
  exception_infos: number
  error_msg: string | null
  result_rows: number
  steps: StepLog[]
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 14, height: 'calc(100vh - 100px)', minHeight: 0 },
  card: { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' },
  cardHead: { padding: '10px 14px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  btn: { background: '#0ea5e9', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnSm: { background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  btnDanger: { background: 'transparent', border: '1px solid #ef4444', borderRadius: 5, color: '#f87171', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  btnCmp: { background: '#7c3aed22', border: '1px solid #7c3aed', borderRadius: 5, color: '#a78bfa', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  input: { background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '5px 10px' },
  select: { background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '5px 10px' },
  tblWrap: { overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 },
  tbl: { borderCollapse: 'collapse' as const, width: '100%', minWidth: 900, fontSize: 12 },
  th: { background: 'var(--content-bg)', color: 'var(--text-muted)', fontWeight: 600, padding: '7px 12px', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, borderBottom: '1px solid var(--card-border)', fontSize: 10, letterSpacing: 0.4 },
  td: { padding: '7px 12px', color: 'var(--text-secondary)', borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' as const },
  tdNum: { padding: '7px 12px', color: '#7dd3fc', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  tdGreen: { padding: '7px 12px', color: '#4ade80', borderBottom: '1px solid #1e293b', textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  empty: { padding: 40, textAlign: 'center' as const, color: 'var(--text-muted)', fontSize: 13 },
  // Detail expand
  detail: { background: 'var(--content-bg)', borderBottom: '1px solid var(--card-border)', padding: '14px 16px' },
  kpiRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 12 },
  kpi: { background: 'var(--card-bg)', borderRadius: 6, padding: '8px 12px', minWidth: 100 },
  kpiVal: { fontSize: 18, fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' as const },
  kpiLabel: { fontSize: 10, color: 'var(--text-muted)', marginTop: 2 },
  // Compare modal
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, width: 900, maxWidth: '96vw', maxHeight: '85vh', overflowY: 'auto' as const, overflowX: 'auto' as const, padding: 20 },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(s: string) {
  return s === 'complete' ? '#4ade80' : s === 'error' ? '#f87171' : '#fbbf24'
}
function statusBg(s: string) {
  return s === 'complete' ? '#14532d' : s === 'error' ? '#450a0a' : '#1c1917'
}
function statusBorder(s: string) {
  return s === 'complete' ? '#16a34a' : s === 'error' ? '#ef4444' : '#78716c'
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
function fmtNum(n: number | null | undefined, dec = 0) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: dec })
}
function pct(n: number) { return `${(n * 100).toFixed(1)}%` }

// ── Step list mini ─────────────────────────────────────────────────────────────
function MiniSteps({ steps }: { steps: StepLog[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 4, marginTop: 8 }}>
      {steps.map(s => (
        <div key={s.step} style={{ fontSize: 10, color: s.status === 'ok' ? '#4ade80' : s.status === 'error' ? '#f87171' : '#94a3b8', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>{s.status === 'ok' ? '✓' : '✗'} {s.step}.</span>
          <span>
            {s.name}
            {s.message && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>— {s.message}</span>}
            {s.rows != null && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({s.rows.toLocaleString()} rows)</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Exception badges ──────────────────────────────────────────────────────────
function ExcBadges({ run }: { run: HistoryRun }) {
  return (
    <div style={{ display: 'flex', gap: 5 }}>
      {run.exception_errors > 0 && (
        <span style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 10, padding: '1px 7px', color: '#f87171', fontSize: 10, fontWeight: 700 }}>{run.exception_errors}E</span>
      )}
      {run.exception_warnings > 0 && (
        <span style={{ background: '#1c1400', border: '1px solid #d97706', borderRadius: 10, padding: '1px 7px', color: '#fbbf24', fontSize: 10, fontWeight: 700 }}>{run.exception_warnings}W</span>
      )}
      {run.exception_infos > 0 && (
        <span style={{ background: '#0c1a2e', border: '1px solid #3b82f6', borderRadius: 10, padding: '1px 7px', color: '#60a5fa', fontSize: 10, fontWeight: 700 }}>{run.exception_infos}I</span>
      )}
      {run.exception_errors === 0 && run.exception_warnings === 0 && run.exception_infos === 0 && run.status === 'complete' && (
        <span style={{ color: '#4ade80', fontSize: 10 }}>✓</span>
      )}
    </div>
  )
}

// ── Expanded detail row ────────────────────────────────────────────────────────
function ExpandedDetail({ run, onDelete }: { run: HistoryRun; onDelete: () => void }) {
  return (
    <td colSpan={99} style={S.detail}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
        {/* KPIs */}
        <div style={{ flex: 2, minWidth: 280 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, letterSpacing: 0.4 }}>SUMMARY METRICS</div>
          <div style={S.kpiRow}>
            {[
              { label: 'Total REQ', val: fmtNum(run.total_req) },
              { label: 'Stores', val: fmtNum(run.stores) },
              { label: 'Departments', val: fmtNum(run.departments_count) },
              { label: 'Rows', val: fmtNum(run.total_rows) },
              { label: 'Fill Rate', val: pct(run.fill_rate_achieved) },
              { label: 'Zero REQ', val: fmtNum(run.zero_req_rows) },
              { label: 'Capped', val: fmtNum(run.capped_rows) },
              { label: 'Total PBS', val: fmtNum(run.total_pbs) },
            ].map(k => (
              <div key={k.label} style={S.kpi}>
                <div style={S.kpiVal}>{k.val}</div>
                <div style={S.kpiLabel}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Request params */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6, marginTop: 4, letterSpacing: 0.4 }}>RUN PARAMETERS</div>
          <div style={{ display: 'flex', gap: 20, fontSize: 11, color: 'var(--text-secondary)', flexWrap: 'wrap' as const }}>
            {[
              ['Factor Set', run.factor_set_name],
              ['Attribute1', run.attribute1],
              ['Division', run.division || 'All'],
              ['Department', run.department || 'All'],
              ['Transit', run.include_transit ? '✓' : '✗'],
              ['Pack Pending', run.include_pack_pending ? '✓' : '✗'],
              ['Transfer Out', run.include_transfer_out ? '✓' : '✗'],
            ].map(([k, v]) => (
              <span key={k as string}><span style={{ color: 'var(--text-muted)' }}>{k}: </span>{v || '—'}</span>
            ))}
          </div>

          {run.error_msg && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6, fontSize: 11, color: '#f87171' }}>
              <strong>Error:</strong> {run.error_msg}
            </div>
          )}
        </div>

        {/* Steps */}
        <div style={{ flex: 3, minWidth: 320 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8, letterSpacing: 0.4 }}>PIPELINE STEPS</div>
          <MiniSteps steps={run.steps} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
        <button style={S.btnDanger} onClick={() => {
          if (confirm('Delete this run from history?')) onDelete()
        }}>Delete from history</button>
      </div>
    </td>
  )
}

// ── Compare modal ─────────────────────────────────────────────────────────────
function CompareModal({ runs, onClose }: { runs: [HistoryRun, HistoryRun]; onClose: () => void }) {
  const [a, b] = runs
  const rows: Array<{ label: string; aVal: string; bVal: string; better?: 'a' | 'b' | 'equal' }> = [
    { label: 'Status', aVal: a.status, bVal: b.status },
    { label: 'Factor Set', aVal: a.factor_set_name ?? '—', bVal: b.factor_set_name ?? '—' },
    { label: 'Attribute1', aVal: a.attribute1 ?? '—', bVal: b.attribute1 ?? '—' },
    { label: 'Division', aVal: a.division || 'All', bVal: b.division || 'All' },
    { label: 'Completed', aVal: fmtDate(a.completed_at), bVal: fmtDate(b.completed_at) },
    { label: 'Duration (s)', aVal: fmtNum(a.duration_s, 2), bVal: fmtNum(b.duration_s, 2), better: (a.duration_s ?? 999) <= (b.duration_s ?? 999) ? 'a' : 'b' },
    { label: 'Total REQ', aVal: fmtNum(a.total_req), bVal: fmtNum(b.total_req), better: a.total_req >= b.total_req ? 'a' : 'b' },
    { label: 'Total PBS', aVal: fmtNum(a.total_pbs), bVal: fmtNum(b.total_pbs) },
    { label: 'Fill Rate', aVal: pct(a.fill_rate_achieved), bVal: pct(b.fill_rate_achieved), better: a.fill_rate_achieved >= b.fill_rate_achieved ? 'a' : 'b' },
    { label: 'Stores', aVal: fmtNum(a.stores), bVal: fmtNum(b.stores) },
    { label: 'Rows', aVal: fmtNum(a.total_rows), bVal: fmtNum(b.total_rows) },
    { label: 'Zero REQ Rows', aVal: fmtNum(a.zero_req_rows), bVal: fmtNum(b.zero_req_rows), better: a.zero_req_rows <= b.zero_req_rows ? 'a' : 'b' },
    { label: 'Capped Rows', aVal: fmtNum(a.capped_rows), bVal: fmtNum(b.capped_rows), better: a.capped_rows <= b.capped_rows ? 'a' : 'b' },
    { label: 'Exceptions (E/W/I)', aVal: `${a.exception_errors}/${a.exception_warnings}/${a.exception_infos}`, bVal: `${b.exception_errors}/${b.exception_warnings}/${b.exception_infos}`, better: (a.exception_errors + a.exception_warnings) <= (b.exception_errors + b.exception_warnings) ? 'a' : 'b' },
  ]

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Run Comparison</span>
          <button style={S.btnSm} onClick={onClose}>✕ Close</button>
        </div>

        <table style={{ ...S.tbl, marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 150 }}>METRIC</th>
              <th style={S.th}>{a.label || a.run_id.slice(0, 8)}</th>
              <th style={S.th}>{b.label || b.run_id.slice(0, 8)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label}>
                <td style={{ ...S.td, color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>{row.label}</td>
                <td style={{ ...S.td, fontWeight: row.better === 'a' ? 700 : 400, color: row.better === 'a' ? '#4ade80' : '#cbd5e1' }}>
                  {row.aVal}{row.better === 'a' && ' ▲'}
                </td>
                <td style={{ ...S.td, fontWeight: row.better === 'b' ? 700 : 400, color: row.better === 'b' ? '#4ade80' : '#cbd5e1' }}>
                  {row.bVal}{row.better === 'b' && ' ▲'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function History() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<HistoryRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [attr1Filter, setAttr1Filter] = useState('')
  const [fsFilter, setFsFilter] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  // UI state
  const [expanded, setExpanded] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  function startResizeCol(col: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX; const startW = colWidths[col] ?? 100
    function onMove(me: MouseEvent) { setColWidths(p => ({ ...p, [col]: Math.max(40, startW + me.clientX - startX) })) }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  const load = useCallback(async (off = 0) => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { limit: String(limit), offset: String(off) }
      if (statusFilter) params.status = statusFilter
      if (attr1Filter) params.attribute1 = attr1Filter
      if (fsFilter) params.factor_set_name = fsFilter
      const d = await apiFetch<{ runs: HistoryRun[]; total: number }>('/calculation/history', params)
      setRuns(d.runs)
      setTotal(d.total)
      setOffset(off)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally { setLoading(false) }
  }, [statusFilter, attr1Filter, fsFilter])

  useEffect(() => { load(0) }, [load])

  function toggleExpand(id: string) {
    setExpanded(expanded === id ? null : id)
  }

  function toggleCompare(id: string) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  async function deleteRun(runId: string) {
    await http.delete(`/calculation/history/${runId}`)
    setRuns(prev => prev.filter(r => r.run_id !== runId))
    setTotal(t => t - 1)
  }

  function openComparison() {
    if (compareIds.length === 2) setShowCompare(true)
  }

  const compareRuns = compareIds.length === 2
    ? [runs.find(r => r.run_id === compareIds[0])!, runs.find(r => r.run_id === compareIds[1])!].filter(Boolean)
    : []

  function reRun(run: HistoryRun) {
    // Pass run config as URL search params for the Calculation page to pick up
    const params = new URLSearchParams()
    if (run.factor_set_id) params.set('factor_set_id', run.factor_set_id)
    if (run.attribute1) params.set('attribute1', run.attribute1)
    if (run.division) params.set('division', run.division)
    if (run.department) params.set('department', run.department)
    navigate(`/calculation?${params.toString()}`)
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Calculation History</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Persistent audit trail of every calculation run · {total.toLocaleString()} total
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <select style={S.select} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); load(0) }}>
          <option value="">All statuses</option>
          <option value="complete">Complete</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
        </select>
        <input style={S.input} placeholder="Attribute1…" value={attr1Filter}
          onChange={e => setAttr1Filter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(0)} />
        <input style={S.input} placeholder="Factor set name…" value={fsFilter}
          onChange={e => setFsFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(0)} />
        <button style={S.btn} onClick={() => load(0)}>Search</button>
        <button style={S.btnSm} onClick={() => load(0)}>↻ Refresh</button>
        <button style={{ ...S.btnSm, marginLeft: 'auto' }}
          onClick={() => window.open('/api/calculation/history/export/excel', '_blank')}>
          Export all ↓
        </button>
        {compareIds.length === 2 && (
          <button style={S.btnCmp} onClick={openComparison}>⚖ Compare selected</button>
        )}
        {compareIds.length > 0 && (
          <button style={S.btnSm} onClick={() => setCompareIds([])}>Clear selection</button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ ...S.card, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {compareIds.length > 0 && (
          <div style={{ padding: '6px 14px', background: '#1c0f3a', borderBottom: '1px solid #7c3aed', fontSize: 11, color: '#a78bfa' }}>
            ⚖ Comparing: {compareIds.length}/2 runs selected. {compareIds.length < 2 ? 'Select one more to compare.' : 'Click "Compare selected" to view.'}
          </div>
        )}

        {loading && <div style={S.empty}>Loading history…</div>}
        {!loading && runs.length === 0 && (
          <div style={S.empty}>No runs found. Runs are saved to history after completion.</div>
        )}

        {!loading && runs.length > 0 && (
          <>
            <div style={S.tblWrap}>
              <table style={S.tbl}>
                <thead>
                  <tr>
                    {(['CMP','LABEL','STATUS','FACTOR SET','ATTR1','DIV / DEPT','STARTED','DUR (s)','TOTAL REQ','STORES','FILL %','EXCEPTIONS','ACTIONS'] as const).map(col => (
                      <th key={col} style={{ ...S.th, position: 'relative', width: colWidths[col], textAlign: ['TOTAL REQ','STORES','FILL %'].includes(col) ? 'right' as const : 'left' as const }}>
                        {col}
                        <span onMouseDown={e => startResizeCol(col, e)} onClick={e => e.stopPropagation()}
                          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent', borderRight: '2px solid transparent' }}
                          onMouseEnter={e => (e.currentTarget.style.borderRightColor = '#334155')}
                          onMouseLeave={e => (e.currentTarget.style.borderRightColor = 'transparent')} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <>
                      <tr
                        key={run.run_id}
                        onClick={() => toggleExpand(run.run_id)}
                        style={{
                          cursor: 'pointer',
                          background: expanded === run.run_id ? '#0f172a' : compareIds.includes(run.run_id) ? '#1c0f3a' : 'transparent',
                          borderLeft: compareIds.includes(run.run_id) ? '3px solid #7c3aed' : '3px solid transparent',
                        }}
                      >
                        {/* Compare checkbox */}
                        <td style={{ ...S.td, width: 32 }} onClick={e => { e.stopPropagation(); toggleCompare(run.run_id) }}>
                          <input type="checkbox" checked={compareIds.includes(run.run_id)} readOnly style={{ cursor: 'pointer' }} />
                        </td>

                        {/* Label */}
                        <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {run.label || <span style={{ color: 'var(--text-muted)' }}>{run.run_id.slice(0, 8)}…</span>}
                        </td>

                        {/* Status badge */}
                        <td style={S.td}>
                          <span style={{
                            background: statusBg(run.status), border: `1px solid ${statusBorder(run.status)}`,
                            borderRadius: 10, padding: '1px 8px', fontSize: 10, fontWeight: 700, color: statusColor(run.status),
                          }}>
                            {run.status.toUpperCase()}
                          </span>
                        </td>

                        <td style={{ ...S.td, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{run.factor_set_name || '—'}</td>
                        <td style={S.td}>{run.attribute1 || '—'}</td>
                        <td style={{ ...S.td, color: 'var(--text-muted)', fontSize: 11 }}>
                          {[run.division, run.department].filter(Boolean).join(' › ') || 'All'}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(run.started_at)}</td>
                        <td style={S.tdNum}>{run.duration_s != null ? run.duration_s.toFixed(1) : '—'}</td>
                        <td style={S.tdGreen}>{run.status === 'complete' ? fmtNum(run.total_req) : '—'}</td>
                        <td style={S.tdNum}>{run.status === 'complete' ? fmtNum(run.stores) : '—'}</td>
                        <td style={S.tdNum}>{run.status === 'complete' ? pct(run.fill_rate_achieved) : '—'}</td>
                        <td style={S.td}><ExcBadges run={run} /></td>

                        {/* Actions */}
                        <td style={{ ...S.td, whiteSpace: 'nowrap' as const }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={S.btnSm} onClick={() => reRun(run)} title="Pre-fill Calculation form">Re-run</button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail */}
                      {expanded === run.run_id && (
                        <tr key={`${run.run_id}-detail`}>
                          <ExpandedDetail run={run} onDelete={() => { deleteRun(run.run_id); setExpanded(null) }} />
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
              <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()} runs</span>
              <button style={S.btnSm} disabled={offset === 0} onClick={() => load(Math.max(0, offset - limit))}>← Prev</button>
              <button style={S.btnSm} disabled={offset + limit >= total} onClick={() => load(offset + limit)}>Next →</button>
            </div>
          </>
        )}
      </div>

      {/* Compare modal */}
      {showCompare && compareRuns.length === 2 && (
        <CompareModal runs={compareRuns as [HistoryRun, HistoryRun]} onClose={() => setShowCompare(false)} />
      )}
    </div>
  )
}
