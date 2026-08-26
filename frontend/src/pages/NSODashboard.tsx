/**
 * NSO Dashboard — New Store Opening performance tracker.
 * Two views: Store View (Excel-style store summary) and Article Detail.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import http from '@/api/http'

async function apiFetch<T>(url: string, params?: Record<string, string>): Promise<T> {
  const res = await http.get<{ success: boolean; data: T; message: string | null }>(url, { params })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface NSOFilters {
  attribute1: string[]; store_status: string[]; division: string[]
  cluster_type: string[]; region_type: string[]; store_tag: string[]
}
interface NSOData { rows: Record<string, unknown>[]; columns: string[]; count: number; total_cached: number; elapsed_ms: number; served_from: string }

// ── Colour helpers ─────────────────────────────────────────────────────────────
/** Colour a percentage cell like the Excel: red <80, yellow 80-99, green ≥100 */
function pctColor(val: number | null): string {
  if (val === null || isNaN(val)) return '#cbd5e1'
  if (val >= 100) return '#4ade80'
  if (val >= 80)  return '#facc15'
  return '#f87171'
}

/** Row accent by store status */
function statusColor(status: string | null): string {
  if (!status) return 'transparent'
  const s = String(status).toUpperCase()
  if (s === 'ACTIVE')   return '#14532d22'
  if (s.includes('UPCOMING')) return '#1e3a5f44'
  return 'transparent'
}

// ── PCT / NUM columns (lowercase — Parquet cache lowercases column names) ──────
const PCT_COLS = new Set(['achv_per', 'lm_achv_per'])
const NUM_COLS = new Set([
  'area', 'store_area', 'art_str',
  'proj_q', 'proj_q_1', 'proj_q_2', 'proj_q_3', 'proj_q_4', 'proj_q_5', 'proj_q_6',
  'proj_v', 'proj_v_1', 'proj_v_2', 'proj_v_3', 'proj_v_4', 'proj_v_5', 'proj_v_6',
  'proj_cv', 'proj_cv_1', 'proj_cv_2', 'proj_cv_3', 'proj_cv_4', 'proj_cv_5', 'proj_cv_6',
  'pbs_q', 'pbs_v', 'pbs_cv',
  'ttl_stk_q', 'stk_q', 'adj_stk_q', 'in_transit_q', 'pack_pend_q',
  'to_q', 'lm_sl_q', 'mtd_sl_q',
  'ttl_stk_v', 'stk_v', 'adj_stk_v', 'in_transit_v', 'pack_pend_v',
  'to_v', 'lm_sl_val', 'mtd_sl_v',
  'tgt_v', 'sl_v', 'lm_tgt_v', 'lm_sl_v',
  'req_q', 'req_v',
])

function fmtNum(val: unknown): string {
  const n = Number(val)
  if (isNaN(n)) return val == null ? '—' : String(val)
  if (Math.abs(n) >= 1_00_000) return (n / 1_00_000).toFixed(2) + ' L'
  if (Number.isInteger(n)) return n.toLocaleString('en-IN')
  return n.toFixed(2)
}

function fmtPct(val: unknown): string {
  const n = Number(val)
  if (isNaN(n)) return val == null ? '—' : String(val)
  return n.toFixed(2) + '%'
}

// ── Store Summary Types ────────────────────────────────────────────────────────
interface StoreRow {
  store_name: string
  store_f_name?: string
  store_area?: number | string
  store_status?: string
  cluster_type?: string
  region_type?: string
  tentetive_date?: string
  opening_date?: string
  pbs_q?: number; ttl_stk_q?: number
  pbs_v?: number; ttl_stk_v?: number
  to_v?: number; mtd_sl_v?: number
  lm_sl_val?: number; lm_tgt_v?: number
  stk_v?: number; pack_pend_v?: number; in_transit_v?: number
  opert_days?: number; sl_avg_d?: number
  ach_pct?: number; ach_lm_pct?: number; fill_rate?: number
  [key: string]: unknown
}
interface StoreSummaryData { stores: StoreRow[]; count: number; elapsed_ms: number }

// ── Store Summary Component ────────────────────────────────────────────────────
const STORE_COLS: { key: string; label: string; type: 'text' | 'num' | 'lakh' | 'pct' | 'date' | 'qty' }[] = [
  { key: 'tentetive_date', label: 'TENT DATE',    type: 'date' },
  { key: 'store_area',     label: 'AREA',         type: 'qty'  },
  { key: 'store_f_name',   label: 'STORE NAME',   type: 'text' },
  { key: 'store_name',     label: 'CODE',         type: 'text' },
  { key: 'pbs_q',          label: 'PBS QTY',      type: 'qty'  },
  { key: 'ttl_stk_q',      label: 'STK QTY',      type: 'qty'  },
  { key: 'pbs_v',          label: 'PBS VAL(L)',    type: 'lakh' },
  { key: 'ttl_stk_v',      label: 'TTL STK(L)',   type: 'lakh' },
  { key: 'in_transit_v',   label: 'IN-TRANSIT(L)',type: 'lakh' },
  { key: 'to_v',           label: 'TO VAL(L)',    type: 'lakh' },
  { key: 'mtd_sl_v',       label: 'MTD SALE(L)',  type: 'lakh' },
  { key: 'ach_lm_pct',     label: 'ACH LM%',     type: 'pct'  },
  { key: 'ach_pct',        label: 'ACH%',         type: 'pct'  },
  { key: 'fill_rate',      label: 'FILL RATE%',   type: 'pct'  },
  { key: 'stk_v',          label: 'STK VAL(L)',   type: 'lakh' },
  { key: 'pack_pend_v',    label: 'PACK PEND(L)', type: 'lakh' },
  { key: 'opert_days',     label: 'OPER DAYS',    type: 'qty'  },
  { key: 'sl_avg_d',       label: 'SL AVG/D(L)',  type: 'lakh' },
  { key: 'str_days',       label: 'STR(days)',    type: 'num'  },
]

