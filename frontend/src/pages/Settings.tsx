/**
 * Settings — Phase 14
 *
 * Operational control panel: system health, cache management,
 * Oracle pool state, run store metrics, and environment info.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import http from '@/api/http'
import { useAuth, hasRole } from '@/context/AuthContext'
import Procedures from '@/pages/Procedures'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SystemStatus {
  timestamp: string
  oracle_pool: {
    min_size?: number; max_size?: number
    open?: number; busy?: number; free?: number
    error?: string
  }
  item_cache: { loaded: boolean; rows: number; memory_mb: number | null; error?: string }
  store_cache: { loaded: boolean; rows: number; memory_mb: number | null; error?: string }
  run_store: {
    runs_in_memory: number; result_dataframes_mb: number
    statuses: Record<string, number>; error?: string
  }
  warmup: {
    running: boolean; last_run: string | null; last_duration_s: number | null
    items_loaded: number; stores_loaded: number; error: string | null
  }
  recommendations: string[]
  status_query_ms: number
}

interface HealthReady {
  ready: boolean
  checks: Record<string, { ok: boolean; ms?: number; error?: string }>
  version: string
  environment: string
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:    { display: 'flex', flexDirection: 'column', gap: 16 },
  header:  { display: 'flex', alignItems: 'baseline', gap: 12 },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 },
  card:    { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'hidden' },
  cardHead:{ padding: '10px 14px', borderBottom: '1px solid var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  cardBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
  row:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },
  label:   { color: 'var(--text-muted)', fontSize: 11 },
  val:     { color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const },
  good:    { color: '#4ade80', fontSize: 12, fontWeight: 700 },
  warn:    { color: '#f59e0b', fontSize: 12, fontWeight: 700 },
  bad:     { color: '#f87171', fontSize: 12, fontWeight: 700 },
  btnBlue: { background: '#0ea5e9', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnRed:  { background: 'transparent', border: '1px solid #f87171', borderRadius: 6, color: '#f87171', fontSize: 11, fontWeight: 600, padding: '5px 14px', cursor: 'pointer' },
  btnSm:   { background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  badge:   (ok: boolean): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
    background: ok ? '#14532d' : '#450a0a',
    color: ok ? '#4ade80' : '#f87171',
  }),
  recBox:  { background: 'var(--content-bg)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 },
  divider: { height: 1, background: 'var(--table-row-hover)', margin: '4px 0' },
}

function fmt(v: number | null | undefined, dec = 0) {
  if (v == null) return '—'
  return v.toLocaleString(undefined, { maximumFractionDigits: dec })
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'Never'
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return iso }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: ok ? '#4ade80' : '#f87171', marginRight: 6, flexShrink: 0,
    }} />
  )
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={S.val}>{children}</span>
    </div>
  )
}

// ── Readiness card ────────────────────────────────────────────────────────────

function ReadinessCard({ data }: { data: HealthReady | null }) {
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Readiness</span>
        {data && <span style={S.badge(data.ready)}>{data.ready ? 'READY' : 'DEGRADED'}</span>}
      </div>
      <div style={S.cardBody}>
        {!data && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
        {data && (
          <>
            <Kv label="Version">{data.version}</Kv>
            <Kv label="Environment">{data.environment}</Kv>
            <div style={S.divider} />
            {Object.entries(data.checks).map(([name, check]) => (
              <div key={name} style={S.row}>
                <span style={S.label}><StatusDot ok={check.ok} />{name}</span>
                <span style={check.ok ? S.good : S.bad}>
                  {check.ok ? (check.ms != null ? `${fmt(check.ms, 0)} ms` : 'OK') : (check.error ?? 'FAIL')}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Browser localStorage Cache card ──────────────────────────────────────────

const BROWSER_CACHE_KEYS: { key: string; label: string; desc: string }[] = [
  { key: 'dashboard_summary_v1', label: 'Dashboard Summary',   desc: 'Store network & KPI snapshot' },
  { key: 'dashboard_widgets',    label: 'Pinned Widgets',      desc: 'Dashboard widget pins' },
  { key: 'app_viewMode',         label: 'View Mode',           desc: 'Mobile/desktop preference' },
  { key: 'app_sidebarCollapsed', label: 'Sidebar State',       desc: 'Collapsed/expanded preference' },
  { key: 'ck_ss27_token',        label: 'Auth Token',          desc: 'Login session token' },
]

function getBrowserCacheInfo() {
  return BROWSER_CACHE_KEYS.map(({ key, label, desc }) => {
    try {
      const val = localStorage.getItem(key)
      const bytes = val ? new Blob([val]).size : 0
      return { key, label, desc, present: val !== null, bytes }
    } catch {
      return { key, label, desc, present: false, bytes: 0 }
    }
  })
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(2)} MB`
}

function BrowserCacheCard() {
  const [items, setItems] = useState(getBrowserCacheInfo)
  const [msg, setMsg] = useState('')

  function refresh() { setItems(getBrowserCacheInfo()) }

  function clearOne(key: string) {
    try { localStorage.removeItem(key) } catch {}
    setMsg(`Cleared: ${key}`)
    refresh()
    setTimeout(() => setMsg(''), 2500)
  }

  function clearAll() {
    BROWSER_CACHE_KEYS.forEach(({ key }) => {
      if (key === 'ck_ss27_token') return // keep auth token
      try { localStorage.removeItem(key) } catch {}
    })
    setMsg('All data caches cleared (auth token kept)')
    refresh()
    setTimeout(() => setMsg(''), 3000)
  }

  const totalBytes = items.reduce((s, i) => s + i.bytes, 0)
  const present = items.filter(i => i.present)

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>🗄️ Browser Cache (localStorage)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={refresh} style={{ background: 'none', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-muted)', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>↻</button>
          <button onClick={clearAll} style={{ background: '#7f1d1d', border: 'none', borderRadius: 5, color: '#fca5a5', fontSize: 10, padding: '3px 10px', cursor: 'pointer', fontWeight: 600 }}>
            Clear Data Cache
          </button>
        </div>
      </div>
      <div style={S.cardBody}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
          {present.length} entries · Total: <strong style={{ color: '#7dd3fc' }}>{fmtBytes(totalBytes)}</strong>
        </div>
        {items.map(({ key, label, desc, present, bytes }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--content-bg)', borderRadius: 6, border: '1px solid var(--card-border)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: present ? '#4ade80' : '#334155', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: present ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{desc}{present ? ` · ${fmtBytes(bytes)}` : ' · empty'}</div>
            </div>
            {present && key !== 'ck_ss27_token' && (
              <button onClick={() => clearOne(key)} style={{ background: 'none', border: '1px solid #334155', borderRadius: 4, color: '#f87171', fontSize: 9, padding: '2px 7px', cursor: 'pointer' }}>
                Clear
              </button>
            )}
            {key === 'ck_ss27_token' && present && (
              <span style={{ fontSize: 9, color: '#4ade80' }}>Active</span>
            )}
          </div>
        ))}
        {msg && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>{msg}</div>}
      </div>
    </div>
  )
}

// ── Cache card ────────────────────────────────────────────────────────────────

function CacheCard({
  status, onWarmup, onInvalidate, actionPending,
}: {
  status: SystemStatus | null
  onWarmup: () => void
  onInvalidate: () => void
  actionPending: string | null
}) {
  const warmup = status?.warmup
  const item = status?.item_cache
  const store = status?.store_cache

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Data Caches</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={S.btnBlue} onClick={onWarmup} disabled={!!actionPending || warmup?.running}>
            {warmup?.running ? 'Warming…' : actionPending === 'warmup' ? 'Starting…' : '↑ Warm Up'}
          </button>
          <button style={S.btnRed} onClick={onInvalidate} disabled={!!actionPending}>
            {actionPending === 'invalidate' ? 'Clearing…' : 'Invalidate'}
          </button>
        </div>
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
        {status && (
          <>
            <Kv label="Item master">
              {item?.loaded
                ? <span style={S.good}>{fmt(item.rows)} rows ({fmt(item.memory_mb, 1)} MB)</span>
                : <span style={S.warn}>Cold</span>}
            </Kv>
            <Kv label="Store master">
              {store?.loaded
                ? <span style={S.good}>{fmt(store.rows)} rows ({fmt(store.memory_mb, 1)} MB)</span>
                : <span style={S.warn}>Cold</span>}
            </Kv>
            <div style={S.divider} />
            <Kv label="Last warmup">{fmtDate(warmup?.last_run ?? null)}</Kv>
            {warmup?.last_duration_s != null && (
              <Kv label="Warmup duration">{fmt(warmup.last_duration_s, 1)} s</Kv>
            )}
            {warmup?.error && (
              <div style={{ fontSize: 11, color: '#f87171' }}>Error: {warmup.error}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Oracle pool card ──────────────────────────────────────────────────────────

function OraclePoolCard({ status }: { status: SystemStatus | null }) {
  const pool = status?.oracle_pool
  const utilPct = pool?.open && pool?.busy != null
    ? Math.round((pool.busy / pool.open) * 100)
    : null

  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Oracle Connection Pool</span>
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
        {status && pool?.error && <span style={S.bad}>{pool.error}</span>}
        {status && !pool?.error && pool && (
          <>
            <Kv label="Pool size">{fmt(pool.min_size)} – {fmt(pool.max_size)}</Kv>
            <Kv label="Connections open">{fmt(pool.open)}</Kv>
            <Kv label="Busy / Free">
              <span>{fmt(pool.busy)} / <span style={S.good}>{fmt(pool.free)}</span></span>
            </Kv>
            {utilPct != null && (
              <Kv label="Utilisation">
                <span style={utilPct > 80 ? S.warn : S.good}>{utilPct}%</span>
              </Kv>
            )}
            {/* Usage bar */}
            {pool.open != null && pool.busy != null && (
              <div style={{ marginTop: 4 }}>
                <div style={{ height: 6, background: 'var(--content-bg)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 0.3s',
                    width: pool.open > 0 ? `${(pool.busy / pool.open) * 100}%` : '0%',
                    background: utilPct != null && utilPct > 80 ? '#f59e0b' : '#4ade80',
                  }} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Run store card ────────────────────────────────────────────────────────────

function RunStoreCard({ status }: { status: SystemStatus | null }) {
  const rs = status?.run_store
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Run Store (In-Memory)</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>max 20 runs</span>
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
        {status && rs && !rs.error && (
          <>
            <Kv label="Runs in memory">{fmt(rs.runs_in_memory)}</Kv>
            <Kv label="Result DataFrames">{fmt(rs.result_dataframes_mb, 1)} MB</Kv>
            <div style={S.divider} />
            {Object.entries(rs.statuses ?? {}).map(([status, count]) => count > 0 && (
              <Kv key={status} label={status}>{String(count)}</Kv>
            ))}
          </>
        )}
        {rs?.error && <span style={S.bad}>{rs.error}</span>}
      </div>
    </div>
  )
}

// ── Recommendations card ──────────────────────────────────────────────────────

function RecommendationsCard({ status }: { status: SystemStatus | null }) {
  const recs = status?.recommendations ?? []
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Recommendations</span>
        {status && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            checked in {fmt(status.status_query_ms, 0)} ms
          </span>
        )}
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</span>}
        {recs.map((r, i) => (
          <div key={i} style={S.recBox}>{r}</div>
        ))}
      </div>
    </div>
  )
}

