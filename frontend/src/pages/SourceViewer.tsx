import { useEffect, useState } from 'react'
import http from '@/api/http'

interface SourceFile { key: string; path: string }

const FILE_LABELS: Record<string, string> = {
  // Entry points
  start:              'start.py',
  main:               'main.py',
  // Core / Infra
  system:             'system.py',
  parquet_store:      'parquet_store.py',
  store_repository:   'store_repository.py',
  item_repository:    'item_repository.py',
  // Routes — Data
  dashboard:          'dashboard.py',
  nso:                'nso.py',
  sale:               'sale.py',
  req_dashboard:      'req_dashboard.py',
  warehouse_inventory:'warehouse_inventory.py',
  master_data:        'master_data.py',
  results_journey:    'results_journey.py',
  run_logs:           'run_logs.py',
  // Routes — Allocation
  simulation:         'simulation.py',
  distribution:       'distribution.py',
  calculation:        'calculation.py',
  pipeline:           'pipeline.py',
  option_listing:     'option_listing.py',
  factors:            'factors.py',
  prd_swap:           'prd_swap.py',
  // Routes — Infra/Ops
  data_store:         'data_store.py',
  oracle_refresh:     'oracle_refresh.py',
  deploy:             'deploy.py',
  database:           'database.py',
  auth:               'auth.py',
}

