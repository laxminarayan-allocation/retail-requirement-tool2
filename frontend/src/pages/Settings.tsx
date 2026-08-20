/**
 * Settings — Phase 14
 *
 * Operational control panel: system health, cache management,
 * Oracle pool state, run store metrics, and environment info.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import http from '@/api/http'

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
  card:    { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden' },
  cardHead:{ padding: '10px 14px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  cardBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
  row:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },
  label:   { color: '#64748b', fontSize: 11 },
  val:     { color: '#e2e8f0', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const },
  good:    { color: '#4ade80', fontSize: 12, fontWeight: 700 },
  warn:    { color: '#f59e0b', fontSize: 12, fontWeight: 700 },
  bad:     { color: '#f87171', fontSize: 12, fontWeight: 700 },
  btnBlue: { background: '#0ea5e9', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnRed:  { background: 'transparent', border: '1px solid #f87171', borderRadius: 6, color: '#f87171', fontSize: 11, fontWeight: 600, padding: '5px 14px', cursor: 'pointer' },
  btnSm:   { background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  badge:   (ok: boolean): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
    background: ok ? '#14532d' : '#450a0a',
    color: ok ? '#4ade80' : '#f87171',
  }),
  recBox:  { background: '#0f172a', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#94a3b8', lineHeight: 1.6 },
  divider: { height: 1, background: '#334155', margin: '4px 0' },
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
        {!data && <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>}
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
        {!status && <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>}
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
        {!status && <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>}
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
                <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
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
        <span style={{ fontSize: 10, color: '#475569' }}>max 20 runs</span>
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>}
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
          <span style={{ fontSize: 10, color: '#475569' }}>
            checked in {fmt(status.status_query_ms, 0)} ms
          </span>
        )}
      </div>
      <div style={S.cardBody}>
        {!status && <span style={{ color: '#64748b', fontSize: 12 }}>Loading…</span>}
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

// ── Main export ───────────────────────────────────────────────────────────────

export default function Settings() {
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

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>Settings & System</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Operational control panel — cache management, health checks, and system metrics
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRefresh && (
            <span style={{ fontSize: 10, color: '#475569' }}>
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
          background: '#0f172a', border: '1px solid #38bdf8', borderRadius: 6,
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
        <RecommendationsCard status={status} />
        <QuickLinksCard />
      </div>
    </div>
  )
}
