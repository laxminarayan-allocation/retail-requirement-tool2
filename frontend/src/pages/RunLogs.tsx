import { useState, useEffect, useCallback } from 'react'

// ── types ─────────────────────────────────────────────────────────────────────

interface RunRecord {
  ts: string
  job_id: string
  module: string
  source?: string
}

interface ParamChange {
  when: string
  run: number
  changes: { key: string; old: string; new: string }[]
}

type Tab = 'param_changes' | 'runs' | 'timeline'

// ── helpers ───────────────────────────────────────────────────────────────────

const API = (path: string) => `/api${path}`

async function apiFetch(path: string) {
  const token = localStorage.getItem('ck_ss27_token') ?? ''
  const r = await fetch(API(path), { headers: { Authorization: `Bearer ${token}` } })
  return r.json()
}

function fmtTs(ts: string): { date: string; time: string } {
  if (!ts) return { date: '—', time: '' }
  const d = ts.replace('T', ' ')
  const [date, time] = d.split(' ')
  const short = date?.replace(/^\d{4}-/, '') ?? date
  return { date: short, time: time ?? '' }
}

// ── diff cell ─────────────────────────────────────────────────────────────────

function DiffCell({ old: o, n }: { old: string; n: string }) {
  const same = o === n
  if (same) return <span style={{ color: 'var(--text-muted, #94a3b8)' }}>{o}</span>
  const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '…' : s
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{
        textDecoration: 'line-through', color: '#ef4444',
        fontFamily: 'monospace', fontSize: 11,
      }}>{truncate(o)}</span>
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <span style={{
        color: '#22c55e', fontFamily: 'monospace', fontSize: 11,
      }}>{truncate(n)}</span>
    </span>
  )
}

// ── Param Changes tab ─────────────────────────────────────────────────────────

