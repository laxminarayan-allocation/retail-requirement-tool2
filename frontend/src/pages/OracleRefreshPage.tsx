import { useEffect, useRef, useState, useCallback } from 'react'
import http from '@/api/http'
import { useTheme } from '@/context/ThemeContext'
import { useOracleRefresh } from '@/context/OracleRefreshContext'

type Tab = 'refresh' | 'audit' | 'health' | 'log' | 'scheduler'

interface FileInfo { name: string; path: string; size: number; modified: string }
interface AuditEntry { job_id: string; started_at: string; finished_at: string | null; refreshed: number; failed: number; files: string[]; failed_files?: string[]; status: string }
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
  const { job, isRunning, startRefresh, cancelRefresh, clearJob } = useOracleRefresh()
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
  const [schedSaving, setSchedSaving]   = useState(false)

  interface SchedEntry { id: string; enabled: boolean; cron: string; folder: string }
  const [schedules, setSchedules] = useState<SchedEntry[]>([])
  const [sortKey, setSortKey]       = useState<'size' | 'modified' | 'name'>('size')
  const [sortAsc, setSortAsc]       = useState(true)

  // Load config on mount
  useEffect(() => {
    http.get<{ success: boolean; data: any }>('/oracle-refresh/config').then(r => {
      const d = r.data.data
      if (d.folder) { setFolder(d.folder); setFolderInput(d.folder) }
      if (d.recent_folders) setRecentFolders(d.recent_folders ?? [])
    }).catch(() => {})
    http.get<{ success: boolean; data: any[] }>('/oracle-refresh/schedules').then(r => {
      setSchedules(r.data.data ?? [])
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

  const removeRecentFolder = async (f: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await http.delete(`/oracle-refresh/recent-folder?path=${encodeURIComponent(f)}`)
      setRecentFolders(prev => prev.filter(r => r !== f))
    } catch { setRecentFolders(prev => prev.filter(r => r !== f)) }
  }

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

  const addSchedule = async () => {
    setSchedSaving(true)
    try {
      const r = await http.post<{ success: boolean; data: any }>('/oracle-refresh/schedules',
        { enabled: true, cron: '0 8 * * 1-6', folder: '' })
      setSchedules(prev => [...prev, r.data.data])
    } finally { setSchedSaving(false) }
  }

  const updateSchedule = async (entry: any) => {
    try {
      await http.put(`/oracle-refresh/schedules/${entry.id}`, entry)
      setSchedules(prev => prev.map(s => s.id === entry.id ? entry : s))
    } catch { /* ignore */ }
  }

  const deleteSchedule = async (id: string) => {
    try {
      await http.delete(`/oracle-refresh/schedules/${id}`)
      setSchedules(prev => prev.filter(s => s.id !== id))
    } catch { /* ignore */ }
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
                  <div key={i} style={{ display: 'flex', alignItems: 'center', borderRadius: 12,
                    border: `1px solid ${T.cardBorder}`,
                    background: f === folder ? T.accentBg : T.cardBg }}>
                    <button onClick={() => { setFolderInput(f); setTimeout(() => applyFolder(), 50) }}
                      title={f}
                      style={{ fontSize: 11, padding: '3px 8px 3px 10px', border: 'none', background: 'transparent',
                        color: f === folder ? T.accent : T.textSecondary,
                        cursor: 'pointer', maxWidth: 200,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📁 {f.split('\\').filter(Boolean).pop() || f}
                    </button>
                    <button onClick={e => removeRecentFolder(f, e)} title="Remove"
                      style={{ fontSize: 11, padding: '2px 7px 2px 2px', border: 'none', background: 'transparent',
                        color: T.textMuted, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                  </div>
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

            {/* Run / Stop / Done buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleRun} disabled={isRunning || (files.length === 0 && selected.size === 0)}
                  style={{ padding: '10px 24px', borderRadius: 8, border: 'none',
                    background: isRunning ? T.cardBorder : T.accent, color: '#fff',
                    fontSize: 14, fontWeight: 700, cursor: isRunning ? 'not-allowed' : 'pointer',
                    opacity: isRunning ? 0.6 : 1 }}>
                  {isRunning ? '⟳ Refreshing…' : `▶ Run Refresh${selected.size > 0 ? ` (${selected.size} selected)` : files.length > 0 ? ` (all ${files.length})` : ''}`}
                </button>
                {isRunning && (
                  <button onClick={cancelRefresh}
                    style={{ padding: '10px 20px', borderRadius: 8, border: `2px solid #e53e3e`,
                      background: 'transparent', color: '#e53e3e',
                      fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    ⛔ Stop
                  </button>
                )}
                {job && !isRunning && (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') && (
                  <button onClick={clearJob}
                    style={{ padding: '10px 20px', borderRadius: 8, border: `2px solid #22c55e`,
                      background: 'transparent', color: '#22c55e',
                      fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    ✓ Done
                  </button>
                )}
              </div>
              {/* Current file progress */}
              {isRunning && job?.current_file && (
                <div style={{ fontSize: 12, color: T.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: T.accent }}>▶</span>
                  <span style={{ fontFamily: 'monospace' }}>{job.current_file}</span>
                  {job.total_files > 0 && (
                    <span style={{ color: T.textMuted }}>
                      ({job.done_files}/{job.total_files})
                    </span>
                  )}
                </div>
              )}
            </div>
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
                    <>
                    <tr key={i} style={{ borderBottom: (a.failed > 0 && a.failed_files?.length) ? 'none' : `1px solid ${T.cardBorder}` }}>
                      <td style={{ padding: '6px 10px', color: T.textSecondary }}>{a.started_at?.slice(11, 19)}{' '}<span style={{ color: T.textMuted }}>{a.started_at?.slice(0,10)}</span></td>
                      <td style={{ padding: '6px 10px', color: T.textMuted }}>{a.finished_at?.slice(11,19) ?? '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {a.status === 'done'       ? pill('#22c55e', '#052e16', 'Done') :
                         a.status === 'cancelled'  ? pill('#f59e0b', '#451a03', 'Cancelled') :
                         a.status === 'running'    ? pill(T.accent, T.accentBg, 'Running') :
                         pill('#ef4444', '#450a0a', 'Error')}
                      </td>
                      <td style={{ padding: '6px 10px', color: T.textMuted }}>{a.files?.length ?? 0}</td>
                      <td style={{ padding: '6px 10px', color: '#22c55e', fontWeight: 700 }}>{a.refreshed ?? 0}</td>
                      <td style={{ padding: '6px 10px', color: '#ef4444', fontWeight: 700 }}>{a.failed ?? 0}</td>
                    </tr>
                    {a.failed > 0 && a.failed_files && a.failed_files.length > 0 && (
                      <tr key={`${i}-fail`} style={{ borderBottom: `1px solid ${T.cardBorder}`, background: '#450a0a22' }}>
                        <td colSpan={6} style={{ padding: '4px 10px 8px 30px' }}>
                          <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>✗ Failed files: </span>
                          {a.failed_files.map((f, fi) => (
                            <span key={fi} style={{ fontSize: 11, color: '#fca5a5', marginRight: 8,
                              fontFamily: 'monospace' }}>
                              {f}{fi < a.failed_files!.length - 1 ? ',' : ''}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )}
                    </>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 540 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary }}>⏰ Schedules</span>
              <button onClick={addSchedule} disabled={schedSaving}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none',
                  background: T.accent, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                + Add Schedule
              </button>
            </div>

            {schedules.length === 0 && (
              <div style={{ fontSize: 13, color: T.textMuted, padding: 16, textAlign: 'center',
                background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 10 }}>
                No schedules yet — click "+ Add Schedule" to create one.
              </div>
            )}

            {schedules.map((s, idx) => {
              const cronParts = s.cron.trim().split(/\s+/)
              const cronHuman = cronParts.length === 5
                ? (() => {
                    const [m, h, , , d] = cronParts
                    const hh = h === '*' ? '**' : h.padStart(2,'0')
                    const mm = m === '*' ? '00' : m.padStart(2,'0')
                    const days = d === '*' ? 'Every day' : d === '1-6' ? 'Mon–Sat' : d === '1-5' ? 'Mon–Fri' : `Days: ${d}`
                    return `${hh}:${mm}  •  ${days}`
                  })()
                : s.cron
              const folderName = s.folder ? (s.folder.split('\\').filter(Boolean).pop() || s.folder) : '(Refresh tab files)'

              return (
              <div key={s.id} style={{ background: T.cardBg, border: `2px solid ${s.enabled ? T.accent : T.cardBorder}`,
                borderRadius: 10, overflow: 'hidden' }}>
                {/* Summary header — always visible */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: s.enabled ? T.accentBg : 'transparent' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                    <input type="checkbox" checked={s.enabled}
                      onChange={e => updateSchedule({ ...s, enabled: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: T.accent, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: s.enabled ? T.accent : T.textMuted,
                        letterSpacing: 0.5 }}>
                        ⏰ {cronHuman}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={s.folder}>
                        📁 {folderName}
                      </div>
                    </div>
                  </label>
                  <button onClick={() => deleteSchedule(s.id)}
                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer',
                      fontSize: 20, lineHeight: 1, flexShrink: 0, marginLeft: 10 }}>✕</button>
                </div>

                {/* Edit fields */}
                <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.cardBorder}` }}>
                  {/* Folder */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, fontWeight: 600 }}>📁 Folder path</div>
                    <input value={s.folder}
                      onChange={e => setSchedules(prev => prev.map(x => x.id === s.id ? { ...x, folder: e.target.value } : x))}
                      onBlur={() => updateSchedule(s)}
                      placeholder="\\10.0.0.25\22-Allocation\... (blank = Refresh tab files)"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, fontFamily: 'monospace',
                        padding: '7px 10px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                        background: T.bg, color: T.textPrimary, outline: 'none' }} />
                    {recentFolders.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                        <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>Recent:</span>
                        {recentFolders.map((f, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', borderRadius: 12,
                            border: `1px solid ${T.cardBorder}`,
                            background: f === s.folder ? T.accentBg : T.cardBg }}>
                            <button onClick={() => updateSchedule({ ...s, folder: f })} title={f}
                              style={{ fontSize: 11, padding: '2px 6px 2px 8px', border: 'none', background: 'transparent',
                                color: f === s.folder ? T.accent : T.textSecondary, cursor: 'pointer',
                                maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              📁 {f.split('\\').filter(Boolean).pop() || f}
                            </button>
                            <button onClick={e => removeRecentFolder(f, e)} title="Remove"
                              style={{ fontSize: 10, padding: '2px 6px 2px 2px', border: 'none', background: 'transparent',
                                color: T.textMuted, cursor: 'pointer' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cron */}
                  <div>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4, fontWeight: 600 }}>
                      ⏰ Cron &nbsp;<span style={{ fontWeight: 400 }}>min hour * * days — e.g. <code style={{ color: T.accent }}>30 8 * * 1-6</code> = Mon–Sat 8:30 AM</span>
                    </div>
                    <input value={s.cron}
                      onChange={e => setSchedules(prev => prev.map(x => x.id === s.id ? { ...x, cron: e.target.value } : x))}
                      onBlur={() => updateSchedule(s)}
                      placeholder="0 8 * * 1-6"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 15, fontFamily: 'monospace',
                        fontWeight: 700, padding: '8px 12px', borderRadius: 6, border: `1px solid ${T.cardBorder}`,
                        background: T.bg, color: T.textPrimary, outline: 'none', letterSpacing: 1 }} />
                  </div>
                </div>
              </div>
              )
            })}

            <div style={{ fontSize: 11, color: T.textMuted, background: T.cardBg,
              border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: 10 }}>
              Scheduler checks every minute. Changes save automatically on blur.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