function fmtLakh(v: unknown): string {
  const n = Number(v)
  if (isNaN(n) || v == null) return '—'
  return n.toFixed(2)  // values already normalized to Lakhs by backend
}
function fmtQty(v: unknown): string {
  const n = Number(v)
  if (isNaN(n) || v == null) return '—'
  return Math.round(n).toLocaleString('en-IN')
}
function fmtDate(v: unknown): string {
  if (!v) return '—'
  const s = String(v)
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── Multi-select dropdown with checkboxes ──────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const toggle = useCallback((v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }, [selected, onChange])
  const display = selected.length === 0 ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}`
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        ...S.select, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
        background: selected.length > 0 ? '#1e3a5f' : undefined,
        color: selected.length > 0 ? '#7dd3fc' : C.text2,
        border: selected.length > 0 ? '1px solid #3b82f6' : undefined,
      }}>{display} ▾</button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 999, minWidth: 180,
          background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 6,
          boxShadow: '0 4px 16px #0006', padding: '4px 0', maxHeight: 220, overflowY: 'auto',
        }}>
          {selected.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: '4px 10px', fontSize: 11, color: '#f87171', cursor: 'pointer' }}>✕ Clear all</div>
          )}
          {options.map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: C.text2 }}>
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} style={{ accentColor: C.blue }} />
              {v}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Searchable multi-select (for store names — can be large list) ───────────────
function SearchableMultiSelect({
  label, options, selected, onChange,
}: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])
  const toggle = useCallback((v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }, [selected, onChange])
  const filtered = q.trim() ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options
  const display = selected.length === 0 ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}`
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        ...S.select, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap', minWidth: 140,
        background: selected.length > 0 ? '#1e3a5f' : undefined,
        color: selected.length > 0 ? '#7dd3fc' : C.text2,
        border: selected.length > 0 ? '1px solid #3b82f6' : undefined,
      }}>{display} ▾</button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 999, width: 260,
          background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 6,
          boxShadow: '0 8px 24px #0008', display: 'flex', flexDirection: 'column',
        }}>
          {/* Search input */}
          <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search store…"
              style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 12, padding: '5px 8px', outline: 'none' }}
            />
          </div>
          {/* Actions */}
          <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
            {selected.length > 0 && (
              <div onClick={() => onChange([])} style={{ flex: 1, padding: '5px 10px', fontSize: 11, color: '#f87171', cursor: 'pointer', textAlign: 'center' }}>✕ Clear</div>
            )}
            {filtered.length > 0 && filtered.length !== options.length && (
              <div onClick={() => onChange([...new Set([...selected, ...filtered])])} style={{ flex: 1, padding: '5px 10px', fontSize: 11, color: '#4ade80', cursor: 'pointer', textAlign: 'center' }}>+ All shown</div>
            )}
          </div>
          {/* List */}
          <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.length === 0 && <div style={{ padding: '8px 12px', fontSize: 11, color: C.text3 }}>No match</div>}
            {filtered.map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: selected.includes(v) ? '#7dd3fc' : C.text2, background: selected.includes(v) ? '#1e3a5f44' : 'transparent' }}>
                <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} style={{ accentColor: C.blue, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
              </label>
            ))}
          </div>
          {filtered.length > 0 && (
            <div style={{ padding: '4px 10px', borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.text3 }}>
              {filtered.length} of {options.length} · {selected.length} selected
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Mobile KPI strip ──────────────────────────────────────────────────────────
function MobileKPIStrip({ items }: { items: { label: string; val: string; color: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px', scrollbarWidth: 'none' }}>
      {items.map(k => (
        <div key={k.label} style={{
          flexShrink: 0, background: '#1e293b', borderRadius: 10, padding: '8px 14px',
          border: '1px solid #334155', textAlign: 'center', minWidth: 90,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.val}</div>
          <div style={{ fontSize: 9, color: '#64748b', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Mobile store card ──────────────────────────────────────────────────────────
function MobileStoreCard({ row, str }: { row: StoreRow; str?: number }) {
  const status = String(row.store_status ?? '').toUpperCase()
  const isActive = status === 'ACTIVE'
  const borderColor = isActive ? '#16a34a' : '#3b82f6'
  const statusColor = isActive ? '#4ade80' : '#7dd3fc'
  const statusBg = isActive ? '#14532d' : '#1e3a5f'
  return (
    <div style={{
      background: '#1e293b', border: `1px solid ${borderColor}22`,
      borderLeft: `3px solid ${borderColor}`, borderRadius: 10, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Top row: name + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0', lineHeight: 1.3 }}>
          {row.store_f_name || row.store_name}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: statusBg, color: statusColor, border: `1px solid ${borderColor}`,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>{row.store_status}</span>
      </div>
      {/* Opening date + code */}
      <div style={{ fontSize: 10, color: '#64748b', display: 'flex', gap: 10 }}>
        <span>📅 {fmtDate(row.opening_date || row.tentetive_date)}</span>
        <span>🏪 {row.store_name}</span>
        {row.opert_days != null && <span>⏱ {row.opert_days}d</span>}
      </div>
      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        {[
          { label: 'MTD Sale', val: fmtLakh(row.mtd_sl_v) + ' L', color: '#4ade80' },
          { label: 'PBS Val', val: fmtLakh(row.pbs_v) + ' L', color: '#facc15' },
          { label: 'Stk Val', val: fmtLakh(row.ttl_stk_v) + ' L', color: '#7dd3fc' },
          { label: 'In-Transit', val: fmtLakh(row.in_transit_v) + ' L', color: '#fb923c' },
          { label: 'Oper Days', val: row.opert_days != null ? String(row.opert_days) + 'd' : '—', color: '#94a3b8' },
          { label: 'Ach%', val: row.ach_pct != null ? Number(row.ach_pct).toFixed(1) + '%' : '—', color: pctColor(row.ach_pct != null ? Number(row.ach_pct) : null) },
          { label: 'Fill%', val: row.fill_rate != null ? Number(row.fill_rate).toFixed(1) + '%' : '—', color: pctColor(row.fill_rate != null ? Number(row.fill_rate) : null) },
          { label: 'STR', val: str != null ? str.toFixed(1) + 'd' : '—', color: '#c084fc' },
        ].map(m => (
          <div key={m.label} style={{ background: '#0f172a', borderRadius: 6, padding: '5px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{m.val}</div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mobile filter drawer ───────────────────────────────────────────────────────
function MobileFilterDrawer({ open, onClose, children, activeCount }: {
  open: boolean; onClose: () => void; children: React.ReactNode; activeCount: number
}) {
  if (!open) return null
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2001,
        background: '#1e293b', borderTop: '1px solid #334155',
        borderRadius: '16px 16px 0 0', padding: '0 0 24px',
        maxHeight: '80vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #334155' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>
            Filters {activeCount > 0 && <span style={{ background: '#1d4ed8', color: '#fff', fontSize: 10, padding: '2px 7px', borderRadius: 10, marginLeft: 6 }}>{activeCount}</span>}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      </div>
    </>
  )
}

// ── Mobile full-width MultiSelect ──────────────────────────────────────────────
function MobileMultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback((v: string) => {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }, [selected, onChange])
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', background: selected.length > 0 ? '#1e3a5f' : '#0f172a',
        border: `1px solid ${selected.length > 0 ? '#3b82f6' : '#334155'}`, borderRadius: 8,
        color: selected.length > 0 ? '#7dd3fc' : '#94a3b8', fontSize: 13, padding: '10px 12px',
        cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{selected.length === 0 ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} selected`}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto' }}>
          {selected.length > 0 && (
            <div onClick={() => onChange([])} style={{ padding: '8px 12px', fontSize: 12, color: '#f87171', cursor: 'pointer' }}>✕ Clear all</div>
          )}
          {options.map(v => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#94a3b8', borderTop: '1px solid #1e293b' }}>
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} style={{ accentColor: '#3b82f6', width: 16, height: 16 }} />
              {v}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function StoreSummary({
  selStatus, selCluster, selRegion, selTag, selDivisions, selCampaigns, selStores, source, onToggleSource, isMobile, onStoreOptions,
}: {
  selStatus: string; selCluster: string; selRegion: string; selTag: string
  selDivisions: string[]; selCampaigns: string[]; selStores: string[]
  source: 'nso' | 'all'; onToggleSource: () => void; isMobile: boolean
  onStoreOptions?: (opts: string[]) => void
}) {
  const [data, setData] = useState<StoreSummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<string>('mtd_sl_v')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function load(src?: 'nso' | 'all') {
    setLoading(true); setError(null)
    const params: Record<string, string> = {}
    if (selStatus)  params.store_status = selStatus
    if (selCluster) params.cluster_type = selCluster
    if (selRegion)  params.region_type  = selRegion
    if (selTag)     params.store_tag    = selTag
    if (selDivisions.length > 0) params.division  = selDivisions.join(',')
    if (selCampaigns.length > 0) params.attribute1 = selCampaigns.join(',')
    params.source = src ?? source
    apiFetch<StoreSummaryData>('/nso/store-summary', params)
      .then(d => {
        setData(d)
        setLoading(false)
        if (onStoreOptions) {
          const names = Array.from(new Set(d.stores.map(s => s.store_f_name ?? s.store_name).filter(Boolean))).sort() as string[]
          onStoreOptions(names)
        }
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  const mountedRef = useRef(false)
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    load()
  }, [selStatus, selCluster, selRegion, selTag, selDivisions, selCampaigns, source]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportCSV() {
    if (!data?.stores.length) return
    const header = STORE_COLS.map(c => c.label).join(',')
    const body = data.stores.map(r =>
      STORE_COLS.map(c => {
        const v = r[c.key]
        if (c.type === 'lakh') return Number(v).toFixed(2)  // already in Lakhs
        if (c.type === 'pct')  return v == null ? '' : Number(v).toFixed(2)
        if (c.type === 'qty')  return v == null ? '' : String(Math.round(Number(v)))
        if (c.type === 'date') return fmtDate(v)
        return v == null ? '' : String(v)
      }).join(',')
    ).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nso_store_summary_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const stores = data?.stores ?? []

  function sortRows(rows: StoreRow[]) {
    return [...rows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const an = Number(av), bn = Number(bv)
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  function handleSort(key: string) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(key); setSortDir('desc') }
  }

  const storeMatch = (r: StoreRow) =>
    selStores.length === 0 || selStores.includes(r.store_f_name ?? '') || selStores.includes(r.store_name)
  const active   = sortRows(stores.filter(r => String(r.store_status ?? '').toUpperCase() === 'ACTIVE' && storeMatch(r)))
  const upcoming = sortRows(stores.filter(r => String(r.store_status ?? '').toUpperCase().includes('UPCOMING') && storeMatch(r)))

  function StoreTable({ rows, title }: { rows: StoreRow[]; title: string }) {
    const color = title.startsWith('Active') ? C.green : '#7dd3fc'
    return (
      <>
        <tr>
          <td colSpan={STORE_COLS.length} style={{
            background: title.startsWith('Active') ? '#052e16' : '#0c1a2e',
            color, fontWeight: 700, fontSize: 11, padding: '6px 10px',
            letterSpacing: 0.5,
          }}>
            {title} ({rows.length})
          </td>
        </tr>
        {rows.map((row, i) => (
          <tr key={row.store_name + i} style={{ background: i % 2 === 0 ? C.surf2 : C.surf1 }}>
            {STORE_COLS.map(col => {
              const v = row[col.key]
              if (col.type === 'pct') {
                const n = Number(v)
                return (
                  <td key={col.key} style={{ ...S.tdPct, color: pctColor(isNaN(n) ? null : n) }}>
                    {v == null ? '—' : n.toFixed(1) + '%'}
                  </td>
                )
              }
              if (col.type === 'lakh') return <td key={col.key} style={S.tdNum}>{fmtLakh(v)}</td>
              if (col.type === 'qty')  return <td key={col.key} style={S.tdNum}>{fmtQty(v)}</td>
              if (col.type === 'date') return <td key={col.key} style={{ ...S.td, color: C.text2 }}>{fmtDate(v)}</td>
              if (col.key === 'store_name') return <td key={col.key} style={{ ...S.td, fontWeight: 700, color: C.blue }}>{String(v ?? '—')}</td>
              if (col.key === 'store_f_name') return <td key={col.key} style={{ ...S.td, minWidth: 160 }}>{String(v ?? '—')}</td>
              return <td key={col.key} style={S.td}>{v == null ? '—' : String(v)}</td>
            })}
          </tr>
        ))}
      </>
    )
  }

  // KPIs from store summary
  const totalMtd = stores.reduce((s, r) => s + (Number(r.mtd_sl_v) || 0), 0)
  const totalPbs = stores.reduce((s, r) => s + (Number(r.pbs_v) || 0), 0)
  const totalStk = stores.reduce((s, r) => s + (Number(r.ttl_stk_v) || 0), 0)
  // STR = total_stk_v / portfolio_daily_rate
  // Per-store MTD days = min(opert_days, days elapsed in month)
  // e.g. SDH opened Aug 15 → 8 days; old store → 22 days
  const mtdDays = new Date().getDate() - 1 || 1
  const totalStkV = stores.reduce((s, r) => s + (Number(r.stk_v) || 0), 0)
  const portfolioDailyRate = stores.reduce((s, r) => {
    const storeMtdDays = Math.min(Number(r.opert_days) || 0, mtdDays)
    const mtd = Number(r.mtd_sl_v) || 0
    return s + (storeMtdDays > 0 ? mtd / storeMtdDays : 0)
  }, 0)
  const totalSTR = portfolioDailyRate > 0 ? totalStkV / portfolioDailyRate : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 10 }}>
      {/* Store KPI row */}
      {data && (
        <div style={{ ...S.card, flexShrink: 0 }}>
          <div style={S.kpiRow}>
            {[
              { label: 'Total Stores', val: stores.length, color: C.blue, suffix: '' },
              { label: 'Active', val: active.length, color: C.green, suffix: '' },
              { label: 'Upcoming', val: upcoming.length, color: '#7dd3fc', suffix: '' },
              { label: 'MTD Sale(L)', val: totalMtd.toFixed(2), color: C.green, suffix: '' },
              { label: 'PBS Val(L)', val: totalPbs.toFixed(2), color: C.yellow, suffix: '' },
              { label: 'Stock Val(L)', val: totalStk.toFixed(2), color: C.yellow, suffix: '' },
              { label: 'STR (days)', val: totalSTR.toFixed(1), color: '#c084fc', suffix: '' },
            ].map(k => (
              <div key={k.label} style={S.kpi}>
                <div style={{ ...S.kpiVal, color: k.color }}>{k.val}</div>
                <div style={S.kpiLabel}>{k.label}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Toggle pill: NSO ↔ All Chain */}
              <div
                onClick={!loading ? onToggleSource : undefined}
                title={source === 'nso' ? 'Showing NSO stores only — click to switch to All Chain stores' : 'Showing All Chain stores — click to switch to NSO stores only'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0,
                  border: `1px solid ${source === 'all' ? '#c084fc' : C.border}`,
                  borderRadius: 20, overflow: 'hidden', cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontWeight: 700, userSelect: 'none',
                }}
              >
                <span style={{
                  padding: '4px 10px',
                  background: source === 'nso' ? C.blue : 'transparent',
                  color: source === 'nso' ? '#fff' : C.text3,
                }}>NSO</span>
                <span style={{
                  padding: '4px 10px',
                  background: source === 'all' ? '#7c3aed' : 'transparent',
                  color: source === 'all' ? '#fff' : C.text3,
                }}>All Chain</span>
              </div>
              <button style={S.btnSm} onClick={() => load()} disabled={loading}>
                {loading ? '⋯' : '↻ Reload'}
              </button>
              {data && <button style={S.btnSm} onClick={exportCSV}>⬇ CSV</button>}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ ...S.card, background: '#450a0a', border: `1px solid ${C.red}` }}>
          <div style={{ padding: '12px 14px', color: C.red, fontSize: 13 }}>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {loading && <div style={{ ...S.card, ...S.empty }}>Loading store summary…</div>}

      {/* ── Mobile store cards ── */}
      {isMobile && !loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 80 }}>
          {/* Sort selector row */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>Sort:</span>
            {[
              { key: 'mtd_sl_v',  label: 'MTD Sale' },
              { key: 'ach_pct',   label: 'Ach%' },
              { key: 'fill_rate', label: 'Fill%' },
              { key: 'pbs_v',     label: 'PBS Val' },
              { key: 'ttl_stk_v', label: 'Stk Val' },
              { key: 'opert_days',label: 'Oper Days' },
            ].map(opt => (
              <button key={opt.key} onClick={() => handleSort(opt.key)} style={{
                fontSize: 10, padding: '4px 9px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${sortCol === opt.key ? '#3b82f6' : '#334155'}`,
                background: sortCol === opt.key ? '#1e3a5f' : '#0f172a',
                color: sortCol === opt.key ? '#7dd3fc' : '#64748b', fontWeight: 600,
              }}>
                {opt.label}{sortCol === opt.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
              </button>
            ))}
          </div>
          {stores.length === 0 && <div style={{ ...S.card, ...S.empty }}>No stores found.</div>}
          {active.length === 0 && upcoming.length === 0 && stores.length > 0 && (
            <div style={{ ...S.card, ...S.empty }}>No stores match the selected store filter.</div>
          )}
          {active.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: 0.8, paddingLeft: 4 }}>
                ● Active ({active.length})
              </div>
              {active.map((row, i) => {
                const storeMtdDays = Math.min(Number(row.opert_days) || 0, mtdDays)
                const dailyRate = storeMtdDays > 0 ? (Number(row.mtd_sl_v) || 0) / storeMtdDays : 0
                const str = dailyRate > 0 ? (Number(row.stk_v) || 0) / dailyRate : undefined
                return <MobileStoreCard key={row.store_name + i} row={row} str={str} />
              })}
            </>
          )}
          {upcoming.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 0.8, paddingLeft: 4, marginTop: 6 }}>
                ● Upcoming ({upcoming.length})
              </div>
              {upcoming.map((row, i) => (
                <MobileStoreCard key={row.store_name + i} row={row} />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Desktop store table ── */}
      {!isMobile && !loading && data && (
        <div style={{ ...S.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...S.tblWrap }}>
            <table style={{ ...S.tbl, minWidth: 1600 }}>
              <thead>
                <tr>
                  {STORE_COLS.map(col => (
                    <th key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        ...(col.type === 'text' || col.type === 'date' ? S.th : S.thNum),
                        cursor: 'pointer', userSelect: 'none',
                        background: sortCol === col.key ? '#1e3a5f' : C.bg,
                        color: sortCol === col.key ? '#7dd3fc' : undefined,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}{sortCol === col.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.length > 0 && <StoreTable rows={active} title="Active Stores" />}
                {upcoming.length > 0 && <StoreTable rows={upcoming} title="Upcoming Stores" />}
                {stores.length === 0 && (
                  <tr><td colSpan={STORE_COLS.length} style={S.empty}>No stores found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '6px 14px', borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.text3 }}>
            {stores.length} stores · {data.elapsed_ms} ms · V_NSO article aggregation · MTD sale = NSO-plan articles only
          </div>
        </div>
      )}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a', surf1: '#1e293b', surf2: '#0f172a',
  border: '#334155', border2: '#1e293b',
  text: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  blue: '#38bdf8', green: '#4ade80', yellow: '#facc15', red: '#f87171',
}
const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 100px)', minHeight: 0 },
  card: { background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8 },
  cardHead: { padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: C.text },
  filterRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  select: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: '5px 10px' },
  btn: { background: C.blue, border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnSm: { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.text2, fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  tblWrap: { overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0 },
  tbl: { borderCollapse: 'separate' as const, borderSpacing: 0, width: '100%', minWidth: 1400, fontSize: 11 },
  th: {
    background: C.bg, color: C.text3, fontWeight: 600,
    padding: '6px 10px', textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 2,
    borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: 0.4,
  },
  thNum: {
    background: C.bg, color: C.text3, fontWeight: 600,
    padding: '6px 10px', textAlign: 'right' as const,
    whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 2,
    borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: 0.4,
  },
  td: { padding: '6px 10px', color: C.text, borderBottom: `1px solid ${C.border2}`, whiteSpace: 'nowrap' as const, fontSize: 11 },
  tdNum: { padding: '6px 10px', textAlign: 'right' as const, borderBottom: `1px solid ${C.border2}`, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const, fontSize: 11, color: '#7dd3fc' },
  tdPct: { padding: '6px 10px', textAlign: 'right' as const, borderBottom: `1px solid ${C.border2}`, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const, fontSize: 11, fontWeight: 700 },
  kpiRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, padding: '10px 14px' },
  kpi: { background: C.bg, borderRadius: 6, padding: '8px 12px', minWidth: 110, border: `1px solid ${C.border}` },
  kpiVal: { fontSize: 18, fontWeight: 700, color: C.blue, fontVariantNumeric: 'tabular-nums' as const },
  kpiLabel: { fontSize: 10, color: C.text3, marginTop: 2 },
  empty: { padding: 40, textAlign: 'center' as const, color: C.text3, fontSize: 13 },
  badge: { display: 'inline-block', borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '1px 7px' },
}

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return m
}

// ── Derived KPIs ───────────────────────────────────────────────────────────────
function deriveKPIs(rows: Record<string, unknown>[]) {
  if (!rows.length) return null
  const num = (col: string) => rows.reduce((s, r) => s + (Number(r[col]) || 0), 0)
  const stores = new Set(rows.map(r => r['store_name'] ?? r['STORE_NAME']))
  const status = (r: Record<string, unknown>) => String(r['store_status'] ?? r['STORE_STATUS'] ?? '').toUpperCase()
  const active = rows.filter(r => status(r) === 'ACTIVE')
  const upcoming = rows.filter(r => status(r).includes('UPCOMING'))
  return {
    total: stores.size,
    active: new Set(active.map(r => r['store_name'] ?? r['STORE_NAME'])).size,
    upcoming: new Set(upcoming.map(r => r['store_name'] ?? r['STORE_NAME'])).size,
    pbsQ: num('pbs_q'), ttlStkQ: num('ttl_stk_q'),
    pbsV: num('pbs_v'), ttlStkV: num('ttl_stk_v'),
    toV: num('to_v'), mtdSlv: num('mtd_sl_v'),
  }
}

// ── Status badge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const s = String(status).toUpperCase()
  const bg = s === 'ACTIVE' ? '#14532d' : '#1e3a5f'
  const color = s === 'ACTIVE' ? '#4ade80' : '#7dd3fc'
  const border = s === 'ACTIVE' ? '#16a34a' : '#3b82f6'
  return <span style={{ ...S.badge, background: bg, color, border: `1px solid ${border}` }}>{status}</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function NSODashboard() {
  const isMobile = useIsMobile()

  const [filters, setFilters] = useState<NSOFilters>({
    attribute1: [], store_status: [], division: [], cluster_type: [], region_type: [], store_tag: []
  })
  const [selStatuses, setSelStatuses]   = useState<string[]>([])
  const [selClusters, setSelClusters]   = useState<string[]>([])
  const [selRegions, setSelRegions]     = useState<string[]>([])
  const [selTags, setSelTags]           = useState<string[]>([])
  const [selDivisions, setSelDivisions] = useState<string[]>([])
  const [selCampaigns, setSelCampaigns] = useState<string[]>([])
  const [selStores, setSelStores]     = useState<string[]>([])
  const [storeOptions, setStoreOptions] = useState<string[]>([])
  const [search, setSearch]         = useState('')

  const [tab, setTab]           = useState<'store' | 'article'>('store')
  const [source, setSource]     = useState<'nso' | 'all'>('nso')
  const [data, setData]         = useState<NSOData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [artSortCol, setArtSortCol] = useState('')
  const [artSortDir, setArtSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSource() { setSource(s => s === 'nso' ? 'all' : 'nso'); setSelStores([]); setStoreOptions([]) }
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  // Load filter options once
  useEffect(() => {
    apiFetch<NSOFilters>('/nso/filters').then(setFilters).catch(e => setError(String(e)))
  }, [])

  function load() {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = { limit: '50000', source }
    if (selCampaigns.length)   params.attribute1   = selCampaigns.join(',')
    if (selDivisions.length)   params.division     = selDivisions.join(',')
    if (selStatuses.length)    params.store_status = selStatuses.join(',')
    if (selClusters.length)    params.cluster_type = selClusters.join(',')
    if (selRegions.length)     params.region_type  = selRegions.join(',')
    if (selTags.length)        params.store_tag    = selTags.join(',')
    apiFetch<NSOData>('/nso/data', params)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  // Load article data only when user switches to article tab (lazy)
  useEffect(() => { if (tab === 'article') load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-reload when any server-side filter or source changes (only if data already loaded)
  useEffect(() => {
    if (data && tab === 'article') load()
  }, [selCampaigns, selDivisions, selStatuses, selClusters, selRegions, selTags, source]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered rows (client-side text search)
  const rows = data?.rows ?? []
  const cols = data?.columns ?? []

  const storeFiltered = selStores.length > 0
    ? rows.filter(r => selStores.includes(String(r['store_f_name'] ?? '')) || selStores.includes(String(r['store_name'] ?? '')))
    : rows
  const filtered = search.trim()
    ? storeFiltered.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : storeFiltered

  const visible = artSortCol
    ? [...filtered].sort((a, b) => {
        const av = a[artSortCol], bv = b[artSortCol]
        if (av == null && bv == null) return 0
        if (av == null) return 1; if (bv == null) return -1
        const an = Number(av), bn = Number(bv)
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv))
        return artSortDir === 'asc' ? cmp : -cmp
      })
    : filtered

  function handleArtSort(c: string) {
    if (artSortCol === c) setArtSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setArtSortCol(c); setArtSortDir('asc') }
  }

  const totalPages = Math.ceil(visible.length / PAGE_SIZE)
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset to page 1 when filter/search changes
  useEffect(() => { setPage(1) }, [visible.length])

  const kpis = deriveKPIs(visible)

  // Column display helpers
  const isPct = (c: string) => PCT_COLS.has(c)
  const isNum = (c: string) => NUM_COLS.has(c) || (data?.rows[0] && typeof data.rows[0][c] === 'number' && !isPct(c))

  function exportCSV() {
    if (!visible.length) return
    const header = cols.join(',')
    const body = visible.map(r => cols.map(c => {
      const v = r[c]
      const s = v == null ? '' : String(v)
      return s.includes(',') ? `"${s}"` : s
    }).join(',')).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nso_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const activeFilterCount = selStatuses.length + selClusters.length + selRegions.length + selTags.length + selDivisions.length + selCampaigns.length + selStores.length

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingBottom: 0 }}>

        {/* Mobile header */}
        <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>NSO Dashboard</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>New Store Opening Tracker</div>
            </div>
            {/* NSO/All pill */}
            <div onClick={toggleSource} style={{
              display: 'flex', alignItems: 'center',
              border: `1px solid ${source === 'all' ? '#c084fc' : '#334155'}`,
              borderRadius: 20, overflow: 'hidden', cursor: 'pointer',
              fontSize: 11, fontWeight: 700, userSelect: 'none',
            }}>
              <span style={{ padding: '5px 12px', background: source === 'nso' ? '#0ea5e9' : 'transparent', color: source === 'nso' ? '#fff' : '#64748b' }}>NSO</span>
              <span style={{ padding: '5px 12px', background: source === 'all' ? '#7c3aed' : 'transparent', color: source === 'all' ? '#fff' : '#64748b' }}>All Chain</span>
            </div>
          </div>
          {/* Tab + Filter row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {(['store', 'article'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: tab === t ? '#0ea5e9' : '#0f172a',
                color: tab === t ? '#fff' : '#64748b',
              }}>
                {t === 'store' ? '📊 Store' : '📋 Articles'}
              </button>
            ))}
            <button onClick={() => setFilterDrawerOpen(true)} style={{
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${activeFilterCount > 0 ? '#3b82f6' : '#334155'}`,
              background: activeFilterCount > 0 ? '#1e3a5f' : '#0f172a',
              color: activeFilterCount > 0 ? '#7dd3fc' : '#64748b', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            }}>
              ⚙ {activeFilterCount > 0 ? activeFilterCount : ''} Filters
            </button>
            {tab === 'article' && (
              <button onClick={() => load()} disabled={loading} style={{
                padding: '8px 14px', borderRadius: 8, border: 'none',
                background: '#0ea5e9', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
              }}>
                {loading ? '⋯' : '⚡'}
              </button>
            )}
          </div>
          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
              {[
                ...selStatuses.map(v => ({ label: v, clear: () => setSelStatuses(s => s.filter(x => x !== v)) })),
                ...selClusters.map(v => ({ label: `Zone: ${v}`, clear: () => setSelClusters(s => s.filter(x => x !== v)) })),
                ...selRegions.map(v => ({ label: `Rgn: ${v}`, clear: () => setSelRegions(s => s.filter(x => x !== v)) })),
                ...selDivisions.map(v => ({ label: `Div: ${v}`, clear: () => setSelDivisions(s => s.filter(x => x !== v)) })),
                ...selCampaigns.map(v => ({ label: `Camp: ${v}`, clear: () => setSelCampaigns(s => s.filter(x => x !== v)) })),
                ...selStores.map(v => ({ label: v, clear: () => setSelStores(s => s.filter(x => x !== v)) })),
              ].map((chip, i) => (
                <span key={i} onClick={chip.clear} style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 10, cursor: 'pointer',
                  background: '#1e3a5f', color: '#7dd3fc', border: '1px solid #3b82f6',
                }}>
                  {chip.label} ✕
                </span>
              ))}
            </div>
          )}
          {/* Search (article tab) */}
          {tab === 'article' && data && (
            <input
              ref={searchRef}
              placeholder="Search store or article…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...S.select, width: '100%', marginTop: 8, boxSizing: 'border-box' as const, fontSize: 13, padding: '9px 12px' }}
            />
          )}
        </div>

        {/* Mobile filter drawer */}
        <MobileFilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} activeCount={activeFilterCount}>
          <MobileMultiSelect label="Status"    options={filters.store_status} selected={selStatuses}  onChange={setSelStatuses}  />
          <MobileMultiSelect label="Zones"     options={filters.cluster_type} selected={selClusters}  onChange={setSelClusters}  />
          <MobileMultiSelect label="Regions"   options={filters.region_type}  selected={selRegions}   onChange={setSelRegions}   />
          {filters.store_tag.length > 0 && <MobileMultiSelect label="Tags" options={filters.store_tag} selected={selTags} onChange={setSelTags} />}
          <MobileMultiSelect label="Divisions" options={filters.division}     selected={selDivisions} onChange={setSelDivisions} />
          <MobileMultiSelect label="Campaigns" options={filters.attribute1}   selected={selCampaigns} onChange={setSelCampaigns} />
          <MobileMultiSelect label="Stores"    options={storeOptions}         selected={selStores}    onChange={setSelStores}    />
          <button onClick={() => { setFilterDrawerOpen(false) }} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            background: '#0ea5e9', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 4,
          }}>Apply Filters</button>
          {activeFilterCount > 0 && (
            <button onClick={() => { setSelStatuses([]); setSelClusters([]); setSelRegions([]); setSelTags([]); setSelDivisions([]); setSelCampaigns([]); setSelStores([]) }} style={{
              width: '100%', padding: '10px', borderRadius: 10, border: '1px solid #334155',
              background: 'transparent', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Clear All Filters</button>
          )}
        </MobileFilterDrawer>

        {/* Store View */}
        {tab === 'store' && (
          <div style={{ padding: '10px 12px', paddingBottom: 20 }}>
            <StoreSummary
              selStatus={selStatuses.join(',')} selCluster={selClusters.join(',')}
              selRegion={selRegions.join(',')} selTag={selTags.join(',')}
              selDivisions={selDivisions} selCampaigns={selCampaigns} selStores={selStores}
              source={source} onToggleSource={toggleSource} isMobile={true} onStoreOptions={setStoreOptions}
            />
          </div>
        )}

        {/* Article View mobile */}
        {tab === 'article' && (
          <div style={{ padding: '10px 12px', paddingBottom: 20 }}>
            {/* KPI strip */}
            {kpis && (
              <MobileKPIStrip items={[
                { label: 'Stores', val: kpis.total.toString(), color: '#38bdf8' },
                { label: 'Active', val: kpis.active.toString(), color: '#4ade80' },
                { label: 'PBS Val', val: (kpis.pbsV / 100000).toFixed(1) + 'L', color: '#facc15' },
                { label: 'Stk Val', val: (kpis.ttlStkV / 100000).toFixed(1) + 'L', color: '#7dd3fc' },
                { label: 'MTD Sale', val: (kpis.mtdSlv / 100000).toFixed(1) + 'L', color: '#4ade80' },
                { label: 'TO Val', val: (kpis.toV / 100000).toFixed(1) + 'L', color: '#c084fc' },
              ]} />
            )}
            {!data && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569', fontSize: 14 }}>
                Tap ⚡ to load article data
              </div>
            )}
            {loading && <div style={{ textAlign: 'center', padding: '40px 20px', color: '#38bdf8', fontSize: 14 }}>Loading…</div>}
            {error && <div style={{ background: '#450a0a', border: '1px solid #f87171', borderRadius: 10, padding: 14, color: '#f87171', fontSize: 13 }}>{error}</div>}
            {data && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <div style={{ fontSize: 10, color: '#64748b', paddingLeft: 2 }}>
                  {visible.length.toLocaleString()} rows · ⚡ Parquet
                </div>
                {paged.map((row, i) => {
                  const artName = row['article_name'] ?? row['ARTICLE_NAME'] ?? ''
                  const storeName = row['store_f_name'] ?? row['store_name'] ?? ''
                  const div = row['division'] ?? ''
                  const camp = row['attribute1'] ?? ''
                  const status = String(row['store_status'] ?? '')
                  const isActive = status.toUpperCase() === 'ACTIVE'
                  return (
                    <div key={i} style={{
                      background: '#1e293b', border: `1px solid ${isActive ? '#16a34a33' : '#3b82f633'}`,
                      borderLeft: `3px solid ${isActive ? '#16a34a' : '#3b82f6'}`,
                      borderRadius: 10, padding: '10px 12px',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#e2e8f0', marginBottom: 4 }}>{String(artName || '—')}</div>
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                        <span>🏪 {String(storeName)}</span>
                        {div && <span>📁 {String(div)}</span>}
                        {camp && <span>🏷 {String(camp)}</span>}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                        {[
                          { label: 'PBS Q', val: fmtQty(row['pbs_q']) },
                          { label: 'Stk Q', val: fmtQty(row['ttl_stk_q'] ?? row['stk_q']) },
                          { label: 'MTD Sl', val: fmtQty(row['mtd_sl_q']) },
                          { label: 'PBS V(L)', val: fmtLakh(row['pbs_v']) },
                          { label: 'Stk V(L)', val: fmtLakh(row['ttl_stk_v'] ?? row['stk_v']) },
                          { label: 'TO V(L)', val: fmtLakh(row['to_v']) },
                        ].map(m => (
                          <div key={m.label} style={{ background: '#0f172a', borderRadius: 5, padding: '4px 6px' }}>
                            <div style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 600 }}>{m.val}</div>
                            <div style={{ fontSize: 9, color: '#475569' }}>{m.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '12px 0', alignItems: 'center' }}>
                    <button style={{ ...S.btnSm, padding: '6px 14px' }} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{page}/{totalPages}</span>
                    <button style={{ ...S.btnSm, padding: '6px 14px' }} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div style={{ ...S.page, height: 'calc(100vh - 100px)' }}>

      {/* ── Header + filters ── */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>NSO Dashboard</div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
                New Store Opening — performance tracker · data from Master Data parquet
              </div>
            </div>
          </div>
          <div style={S.filterRow}>
            {/* Tab switcher */}
            {(['store', 'article'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                ...S.btnSm,
                background: tab === t ? C.blue : 'transparent',
                color: tab === t ? '#fff' : C.text2,
                fontWeight: tab === t ? 700 : 400,
              }}>
                {t === 'store' ? '📊 Store View' : '📋 Article Detail'}
              </button>
            ))}
            {/* NSO / All Chain pill — visible on both tabs */}
            <div
              onClick={toggleSource}
              title={source === 'nso' ? 'NSO stores only — click for All Chain' : 'All Chain stores — click for NSO only'}
              style={{
                display: 'flex', alignItems: 'center',
                border: `1px solid ${source === 'all' ? '#c084fc' : C.border}`,
                borderRadius: 20, overflow: 'hidden', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, userSelect: 'none',
              }}
            >
              <span style={{ padding: '4px 10px', background: source === 'nso' ? C.blue : 'transparent', color: source === 'nso' ? '#fff' : C.text3 }}>NSO</span>
              <span style={{ padding: '4px 10px', background: source === 'all' ? '#7c3aed' : 'transparent', color: source === 'all' ? '#fff' : C.text3 }}>All Chain</span>
            </div>
            <div style={{ width: 1, height: 20, background: C.border }} />
            <MultiSelect label="Status"   options={filters.store_status} selected={selStatuses}  onChange={setSelStatuses}  />
            <MultiSelect label="Zones"    options={filters.cluster_type} selected={selClusters}  onChange={setSelClusters}  />
            <MultiSelect label="Regions"  options={filters.region_type}  selected={selRegions}   onChange={setSelRegions}   />
            {filters.store_tag.length > 0 && (
              <MultiSelect label="Tags" options={filters.store_tag} selected={selTags} onChange={setSelTags} />
            )}
            <MultiSelect label="Divisions" options={filters.division}   selected={selDivisions} onChange={setSelDivisions} />
            <MultiSelect label="Campaigns" options={filters.attribute1} selected={selCampaigns} onChange={setSelCampaigns} />
            <SearchableMultiSelect label="Stores" options={storeOptions} selected={selStores} onChange={setSelStores} />
            {tab === 'article' && (
              <>
                <button style={S.btn} onClick={() => load()} disabled={loading}>
                  {loading ? '⋯ Loading…' : '⚡ Load'}
                </button>
                {data && <button style={S.btnSm} onClick={exportCSV}>⬇ CSV</button>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Store View Tab ── */}
      {tab === 'store' && (
        <StoreSummary
          selStatus={selStatuses.join(',')} selCluster={selClusters.join(',')}
          selRegion={selRegions.join(',')} selTag={selTags.join(',')}
          selDivisions={selDivisions} selCampaigns={selCampaigns} selStores={selStores}
          source={source} onToggleSource={toggleSource} isMobile={false} onStoreOptions={setStoreOptions}
        />
      )}

      {/* ── Article Detail Tab ── */}
      {tab === 'article' && (
        <>
          {/* KPI strip */}
          {kpis && (
            <div style={{ ...S.card, flexShrink: 0 }}>
              <div style={S.kpiRow}>
                {[
                  { label: 'Total Stores', val: kpis.total.toLocaleString(), color: C.blue },
                  { label: 'Active', val: kpis.active.toLocaleString(), color: C.green },
                  { label: 'Upcoming', val: kpis.upcoming.toLocaleString(), color: '#7dd3fc' },
                  { label: 'PBS Qty', val: (kpis.pbsQ / 1000).toFixed(1) + 'K', color: C.blue },
                  { label: 'Stock Qty', val: (kpis.ttlStkQ / 1000).toFixed(1) + 'K', color: C.blue },
                  { label: 'PBS Value (L)', val: (kpis.pbsV / 100000).toFixed(2), color: C.yellow },
                  { label: 'Stock Value (L)', val: (kpis.ttlStkV / 100000).toFixed(2), color: C.yellow },
                  { label: 'Turnover (L)', val: (kpis.toV / 100000).toFixed(2), color: C.green },
                  { label: 'MTD Sales (L)', val: (kpis.mtdSlv / 100000).toFixed(2), color: C.green },
                ].map(k => (
                  <div key={k.label} style={S.kpi}>
                    <div style={{ ...S.kpiVal, color: k.color }}>{k.val}</div>
                    <div style={S.kpiLabel}>{k.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{ ...S.card, background: '#450a0a', border: `1px solid ${C.red}` }}>
              <div style={{ padding: '12px 14px', color: C.red, fontSize: 13 }}>
                <strong>Error:</strong> {error}
              </div>
            </div>
          )}

          {/* Search */}
          {data && (
            <div style={{ ...S.card, padding: '8px 14px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <input
                ref={searchRef}
                placeholder="Search store name, status…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...S.select, flex: 1, maxWidth: 300 }}
              />
              <span style={{ fontSize: 11, color: C.text3 }}>
                {visible.length.toLocaleString()} / {rows.length.toLocaleString()} rows
                {data.total_cached ? ` (${data.total_cached.toLocaleString()} cached)` : ''}
                {` · ${data.elapsed_ms} ms`}
              </span>
            </div>
          )}

          {loading && <div style={{ ...S.card, ...S.empty }}>Loading V_NSO data…</div>}

          {!loading && data && cols.length > 0 && (
            <div style={{ ...S.card, ...(isMobile ? {} : { flex: 1, minHeight: 0 }), display: 'flex', flexDirection: 'column' }}>
              <div style={{ ...S.tblWrap, ...(isMobile ? { overflowY: 'visible', flex: 'unset', minHeight: 'unset' } : {}) }}>
                <table style={S.tbl}>
                  <thead>
                    <tr>
                      {cols.map(c => (
                        <th key={c}
                          onClick={() => handleArtSort(c)}
                          style={{
                            ...(isPct(c) || isNum(c) ? S.thNum : S.th),
                            cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                            background: artSortCol === c ? '#1e3a5f' : C.bg,
                            color: artSortCol === c ? '#7dd3fc' : undefined,
                          }}
                        >
                          {c.replace(/_/g, ' ')}{artSortCol === c ? (artSortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.length === 0 && (
                      <tr><td colSpan={cols.length} style={S.empty}>No rows match filters.</td></tr>
                    )}
                    {paged.map((row, i) => {
                      const status = String(row['store_status'] ?? row['STORE_STATUS'] ?? '')
                      const rowBg = i % 2 === 0 ? statusColor(status) : 'transparent'
                      return (
                        <tr key={i} style={{ background: rowBg }}>
                          {cols.map(c => {
                            const val = row[c]
                            if (c === 'store_status' || c === 'STORE_STATUS') {
                              return <td key={c} style={S.td}><StatusBadge status={String(val ?? '')} /></td>
                            }
                            if (isPct(c)) {
                              const n = Number(val)
                              return (
                                <td key={c} style={{ ...S.tdPct, color: pctColor(isNaN(n) ? null : n) }}>
                                  {fmtPct(val)}
                                </td>
                              )
                            }
                            if (isNum(c)) {
                              return <td key={c} style={S.tdNum}>{fmtNum(val)}</td>
                            }
                            return <td key={c} style={S.td}>{val == null ? '—' : String(val)}</td>
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 14px', borderTop: `1px solid ${C.border}`, justifyContent: 'center', fontSize: 12, color: C.text2 }}>
                  <button style={S.btnSm} disabled={page === 1} onClick={() => setPage(1)}>«</button>
                  <button style={S.btnSm} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                  <span>{page} / {totalPages} &nbsp;({visible.length.toLocaleString()} rows)</span>
                  <button style={S.btnSm} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
                  <button style={S.btnSm} disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
                </div>
              )}
            </div>
          )}

          {!loading && !data && !error && (
            <div style={{ ...S.card, ...S.empty }}>
              Select filters above, then click <strong>Load</strong>.
            </div>
          )}
        </>
      )}
    </div>
  )
}