function ParamChangesTab() {
  const [rows, setRows] = useState<ParamChange[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch('/pipeline/logs/param-changes')
      .then(r => { if (r.ok) setRows(r.data.rows) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div style={emptyStyle}>Loading…</div>
  if (rows.length === 0) return (
    <div style={emptyStyle}>
      No parameter changes recorded yet.<br />
      <span style={{ fontSize: 12, opacity: 0.7 }}>Changes are logged when you save config in All Parameters.</span>
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-card, #1e1e2e)' }}>
            {['WHEN', '#', 'CHANGES'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const { date, time } = fmtTs(row.when)
            return row.changes.map((ch, ci) => (
              <tr key={`${ri}-${ci}`} style={{ borderBottom: '1px solid var(--border, #222)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                {ci === 0 && (
                  <td rowSpan={row.changes.length} style={{ ...tdStyle, color: 'var(--text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: 8 }}>
                    <div style={{ fontSize: 11 }}>{date.replace('-', '/')}</div>
                    <div style={{ fontSize: 11 }}>{time}</div>
                  </td>
                )}
                {ci === 0 && (
                  <td rowSpan={row.changes.length} style={{ ...tdStyle, fontWeight: 700, color: 'var(--text-muted)', verticalAlign: 'top', paddingTop: 8 }}>
                    {row.run}
                  </td>
                )}
                <td style={{ ...tdStyle, maxWidth: 800 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text, #e2e8f0)', marginRight: 8 }}>
                    {ch.key}
                  </span>
                  <DiffCell old={ch.old} n={ch.new} />
                </td>
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Runs tab ──────────────────────────────────────────────────────────────────

function RunsTab() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/pipeline/logs/runs')
      .then(r => { if (r.ok) setRows(r.data.rows) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={emptyStyle}>Loading…</div>
  if (rows.length === 0) return <div style={emptyStyle}>No pipeline runs recorded yet.<br/><span style={{fontSize:12,opacity:0.7}}>Backend restart karo aur ek module run karo.</span></div>

  function statusColor(s: string) {
    if (s === 'finished') return '#22c55e'
    if (s === 'error') return '#ef4444'
    if (s === 'running') return '#f59e0b'
    return 'var(--text-muted)'
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--bg-card, #1e1e2e)' }}>
            {['WHEN', 'MODULE', 'STATUS', 'JOB ID', 'SOURCE'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { date, time } = fmtTs(row.ts)
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border, #222)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <td style={{ ...tdStyle, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <div>{date.replace('-', '/')}</div>
                  <div>{time}</div>
                </td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>Module {row.module}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: statusColor(row.status ?? '') }}>
                  {row.status === 'finished' ? '✓ Done' : row.status === 'error' ? '✕ Error' : row.status === 'running' ? '⏳ Running' : '—'}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>{row.job_id}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.source || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function TimelineTab() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/pipeline/logs/timeline')
      .then(r => { if (r.ok) setItems(r.data.rows) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={emptyStyle}>Loading…</div>
  if (items.length === 0) return <div style={emptyStyle}>No activity recorded yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0.5rem 0' }}>
      {items.map((item, i) => {
        const ts = item.ts ?? item.when ?? ''
        const { date, time } = fmtTs(ts)
        const isRun = item._type === 'run'
        return (
          <div key={i} style={{
            display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
            padding: '0.5rem 0.75rem', borderRadius: 6,
            borderLeft: `3px solid ${isRun ? '#6366f1' : '#f59e0b'}`,
            background: 'var(--bg, #111827)',
          }}>
            <div style={{ width: 70, flexShrink: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              <div>{date}</div><div>{time}</div>
            </div>
            <div style={{ fontSize: 12 }}>
              {isRun ? (
                <span style={{ color: '#6366f1', fontWeight: 600 }}>▶ Module {item.module} run</span>
              ) : (
                <>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>✎ Config save</span>
                  {(item.changes ?? []).map((ch: any, ci: number) => (
                    <div key={ci} style={{ marginTop: 2 }}>
                      <span style={{ color: 'var(--text)' }}>{ch.key} </span>
                      <DiffCell old={ch.old} n={ch.new} />
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── shared styles ─────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '7px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: 'var(--text-muted, #94a3b8)', borderBottom: '2px solid var(--border, #333)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px', color: 'var(--text, #e2e8f0)',
}

const emptyStyle: React.CSSProperties = {
  padding: '2.5rem', textAlign: 'center',
  color: 'var(--text-muted, #94a3b8)', fontSize: 14, lineHeight: 1.8,
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function RunLogs() {
  const [tab, setTab] = useState<Tab>('param_changes')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'timeline',      label: 'Timeline' },
    { key: 'runs',          label: 'Runs' },
    { key: 'param_changes', label: 'Parameter changes' },
  ]

  function refresh() {
    // force remount active tab by toggling — simplest approach
    const cur = tab
    setTab('timeline')
    setTimeout(() => setTab(cur), 10)
  }

  return (
    <div style={{ padding: '1.25rem', height: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #e2e8f0)' }}>
            📋 Run &amp; Parameter Logs
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
            Every pipeline run and config save is recorded in append-only JSONL files in{' '}
            <code style={{ fontSize: 11, background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3 }}>
              output/logs/
            </code>. Newest first.
          </p>
        </div>
        <button onClick={refresh} style={{
          padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 13,
        }}>
          ↻ Refresh
        </button>
      </div>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border, #333)' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 16px', fontSize: 13, cursor: 'pointer',
              background: 'none', border: 'none', outline: 'none',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              color: tab === t.key ? '#6366f1' : 'var(--text-muted, #94a3b8)',
              fontWeight: tab === t.key ? 600 : 400,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* content */}
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border, #333)', borderRadius: 8, background: 'var(--bg, #111827)' }}>
        {tab === 'param_changes' && <ParamChangesTab />}
        {tab === 'runs'          && <RunsTab />}
        {tab === 'timeline'      && <TimelineTab />}
      </div>

    </div>
  )
}
