import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

// ── types ────────────────────────────────────────────────────────────────────

interface ResultRow { [k: string]: string }

interface TraceField {
  label: string
  value: string
  note?: string
  flag?: boolean
}

interface TraceStep {
  step: number
  title: string
  subtitle: string
  fields: TraceField[]
  pass?: string | null
  result?: string | null
}

interface TraceData {
  barcode: string
  store: string
  steps: TraceStep[]
}

// ── helpers ───────────────────────────────────────────────────────────────────

const API = (path: string) => `/api${path}`

async function apiFetch(path: string) {
  const token = localStorage.getItem('ck_ss27_token') ?? ''
  const r = await fetch(API(path), { headers: { Authorization: `Bearer ${token}` } })
  return r.json()
}

// ── step colour ───────────────────────────────────────────────────────────────

function stepColor(step: TraceStep): string {
  if (step.pass === 'N' || step.pass === '0') return 'var(--color-error, #ef4444)'
  if (step.pass === 'Y' || step.pass === '1') return 'var(--color-success, #22c55e)'
  if (step.result !== undefined && step.result !== null) {
    return parseFloat(step.result) > 0 ? 'var(--color-success, #22c55e)' : '#f59e0b'
  }
  return 'var(--color-primary, #6366f1)'
}

// ── Trace Modal ───────────────────────────────────────────────────────────────

