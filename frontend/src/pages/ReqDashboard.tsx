import { useEffect, useState, useCallback } from 'react'
import http from '@/api/http'

interface ViewStatus {
  group: string
  owner: string
  obj: string
  cached: boolean
  rows: number | null
  columns: string[] | null
  fetched_at: string | null
}

interface PreviewData {
  columns: string[]
  rows: Record<string, unknown>[]
  total_rows: number
}

const GROUP_ORDER = [
  'MC_REQ', 'ART_REQ', 'MRP_REQ', 'BARCODE_REQ',
  'SIZE_REQ', 'SPARKY_REQ', 'TABLE_REQ', 'OPTION_REQ', 'LIST_REQ',
]

const GROUP_META: Record<string, { label: string; icon: string; color: string }> = {
  MC_REQ:      { label: 'MC Requirement',      icon: '🧩', color: '#6366f1' },
  ART_REQ:     { label: 'Article Requirement', icon: '📦', color: '#0ea5e9' },
  MRP_REQ:     { label: 'MRP Requirement',     icon: '💰', color: '#f59e0b' },
  BARCODE_REQ: { label: 'Barcode Requirement', icon: '🔖', color: '#10b981' },
  SIZE_REQ:    { label: 'Size Requirement',    icon: '📐', color: '#ec4899' },
  SPARKY_REQ:  { label: 'Sparky Requirement',  icon: '⚡', color: '#f97316' },
  TABLE_REQ:   { label: 'Table Requirement',   icon: '📋', color: '#8b5cf6' },
  OPTION_REQ:  { label: 'Option Requirement',  icon: '🎛️', color: '#14b8a6' },
  LIST_REQ:    { label: 'List Requirement',    icon: '📝', color: '#64748b' },
}

const fmtRows = (n: number | null) => n == null ? '—' : n >= 1_000_000
  ? (n / 1_000_000).toFixed(1) + 'M'
  : n >= 1_000 ? (n / 1_000).toFixed(1) + 'K' : String(n)

const fmtTs = (ts: string | null) => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return ts }
}

