import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/context/ThemeContext'

interface Source {
  key: string
  label: string
  table: string
  schedule: string
  file_status: 'fresh' | 'stale' | 'missing'
  download_status: 'running' | 'done' | 'failed' | null
  downloaded_at: string | null
  rows: number | null
  size_mb: number
  error: string | null
}

function authHdr() {
  return { Authorization: `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` }
}

function fmtRows(n: number | null) {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtAgo(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffH = (now.getTime() - d.getTime()) / 3_600_000
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`
  if (diffH < 24) return `${Math.round(diffH)}h ago`
  return `${Math.round(diffH / 24)}d ago`
}

export default function DataStore() {
  const { tokens: T } = useTheme()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [allRunning, setAllRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus() {
    try {
      const r = await fetch('/api/data-store/status', { headers: authHdr() })
      if (!r.ok) return
      setSources(await r.json())
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchStatus()
    intervalRef.current = setInterval(fetchStatus, 3000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  async function downloadOne(key: string) {
    await fetch(`/api/data-store/download/${key}`, { method: 'POST', headers: authHdr() })
    await fetchStatus()
  }

  async function downloadAll() {
    setAllRunning(true)
    await fetch('/api/data-store/download-all', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: '{}' })
    await fetchStatus()
    setTimeout(() => setAllRunning(false), 2000)
  }

  const freshCount  = sources.filter(s => s.file_status === 'fresh').length
  const staleCount  = sources.filter(s => s.file_status === 'stale').length
  const missingCount = sources.filter(s => s.file_status === 'missing').length
  const runningCount = sources.filter(s => s.download_status === 'running').length

  const statusIcon  = (s: Source) => {
    if (s.download_status === 'running') return { icon: '⟳', color: '#f59e0b' }
    if (s.file_status === 'fresh')   return { icon: '✅', color: '#22c55e' }
    if (s.file_status === 'stale')   return { icon: '⚠️', color: '#f59e0b' }
    return { icon: '❌', color: '#ef4444' }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: `1px solid ${T.cardBorder}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, marginBottom: 2 }}>
              🗄️ Data Store
            </div>
            <div style={{ fontSize: 13, color: T.textMuted }}>
              Oracle → Parquet local cache · Reports read from here, not live Oracle
            </div>
          </div>
          <button onClick={downloadAll} disabled={allRunning || runningCount > 0}
            style={{ padding: '10px 22px', borderRadius: 8, border: 'none',
              background: allRunning || runningCount > 0 ? T.cardBg : T.accent,
              color: allRunning || runningCount > 0 ? T.textMuted : '#fff',
              fontWeight: 700, fontSize: 13, cursor: allRunning || runningCount > 0 ? 'not-allowed' : 'pointer' }}>
            {runningCount > 0 ? `⟳ ${runningCount} downloading…` : '⬇ Download All'}
          </button>
        </div>

        {/* Summary pills */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            { label: `${freshCount} Fresh`, color: '#22c55e', bg: '#22c55e18' },
            { label: `${staleCount} Stale`,  color: '#f59e0b', bg: '#f59e0b18' },
            { label: `${missingCount} Missing`, color: '#ef4444', bg: '#ef444418' },
            { label: `${sources.length} Total`, color: T.textMuted, bg: T.cardBg },
          ].map(p => (
            <div key={p.label} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              color: p.color, background: p.bg, border: `1px solid ${p.color}44` }}>
              {p.label}
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        {loading ? (
          <div style={{ color: T.textMuted, padding: 24, textAlign: 'center' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map(s => {
              const { icon, color } = statusIcon(s)
              const isRunning = s.download_status === 'running'
              return (
                <div key={s.key} style={{ background: T.cardBg, border: `1px solid ${
                  s.file_status === 'fresh' ? '#22c55e33'
                  : s.file_status === 'stale' ? '#f59e0b33'
                  : '#ef444433'
                }`, borderRadius: 10, padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

                  {/* Status icon */}
                  <span style={{ fontSize: 20, flexShrink: 0,
                    animation: isRunning ? 'spin 1s linear infinite' : 'none' }}>{icon}</span>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: T.textMuted, fontFamily: 'monospace', marginTop: 2 }}>
                      {s.table}
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Last Download</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary, fontFamily: 'monospace' }}>
                        {fmtAgo(s.downloaded_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Rows</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>{fmtRows(s.rows)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Size</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>
                        {s.size_mb > 0 ? `${s.size_mb} MB` : '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Schedule</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>{s.schedule}</div>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    color, background: `${color}18`, border: `1px solid ${color}44`, flexShrink: 0 }}>
                    {isRunning ? 'downloading…' : s.file_status}
                  </div>

                  {/* Error */}
                  {s.error && (
                    <div style={{ width: '100%', fontSize: 11, color: '#ef4444', fontFamily: 'monospace',
                      background: '#ef444411', borderRadius: 4, padding: '4px 8px', marginTop: 4 }}>
                      {s.error}
                    </div>
                  )}

                  {/* Action button */}
                  <button onClick={() => downloadOne(s.key)} disabled={isRunning}
                    style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${T.cardBorder}`,
                      background: isRunning ? T.cardBg : T.accentBg, color: isRunning ? T.textMuted : T.accent,
                      fontWeight: 700, fontSize: 12, cursor: isRunning ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                    {isRunning ? '⟳' : '⬇ Refresh'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Architecture note */}
        <div style={{ marginTop: 20, background: T.cardBg, border: `1px solid ${T.cardBorder}`,
          borderRadius: 10, padding: '14px 18px', fontSize: 12, color: T.textSecondary, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: T.textPrimary, marginBottom: 6 }}>📐 How it works</div>
          <div>All data is <strong>T−1</strong> (yesterday's Oracle data). Scheduler downloads at 9 AM IST daily → saves as compressed Parquet files → Reports read from local cache.</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: '#22c55e', fontWeight: 700 }}>Fresh</span> = downloaded within 26h &nbsp;·&nbsp;
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>Stale</span> = older &nbsp;·&nbsp;
            <span style={{ color: '#ef4444', fontWeight: 700 }}>Missing</span> = never downloaded
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