function TraceModal({ data, onClose }: { data: TraceData; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-card, #1e1e2e)', borderRadius: 12,
        width: '100%', maxWidth: 700, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        border: '1px solid var(--border, #333)',
      }}>
        {/* header */}
        <div style={{
          padding: '1rem 1.25rem', borderBottom: '1px solid var(--border, #333)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text, #e2e8f0)' }}>
              Calculation Breakdown
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
              {data.barcode} &nbsp;×&nbsp; {data.store}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)',
            fontSize: 20, cursor: 'pointer', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* steps */}
        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {data.steps.map(step => (
            <div key={step.step} style={{
              border: '1px solid var(--border, #333)',
              borderLeft: `4px solid ${stepColor(step)}`,
              borderRadius: 8, padding: '0.75rem 1rem',
              background: 'var(--bg, #111827)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  background: stepColor(step), color: '#fff',
                  borderRadius: 4, width: 22, height: 22, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>{step.step}</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text, #e2e8f0)' }}>{step.title}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', marginBottom: 8 }}>{step.subtitle}</div>
              {step.fields.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {step.fields.map((f, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border, #2a2a3a)' }}>
                        <td style={{ padding: '3px 8px 3px 0', color: 'var(--text-muted, #94a3b8)', whiteSpace: 'nowrap' }}>{f.label}</td>
                        <td style={{
                          padding: '3px 0', fontWeight: 500,
                          color: f.flag
                            ? (f.value === 'Y' || f.value === '1' ? '#22c55e' : f.value === 'N' || f.value === '0' ? '#ef4444' : 'var(--text, #e2e8f0)')
                            : 'var(--text, #e2e8f0)',
                        }}>{f.value}</td>
                        {f.note && <td style={{ padding: '3px 0 3px 8px', color: '#94a3b8', fontStyle: 'italic', fontSize: 11 }}>{f.note}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {step.fields.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', fontStyle: 'italic' }}>No data found in intermediate CSVs</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ResultsJourney() {
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [file, setFile] = useState('final_sorted.csv')
  const [files, setFiles] = useState<{ name: string; rows: string | number; size_mb: number }[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<ResultRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trace, setTrace] = useState<TraceData | null>(null)
  const [traceLoading, setTraceLoading] = useState<string | null>(null)
  const limit = 100
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // load file list
  useEffect(() => {
    apiFetch('/pipeline/results/files').then(r => {
      if (r.ok) setFiles(r.data.files)
    })
  }, [])

  // load rows
  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ file, search, limit: String(limit), offset: String(offset) })
    apiFetch(`/pipeline/results/rows?${params}`)
      .then(r => {
        if (!r.ok) { setError(r.error ?? 'Unknown error'); return }
        setRows(r.data.rows)
        setColumns(r.data.columns)
        setTotal(r.data.total)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [file, search, offset])

  function handleSearch(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(v); setOffset(0) }, 350)
  }

  async function openTrace(row: ResultRow) {
    const barcode = row.BARCODE ?? ''
    const store = row.STORE_NAME ?? ''
    if (!barcode || !store) return
    const key = `${barcode}|${store}`
    setTraceLoading(key)
    try {
      const r = await apiFetch(`/pipeline/results/trace?barcode=${encodeURIComponent(barcode)}&store=${encodeURIComponent(store)}`)
      if (r.ok) setTrace(r.data)
    } finally {
      setTraceLoading(null)
    }
  }

  const pages = Math.ceil(total / limit)
  const page = Math.floor(offset / limit) + 1

  const PASS_COL = columns.includes('PASS') ? 'PASS' : null
  const EQ_COL   = columns.includes('ELIGIBLE_QTY') ? 'ELIGIBLE_QTY' : null

  function cellStyle(col: string, val: string): React.CSSProperties {
    if (col === 'PASS') return { color: val === 'Y' ? '#22c55e' : val === 'N' ? '#ef4444' : 'inherit', fontWeight: 600 }
    if (col === 'ELIGIBLE_QTY') return { color: parseFloat(val) > 0 ? '#22c55e' : '#94a3b8', fontWeight: 600 }
    if (col === 'BLOCKED' || col === 'MANUAL_EXCLUDE') return { color: val === 'Y' ? '#ef4444' : '#22c55e' }
    return {}
  }

  return (
    <div style={{ padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #e2e8f0)' }}>
          📊 Results & Number Journey
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
          Click any row to see step-by-step calculation breakdown
        </span>
      </div>

      {/* controls */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={file}
          onChange={e => { setFile(e.target.value); setOffset(0) }}
          style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 13,
            background: 'var(--bg-card, #1e1e2e)', color: 'var(--text, #e2e8f0)',
            border: '1px solid var(--border, #333)', cursor: 'pointer',
          }}
        >
          {files.length === 0
            ? <option value="final_sorted.csv">final_sorted.csv</option>
            : files.filter(f => f.name.endsWith('.csv')).map(f => (
              <option key={f.name} value={f.name}>{f.name} ({f.rows} rows, {f.size_mb} MB)</option>
            ))
          }
        </select>

        <input
          defaultValue={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search barcode / store / MC…"
          style={{
            padding: '6px 10px', borderRadius: 6, fontSize: 13, flex: 1, minWidth: 200,
            background: 'var(--bg-card, #1e1e2e)', color: 'var(--text, #e2e8f0)',
            border: '1px solid var(--border, #333)', outline: 'none',
          }}
        />

        <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : `${total.toLocaleString()} rows`}
        </span>
      </div>

      {/* error */}
      {error && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 8, background: '#3b1515',
          border: '1px solid #ef4444', color: '#fca5a5', fontSize: 13,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* table */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border, #333)', borderRadius: 8 }}>
        {rows.length === 0 && !loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontSize: 14 }}>
            {error ? '' : 'Run the pipeline first to see results here.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-card, #1e1e2e)', zIndex: 1 }}>
                {columns.map(c => (
                  <th key={c} style={{
                    padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap',
                    borderBottom: '2px solid var(--border, #333)',
                    color: 'var(--text-muted, #94a3b8)', fontWeight: 600, fontSize: 11,
                  }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const key = `${row.BARCODE}|${row.STORE_NAME}`
                const isLoading = traceLoading === key
                return (
                  <tr
                    key={i}
                    onClick={() => openTrace(row)}
                    style={{
                      cursor: 'pointer', transition: 'background 0.1s',
                      background: isLoading ? 'rgba(99,102,241,0.1)' : undefined,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = isLoading ? 'rgba(99,102,241,0.1)' : '')}
                  >
                    {columns.map(col => (
                      <td key={col} style={{
                        padding: '5px 8px', borderBottom: '1px solid var(--border, #222)',
                        whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                        ...cellStyle(col, row[col] ?? ''),
                      }}>
                        {col === 'BARCODE' && isLoading ? '⏳ ' : ''}{row[col] ?? ''}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button
            disabled={page <= 1}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            style={{
              padding: '5px 12px', borderRadius: 6, cursor: page <= 1 ? 'not-allowed' : 'pointer',
              background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)',
              opacity: page <= 1 ? 0.4 : 1, fontSize: 13,
            }}
          >← Prev</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page} / {pages}</span>
          <button
            disabled={page >= pages}
            onClick={() => setOffset(offset + limit)}
            style={{
              padding: '5px 12px', borderRadius: 6, cursor: page >= pages ? 'not-allowed' : 'pointer',
              background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)',
              opacity: page >= pages ? 0.4 : 1, fontSize: 13,
            }}
          >Next →</button>
        </div>
      )}

      {/* trace modal */}
      {trace && <TraceModal data={trace} onClose={() => setTrace(null)} />}
    </div>
  )
}