export default function ReqDashboard() {
  const [views, setViews] = useState<ViewStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ owner: string; obj: string; group: string } | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const r = await http.get('/req/status')
      setViews(r.data.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const openModal = async (owner: string, obj: string, group: string) => {
    setModal({ owner, obj, group })
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    try {
      const r = await http.get('/req/preview', { params: { owner, obj, limit: 200 } })
      setPreview(r.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Preview failed'
      setPreviewError(msg)
    }
    setPreviewLoading(false)
  }

  const closeModal = () => { setModal(null); setPreview(null); setPreviewError(null) }

  const grouped: Record<string, ViewStatus[]> = {}
  for (const v of views) {
    if (!grouped[v.group]) grouped[v.group] = []
    grouped[v.group].push(v)
  }

  const totalCached = views.filter(v => v.cached).length
  const totalRows = views.reduce((s, v) => s + (v.rows ?? 0), 0)
  const lastRefresh = views.filter(v => v.fetched_at).map(v => v.fetched_at!).sort().reverse()[0]

  const meta = modal ? GROUP_META[modal.group] : null

  return (
    <div style={{ padding: '20px 24px', background: '#0a0f1e', minHeight: '100vh', color: '#e2e8f0' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: -0.5 }}>
            Requirements Dashboard
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
            Oracle views — auto-refreshed daily at 06:00 AM
          </div>
        </div>
        <button onClick={loadStatus} style={{
          fontSize: 12, padding: '6px 14px', borderRadius: 8,
          background: '#1e293b', border: '1px solid #334155',
          color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ↻ Reload status
        </button>
      </div>

      {/* ── Summary strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Total Views', value: '12', sub: '9 groups' },
          { label: 'Cached', value: `${totalCached}/12`, sub: totalCached === 12 ? 'All ready' : `${12 - totalCached} pending` },
          { label: 'Total Rows', value: fmtRows(totalRows), sub: 'across all views' },
          { label: 'Last Refresh', value: fmtTs(lastRefresh ?? null), sub: 'most recent' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#131929', border: '1px solid #1e293b', borderRadius: 10,
            padding: '12px 16px',
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#475569', fontSize: 13 }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Loading…
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {GROUP_ORDER.map(group => {
            const rows = grouped[group]
            if (!rows || rows.length === 0) return null
            const gm = GROUP_META[group]
            const allCached = rows.every(v => v.cached)
            const someCached = rows.some(v => v.cached)
            const status = allCached ? 'all' : someCached ? 'partial' : 'none'

            return (
              <div key={group} style={{
                background: '#131929',
                border: `1px solid ${allCached ? '#1e3a2f' : someCached ? '#2d1f0a' : '#1e293b'}`,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: allCached ? `0 0 0 0.5px ${gm.color}22` : 'none',
              }}>
                {/* card header */}
                <div style={{
                  padding: '12px 16px',
                  background: `linear-gradient(135deg, ${gm.color}18 0%, transparent 100%)`,
                  borderBottom: '1px solid #1e293b',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 18 }}>{gm.icon}</span>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{gm.label}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                    background: status === 'all' ? '#14532d' : status === 'partial' ? '#422006' : '#1e1b4b',
                    color: status === 'all' ? '#4ade80' : status === 'partial' ? '#fb923c' : '#818cf8',
                  }}>
                    {status === 'all' ? '✓ Cached' : status === 'partial' ? '⟳ Partial' : '○ No data'}
                  </span>
                </div>

                {/* view rows */}
                <div style={{ padding: '4px 0' }}>
                  {rows.map((v, i) => (
                    <div key={v.obj} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 16px',
                      background: i % 2 === 1 ? '#0d1525' : 'transparent',
                      borderBottom: i < rows.length - 1 ? '1px solid #0d1525' : 'none',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#cbd5e1', fontWeight: 600 }}>
                          {v.obj}
                        </div>
                        {v.fetched_at && (
                          <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>
                            {fmtTs(v.fetched_at)}
                          </div>
                        )}
                      </div>

                      {v.cached && (
                        <div style={{ textAlign: 'right', minWidth: 60 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: gm.color, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtRows(v.rows)}
                          </div>
                          <div style={{ fontSize: 10, color: '#475569' }}>rows</div>
                        </div>
                      )}

                      {v.cached
                        ? (
                          <button onClick={() => openModal(v.owner, v.obj, group)} style={{
                            fontSize: 11, padding: '4px 12px', borderRadius: 6,
                            background: gm.color + '22', border: `1px solid ${gm.color}44`,
                            color: gm.color, cursor: 'pointer', fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}>
                            View ↗
                          </button>
                        )
                        : <span style={{ fontSize: 11, color: '#334155', minWidth: 60 }}>Not cached</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal ── */}
      {modal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
        }} onClick={closeModal}>
          <div style={{
            background: '#131929', border: '1px solid #1e293b', borderRadius: 14,
            width: 'calc(100vw - 32px)', height: 'calc(100vh - 32px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>

            {/* modal header */}
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid #1e293b',
              display: 'flex', alignItems: 'center', gap: 12,
              background: `linear-gradient(135deg, ${meta?.color ?? '#6366f1'}18 0%, transparent 100%)`,
            }}>
              <span style={{ fontSize: 20 }}>{meta?.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9', fontFamily: 'monospace' }}>{modal.obj}</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{meta?.label}</div>
              </div>
              {preview && (
                <div style={{ fontSize: 12, color: '#64748b', background: '#0d1525', padding: '4px 10px', borderRadius: 6 }}>
                  {preview.total_rows.toLocaleString()} rows · {preview.columns.length} columns · showing 200
                </div>
              )}
              <button onClick={closeModal} style={{
                background: '#ef4444', border: 'none', color: '#fff',
                fontSize: 12, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 600,
              }}>
                ✕ Close
              </button>
            </div>

            {/* table */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {previewLoading && (
                <div style={{ padding: 32, color: '#475569', textAlign: 'center', fontSize: 14 }}>Loading preview…</div>
              )}
              {previewError && (
                <div style={{ padding: 32, color: '#f87171', textAlign: 'center', fontSize: 14 }}>{previewError}</div>
              )}
              {preview && (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {preview.columns.map(c => (
                        <th key={c} style={{
                          padding: '8px 12px', background: '#0a0f1e', color: '#64748b',
                          borderBottom: '1px solid #1e293b', fontWeight: 600,
                          position: 'sticky', top: 0, whiteSpace: 'nowrap',
                          textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5,
                        }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1525' }}>
                        {preview.columns.map(c => (
                          <td key={c} style={{
                            padding: '6px 12px', borderBottom: '1px solid #131929',
                            color: row[c] == null ? '#334155' : '#cbd5e1', whiteSpace: 'nowrap',
                          }}>
                            {row[c] == null ? '—' : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
