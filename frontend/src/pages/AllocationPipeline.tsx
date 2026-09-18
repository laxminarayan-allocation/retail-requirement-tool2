import { useState } from 'react'
import { useTheme } from '@/context/ThemeContext'
import { useAuth } from '@/context/AuthContext'

type ModuleStatus = 'idle' | 'running' | 'done' | 'error'
type Source = 'csv' | 'db'
type FilterOp = '=' | '!=' | 'in'

interface ModuleResult {
  rows?: number
  files?: { name: string; download: string; rows?: number }[]
  error?: string
}

interface FilterRow {
  id: number
  column: string
  op: FilterOp
  value: string
}

interface Module {
  id: number
  title: string
  description: string
}

const MODULES: Module[] = [
  { id: 1, title: 'Fetch raw data', description: 'Pulls GRC lines and every master/filter table from the chosen source.' },
  { id: 2, title: 'Build grid + enrich', description: 'Enrich GRC × Item master, cross-join active stores, add lifecycle / article grid / ALLOCATION_OPTION.' },
  { id: 3, title: 'Apply system filters', description: 'CAT6 / MC / CLR / Block filters — annotate Y/N per row, nothing dropped yet.' },
  { id: 4, title: 'Manual filters', description: 'Build exclusion rules using the filter builder below.' },
  { id: 5, title: 'Join requirements', description: 'Attach BAR_REQ, MC_REQ, ARTICLE_REQ, MRP_REQ, OPTION_REQ, SPARKY_REQ, SZ_REQ to each grid row.' },
  { id: 6, title: 'Eligible qty + export', description: 'Compute ELIGIBLE_QTY = min(BAR_REQ, MC_REQ, priority_req), sort, write Excel.' },
  { id: 7, title: 'Sort + export', description: 'Sort by DEPARTMENT → STORE_NAME → ARTICLE_NAME and export final Excel.' },
]

const STEP_LABELS = [
  'Fetch raw data',
  'Build grid',
  'System filters',
  'Manual filters',
  'Join requirements',
  'Eligible qty',
  'Sort + export',
]

const COLUMN_OPTIONS = [
  'STORE_NAME', 'ATTRIBUTE1', 'DIVISION', 'DEPARTMENT', 'ARTICLE_NAME',
  'CAT6', 'MC', 'CLR', 'BLOCK', 'LIFECYCLE', 'ALLOCATION_OPTION',
]

let filterIdSeq = 1

