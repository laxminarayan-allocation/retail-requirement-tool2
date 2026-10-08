import { useState, useEffect, useRef, useCallback } from 'react'

interface GitInfo {
  sha: string
  branch: string
  last_commit: string
  remote_sha: string
  behind: boolean
}

interface DeployState {
  running: boolean
  last_started: string | null
  last_finished: string | null
  last_status: 'ok' | 'error' | null
  last_summary: string
  steps: string[]
  git: GitInfo
}

interface HistoryRow {
  ts: string
  status: 'ok' | 'error'
  summary: string
  build_frontend: boolean
  changed_files?: string[]
  before_sha?: string
  after_sha?: string
}

const token = () => localStorage.getItem('ck_ss27_token') ?? ''
const authH = () => ({ Authorization: `Bearer ${token()}` })
const API = (p: string) => `/api${p}`

function fmtTs(ts: string | null): string {
  if (!ts) return '—'
  return ts.replace('T', ' ')
}

type PageTab = 'deploy' | 'history'

export default function DeployAgent() {
  const [state, setState]           = useState<DeployState | null>(null)
  const [log, setLog]               = useState<string[]>([])
  const [logVisible, setLogVisible] = useState(false)
  const [buildMobile, setBuildMobile] = useState(false)
  const [history, setHistory]       = useState<HistoryRow[]>([])
  const [tab, setTab]               = useState<PageTab>('deploy')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logRef  = useRef<HTMLDivElement>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(API('/deploy/status'), { headers: authH() })
      const j = await r.json()
      if (j.ok) setState(j.data)
    } catch { /* ignore */ }
  }, [])

  const fetchLog = useCallback(async () => {
    try {
      const r = await fetch(API('/deploy/log?lines=200'), { headers: authH() })
      const j = await r.json()
      if (j.ok) setLog(j.data.lines)
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(API('/deploy/history'), { headers: authH() })
      const j = await r.json()
      if (j.ok) setHistory(j.data.rows)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchLog()
    fetchHistory()
    pollRef.current = setInterval(() => {
      fetchStatus()
      if (logVisible) fetchLog()
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchStatus, fetchLog, logVisible])

  useEffect(() => {
    if (tab === 'history') fetchHistory()
  }, [tab, fetchHistory])

  // auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, logVisible])

  async function triggerDeploy() {
    try {
      const url = buildMobile ? API('/deploy/run?build_frontend=true') : API('/deploy/run')
      await fetch(url, { method: 'POST', headers: authH() })
      setTimeout(fetchStatus, 500)
      setTimeout(fetchLog, 1000)
    } catch { /* ignore */ }
  }

  const running = state?.running ?? false
  const behind  = state?.git?.behind ?? false
  const status  = state?.last_status

  function statusColor() {
    if (running) return '#f59e0b'
    if (status === 'ok') return '#22c55e'
    if (status === 'error') return '#ef4444'
    return 'var(--text-muted, #94a3b8)'
  }

  function statusIcon() {
    if (running) return '⏳'
    if (status === 'ok') return '✓'
    if (status === 'error') return '✕'
    return '●'
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: active ? 700 : 500,
    cursor: 'pointer', border: 'none',
    background: active ? 'var(--accent, #6366f1)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted, #94a3b8)',
    transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '1.25rem', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* header + tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text, #e2e8f0)' }}>
            🚀 Deploy Agent
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
            Git pull → detect changes → pip install / npm install → restart backend / HMR frontend
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card, #1e1e2e)', borderRadius: 8, padding: 4, border: '1px solid var(--border, #333)' }}>
          <button style={tabStyle(tab === 'deploy')} onClick={() => setTab('deploy')}>🚀 Deploy</button>
          <button style={tabStyle(tab === 'history')} onClick={() => setTab('history')}>📋 History</button>
        </div>
      </div>

      {tab === 'deploy' && <>

        {/* git card */}
        {state?.git && (
          <div style={{
            border: '1px solid var(--border, #333)', borderRadius: 10,
            background: 'var(--bg-card, #1e1e2e)', padding: '0.875rem 1rem',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text, #e2e8f0)' }}>
                📦 {state.git.branch}
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
                  {state.git.sha}
                </span>
              </div>
              {behind ? (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                  background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44',
                }}>⬇ Updates available</span>
              ) : (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                  background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44',
                }}>✓ Up to date</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {state.git.last_commit}
            </div>
          </div>
        )}

        {/* last deploy result */}
        {state?.last_summary && (
          <div style={{
            border: `1px solid ${statusColor()}44`,
            borderLeft: `4px solid ${statusColor()}`,
            borderRadius: 8, background: 'var(--bg, #111827)',
            padding: '0.75rem 1rem',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{statusIcon()}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: statusColor() }}>
                {running ? 'Deploying…' : status === 'ok' ? 'Deploy successful' : status === 'error' ? 'Deploy failed' : 'Last deploy'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {state.last_summary}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 12 }}>
                {state.last_started && <span>Started: {fmtTs(state.last_started)}</span>}
                {state.last_finished && <span>Finished: {fmtTs(state.last_finished)}</span>}
              </div>
            </div>
          </div>
        )}

        {/* live steps */}
        {(running || (state?.steps?.length ?? 0) > 0) && (
          <div style={{
            background: '#0a0a0f', border: '1px solid var(--border, #333)',
            borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: 12,
            color: '#a3e635', maxHeight: 220, overflowY: 'auto',
          }}>
            {state?.steps?.map((s, i) => (
              <div key={i} style={{ lineHeight: 1.7 }}>{s}</div>
            ))}
            {running && <div style={{ color: '#f59e0b' }}>▸ running…</div>}
          </div>
        )}

        {/* mobile build toggle */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '8px 12px', borderRadius: 8,
          background: buildMobile ? '#6366f122' : 'var(--bg-card, #1e1e2e)',
          border: `1px solid ${buildMobile ? '#6366f1' : 'var(--border, #333)'}`,
          transition: 'all 0.15s',
        }}>
          <input
            type="checkbox"
            checked={buildMobile}
            onChange={e => setBuildMobile(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #e2e8f0)' }}>
              📱 Build for mobile (Tailscale)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              Runs <code style={{ background: '#ffffff11', padding: '1px 5px', borderRadius: 3 }}>npx vite build</code> after pull — updates the mobile link automatically
            </div>
          </div>
        </label>

        {/* action buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={triggerDeploy}
            disabled={running}
            style={{
              padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700,
              cursor: running ? 'not-allowed' : 'pointer',
              background: running ? 'var(--text-muted, #555)' : (behind ? '#6366f1' : '#22c55e'),
              color: '#fff', border: 'none', opacity: running ? 0.7 : 1,
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {running ? '⏳ Deploying…' : behind ? '⬇ Pull & Deploy' : '🔄 Pull (check for updates)'}
          </button>

          <button
            onClick={() => { setLogVisible(v => !v); if (!logVisible) fetchLog() }}
            style={{
              padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text)', transition: 'all 0.15s',
            }}
          >
            {logVisible ? '▲ Hide full log' : '▼ Full deploy log'}
          </button>

          <button
            onClick={() => { fetchStatus(); fetchLog() }}
            style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13,
              cursor: 'pointer', background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', transition: 'all 0.15s',
            }}
          >
            ↻
          </button>
        </div>

        {/* full log */}
        {logVisible && (
          <div
            ref={logRef}
            style={{
              background: '#0a0a0f', border: '1px solid var(--border, #333)',
              borderRadius: 8, padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: 11,
              color: '#94a3b8', maxHeight: 400, overflowY: 'auto',
            }}
          >
            {log.length === 0
              ? <div style={{ color: '#555' }}>No log yet — run a deploy first.</div>
              : log.map((l, i) => (
                <div key={i} style={{
                  lineHeight: 1.7,
                  color: l.includes('ERROR') || l.includes('failed') ? '#ef4444'
                       : l.includes('done') || l.includes('ok') || l.includes('✓') ? '#22c55e'
                       : l.includes('→') || l.includes('changed') ? '#f59e0b'
                       : '#94a3b8',
                }}>{l}</div>
              ))}
          </div>
        )}

        {/* info box */}
        <div style={{
          border: '1px solid var(--border, #333)', borderRadius: 8,
          background: 'var(--bg-card, #1e1e2e)', padding: '0.875rem 1rem',
          fontSize: 12, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.8,
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>What this does:</div>
          <div>① <strong>git pull</strong> — fetches latest commits from GitHub</div>
          <div>② <strong>Backend changed?</strong> → touches main.py → uvicorn --reload restarts automatically</div>
          <div>③ <strong>requirements.txt changed?</strong> → pip install automatically</div>
          <div>④ <strong>Frontend changed?</strong> → Vite HMR picks it up (no restart needed)</div>
          <div>⑤ <strong>package.json changed?</strong> → npm install automatically</div>
          <div>⑥ <strong>Mobile build ON?</strong> → npx vite build runs → Tailscale link updated</div>
          <div style={{ marginTop: 8, color: '#6366f1', fontWeight: 600 }}>
            Webhook: POST /api/deploy/webhook — auto-deploy on GitHub push
          </div>
        </div>

      </>}

      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
              {history.length} deploy runs recorded
            </div>
            <button
              onClick={fetchHistory}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)',
              }}
            >↻ Refresh</button>
          </div>

          {history.length === 0 ? (
            <div style={{
              padding: '2rem', textAlign: 'center', color: 'var(--text-muted)',
              border: '1px dashed var(--border, #333)', borderRadius: 8, fontSize: 13,
            }}>
              No deploy history yet — run a deploy first.
            </div>
          ) : history.map((row, i) => {
            const color = row.status === 'ok' ? '#22c55e' : '#ef4444'
            return (
              <div key={i} style={{
                border: `1px solid ${color}33`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 8, background: 'var(--bg-card, #1e1e2e)',
                padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color }}>
                    {row.status === 'ok' ? '✓' : '✕'} {row.summary}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {row.build_frontend && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#6366f122', color: '#6366f1', border: '1px solid #6366f133' }}>
                        📱 mobile build
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {row.ts?.replace('T', ' ') ?? '—'}
                    </span>
                  </div>
                </div>
                {row.before_sha && row.after_sha && row.before_sha !== row.after_sha && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {row.before_sha} → {row.after_sha}
                    {row.changed_files && row.changed_files.length > 0 && (
                      <span style={{ marginLeft: 10 }}>{row.changed_files.slice(0, 3).join(', ')}{row.changed_files.length > 3 ? ` +${row.changed_files.length - 3} more` : ''}</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
