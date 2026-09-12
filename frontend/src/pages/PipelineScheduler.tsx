import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/context/ThemeContext'

interface LogEntry { ts: string; message: string; level: string }
interface SchedulerStatus {
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  log: LogEntry[]
  config: { enabled: boolean; hour: number; minute: number }
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` }
}

export default function PipelineScheduler() {
  const { tokens: T } = useTheme()
  const [status, setStatus] = useState<SchedulerStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [runNowLoading, setRunNowLoading] = useState(false)
  const [localHour, setLocalHour] = useState(9)
  const [localMinute, setLocalMinute] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)

  async function fetchStatus() {
    try {
      const r = await fetch('/api/option-listing/scheduler/status', { headers: authHeader() })
      if (!r.ok) return
      const d: SchedulerStatus = await r.json()
      setStatus(d)
      if (!saving) {
        setLocalHour(d.config.hour)
        setLocalMinute(d.config.minute)
      }
    } catch {}
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 4000)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [status?.log?.length, autoScroll])

  async function saveConfig(patch: Partial<{ enabled: boolean; hour: number; minute: number }>) {
    setSaving(true)
    try {
      await fetch('/api/option-listing/scheduler/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(patch),
      })
      await fetchStatus()
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    setRunNowLoading(true)
    try {
      await fetch('/api/option-listing/scheduler/run-now', { method: 'POST', headers: authHeader() })
      await fetchStatus()
    } finally {
      setRunNowLoading(false)
    }
  }

  const enabled = status?.config.enabled ?? true
  const lastStatus = status?.last_status
  const statusColor = lastStatus === 'success' ? '#22c55e'
    : lastStatus === 'failed' ? '#ef4444'
    : lastStatus === 'running' ? '#f59e0b'
    : T.textMuted

  const levelColor = (l: string) =>
    l === 'error' ? '#ef4444' : l === 'warn' ? '#f59e0b' : T.textSecondary

  const timeLabel = (() => {
    if (!status) return '—'
    const h = String(status.config.hour).padStart(2, '0')
    const m = String(status.config.minute).padStart(2, '0')
    return `${h}:${m} IST (daily)`
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 24px 12px', borderBottom: `1px solid ${T.cardBorder}`, flexShrink: 0 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.textPrimary, marginBottom: 2 }}>
          ⏰ Pipeline Scheduler
        </div>
        <div style={{ color: T.textMuted, fontSize: 13 }}>
          Daily auto-run of all 9 pipeline steps (MC + 00 → 06) at a fixed IST time
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Config Card ── */}
        <div style={{ background: T.cardBg, border: `2px solid ${enabled ? T.accent : T.cardBorder}`,
          borderRadius: 12, overflow: 'hidden' }}>
          {/* Top bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', background: enabled ? T.accentBg : 'transparent', gap: 12, flexWrap: 'wrap' }}>
            {/* Enable toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
              <input type="checkbox" checked={enabled}
                onChange={e => saveConfig({ enabled: e.target.checked })}
                style={{ width: 18, height: 18, accentColor: T.accent, cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: enabled ? T.accent : T.textMuted, letterSpacing: 0.3 }}>
                  {enabled ? '⏰ Scheduler Enabled' : '⏸ Scheduler Disabled'}
                </div>
                <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>
                  {enabled ? `Next run: ${status?.next_run_at ?? '…'}` : 'Auto-run is paused'}
                </div>
              </div>
            </label>

            {/* Run Now */}
            <button onClick={runNow} disabled={runNowLoading}
              style={{ padding: '9px 20px', borderRadius: 8, border: 'none',
                background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: runNowLoading ? 'wait' : 'pointer', opacity: runNowLoading ? 0.7 : 1, flexShrink: 0 }}>
              {runNowLoading ? '⟳ Triggering…' : '▶ Run Now'}
            </button>
          </div>

          {/* Time picker row */}
          <div style={{ padding: '14px 18px', borderTop: `1px solid ${T.cardBorder}`,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, minWidth: 80 }}>⏱ Run Time</span>

            {/* Hour */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Hour (0–23)</span>
              <input type="number" min={0} max={23} value={localHour}
                onChange={e => { setSaving(true); setLocalHour(Number(e.target.value)) }}
                onBlur={() => saveConfig({ hour: localHour, minute: localMinute })}
                style={{ width: 70, fontSize: 18, fontFamily: 'monospace', fontWeight: 700,
                  padding: '6px 10px', borderRadius: 7, border: `1px solid ${T.cardBorder}`,
                  background: T.bg, color: T.textPrimary, outline: 'none', textAlign: 'center' }} />
            </div>

            <span style={{ fontSize: 22, color: T.textMuted, fontWeight: 700, marginTop: 14 }}>:</span>

            {/* Minute */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Minute (0–59)</span>
              <input type="number" min={0} max={59} value={localMinute}
                onChange={e => { setSaving(true); setLocalMinute(Number(e.target.value)) }}
                onBlur={() => saveConfig({ hour: localHour, minute: localMinute })}
                style={{ width: 70, fontSize: 18, fontFamily: 'monospace', fontWeight: 700,
                  padding: '6px 10px', borderRadius: 7, border: `1px solid ${T.cardBorder}`,
                  background: T.bg, color: T.textPrimary, outline: 'none', textAlign: 'center' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 8 }}>
              <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Configured</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: T.accent, fontFamily: 'monospace' }}>
                {timeLabel}
              </span>
            </div>

            {/* Quick presets */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
              {[['6:00', 6, 0], ['7:00', 7, 0], ['8:00', 8, 0], ['9:00', 9, 0], ['9:30', 9, 30], ['10:00', 10, 0]].map(([label, h, m]) => (
                <button key={label as string}
                  onClick={() => { setLocalHour(h as number); setLocalMinute(m as number); saveConfig({ hour: h as number, minute: m as number }) }}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${T.cardBorder}`,
                    background: status?.config.hour === h && status?.config.minute === m ? T.accentBg : T.cardBg,
                    color: status?.config.hour === h && status?.config.minute === m ? T.accent : T.textSecondary }}>
                  {label as string}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Status row ── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Last Run', value: status?.last_run_at ?? 'Never' },
            { label: 'Last Status', value: lastStatus ?? '—', color: statusColor },
            { label: 'Next Scheduled', value: status?.next_run_at ?? '—' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ flex: 1, minWidth: 160, background: T.cardBg,
              border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: color ?? T.textPrimary, fontFamily: 'monospace' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Log ── */}
        <div style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderBottom: `1px solid ${T.cardBorder}` }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: T.textPrimary }}>📋 Scheduler Log</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.textMuted, cursor: 'pointer' }}>
                <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}
                  style={{ accentColor: T.accent }} />
                Auto-scroll
              </label>
              <span style={{ fontSize: 11, color: T.textMuted }}>
                {status?.log?.length ?? 0} entries (last 200)
              </span>
            </div>
          </div>
          <div ref={logRef}
            style={{ height: 320, overflowY: 'auto', padding: '8px 0', fontFamily: 'monospace', fontSize: 12 }}>
            {!status?.log?.length ? (
              <div style={{ color: T.textMuted, padding: '16px 20px', fontStyle: 'italic' }}>
                No log entries yet — log populates when the scheduler starts or runs.
              </div>
            ) : (
              status.log.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '3px 16px',
                  background: i % 2 === 0 ? 'transparent' : `${T.cardBorder}22`,
                  borderLeft: e.level === 'error' ? '3px solid #ef4444'
                    : e.level === 'warn' ? '3px solid #f59e0b'
                    : '3px solid transparent' }}>
                  <span style={{ color: T.textMuted, flexShrink: 0, fontSize: 11, paddingTop: 1 }}>{e.ts}</span>
                  <span style={{ color: levelColor(e.level), flex: 1, wordBreak: 'break-word' }}>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Steps info ── */}
        <div style={{ background: T.cardBg, border: `1px solid ${T.cardBorder}`, borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8 }}>
            9 Steps run in order
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              ['MC', 'Load from Oracle (New MC Search)'],
              ['00', 'Download GRC / REQ / SALE from Oracle'],
              ['02', 'Process GRC + PPO'],
              ['03', 'Process REQ + sale-floor'],
              ['07', 'LY Sell-Through analysis'],
              ['08', 'Listing eligibility'],
              ['04', 'Colour distribution'],
              ['05', 'Management summary'],
              ['06', 'Self-audit'],
            ].map(([step, label]) => (
              <div key={step} title={label}
                style={{ background: T.accentBg, border: `1px solid ${T.accent}44`, borderRadius: 6,
                  padding: '3px 10px', fontSize: 11, fontWeight: 700, color: T.accent, cursor: 'default' }}>
                {step}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