// ── Quick links card ──────────────────────────────────────────────────────────

function QuickLinksCard() {
  const navigate = useNavigate()
  const links = [
    { label: 'Dashboard', path: '/', icon: '◉' },
    { label: 'Run Calculation', path: '/calculation', icon: '▶' },
    { label: 'Result Explorer', path: '/results', icon: '⊞' },
    { label: 'Run History', path: '/history', icon: '⊟' },
    { label: 'Factors', path: '/factors', icon: '⚙' },
    { label: 'Database Explorer', path: '/database', icon: '⬡' },
  ]
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>Quick Navigation</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
        {links.map(l => (
          <button key={l.path} style={S.btnSm} onClick={() => navigate(l.path)}>
            {l.icon} {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Version entry types ───────────────────────────────────────────────────────

type VersionEntry = {
  id: string; version: string; date: string; type: string
  title: string; desc: string; released: boolean; added_by: string
}

const TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  feature:     { label: '✦ NEW',         bg: '#1e3a5f', color: '#38bdf8' },
  fix:         { label: '✓ FIX',         bg: '#1c2e1c', color: '#4ade80' },
  improvement: { label: '↑ IMPROVEMENT', bg: '#2d1f00', color: '#fbbf24' },
  breaking:    { label: '⚠ BREAKING',    bg: '#3b0a0a', color: '#f87171' },
}

function VersionControlCard() {
  const { user } = useAuth()
  const isAdmin = user && hasRole(user, 'admin')
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formMsg, setFormMsg] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  const [form, setForm] = useState({
    version: '', date: new Date().toISOString().slice(0, 10),
    type: 'feature', title: '', desc: '', released: true,
  })

  async function fetchVersions() {
    setLoading(true)
    try {
      const res = await http.get<{ success: boolean; data: { versions: VersionEntry[] } }>('/versions')
      if (res.data.success) setVersions(res.data.data.versions)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchVersions() }, [])

  async function handleSyncGit() {
    setSaving(true); setFormMsg('')
    try {
      const res = await http.post<{ success: boolean; message: string; data: { added: number } }>('/versions/sync-git', { limit: 50 })
      setFormMsg(res.data.success ? `✓ ${res.data.message}` : (res.data.message || 'Sync failed'))
      if (res.data.success) await fetchVersions()
    } catch { setFormMsg('Sync error — backend check karo') }
    finally { setSaving(false) }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.version || !form.title) return
    setSaving(true); setFormMsg('')
    try {
      const res = await http.post<{ success: boolean; message: string }>('/versions', form)
      if (res.data.success) {
        setFormMsg('✓ Added successfully')
        setForm({ version: '', date: new Date().toISOString().slice(0, 10), type: 'feature', title: '', desc: '', released: true })
        setShowForm(false)
        await fetchVersions()
      } else {
        setFormMsg(res.data.message || 'Failed')
      }
    } catch { setFormMsg('Error saving entry') }
    finally { setSaving(false) }
  }

  async function toggleRelease(entry: VersionEntry) {
    try {
      await http.patch(`/versions/${entry.id}`, { released: !entry.released })
      await fetchVersions()
    } catch { /* silent */ }
  }

  async function handleDelete(entry: VersionEntry) {
    if (!confirm(`Delete version entry "${entry.version} — ${entry.title}"?`)) return
    try {
      await http.delete(`/versions/${entry.id}`)
      await fetchVersions()
    } catch { /* silent */ }
  }

  const typeMeta = (t: string) => TYPE_META[t] || TYPE_META['feature']

  return (
    <div style={{ ...S.card, gridColumn: '1 / -1' }}>
      <div style={S.cardHead}>
        <span style={S.cardTitle}>📋 Version Control — Changelog</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {versions.length} entries
          </span>
          {isAdmin && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...S.btnBlue, background: '#0f766e', fontSize: 11 }}
                onClick={handleSyncGit}
                disabled={saving}
                title="Git commits se auto entries banao"
              >
                {saving ? 'Syncing…' : '🔄 Sync from Git'}
              </button>
              <button
                style={{ ...S.btnBlue, background: showForm ? '#475569' : '#0ea5e9' }}
                onClick={() => { setShowForm(v => !v); setFormMsg('') }}
              >
                {showForm ? '✕ Cancel' : '+ Add Entry'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add form — admin only */}
      {isAdmin && showForm && (
        <form ref={formRef} onSubmit={handleAdd} style={{
          padding: '12px 14px', borderBottom: '1px solid var(--card-border)',
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          background: '#0f1923',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>VERSION *</label>
            <input
              style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-primary)' }}
              placeholder="e.g. 1.4.0" value={form.version}
              onChange={e => setForm(f => ({ ...f, version: e.target.value }))} required
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>DATE</label>
            <input
              type="date"
              style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-primary)' }}
              value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>TYPE</label>
            <select
              style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-primary)' }}
              value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            >
              <option value="feature">Feature / New</option>
              <option value="fix">Bug Fix</option>
              <option value="improvement">Improvement</option>
              <option value="breaking">Breaking Change</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>RELEASED?</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={form.released} onChange={e => setForm(f => ({ ...f, released: e.target.checked }))} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{form.released ? 'Yes — visible to all' : 'No — draft only'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>TITLE *</label>
            <input
              style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '5px 8px', fontSize: 12, color: 'var(--text-primary)' }}
              placeholder="Short title of this change" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>DESCRIPTION</label>
            <textarea
              style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '6px 8px', fontSize: 11, color: 'var(--text-primary)', resize: 'vertical', minHeight: 60 }}
              placeholder="Detailed description of what changed..." value={form.desc}
              onChange={e => setForm(f => ({ ...f, desc: e.target.value }))}
            />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" style={{ ...S.btnBlue }} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Entry'}
            </button>
            {formMsg && <span style={{ fontSize: 11, color: formMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{formMsg}</span>}
          </div>
        </form>
      )}

      {/* Entries list */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>}
        {!loading && versions.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>No entries yet.</span>
        )}
        {versions.map(entry => {
          const tm = typeMeta(entry.type)
          return (
            <div key={entry.id} style={{
              display: 'flex', gap: 10, padding: '9px 10px',
              background: 'var(--content-bg)', borderRadius: 6, alignItems: 'flex-start',
              border: entry.released ? '1px solid var(--card-border)' : '1px dashed #334155',
              opacity: entry.released ? 1 : 0.65,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: tm.bg, color: tm.color, letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {tm.label}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>v{entry.version}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                  {entry.title}
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>{entry.date}</span>
                  {!entry.released && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 6, background: '#2d1f00', padding: '1px 5px', borderRadius: 3 }}>DRAFT</span>}
                </div>
                {entry.desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{entry.desc}</div>}
                <div style={{ fontSize: 9, color: '#334155', marginTop: 3 }}>by {entry.added_by}</div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => toggleRelease(entry)}
                    title={entry.released ? 'Mark as Draft' : 'Release'}
                    style={{ background: 'none', border: '1px solid var(--card-border)', borderRadius: 4, padding: '2px 7px', fontSize: 9, color: entry.released ? '#f59e0b' : '#4ade80', cursor: 'pointer' }}
                  >
                    {entry.released ? 'Unpublish' : 'Release'}
                  </button>
                  <button
                    onClick={() => handleDelete(entry)}
                    title="Delete"
                    style={{ background: 'none', border: '1px solid #334155', borderRadius: 4, padding: '2px 6px', fontSize: 9, color: '#f87171', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Settings() {
  const [searchParams] = useSearchParams()
  const [pageTab, setPageTab] = useState<'settings' | 'procedures'>(
    searchParams.get('tab') === 'procedures' ? 'procedures' : 'settings'
  )
  const tabBar = (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--card-border)', flexShrink: 0, background: 'var(--content-bg)', marginBottom: 12 }}>
      {([
        { key: 'settings', label: '⚙️ Settings' },
        { key: 'procedures', label: '📋 Procedures' },
      ] as const).map(({ key, label }) => (
        <button key={key} onClick={() => setPageTab(key)} style={{
          background: pageTab === key ? '#1e293b' : 'transparent',
          border: 'none',
          borderBottom: pageTab === key ? '2px solid #38bdf8' : '2px solid transparent',
          color: pageTab === key ? '#e2e8f0' : '#64748b',
          fontSize: 12, fontWeight: 600, padding: '8px 18px', cursor: 'pointer',
        }}>{label}</button>
      ))}
    </div>
  )

  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [readiness, setReadiness] = useState<HealthReady | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [sysRes, readyRes] = await Promise.all([
        http.get<{ success: boolean; data: SystemStatus }>('/system/status'),
        http.get<{ success: boolean; data: HealthReady }>('/health/ready'),
      ])
      if (sysRes.data.success) setStatus(sysRes.data.data)
      if (readyRes.data.success) setReadiness(readyRes.data.data)
      setLastRefresh(new Date())
    } catch (e) {
      console.error('Settings fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleWarmup() {
    setActionPending('warmup')
    setActionMsg(null)
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/cache/warmup')
      setActionMsg(res.data.message ?? 'Warmup started.')
      setTimeout(fetchAll, 3000)
    } catch {
      setActionMsg('Warmup request failed.')
    } finally {
      setActionPending(null)
    }
  }

  async function handleInvalidate() {
    if (!confirm('Clear all Oracle data caches? The next calculation run will re-fetch from Oracle.')) return
    setActionPending('invalidate')
    setActionMsg(null)
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/cache/invalidate')
      setActionMsg(res.data.message ?? 'Caches cleared.')
      await fetchAll()
    } catch {
      setActionMsg('Invalidate request failed.')
    } finally {
      setActionPending(null)
    }
  }

  async function handleRestartBackend() {
    if (!confirm('Backend restart karega — 5-10 seconds ke liye disconnect hoga. Continue?')) return
    setActionPending('restart-backend')
    setActionMsg(null)
    try {
      await http.post('/system/restart-backend')
      setActionMsg('Backend restart ho raha hai… 10 seconds mein page refresh karo.')
    } catch {
      setActionMsg('Restart signal bhej diya — reconnect karein.')
    } finally {
      setActionPending(null)
    }
  }

  async function handleBuildFrontend() {
    setActionPending('build-frontend')
    setActionMsg('Frontend build chal raha hai… (~30-60s)')
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/build-frontend', {}, { timeout: 150_000 })
      setActionMsg(res.data.message ?? 'Build done. Mobile refresh karo.')
    } catch {
      setActionMsg('Build failed — backend logs check karo.')
    } finally {
      setActionPending(null)
    }
  }

  async function handleMobileUpgrade() {
    if (!confirm('📱 Mobile Upgrade: Frontend build + Backend restart karega.\n\n10-60 seconds ke liye app disconnect hoga. Continue?')) return
    setActionPending('mobile-upgrade')
    setActionMsg('Step 1/2: Frontend build ho raha hai…')
    try {
      await http.post('/system/build-frontend', {}, { timeout: 150_000 })
      setActionMsg('Step 2/2: Backend restart ho raha hai…')
      await http.post('/system/restart-backend').catch(() => {})
      setActionMsg('✅ Mobile Upgrade done! Mobile pe page hard-refresh karo (Ctrl+Shift+R).')
    } catch {
      setActionMsg('Upgrade failed — backend logs check karo.')
    } finally {
      setActionPending(null)
    }
  }

  async function handleGitPush() {
    if (!confirm('Changes commit karke git push karega. Continue?')) return
    setActionPending('git-push')
    setActionMsg('Git push ho raha hai…')
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/git/push', {}, { timeout: 90_000 })
      setActionMsg(res.data.message ?? 'Push done.')
    } catch (e: any) {
      setActionMsg('Push failed: ' + (e?.response?.data?.message || 'network error'))
    } finally {
      setActionPending(null)
    }
  }

  async function handleGitPull() {
    if (!confirm('Git pull karega — latest changes server se ayenge. Continue?')) return
    setActionPending('git-pull')
    setActionMsg('Git pull ho raha hai…')
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/git/pull', {}, { timeout: 90_000 })
      setActionMsg(res.data.message ?? 'Pull done.')
    } catch (e: any) {
      setActionMsg('Pull failed: ' + (e?.response?.data?.message || 'network error'))
    } finally {
      setActionPending(null)
    }
  }

  if (pageTab === 'procedures') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
        {tabBar}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Procedures />
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      {tabBar}
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Settings & System</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Operational control panel — cache management, health checks, and system metrics
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Refreshed {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button style={S.btnSm} onClick={fetchAll} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Action feedback */}
      {actionMsg && (
        <div style={{
          background: 'var(--content-bg)', border: '1px solid #38bdf8', borderRadius: 6,
          padding: '8px 14px', fontSize: 12, color: '#38bdf8',
        }}>
          {actionMsg}
        </div>
      )}

      {/* Card grid */}
      <div style={S.grid}>
        <ReadinessCard data={readiness} />
        <CacheCard
          status={status}
          onWarmup={handleWarmup}
          onInvalidate={handleInvalidate}
          actionPending={actionPending}
        />
        <OraclePoolCard status={status} />
        <RunStoreCard status={status} />
        <BrowserCacheCard />
        <RecommendationsCard status={status} />
        <QuickLinksCard />

        {/* ── Version Control / Changelog ─────────────────────────────── */}
        <VersionControlCard />

        {/* ── Server Control ───────────────────────────────────────────── */}
        <div style={{ ...S.card, gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={S.cardTitle}>🔧 Server Control</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* ── Mobile Upgrade — prominent button ── */}
            <button
              style={{ ...S.btnBlue, background: '#0e7490', border: '2px solid #22d3ee', fontWeight: 800, fontSize: 13, padding: '8px 18px' }}
              onClick={handleMobileUpgrade}
              disabled={!!actionPending}
            >
              {actionPending === 'mobile-upgrade' ? '⏳ Upgrading…' : '📱 Mobile Upgrade'}
            </button>
            <div style={{ width: 1, height: 28, background: 'var(--card-border)' }} />
            <button
              style={{ ...S.btnRed, background: '#b45309' }}
              onClick={handleRestartBackend}
              disabled={!!actionPending}
            >
              {actionPending === 'restart-backend' ? 'Restarting…' : '↺ Restart Backend'}
            </button>
            <button
              style={{ ...S.btnBlue, background: '#0f766e' }}
              onClick={handleBuildFrontend}
              disabled={!!actionPending}
            >
              {actionPending === 'build-frontend' ? 'Building…' : '⚙ Build Frontend'}
            </button>
            <button
              style={{ ...S.btnBlue, background: '#1d4ed8' }}
              onClick={handleGitPush}
              disabled={!!actionPending}
            >
              {actionPending === 'git-push' ? 'Pushing…' : '⬆ Push to Git'}
            </button>
            <button
              style={{ ...S.btnBlue, background: '#6d28d9' }}
              onClick={handleGitPull}
              disabled={!!actionPending}
            >
              {actionPending === 'git-pull' ? 'Pulling…' : '⬇ Pull / Upgrade'}
            </button>
            {actionMsg && (
              <span style={{ fontSize: 12, color: actionMsg.includes('fail') || actionMsg.includes('Failed') ? '#f87171' : '#4ade80', marginLeft: 4 }}>
                {actionMsg}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            📱 <b>Mobile Upgrade</b> — Build + Restart dono karta hai, mobile pe latest changes aate hain (https://ckho-d-aloc.tail8de265.ts.net). &nbsp;
            Restart Backend — uvicorn restart (5–10s). Build Frontend — sirf npm run build. Push to Git — commit + push. Pull/Upgrade — latest code fetch.
          </div>
        </div>
      </div>
    </div>
  )
}
