import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/context/ThemeContext'
import { useDbRefresh } from '@/context/DbRefreshContext'

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
  const { setDataStoreRunning } = useDbRefresh()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [allRunning, setAllRunning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Scheduler state
  const [schedTime, setSchedTime] = useState<string | null>(null)
  const [schedEdit, setSchedEdit] = useState(false)
  const [schedInput, setSchedInput] = useState('')
  const [schedSaving, setSchedSaving] = useState(false)
  const [schedMsg, setSchedMsg] = useState<string | null>(null)

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
    // Load scheduler time
    fetch('/api/database/output/schedule', { headers: authHdr() })
      .then(r => r.json()).then(d => { if (d.success) setSchedTime(d.data.time) })
      .catch(() => {})
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  async function saveSchedule() {
    if (!/^\d{2}:\d{2}$/.test(schedInput)) { setSchedMsg('HH:MM format mein daalo (e.g. 06:30)'); return }
    setSchedSaving(true); setSchedMsg(null)
    try {
      const r = await fetch('/api/database/output/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify({ time: schedInput }) })
      const d = await r.json()
      if (d.success) { setSchedTime(d.data.time); setSchedEdit(false); setSchedMsg(null) }
      else setSchedMsg(d.message ?? 'Save failed')
    } catch { setSchedMsg('Save failed') }
    finally { setSchedSaving(false) }
  }

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

  useEffect(() => { setDataStoreRunning(runningCount > 0) }, [runningCount, setDataStoreRunning])

  const statusIcon  = (s: Source) => {
    if (s.download_status === 'running') return { icon: '⟳', color: '#f59e0b' }
    if (s.file_status === 'fresh')   return { icon: '✅', color: '#22c55e' }
    if (s.file_status === 'stale')   return { icon: '⚠️', color: '#f59e0b' }
    return { icon: '❌', color: '#ef4444' }
  }

  // Show migration banner if all (or almost all) sources are missing — likely after storage path change
  const showMigrationBanner = !loading && missingCount > 0 && missingCount >= sources.length - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* Migration notice — shown when storage path changed and files need re-download */}
      {showMigrationBanner && (
        <div style={{
          background: '#7c3aed18', borderBottom: '2px solid #7c3aed55',
          padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: 13 }}>System Update: Storage path changed — </span>
            <span style={{ color: '#7c3aed', fontSize: 13 }}>
              Files have moved to a new location. Click <b>Download All</b> once to restore all sources.
            </span>
          </div>
          <button onClick={downloadAll} disabled={runningCount > 0}
            style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#7c3aed',
              color: '#fff', fontWeight: 700, fontSize: 12, cursor: runningCount > 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {runningCount > 0 ? '⟳ Downloading…' : '⬇ Download All Now'}
          </button>
        </div>
      )}

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

        {/* Scheduler config */}
        <div style={{ marginTop: 20, background: T.cardBg, border: `1px solid ${T.cardBorder}`,
          borderRadius: 10, padding: '14px 18px', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}>⏰</span>
            <span style={{ fontWeight: 700, color: T.textPrimary }}>Auto-Refresh Scheduler</span>
            <span style={{ color: T.textMuted, fontSize: 11 }}>Daily IST</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {!schedEdit ? (
                <>
                  <span style={{ fontWeight: 800, fontSize: 20, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
                    {schedTime ?? '—'}
                  </span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>IST</span>
                  <button onClick={() => { setSchedInput(schedTime ?? '06:30'); setSchedEdit(true); setSchedMsg(null) }}
                    style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                      background: 'transparent', color: T.accent, cursor: 'pointer', fontWeight: 600 }}>
                    ✎ Change
                  </button>
                </>
              ) : (
                <>
                  <input value={schedInput} onChange={e => setSchedInput(e.target.value)}
                    placeholder="HH:MM" maxLength={5}
                    style={{ width: 72, padding: '4px 8px', borderRadius: 6, border: `1px solid ${T.accent}`,
                      background: '#0f172a', color: T.textPrimary, fontSize: 14, fontWeight: 700,
                      textAlign: 'center', outline: 'none' }} />
                  <button onClick={saveSchedule} disabled={schedSaving}
                    style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: 'none',
                      background: '#16a34a', color: '#fff', cursor: schedSaving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                    {schedSaving ? '...' : 'Save'}
                  </button>
                  <button onClick={() => { setSchedEdit(false); setSchedMsg(null) }}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                      background: 'transparent', color: T.textMuted, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
          {schedMsg && <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>{schedMsg}</div>}
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
            Har roz is time pe sab sources automatic refresh honge. Data Store mein "daily" wale sources refresh honge.
          </div>
        </div>

        {/* Architecture note */}
        <div style={{ marginTop: 12, background: T.cardBg, border: `1px solid ${T.cardBorder}`,
          borderRadius: 10, padding: '14px 18px', fontSize: 12, color: T.textSecondary, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, color: T.textPrimary, marginBottom: 6 }}>📐 How it works</div>
          <div>All data is <strong>T−1</strong> (yesterday's Oracle data). Scheduler downloads daily → saves as compressed Parquet files → Reports read from local cache.</div>
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
