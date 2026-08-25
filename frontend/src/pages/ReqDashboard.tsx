import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ViewStatus {
  group: string
  label: string
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

// ── Group order ────────────────────────────────────────────────────────────────

const GROUP_ORDER = [
  'MC_REQ', 'ART_REQ', 'MRP_REQ', 'BARCODE_REQ',
  'SIZE_REQ', 'SPARKY_REQ', 'TABLE_REQ', 'OPTION_REQ', 'LIST_REQ',
]

const GROUP_LABELS: Record<string, string> = {
  MC_REQ:      'MC Requirement',
  ART_REQ:     'Article Requirement',
  MRP_REQ:     'MRP Requirement',
  BARCODE_REQ: 'Barcode Requirement',
  SIZE_REQ:    'Size Requirement',
  SPARKY_REQ:  'Sparky Requirement',
  TABLE_REQ:   'Table Requirement',
  OPTION_REQ:  'Option Requirement',
  LIST_REQ:    'List Requirement',
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { padding: '20px 24px', background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' },
  heading: { fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 },
  sub: { fontSize: 13, color: '#64748b', marginBottom: 24 },
  groupCard: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
    marginBottom: 16, overflow: 'hidden',
  },
  groupHeader: {
    padding: '10px 16px', background: '#172033', borderBottom: '1px solid #334155',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  groupTitle: { fontWeight: 700, fontSize: 14, color: '#a5b4fc', flex: 1 },
  viewRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 16px', borderBottom: '1px solid #1e293b',
  },
  viewLabel: { flex: 1, fontSize: 13, color: '#cbd5e1' },
  badge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 99,
    fontWeight: 600, minWidth: 60, textAlign: 'center',
  },
  btnView: {
    fontSize: 12, padding: '3px 10px', borderRadius: 5,
    background: '#1d4ed8', color: '#fff', border: 'none', cursor: 'pointer',
  },
  rows: { fontSize: 12, color: '#94a3b8', minWidth: 80, textAlign: 'right' as const },
  ts: { fontSize: 11, color: '#475569', minWidth: 130, textAlign: 'right' as const },

  // Modal
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
  },
  modal: {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
    width: 'calc(100vw - 32px)', height: 'calc(100vh - 32px)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  modalHeader: {
    padding: '12px 18px', borderBottom: '1px solid #334155',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  modalTitle: { flex: 1, fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
  closeBtn: {
    background: '#ef4444', border: 'none', color: '#fff', fontSize: 13,
    borderRadius: 5, padding: '3px 10px', cursor: 'pointer',
  },
  tableWrap: { flex: 1, overflow: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 12 },
  th: {
    padding: '6px 10px', background: '#0f172a', color: '#94a3b8',
    borderBottom: '1px solid #334155', fontWeight: 600,
    position: 'sticky', top: 0, whiteSpace: 'nowrap',
  },
  td: { padding: '5px 10px', borderBottom: '1px solid #1e293b', color: '#cbd5e1', whiteSpace: 'nowrap' },
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ReqDashboard() {
  const [views, setViews] = useState<ViewStatus[]>([])
  const [loading, setLoading] = useState(true)

  const [modal, setModal] = useState<{ owner: string; obj: string; label: string } | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const tok = () => localStorage.getItem('token')

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const r = await axios.get('/api/req/status', { headers: { Authorization: `Bearer ${tok()}` } })
      setViews(r.data.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const openModal = async (owner: string, obj: string, label: string) => {
    setModal({ owner, obj, label })
    setPreview(null)
    setPreviewError(null)
    setPreviewLoading(true)
    try {
      const r = await axios.get('/api/req/preview', {
        params: { owner, obj, limit: 200 },
        headers: { Authorization: `Bearer ${tok()}` },
      })
      setPreview(r.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Preview failed'
      setPreviewError(msg)
    }
    setPreviewLoading(false)
  }

  const closeModal = () => { setModal(null); setPreview(null); setPreviewError(null) }

  // Group views
  const grouped: Record<string, ViewStatus[]> = {}
  for (const v of views) {
    if (!grouped[v.group]) grouped[v.group] = []
    grouped[v.group].push(v)
  }

  const fmtTs = (ts: string | null) => {
    if (!ts) return '—'
    try { return new Date(ts).toLocaleString('en-IN', { hour12: false }).replace(',', '') } catch { return ts }
  }
  const fmtRows = (n: number | null) => n == null ? '—' : n.toLocaleString()

  return (
    <div style={S.page}>
      <div style={S.heading}>Requirements Dashboard</div>
      <div style={S.sub}>
        12 Oracle views across 9 requirement groups — auto-refreshed daily at 06:00 AM
        &nbsp;·&nbsp;
        <button
          onClick={loadStatus}
          style={{ fontSize: 12, background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: 5, padding: '2px 10px', cursor: 'pointer' }}
        >
          ↻ Reload status
        </button>
      </div>

      {loading && <div style={{ color: '#64748b', fontSize: 14 }}>Loading…</div>}

      {!loading && GROUP_ORDER.map(group => {
        const rows = grouped[group]
        if (!rows || rows.length === 0) return null
        const allCached = rows.every(v => v.cached)
        const someCached = rows.some(v => v.cached)
        return (
          <div key={group} style={S.groupCard}>
            <div style={S.groupHeader}>
              <span style={S.groupTitle}>{GROUP_LABELS[group] ?? group}</span>
              <span style={{
                ...S.badge,
                background: allCached ? '#14532d' : someCached ? '#422006' : '#1e1b4b',
                color: allCached ? '#4ade80' : someCached ? '#fb923c' : '#818cf8',
              }}>
                {allCached ? '✓ Cached' : someCached ? '~ Partial' : '○ No data'}
              </span>
            </div>
            {rows.map(v => (
              <div key={v.obj} style={S.viewRow}>
                <span style={S.viewLabel}>
                  <span style={{ color: '#475569', marginRight: 6, fontFamily: 'monospace', fontSize: 11 }}>
                    {v.owner}.{v.obj}
                  </span>
                  {v.label}
                </span>
                <span style={S.rows}>{fmtRows(v.rows)} rows</span>
                <span style={S.ts}>{fmtTs(v.fetched_at)}</span>
                {v.cached
                  ? <button style={S.btnView} onClick={() => openModal(v.owner, v.obj, v.label)}>View</button>
                  : <span style={{ fontSize: 12, color: '#475569', minWidth: 44 }}>—</span>
                }
              </div>
            ))}
          </div>
        )
      })}

      {/* Preview Modal */}
      {modal && (
        <div style={S.overlay} onClick={closeModal}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>{modal.label} &nbsp;·&nbsp; <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 12 }}>{modal.owner}.{modal.obj}</span></span>
              {preview && <span style={{ fontSize: 12, color: '#64748b' }}>{preview.total_rows.toLocaleString()} rows (showing first 200)</span>}
              <button style={S.closeBtn} onClick={closeModal}>✕ Close</button>
            </div>
            <div style={S.tableWrap}>
              {previewLoading && <div style={{ padding: 24, color: '#64748b' }}>Loading preview…</div>}
              {previewError && <div style={{ padding: 24, color: '#f87171' }}>{previewError}</div>}
              {preview && (
                <table style={S.table}>
                  <thead>
                    <tr>{preview.columns.map(c => <th key={c} style={S.th}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#172033' }}>
                        {preview.columns.map(c => (
                          <td key={c} style={S.td}>
                            {row[c] == null ? <span style={{ color: '#475569' }}>—</span> : String(row[c])}
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