// Minimal Python syntax highlighter
function highlight(code: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escape(code)
    // strings (double/single quote)
    .replace(/(&#34;&#34;&#34;[\s\S]*?&#34;&#34;&#34;|&#39;&#39;&#39;[\s\S]*?&#39;&#39;&#39;)/g,
      '<span style="color:#a3e635">$1</span>')
    .replace(/(&#34;[^&#34;\n]*&#34;|&#39;[^&#39;\n]*&#39;)/g,
      '<span style="color:#a3e635">$1</span>')
    // comments
    .replace(/(#[^\n]*)/g, '<span style="color:#6b7280">$1</span>')
    // keywords
    .replace(/\b(def|class|import|from|return|if|else|elif|for|while|try|except|with|as|in|not|and|or|is|None|True|False|async|await|raise|pass|continue|break|lambda|yield|global|nonlocal)\b/g,
      '<span style="color:#818cf8">$1</span>')
    // decorators
    .replace(/(@\w+)/g, '<span style="color:#f59e0b">$1</span>')
    // numbers
    .replace(/\b(\d+)\b/g, '<span style="color:#38bdf8">$1</span>')
}

interface BackupInfo { filename: string; size_kb: number; created_at: string }
interface BackupStatus { last_backup_at: string | null; last_backup_file: string | null; next_backup_at: string | null; backups: BackupInfo[] }

function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function SourceViewer() {
  const [files, setFiles] = useState<SourceFile[]>([])
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState<string>('')
  const [path, setPath] = useState<string>('')
  const [lines, setLines] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Backup state
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backupRunning, setBackupRunning] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [showBackups, setShowBackups] = useState(false)

  const loadBackupStatus = () => {
    http.get('/system/source/backup/status').then(r => {
      if (r.data.success) setBackupStatus(r.data.data)
    }).catch(() => {})
  }

  useEffect(() => { loadBackupStatus() }, [])

  const runBackup = async () => {
    setBackupRunning(true); setBackupMsg(null)
    try {
      await http.post('/system/source/backup/run')
      setBackupMsg('Backup started… refresh in a moment')
      setTimeout(() => { loadBackupStatus(); setBackupMsg(null) }, 4000)
    } catch { setBackupMsg('✗ Backup failed') }
    finally { setBackupRunning(false) }
  }

  const downloadBackup = (filename: string) => {
    const token = localStorage.getItem('ck_ss27_token') ?? ''
    const a = document.createElement('a')
    a.href = `/api/system/source/backup/download?filename=${encodeURIComponent(filename)}`
    // Add auth via fetch + blob since FileResponse needs auth header
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = filename
        link.click(); URL.revokeObjectURL(url)
      })
  }

  useEffect(() => {
    http.get('/system/source/files').then(r => {
      const d = r.data
      if (d.success && d.data?.files) {
        setFiles(d.data.files)
        if (d.data.files.length > 0) setSelected(d.data.files[0].key)
      }
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setContent('')
    http.get(`/system/source/read?file=${selected}`).then(r => {
      const d = r.data
      if (d.success && d.data) {
        setContent(d.data.content)
        setPath(d.data.path)
        setLines(d.data.lines)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [selected])

  const filteredLines = search.trim()
    ? content.split('\n').map((l, i) => ({ n: i + 1, text: l }))
        .filter(l => l.text.toLowerCase().includes(search.toLowerCase()))
    : null

  const copyAll = () => navigator.clipboard.writeText(content)

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', background: 'var(--content-bg)', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 180, flexShrink: 0, background: 'var(--card-bg)', borderRight: '1px solid var(--card-border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '10px 12px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Backend Routes
        </div>
        {files.map(f => (
          <button
            key={f.key}
            onClick={() => { setSelected(f.key); setSearch('') }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '7px 12px', fontSize: 12, fontFamily: 'monospace',
              background: selected === f.key ? '#1e293b' : 'transparent',
              color: selected === f.key ? '#818cf8' : 'var(--text-secondary)',
              border: 'none', borderLeft: selected === f.key ? '3px solid #818cf8' : '3px solid transparent',
              cursor: 'pointer', transition: 'background 0.1s',
            }}
          >
            {FILE_LABELS[f.key] ?? f.key}
          </button>
        ))}
      </div>

      {/* ── Code Panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '8px 16px', background: 'var(--card-bg)', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#818cf8', fontWeight: 600 }}>
            backend/{path}
          </span>
          {lines > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{lines} lines</span>
          )}
          <div style={{ flex: 1 }} />
          <input
            placeholder="Search in file..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--content-bg)', border: '1px solid var(--card-border)',
              borderRadius: 4, padding: '3px 8px', fontSize: 11, color: 'var(--text-primary)',
              width: 180, outline: 'none',
            }}
          />
          <button
            onClick={copyAll}
            style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            Copy
          </button>
          <button
            onClick={() => setShowBackups(v => !v)}
            style={{ fontSize: 11, padding: '3px 10px', background: showBackups ? '#7c3aed22' : 'transparent', border: '1px solid #7c3aed88', borderRadius: 4, color: '#a78bfa', cursor: 'pointer', fontWeight: 600 }}
          >
            🗜 Backups
          </button>
        </div>

        {/* Backup Panel */}
        {showBackups && (
          <div style={{ padding: '10px 16px', background: '#0f172a', borderBottom: '1px solid var(--card-border)', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontWeight: 700, color: '#a78bfa' }}>🗜 Source Backups</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Last: <b style={{ color: 'var(--text-primary)' }}>{fmtDt(backupStatus?.last_backup_at ?? null)}</b>
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                Next (weekly): <b style={{ color: 'var(--text-primary)' }}>{fmtDt(backupStatus?.next_backup_at ?? null)}</b>
              </span>
              <button onClick={runBackup} disabled={backupRunning}
                style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 14px', borderRadius: 6, border: 'none',
                  background: backupRunning ? '#334155' : '#7c3aed', color: '#fff', fontWeight: 700,
                  cursor: backupRunning ? 'not-allowed' : 'pointer' }}>
                {backupRunning ? '...' : '⬇ Backup Now'}
              </button>
            </div>
            {backupMsg && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 6 }}>{backupMsg}</div>}
            {(backupStatus?.backups ?? []).length === 0
              ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No backups yet — click "Backup Now"</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                  {(backupStatus?.backups ?? []).map(b => (
                    <div key={b.filename} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', background: '#1e293b', borderRadius: 6 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-primary)', flex: 1 }}>{b.filename}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{b.size_kb} KB</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtDt(b.created_at)}</span>
                      <button onClick={() => downloadBackup(b.filename)}
                        style={{ fontSize: 10, padding: '2px 10px', borderRadius: 5, border: '1px solid #475569',
                          background: 'transparent', color: '#38bdf8', cursor: 'pointer', fontWeight: 600 }}>
                        ⬇ Download
                      </button>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {/* Code area */}
        <div style={{ flex: 1, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
          {loading && (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Loading...</div>
          )}

          {!loading && filteredLines && (
            <div style={{ padding: '8px 0' }}>
              {filteredLines.length === 0
                ? <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 11 }}>No matches for "{search}"</div>
                : filteredLines.map(l => (
                    <div key={l.n} style={{ display: 'flex', minWidth: 0 }}>
                      <span style={{ width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 16, color: '#374151', userSelect: 'none', fontSize: 11 }}>{l.n}</span>
                      <span
                        style={{ flex: 1, whiteSpace: 'pre', color: 'var(--text-primary)' }}
                        dangerouslySetInnerHTML={{ __html: highlight(l.text) }}
                      />
                    </div>
                  ))
              }
            </div>
          )}

          {!loading && !filteredLines && content && (
            <div style={{ padding: '8px 0' }}>
              {content.split('\n').map((line, i) => (
                <div key={i} style={{ display: 'flex', minWidth: 0 }}>
                  <span style={{ width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 16, color: '#374151', userSelect: 'none', fontSize: 11 }}>{i + 1}</span>
                  <span
                    style={{ flex: 1, whiteSpace: 'pre', color: 'var(--text-primary)' }}
                    dangerouslySetInnerHTML={{ __html: highlight(line) }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
