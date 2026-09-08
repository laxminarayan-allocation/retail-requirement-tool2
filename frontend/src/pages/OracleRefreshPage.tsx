import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useTheme } from '@/context/ThemeContext'
import { useOracleRefresh } from '@/context/OracleRefreshContext'

export default function OracleRefreshPage() {
  const { tokens } = useTheme()
  const { job, isRunning, startRefresh, clearJob } = useOracleRefresh()

  const [files, setFiles] = useState<string[]>([])
  const [newFile, setNewFile] = useState('')
  const [saving, setSaving] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Load saved file config on mount
  useEffect(() => {
    axios.get<{ success: boolean; data: { files: string[] } }>('/api/oracle-refresh/config')
      .then(r => setFiles(r.data.data.files ?? []))
      .catch(() => {})
  }, [])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [job?.log])

  const saveFiles = async (list: string[]) => {
    setSaving(true)
    try {
      await axios.post('/api/oracle-refresh/config', { files: list })
    } finally {
      setSaving(false)
    }
  }

  const addFile = () => {
    const f = newFile.trim()
    if (!f || files.includes(f)) return
    const updated = [...files, f]
    setFiles(updated)
    setNewFile('')
    saveFiles(updated)
  }

  const removeFile = (i: number) => {
    const updated = files.filter((_, idx) => idx !== i)
    setFiles(updated)
    saveFiles(updated)
  }

  const statusColor = {
    idle:    tokens.textMuted,
    running: tokens.accent,
    done:    '#22c55e',
    error:   '#ef4444',
  }

  const s: Record<string, string | number> = {
    card: '',
    input: '',
  }
  void s

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto', paddingBottom: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: tokens.textPrimary }}>🔄 Oracle / Excel Refresh</div>
          <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 2 }}>
            ODBC connection refresh &amp; Pivot Table update — runs in background even if you navigate away
          </div>
        </div>
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            background: tokens.accentBg, color: tokens.accent, borderRadius: 20,
            padding: '4px 12px', fontWeight: 600 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
            Running...
          </div>
        )}
      </div>

      {/* File list */}
      <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
        borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary, marginBottom: 10 }}>
          Excel Files to Refresh
        </div>

        {files.length === 0 && (
          <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 10 }}>
            No files added yet. Add full paths to Excel files below.
          </div>
        )}

        {files.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontSize: 12, color: tokens.textSecondary,
              background: tokens.bg, borderRadius: 6, padding: '5px 10px',
              border: `1px solid ${tokens.cardBorder}`, fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f}
            </div>
            <button onClick={() => removeFile(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: '#ef4444', fontSize: 16, padding: '2px 6px' }}>
              ×
            </button>
          </div>
        ))}

        {/* Add new file */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={newFile}
            onChange={e => setNewFile(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFile()}
            placeholder="C:\path\to\file.xlsx"
            style={{ flex: 1, fontSize: 12, padding: '6px 10px', borderRadius: 6,
              border: `1px solid ${tokens.cardBorder}`, background: tokens.bg,
              color: tokens.textPrimary, fontFamily: 'monospace', outline: 'none' }}
          />
          <button onClick={addFile}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none',
              background: tokens.accent, color: '#fff', cursor: 'pointer',
              fontSize: 12, fontWeight: 600 }}>
            + Add
          </button>
        </div>
        {saving && <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 4 }}>Saving...</div>}
      </div>

      {/* Run button */}
      <button
        onClick={() => startRefresh()}
        disabled={isRunning || files.length === 0}
        style={{
          padding: '10px 24px', borderRadius: 8, border: 'none', cursor: isRunning || files.length === 0 ? 'not-allowed' : 'pointer',
          background: isRunning ? tokens.cardBorder : tokens.accent,
          color: '#fff', fontSize: 14, fontWeight: 700,
          opacity: isRunning || files.length === 0 ? 0.6 : 1,
          alignSelf: 'flex-start',
        }}>
        {isRunning ? '⟳ Refresh Running...' : '▶ Run Refresh'}
      </button>

      {/* Job status + log */}
      {job && (
        <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
          borderRadius: 10, padding: 16, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700,
                color: statusColor[job.status] ?? tokens.textPrimary }}>
                {job.status === 'running' ? '⟳ Running' :
                 job.status === 'done'    ? '✓ Done' :
                 job.status === 'error'   ? '✗ Error' : ''}
              </span>
              <span style={{ fontSize: 11, color: tokens.textMuted }}>
                Started: {job.started_at}
                {job.finished_at ? ` → ${job.finished_at}` : ''}
              </span>
            </div>
            {!isRunning && (
              <button onClick={clearJob}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: tokens.textMuted, fontSize: 11 }}>
                Clear
              </button>
            )}
          </div>

          {job.error && (
            <div style={{ fontSize: 12, color: '#ef4444', background: '#ef444420',
              borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              {job.error}
            </div>
          )}

          <div style={{ background: '#0d1117', borderRadius: 6, padding: 12,
            fontFamily: 'monospace', fontSize: 11, color: '#c9d1d9',
            maxHeight: 320, overflowY: 'auto', lineHeight: 1.6 }}>
            {job.log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