export default function AllocationPipeline() {
  const { tokens: T } = useTheme()
  const { token } = useAuth()

  const [source, setSource] = useState<Source>('csv')
  const [statuses, setStatuses] = useState<Record<number, ModuleStatus>>({
    1: 'idle', 2: 'idle', 3: 'idle', 4: 'idle', 5: 'idle', 6: 'idle', 7: 'idle',
  })
  const [results, setResults] = useState<Record<number, ModuleResult>>({})
  const [stepLogs, setStepLogs] = useState<Record<number, string[]>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState<number | null>(null)

  // Filter builder state
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [newCol, setNewCol] = useState(COLUMN_OPTIONS[0])
  const [newOp, setNewOp] = useState<FilterOp>('=')
  const [newVal, setNewVal] = useState('')

  function setStatus(id: number, s: ModuleStatus) {
    setStatuses(prev => ({ ...prev, [id]: s }))
  }

  function appendLog(id: number, msg: string) {
    setStepLogs(prev => ({ ...prev, [id]: [...(prev[id] || []), msg] }))
  }

  async function runModule(id: number): Promise<boolean> {
    setStatus(id, 'running')
    setStepLogs(prev => ({ ...prev, [id]: [] }))
    setResults(prev => ({ ...prev, [id]: {} }))
    try {
      const res = await fetch(`/api/pipeline/module/${id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(id === 4 ? { source, filters } : { source }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { job_id } = await res.json()
      if (!job_id) throw new Error('No job_id returned')

      // Use fetch+ReadableStream instead of EventSource so we can send the auth header
      const streamResp = await fetch(`/api/pipeline/stream/${job_id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!streamResp.ok || !streamResp.body) throw new Error(`Stream ${streamResp.status}`)

      const reader = streamResp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let lastEventId = -1  // track SSE id: field to deduplicate on reconnect

      return new Promise<boolean>(async (resolve) => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const parts = buf.split('\n\n')
            buf = parts.pop() ?? ''
            for (const block of parts) {
              let evtId: number | null = null
              let dataLine: string | null = null
              for (const line of block.split('\n')) {
                if (line.startsWith('id: ')) evtId = parseInt(line.slice(4), 10)
                if (line.startsWith('data: ')) dataLine = line.slice(6)
              }
              // skip events we've already processed (reconnect replay guard)
              if (evtId !== null && evtId <= lastEventId) continue
              if (evtId !== null) lastEventId = evtId
              if (!dataLine) continue
              try {
                const evt = JSON.parse(dataLine)
                if (evt.event === 'start') continue
                if (evt.step) appendLog(id, `Step ${evt.step}: ${evt.name ?? ''}${evt.detail ? ' — ' + evt.detail : ''}`)
                if (evt.status === 'finished') {
                  setResults(prev => ({ ...prev, [id]: { rows: evt.files?.[0]?.rows, files: evt.files } }))
                  setStatus(id, 'done')
                  resolve(true)
                  return
                }
                if (evt.status === 'error') {
                  setResults(prev => ({ ...prev, [id]: { error: evt.message || 'Module failed' } }))
                  setStatus(id, 'error')
                  resolve(false)
                  return
                }
              } catch { /* skip malformed lines */ }
            }
          }
          resolve(true)
        } catch {
          setStatus(id, 'error')
          resolve(false)
        }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setResults(prev => ({ ...prev, [id]: { error: msg } }))
      setStatus(id, 'error')
      return false
    }
  }

  async function runAll() {
    setRunningAll(true)
    for (const m of MODULES) {
      const ok = await runModule(m.id)
      if (!ok) break
    }
    setRunningAll(false)
  }

  function addFilter() {
    if (!newVal.trim()) return
    setFilters(prev => [...prev, { id: filterIdSeq++, column: newCol, op: newOp, value: newVal.trim() }])
    setNewVal('')
  }

  function removeFilter(id: number) {
    setFilters(prev => prev.filter(f => f.id !== id))
  }

  // Step circle color helpers
  function circleColor(s: ModuleStatus) {
    if (s === 'done') return T.success
    if (s === 'running') return T.accent
    if (s === 'error') return T.danger
    return T.textMuted
  }
  function circleBg(s: ModuleStatus) {
    if (s === 'done') return `${T.success}22`
    if (s === 'running') return `${T.accent}22`
    if (s === 'error') return `${T.danger}22`
    return `${T.textMuted}18`
  }
  function statusLabel(s: ModuleStatus) {
    if (s === 'done') return 'Done'
    if (s === 'running') return 'Running...'
    if (s === 'error') return 'Error'
    return 'Not run'
  }

  const pillBase: React.CSSProperties = {
    padding: '5px 14px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    border: `1px solid ${T.cardBorder}`,
    transition: 'all 0.15s',
  }

  return (
    <div style={{ padding: '24px 28px', minHeight: '100vh', background: T.contentBg, color: T.textPrimary }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: T.textPrimary }}>Create allocation</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: T.textMuted, letterSpacing: '0.02em' }}>
            GRC extract → Grid → System filters → Manual filters → Requirements → Eligible qty → Excel
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Source toggle */}
          <div style={{ display: 'flex', background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 22, overflow: 'hidden' }}>
            {(['csv', 'db'] as Source[]).map(s => (
              <button
                key={s}
                onClick={() => setSource(s)}
                style={{
                  ...pillBase,
                  border: 'none',
                  borderRadius: 0,
                  background: source === s ? T.accent : 'transparent',
                  color: source === s ? '#fff' : T.textSecondary,
                  fontWeight: source === s ? 600 : 400,
                }}
              >
                {s === 'csv' ? 'Sample CSVs' : 'Oracle DB'}
              </button>
            ))}
          </div>

          {/* Run all */}
          <button
            onClick={runAll}
            disabled={runningAll}
            style={{
              ...pillBase,
              background: runningAll ? T.textMuted : T.accent,
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: runningAll ? 0.7 : 1,
              cursor: runningAll ? 'not-allowed' : 'pointer',
            }}
          >
            <span>▶</span> {runningAll ? 'Running…' : 'Run all modules'}
          </button>
        </div>
      </div>

      {/* ── Progress strip ── */}
      <div style={{
        background: T.cardBg,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 12,
        padding: '20px 24px',
        marginBottom: 24,
        overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 640 }}>
          {STEP_LABELS.map((label, i) => {
            const id = i + 1
            const s = statuses[id]
            return (
              <div key={id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {/* Connector line left */}
                {i > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 18,
                    right: '50%',
                    left: '-50%',
                    height: 2,
                    background: statuses[i] === 'done' ? T.success : T.cardBorder,
                    zIndex: 0,
                  }} />
                )}
                {/* Circle */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: circleBg(s),
                  border: `2px solid ${circleColor(s)}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  color: circleColor(s),
                  position: 'relative',
                  zIndex: 1,
                  transition: 'all 0.3s',
                }}>
                  {s === 'done' ? '✓' : s === 'error' ? '✕' : id}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: T.textSecondary, textAlign: 'center', lineHeight: 1.3 }}>{label}</div>
                <div style={{ fontSize: 10, color: circleColor(s), marginTop: 2 }}>{statusLabel(s)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Module cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MODULES.map(m => {
          const s = statuses[m.id]
          return (
            <div key={m.id}>
              <div style={{
                background: T.cardBg,
                border: `1px solid ${s === 'running' ? T.accent : s === 'done' ? T.success : s === 'error' ? T.danger : T.cardBorder}`,
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transition: 'border-color 0.3s',
              }}>
                {/* Number badge */}
                <div style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: T.accentBg,
                  border: `2px solid ${T.accent}`,
                  color: T.accent,
                  fontWeight: 700,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {m.id}
                </div>

                {/* Title + desc */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: T.textPrimary }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{m.description}</div>
                </div>

                {/* Status chip + result info */}
                {s !== 'idle' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: circleColor(s),
                      background: circleBg(s),
                      border: `1px solid ${circleColor(s)}44`,
                      borderRadius: 10,
                      padding: '2px 10px',
                    }}>
                      {statusLabel(s)}
                    </div>
                    {s === 'done' && results[m.id]?.rows != null && (
                      <span style={{ fontSize: 11, color: T.textMuted }}>
                        {results[m.id].rows!.toLocaleString()} rows
                      </span>
                    )}
                    {s === 'error' && results[m.id]?.error && (
                      <span style={{ fontSize: 11, color: T.danger, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {results[m.id].error}
                      </span>
                    )}
                  </div>
                )}

                {/* Configure link */}
                <button
                  onClick={() => setDrawerOpen(drawerOpen === m.id ? null : m.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: T.accent,
                    fontSize: 12,
                    cursor: 'pointer',
                    fontWeight: 500,
                    flexShrink: 0,
                    padding: '4px 8px',
                  }}
                >
                  Configure →
                </button>

                {/* Run module button */}
                <button
                  onClick={() => runModule(m.id)}
                  disabled={s === 'running'}
                  style={{
                    padding: '6px 16px',
                    borderRadius: 8,
                    border: `1px solid ${T.accent}`,
                    background: s === 'done' ? `${T.success}18` : T.accentBg,
                    color: s === 'done' ? T.success : T.accent,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: s === 'running' ? 'not-allowed' : 'pointer',
                    opacity: s === 'running' ? 0.6 : 1,
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {s === 'running' ? '⏳ Running' : 'Run module'}
                </button>
              </div>

              {/* Step logs */}
              {(stepLogs[m.id]?.length > 0 || results[m.id]?.files?.length) && (
                <div style={{
                  background: T.inputBg,
                  border: `1px solid ${T.cardBorder}`,
                  borderTop: 'none',
                  padding: '10px 18px',
                  fontSize: 11,
                  color: T.textMuted,
                  fontFamily: 'monospace',
                }}>
                  {stepLogs[m.id]?.map((l, i) => (
                    <div key={i} style={{ lineHeight: 1.6 }}>▸ {l}</div>
                  ))}
                  {results[m.id]?.files?.map((f, i) => (
                    <a
                      key={i}
                      href={`http://10.0.1.12:8642${f.download}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'block', color: T.accent, marginTop: 4, textDecoration: 'none', fontWeight: 600 }}
                    >
                      ⬇ {f.name}{f.rows != null ? ` (${f.rows.toLocaleString()} rows)` : ''}
                    </a>
                  ))}
                </div>
              )}

              {/* Configure drawer (simple inline panel) */}
              {drawerOpen === m.id && m.id !== 4 && (
                <div style={{
                  background: T.inputBg,
                  border: `1px solid ${T.cardBorder}`,
                  borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  padding: '14px 18px',
                  fontSize: 13,
                  color: T.textSecondary,
                }}>
                  <strong style={{ color: T.textPrimary }}>Module {m.id} — {m.title}</strong>
                  <p style={{ margin: '6px 0 0', color: T.textMuted, fontSize: 12 }}>
                    No additional configuration required. Module will run with defaults for source: <code style={{ color: T.accent }}>{source}</code>.
                  </p>
                </div>
              )}

              {/* Module 4 filter builder */}
              {m.id === 4 && (
                <div style={{
                  background: T.inputBg,
                  border: `1px solid ${T.cardBorder}`,
                  borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  padding: '16px 18px',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: T.textPrimary, marginBottom: 12 }}>
                    Manual filter builder
                  </div>

                  {/* Add row */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                    <select
                      value={newCol}
                      onChange={e => setNewCol(e.target.value)}
                      style={{
                        background: T.cardBg,
                        border: `1px solid ${T.inputBorder}`,
                        color: T.inputColor,
                        borderRadius: 6,
                        padding: '5px 8px',
                        fontSize: 12,
                      }}
                    >
                      {COLUMN_OPTIONS.map(c => <option key={c}>{c}</option>)}
                    </select>

                    <select
                      value={newOp}
                      onChange={e => setNewOp(e.target.value as FilterOp)}
                      style={{
                        background: T.cardBg,
                        border: `1px solid ${T.inputBorder}`,
                        color: T.inputColor,
                        borderRadius: 6,
                        padding: '5px 8px',
                        fontSize: 12,
                        width: 64,
                      }}
                    >
                      {(['=', '!=', 'in'] as FilterOp[]).map(op => <option key={op}>{op}</option>)}
                    </select>

                    <input
                      value={newVal}
                      onChange={e => setNewVal(e.target.value)}
                      placeholder={newOp === 'in' ? 'A,B,C' : 'value'}
                      onKeyDown={e => { if (e.key === 'Enter') addFilter() }}
                      style={{
                        background: T.cardBg,
                        border: `1px solid ${T.inputBorder}`,
                        color: T.inputColor,
                        borderRadius: 6,
                        padding: '5px 10px',
                        fontSize: 12,
                        minWidth: 140,
                      }}
                    />

                    <button
                      onClick={addFilter}
                      style={{
                        background: T.accentBg,
                        border: `1px solid ${T.accent}`,
                        color: T.accent,
                        borderRadius: 6,
                        padding: '5px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      + Add
                    </button>

                    {filters.length > 0 && (
                      <button
                        onClick={() => setFilters([])}
                        style={{
                          background: 'none',
                          border: `1px solid ${T.danger}55`,
                          color: T.danger,
                          borderRadius: 6,
                          padding: '5px 12px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  {/* Active filter chips */}
                  {filters.length === 0 ? (
                    <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>No filters active. Add a scope row above.</p>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {filters.map(f => (
                        <div
                          key={f.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: T.cardBg,
                            border: `1px solid ${T.cardBorder}`,
                            borderRadius: 16,
                            padding: '4px 10px',
                            fontSize: 12,
                            color: T.textSecondary,
                          }}
                        >
                          <span style={{ color: T.accent, fontWeight: 600 }}>{f.column}</span>
                          <span style={{ color: T.textMuted }}>{f.op}</span>
                          <span style={{ color: T.textPrimary }}>{f.value}</span>
                          <button
                            onClick={() => removeFilter(f.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: T.textMuted,
                              cursor: 'pointer',
                              fontSize: 13,
                              lineHeight: 1,
                              padding: 0,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
