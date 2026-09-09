import { useEffect, useRef, useState, useCallback } from 'react'
import http from '@/api/http'
import { useTheme } from '@/context/ThemeContext'
import { useOracleRefresh } from '@/context/OracleRefreshContext'

type Tab = 'refresh' | 'audit' | 'health' | 'log' | 'scheduler'

interface FileInfo { name: string; path: string; size: number; modified: string }
interface AuditEntry { job_id: string; started_at: string; finished_at: string | null; refreshed: number; failed: number; files: string[]; status: string }
interface HealthResult { status: string; error?: string; sysdate?: string; path?: string; accessible?: boolean }

function fmtSize(b: number) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB'
  if (b >= 1024)    return (b / 1024).toFixed(0) + ' KB'
  return b + ' B'
}
function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60)   return diff + 's ago'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  return Math.floor(diff / 3600) + 'h ago'
}

export default function OracleRefreshPage() {
  const { tokens } = useTheme()
  const { job, isRunning, startRefresh, clearJob } = useOracleRefresh()
  const logEndRef = useRef<HTMLDivElement>(null)

  const [tab, setTab]               = useState<Tab>('refresh')
  const [folder, setFolder]           = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [recentFolders, setRecentFolders] = useState<string[]>([])
  const [files, setFiles]           = useState<FileInfo[]>([])
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [audit, setAudit]           = useState<AuditEntry[]>([])
  const [health, setHealth]         = useState<Record<string, HealthResult> | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [schedEnabled, setSchedEnabled] = useState(false)
  const [schedCron, setSchedCron]       = useState('0 8 * * 1-6')
  const [schedFolder, setSchedFolder]   = useState('')
  const [schedSaving, setSchedSaving]   = useState(false)
  const [sortKey, setSortKey]       = useState<'size' | 'modified' | 'name'>('size')
  const [sortAsc, setSortAsc]       = useState(true)

  // Load config on mount
  useEffect(() => {
    http.get<{ success: boolean; data: any }>('/oracle-refresh/config').then(r => {
      const d = r.data.data
      if (d.folder) { setFolder(d.folder); setFolderInput(d.folder) }
      if (d.recent_folders) setRecentFolders(d.recent_folders ?? [])
      if (d.schedule) {
        setSchedEnabled(d.schedule.enabled ?? false)
        setSchedCron(d.schedule.cron ?? '0 8 * * 1-6')
        setSchedFolder(d.schedule.folder ?? '')
      }
    }).catch(() => {})
  }, [])

  // Auto-scroll log
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [job?.log])

  // Load audit when tab opens
  useEffect(() => {
    if (tab === 'audit')
      http.get<{ success: boolean; data: AuditEntry[] }>('/oracle-refresh/audit')
        .then(r => setAudit(r.data.data ?? [])).catch(() => {})
  }, [tab])

  const applyFolder = useCallback(async () => {
    const f = folderInput.trim()
    if (!f) return
    setFolder(f)
    setLoadingFiles(true)
    setSelected(new Set())
    try {
      await http.post('/oracle-refresh/config', { folder: f })
      setRecentFolders(prev => {
        const next = [f, ...prev.filter(x => x !== f)].slice(0, 5)
        return next
      })
      const r = await http.get<{ success: boolean; data: FileInfo[] }>(`/oracle-refresh/folder-files?path=${encodeURIComponent(f)}`)
      setFiles(r.data.data ?? [])
    } catch { setFiles([]) }
    finally { setLoadingFiles(false) }
  }, [folderInput])

  const toggleSelect = (path: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })

  const selectAll  = () => setSelected(new Set(files.map(f => f.path)))
  const selectNone = () => setSelected(new Set())

  const handleRun = async () => {
    const sel = selected.size > 0 ? Array.from(selected) : files.map(f => f.path)
    if (!sel.length) return
    await http.post('/oracle-refresh/config', { files: sel })
    startRefresh(sel)
  }

  const doHealthCheck = async () => {
    setHealthLoading(true); setHealth(null)
    try { const r = await http.get<{ success: boolean; data: any }>('/oracle-refresh/health'); setHealth(r.data.data) }
    catch { setHealth({ error: { status: 'error', error: 'Request failed' } }) }
    finally { setHealthLoading(false) }
  }

  const saveSchedule = async () => {
    setSchedSaving(true)
    try { await http.post('/oracle-refresh/schedule', { enabled: schedEnabled, cron: schedCron, folder: schedFolder }) }
    finally { setSchedSaving(false) }
  }

  // Sorted files
  const sortedFiles = [...files].sort((a, b) => {
    let v = 0
    if (sortKey === 'size')     v = a.size - b.size
    if (sortKey === 'name')     v = a.name.localeCompare(b.name)
    if (sortKey === 'modified') v = a.modified.localeCompare(b.modified)
    return sortAsc ? v : -v
  })

  const T = tokens
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    borderRadius: '6px 6px 0 0',
    background: active ? T.accent : T.cardBg,
    color: active ? '#fff' : T.textMuted,
    borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
  })

  const pill = (color: string, bg: string, label: string) => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bg, color }}>{label}</span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.textPrimary }}>🔄 Oracle ODBC Refresh</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
            {folder || '\\\\server\\share\\folder — set folder in Refresh tab'}
          </div>
        </div>
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            background: T.accentBg, color: T.accent, borderRadius: 20, padding: '4px 12px', fontWeight: 600 }}>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
            Refreshing…
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${T.cardBorder}`, flexShrink: 0, marginBottom: 14 }}>
        {(['refresh','audit','health','log','scheduler'] as Tab[]).map(t => (
          <button key={t} style={tabStyle(tab === t)} onClick={() => setTab(t)}>
            {t === 'refresh' ? '▶ Refresh' : t === 'audit' ? '📋 Audit' : t === 'health' ? '🩺 Health Check' : t === 'log' ? '📄 Log' : '⏰ Scheduler'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 24 }}>

        {/* ── REFRESH ── */}
        {tab === 'refresh' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Folder input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={folderInput} onChange={e => setFolderInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && applyFolder()}
                placeholder="\\\\10.0.0.25\\22-Allocation\\01-Allocation Data\\..."
                style={{ flex: 1, fontSize: 12, padding: '7px 10px', borderRadius: 6,
                  border: `1px solid ${T.cardBorder}`, background: T.bg,
                  color: T.textPrimary, fontFamily: 'monospace', outline: 'none' }} />
              <button onClick={applyFolder} style={{ padding: '7px 16px', borderRadius: 6, border: 'none',
                background: T.accent, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                Apply
              </button>
            </div>

            {/* Recent folders */}
            {recentFolders.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>Recent:</span>
                {recentFolders.map((f, i) => (
                  <button key={i} onClick={() => { setFolderInput(f); setTimeout(() => applyFolder(), 50) }}
                    title={f}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, border: `1px solid ${T.cardBorder}`,
                      background: f === folder ? T.accentBg : T.cardBg,
                      color: f === folder ? T.accent : T.textSecondary,
                      cursor: 'pointer', maxWidth: 220,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    📁 {f.split('\\').filter(Boolean).pop() || f}
                  </button>
                ))}
              </div>
            )}

            {/* File list */}
            {loadingFiles ? (
              <div style={{ color: T.textMuted, fontSize: 12 }}>Loading files…</div>
            ) : files.length > 0 ? (
              <div style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 10, overflow: 'hidden' }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  borderBottom: `1px solid ${T.cardBorder}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.textPrimary }}>
                    Excel Files in Folder
                  </span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>({files.length} files)</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button onClick={selectAll} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                      background: T.cardBg, color: T.textSecondary, cursor: 'pointer', fontSize: 11 }}>
                      ☑ All
                    </button>
                    <button onClick={selectNone} style={{ padding: '4px 12px', borderRadius: 6,
                      border: '1px solid #ef4444', background: 'transparent',
                      color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>
                      ☐ None
                    </button>
                    {/* Sort */}
                    <select value={sortKey} onChange={e => setSortKey(e.target.value as any)}
                      style={{ fontSize: 11, padding: '3px 6px', borderRadius: 5, border: `1px solid ${T.cardBorder}`,
                        background: T.bg, color: T.textSecondary }}>
                      <option value="size">Size</option>
                      <option value="name">Name</option>
                      <option value="modified">Modified</option>
                    </select>
                    <button onClick={() => setSortAsc(a => !a)}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: `1px solid ${T.cardBorder}`,
                        background: T.bg, color: T.textSecondary, cursor: 'pointer' }}>
                      {sortAsc ? '↑ Asc' : '↓ Desc'}
                    </button>
                  </div>
                </div>

                {/* File grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                  {sortedFiles.map(f => {
                    const sel = selected.has(f.path)
                    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
                    const extColor = ext === 'xlsb' ? '#f97316' : ext === 'xlsm' ? '#a855f7' : '#22c55e'
                    return (
                      <div key={f.path} onClick={() => toggleSelect(f.path)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                          borderBottom: `1px solid ${T.cardBorder}`,
                          background: sel ? T.accentBg : 'transparent', cursor: 'pointer',
                          transition: 'background 0.1s' }}>
                        <input type="checkbox" checked={sel} readOnly
                          style={{ width: 14, height: 14, accentColor: T.accent, flexShrink: 0 }} />
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: extColor, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.name}
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 10, color: T.textMuted }}>{timeAgo(f.modified)}</span>
                            <span style={{ fontSize: 10, color: T.accent, background: T.accentBg,
                              padding: '1px 5px', borderRadius: 6 }}>{fmtSize(f.size)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : folder ? (
              <div style={{ fontSize: 12, color: T.textMuted }}>No Excel files found in this folder.</div>
            ) : null}

            {/* Run button */}
            <button onClick={handleRun} disabled={isRunning || (files.length === 0 && selected.size === 0)}
              style={{ padding: '10px 24px', borderRadius: 8, border: 'none', alignSelf: 'flex-start',
                background: isRunning ? T.cardBorder : T.accent, color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: isRunning ? 'not-allowed' : 'pointer',
                opacity: isRunning ? 0.6 : 1 }}>
              {isRunning ? '⟳ Refreshing…' : `▶ Run Refresh${selected.size > 0 ? ` (${selected.size} selected)` : files.length > 0 ? ` (all ${files.length})` : ''}`}
            </button>
          </div>
        )}

        {/* ── AUDIT ── */}
        {tab === 'audit' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, marginBottom: 10 }}>
              Refresh History
            </div>
            {audit.length === 0 ? (
              <div style={{ color: T.textMuted, fontSize: 12 }}>No audit records yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: T.cardBg }}>
                    {['Started', 'Finished', 'Status', 'Files', '✓', '✗'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: T.textMuted,
                        borderBottom: `1px solid ${T.cardBorder}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.cardBorder}` }}>
                      <td style={{ padding: '6px 10px', color: T.textSecondary }}>{a.started_at?.slice(11, 19)}{' '}<span style={{ color: T.textMuted }}>{a.started_at?.slice(0,10)}</span></td>
                      <td style={{ padding: '6px 10px', color: T.textMuted }}>{a.finished_at?.slice(11,19) ?? '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {a.status === 'done'    ? pill('#22c55e', '#052e16', 'Done') :
                         a.status === 'running' ? pill(T.accent, T.accentBg, 'Running') :
                         pill('#ef4444', '#450a0a', 'Error')}
                      </td>
                      <td style={{ padding: '6px 10px', color: T.textMuted }}>{a.files?.length ?? 0}</td>
                      <td style={{ padding: '6px 10px', color: '#22c55e', fontWeight: 700 }}>{a.refreshed ?? 0}</td>
                      <td style={{ padding: '6px 10px', color: '#ef4444', fontWeight: 700 }}>{a.failed ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── HEALTH CHECK ── */}
        {tab === 'health' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button onClick={doHealthCheck} disabled={healthLoading}
              style={{ alignSelf: 'flex-start', padding: '8px 20px', borderRadius: 7, border: 'none',
                background: T.accent, color: '#fff', cursor: healthLoading ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 700 }}>
              {healthLoading ? '⟳ Checking…' : '🩺 Run Health Check'}
            </button>
            {health && Object.entries(health).map(([key, val]) => {
              const ok = val.status === 'ok'
              return (
                <div key={key} style={{ background: T.cardBg, border: `1px solid ${ok ? '#166534' : '#7f1d1d'}`,
                  borderRadius: 8, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 14 }}>{key === 'oracle' ? '🗄️' : key === 'win32com' ? '🪟' : '📁'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, textTransform: 'capitalize' }}>{key}</span>
                    {ok ? pill('#22c55e', '#052e16', '✓ Connected') : pill('#ef4444', '#450a0a', '✗ Error')}
                  </div>
                  {val.sysdate && <div style={{ fontSize: 11, color: T.textMuted }}>SYSDATE: {val.sysdate}</div>}
                  {val.path    && <div style={{ fontSize: 11, color: T.textMuted }}>Path: {val.path}</div>}
                  {val.error   && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, fontFamily: 'monospace' }}>{val.error}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* ── LOG ── */}
        {tab === 'log' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary }}>
                {job ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Job Log
                    {job.status === 'running' ? pill(T.accent, T.accentBg, '⟳ Running') :
                     job.status === 'done'    ? pill('#22c55e', '#052e16', '✓ Done') :
                     pill('#ef4444', '#450a0a', '✗ Error')}
                    <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 400 }}>
                      {job.started_at} {job.finished_at ? `→ ${job.finished_at}` : ''}
                    </span>
                  </span>
                ) : 'No job running'}
              </div>
              {job && !isRunning && (
                <button onClick={clearJob} style={{ background: 'none', border: 'none',
                  cursor: 'pointer', color: T.textMuted, fontSize: 11 }}>Clear</button>
              )}
            </div>
            {job?.error && (
              <div style={{ fontSize: 12, color: '#ef4444', background: '#450a0a',
                borderRadius: 6, padding: '6px 10px', marginBottom: 8, fontFamily: 'monospace' }}>
                {job.error}
              </div>
            )}
            <div style={{ background: '#0d1117', borderRadius: 8, padding: 14,
              fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9',
              minHeight: 200, maxHeight: 500, overflowY: 'auto', lineHeight: 1.8 }}>
              {job?.log?.length ? job.log.map((l, i) => <div key={i}>{l}</div>) :
                <span style={{ color: '#555' }}>No log yet — run a refresh first.</span>}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* ── SCHEDULER ── */}
        {tab === 'scheduler' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
            <div style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textPrimary, marginBottom: 14 }}>
                ⏰ Auto-Refresh Schedule
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={schedEnabled} onChange={e => setSchedEnabled(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: T.accent }} />
                <span style={{ fontSize: 13, color: T.textPrimary, fontWeight: 600 }}>Enable scheduled refresh</span>
              </label>
              {/* Scheduler folder */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
                  Folder to refresh (leave blank to use Refresh tab's selection)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={schedFolder} onChange={e => setSchedFolder(e.target.value)}
                    placeholder="\\10.0.0.25\22-Allocation\..."
                    style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', padding: '6px 10px',
                      borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                      background: T.bg, color: T.textPrimary, outline: 'none' }} />
                  {recentFolders.length > 0 && (
                    <select onChange={e => setSchedFolder(e.target.value)} defaultValue=""
                      style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6,
                        border: `1px solid ${T.cardBorder}`, background: T.bg, color: T.textSecondary }}>
                      <option value="" disabled>Recent…</option>
                      {recentFolders.map((f, i) => (
                        <option key={i} value={f}>{f.split('\\').filter(Boolean).pop() || f}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>
                  Cron expression (min hour * * days)
                </div>
                <input value={schedCron} onChange={e => setSchedCron(e.target.value)}
                  placeholder="0 8 * * 1-6"
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'monospace',
                    padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                    background: T.bg, color: T.textPrimary, outline: 'none' }} />
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>
                Examples: <code style={{ color: T.accent }}>0 8 * * 1-6</code> = Mon–Sat 8:00 AM &nbsp;|&nbsp;
                <code style={{ color: T.accent }}>30 9 * * *</code> = Daily 9:30 AM
              </div>
              <button onClick={saveSchedule} disabled={schedSaving}
                style={{ padding: '8px 20px', borderRadius: 7, border: 'none',
                  background: T.accent, color: '#fff', cursor: schedSaving ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 700 }}>
                {schedSaving ? 'Saving…' : 'Save Schedule'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, background: T.cardBg,
              border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: 12 }}>
              <strong style={{ color: T.textSecondary }}>Note:</strong> Scheduler checks every minute.
              Files configured in the Refresh tab will be used. Server restart clears in-memory job history but schedule config is saved.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
