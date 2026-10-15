/**
 * Distribution Model — replenishment distribution engine.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import http from '@/api/http'
import StaleBanner from '@/components/StaleBanner'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useTheme } from '@/context/ThemeContext'


async function apiFetch<T>(method: string, url: string, params?: Record<string, string>, timeout?: number): Promise<T> {
  const fullUrl = params
    ? `${url}?${new URLSearchParams(params).toString()}`
    : url
  const res = await http.request<{ success: boolean; data: T; message: string | null }>({ method, url: fullUrl, timeout })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

type ReqSource  = 'GRC' | 'WMS' | 'BOTH'
type BizSegment = 'APPS' | 'GM' | 'BOTH'
type SortMode   = 'fill_rate' | 'combined_req' | 'festive_req'

interface ItemMasterStatus { ready: boolean; rows: number; cached_at: string | null }
interface BaseResult { rows: number; columns: string[]; elapsed_ms: number; sample: Record<string, unknown>[] }
interface StoreFieldMeta { label: string; values: string[] }

interface DistResult {
  ol_held_count?: number
  rows: number; elapsed_ms: number; max_round: number
  total_allocated: number; stores_covered: number
  icodes_total: number; icodes_fully_covered: number
  columns: string[]; sample: Record<string, unknown>[]
}

// ── Pill toggle ────────────────────────────────────────────────────────────────
function PillToggle<T extends string>({
  label, options, value, onChange, accent,
}: {
  label: string; options: { val: T; text: string }[]
  value: T; onChange: (v: T) => void; accent: string
}) {
  const { tokens } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: tokens.textMuted, minWidth: 90 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {options.map(o => (
          <button key={o.val} onClick={() => onChange(o.val)} style={{
            padding: '4px 14px', fontSize: 12, borderRadius: 20, border: 'none',
            cursor: 'pointer', fontWeight: value === o.val ? 700 : 400,
            background: value === o.val ? accent : tokens.cardBg,
            color: value === o.val ? '#fff' : tokens.textMuted,
            transition: 'all 0.15s',
          }}>{o.text}</button>
        ))}
      </div>
    </div>
  )
}

// ── Multi-select dropdown ──────────────────────────────────────────────────────
function MultiSelect({
  label, options, selected, onChange, width = 200,
}: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; width?: number
}) {
  const { tokens } = useTheme()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))
  const allSelected = selected.length === 0

  function toggle(val: string) {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }

  const btnLabel = selected.length === 0 ? `${label} (all)` : `${label}: ${selected.length} selected`

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width, padding: '5px 10px', fontSize: 12, borderRadius: 6, textAlign: 'left',
          border: `1px solid ${selected.length > 0 ? '#6366f1' : tokens.cardBorder}`,
          background: selected.length > 0 ? '#6366f110' : tokens.cardBg,
          color: selected.length > 0 ? '#818cf8' : tokens.textMuted,
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: width - 28 }}>{btnLabel}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 999, width: Math.max(width, 220),
          background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,0.4)', padding: 8,
        }}>
          <input
            autoFocus
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 5, marginBottom: 6,
              border: `1px solid ${tokens.cardBorder}`, background: tokens.shellBg, color: tokens.textPrimary, boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button onClick={() => onChange([])} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${tokens.cardBorder}`, background: allSelected ? '#6366f1' : 'transparent', color: allSelected ? '#fff' : tokens.textMuted, cursor: 'pointer' }}>All</button>
            <button onClick={() => onChange([...options])} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${tokens.cardBorder}`, background: 'transparent', color: tokens.textMuted, cursor: 'pointer' }}>Select All</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.length === 0 && <div style={{ fontSize: 11, color: tokens.textMuted, padding: '4px 6px' }}>No results</div>}
            {filtered.map(opt => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', background: selected.includes(opt) ? '#6366f115' : 'transparent' }}>
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: '#6366f1', width: 13, height: 13 }} />
                <span style={{ fontSize: 12, color: tokens.textPrimary }}>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ ready }: { ready: boolean }) {
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: ready ? '#065f4620' : '#92400e20',
      color: ready ? '#34d399' : '#f59e0b',
    }}>{ready ? '✓ Cached' : '⚠ Not Downloaded'}</span>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────────
function DkCollapse({ title, badge, defaultOpen = true, children }: {
  title: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode
}) {
  const { tokens } = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: `1px solid ${tokens.cardBorder}`, borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          background: tokens.contentBg ?? tokens.cardBg, userSelect: 'none' as const }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textPrimary, flex: 1 }}>{title}</span>
        {badge}
        <span style={{ fontSize: 11, color: tokens.textMuted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${tokens.cardBorder}` }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Upload zone ────────────────────────────────────────────────────────────────
function DkUploadZone({ label, hint, active, filename, rows, uploading, onUpload, onClear, inputRef }: {
  label: string; hint: string; active?: boolean; filename?: string; rows?: number
  uploading?: boolean; onUpload: (f: File) => void; onClear?: () => void
  inputRef?: { current: HTMLInputElement | null }
}) {
  const { tokens } = useTheme()
  const localRef = useRef<HTMLInputElement>(null)
  const ref: { current: HTMLInputElement | null } = inputRef ?? localRef
  return (
    <div
      onClick={() => !active && ref.current?.click()}
      style={{
        border: active ? `1px solid #22c55e` : `1px dashed ${tokens.cardBorder ?? '#3a3a3c'}`,
        borderRadius: 8, padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 12, cursor: active ? 'default' : 'pointer',
        background: active ? '#1c3a2a22' : 'transparent',
        transition: 'border-color 0.15s',
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{active ? '✅' : '📂'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: tokens.textPrimary }}>{label}</div>
        {active && filename
          ? <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>{filename} · {rows?.toLocaleString('en-IN')} rows</div>
          : <div style={{ fontSize: 10, color: tokens.textMuted, fontFamily: 'monospace', marginTop: 2 }}>{hint}</div>}
      </div>
      {active && onClear && (
        <button onClick={e => { e.stopPropagation(); onClear() }}
          style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid #ef444440',
            background: 'transparent', color: '#f87171', cursor: 'pointer', flexShrink: 0 }}>
          Clear
        </button>
      )}
      {!active && (
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tokens.cardBg, color: tokens.textMuted,
          border: `1px solid ${tokens.cardBorder}`, flexShrink: 0 }}>
          {uploading ? 'Uploading…' : '+ Upload'}
        </span>
      )}
      <input ref={ref} type="file" accept=".csv" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
    </div>
  )
}


// ── localStorage helpers (survives hard refresh) ───────────────────────────────
const SS_KEY = 'ck_dist_state'
function ssLoad<T>(field: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(SS_KEY) ?? '{}'); return v[field] ?? fallback } catch { return fallback }
}
function ssSave(patch: Record<string, unknown>) {
  try {
    const cur = JSON.parse(localStorage.getItem(SS_KEY) ?? '{}')
    localStorage.setItem(SS_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {}
}

export default function DistributionModel() {
  const { tokens } = useTheme()
  const isMobile = useIsMobile()

  const [reqSource,   setReqSource]   = useState<ReqSource>(() => ssLoad('reqSource', 'GRC'))
  const [bizSegment,  setBizSegment]  = useState<BizSegment>(() => ssLoad('bizSegment', 'APPS'))
  const [sortMode,    setSortMode]    = useState<SortMode>(() => ssLoad('sortMode', 'combined_req'))
  const [reqFallback, setReqFallback] = useState<'parquet' | 'zero'>(() => ssLoad('reqFallback', 'parquet'))

  // Scope builder: each row = {divisions[], attribute1s[]} — rows are OR-combined
  const [scopes, setScopes] = useState<{divisions: string[]; attribute1s: string[]}[]>(() => ssLoad('scopes', [{ divisions: [], attribute1s: [] }]))
  const addScope    = () => setScopes(s => [...s, { divisions: [], attribute1s: [] }])
  const removeScope = (i: number) => setScopes(s => s.filter((_, idx) => idx !== i))
  const updateScope = (i: number, field: 'divisions' | 'attribute1s', val: string[]) =>
    setScopes(s => s.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const [selStores, setSelStores] = useState<string[]>(() => ssLoad('selStores', []))

  // Store master field filters: {col: label, values: string[]}
  const [storeFieldMeta, setStoreFieldMeta] = useState<Record<string, StoreFieldMeta>>({})
  // activeFieldFilters: col → selected values[]
  const [activeFieldFilters, setActiveFieldFilters] = useState<Record<string, string[]>>(() => ssLoad('activeFieldFilters', {}))
  // which fields the user has added as filter rows
  const [addedFilterFields, setAddedFilterFields] = useState<string[]>(() => ssLoad('addedFilterFields', []))
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false)
  const fieldPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (fieldPickerRef.current && !fieldPickerRef.current.contains(e.target as Node)) setFieldPickerOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  // Persist form state on change
  useEffect(() => { ssSave({ reqSource }) }, [reqSource])
  useEffect(() => { ssSave({ bizSegment }) }, [bizSegment])
  useEffect(() => { ssSave({ sortMode }) }, [sortMode])
  useEffect(() => { ssSave({ scopes }) }, [scopes])
  useEffect(() => { ssSave({ selStores }) }, [selStores])
  useEffect(() => { ssSave({ activeFieldFilters }) }, [activeFieldFilters])
  useEffect(() => { ssSave({ addedFilterFields }) }, [addedFilterFields])

  const [divisionOptions,   setDivisionOptions]   = useState<string[]>([])
  const [attribute1Options, setAttribute1Options] = useState<string[]>([])
  const [storeOptions,      setStoreOptions]      = useState<string[]>([])

  useEffect(() => {
    http.get('/master/divisions').then(r => {
      setDivisionOptions(r.data?.data?.divisions ?? [])
    }).catch(() => {})
    http.get('/req/filter_meta').then(r => {
      const vals: string[] = r.data?.data?.attribute1s ?? []
      setAttribute1Options(vals.length > 0 ? vals : ['GM','HVY WINTER','LT WINTER','OCCASIONAL','PREWINTER','REGULAR','RETAIL','SUMMER'])
    }).catch(() => {
      setAttribute1Options(['GM','HVY WINTER','LT WINTER','OCCASIONAL','PREWINTER','REGULAR','RETAIL','SUMMER'])
    })
    http.get('/distribution/store-list').then(r => {
      const stores: string[] = r.data?.data?.stores ?? []
      setStoreOptions(stores)
    }).catch(() => {})
    http.get('/distribution/store-filter-meta').then(r => {
      setStoreFieldMeta(r.data?.data?.fields ?? {})
    }).catch(() => {})
  }, [])

  // ── CSV Stock Upload ────────────────────────────────────────────────────────
  const [csvUploadActive, setCsvUploadActive] = useState(false)
  const [csvUploadMeta,   setCsvUploadMeta]   = useState<{filename: string; rows: number; qty_col: string} | null>(null)
  const [csvUploading,    setCsvUploading]    = useState(false)
  const [csvUploadMsg,    setCsvUploadMsg]    = useState<string | null>(null)
  const csvInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    http.get('/distribution/upload-stock-csv/status').then(r => {
      const d = r.data?.data
      if (d?.active) { setCsvUploadActive(true); setCsvUploadMeta({ filename: d.filename, rows: d.rows, qty_col: d.qty_col }) }
    }).catch(() => {})
  }, [])

  const handleCsvUpload = async (file: File) => {
    setCsvUploading(true); setCsvUploadMsg(null)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await http.post<{ success: boolean; data: { filename: string; rows: number; qty_col: string }; message: string }>('/distribution/upload-stock-csv', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (res.data.success) {
        setCsvUploadActive(true); setCsvUploadMeta(res.data.data)
        setCsvUploadMsg(`✓ ${res.data.message}`)
      } else { setCsvUploadMsg(`✗ ${res.data.message}`) }
    } catch (e: any) { setCsvUploadMsg(`✗ ${e?.response?.data?.message ?? e?.message ?? 'Upload failed'}`) }
    finally { setCsvUploading(false) }
  }

  const clearCsvUpload = async () => {
    await http.delete('/distribution/upload-stock-csv').catch(() => {})
    setCsvUploadActive(false); setCsvUploadMeta(null); setCsvUploadMsg(null)
  }

  // ── Store Priority CSVs (Fill-Rate + Override) ────────────────────────────
  type PriorityCsvKey = 'fill_rate' | 'override'
  const PRIORITY_CSV_SPECS: { key: PriorityCsvKey; label: string; hint: string }[] = [
    { key: 'fill_rate', label: 'Fill-Rate Priority', hint: 'DEPARTMENT, STORE_NAME, FILL_RATE_RANK' },
    { key: 'override',  label: 'Store Override Priority', hint: 'STORE_NAME, OVERRIDE_RANK' },
  ]
  const [priorityMeta,      setPriorityMeta]      = useState<Partial<Record<PriorityCsvKey, {filename: string; rows: number}>>>({})
  const [priorityUploading, setPriorityUploading] = useState<Partial<Record<PriorityCsvKey, boolean>>>({})
  const [priorityMsg,       setPriorityMsg]       = useState<Partial<Record<PriorityCsvKey, string>>>({})
  const priorityRefs = useRef<Partial<Record<PriorityCsvKey, HTMLInputElement | null>>>({})

  useEffect(() => {
    http.get('/distribution/upload-store-priority/status').then(r => {
      setPriorityMeta(r.data?.data ?? {})
    }).catch(() => {})
  }, [])

  const handlePriorityUpload = async (key: PriorityCsvKey, file: File) => {
    setPriorityUploading(p => ({ ...p, [key]: true })); setPriorityMsg(p => ({ ...p, [key]: undefined }))
    try {
      const form = new FormData(); form.append('file', file)
      const res = await http.post<{ success: boolean; data: { filename: string; rows: number }; message: string }>(`/distribution/upload-store-priority/${key}`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (res.data.success) { setPriorityMeta(p => ({ ...p, [key]: res.data.data })); setPriorityMsg(p => ({ ...p, [key]: `✓ ${res.data.message}` })) }
      else { setPriorityMsg(p => ({ ...p, [key]: `✗ ${res.data.message}` })) }
    } catch (e: any) { setPriorityMsg(p => ({ ...p, [key]: `✗ ${(e as any)?.response?.data?.message ?? (e as any)?.message ?? 'Upload failed'}` })) }
    finally { setPriorityUploading(p => ({ ...p, [key]: false })) }
  }

  const clearPriority = async (key: PriorityCsvKey) => {
    await http.delete(`/distribution/upload-store-priority/${key}`).catch(() => {})
    setPriorityMeta(p => { const n = { ...p }; delete n[key]; return n })
    setPriorityMsg(p => { const n = { ...p }; delete n[key]; return n })
  }


  // ── REQ CSV Uploads (Step 2) ───────────────────────────────────────────────
  type ReqCsvKey = 'barcode' | 'mc' | 'art' | 'mrp' | 'size'
  const REQ_CSV_SPECS: { key: ReqCsvKey; label: string; hint: string }[] = [
    { key: 'barcode', label: 'Barcode × Store REQ', hint: 'ICODE, STORE_NAME, REQ' },
    { key: 'mc',      label: 'MC REQ',              hint: 'DEPARTMENT, DISPLAY_TYPE, STORE_NAME, REQ' },
    { key: 'art',     label: 'ART REQ',             hint: 'DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, STORE_NAME, REQ' },
    { key: 'mrp',     label: 'MRP REQ',             hint: 'DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, MRP, STORE_NAME, REQ' },
    { key: 'size',    label: 'SIZE REQ',            hint: 'DEPARTMENT, DISPLAY_TYPE, ARTICLE_NAME, CAT4, STORE_NAME, SZ_REQ' },
  ]
  const [reqCsvMeta,    setReqCsvMeta]    = useState<Partial<Record<ReqCsvKey, {filename: string; rows: number}>>>({})
  const [reqCsvUploading, setReqCsvUploading] = useState<Partial<Record<ReqCsvKey, boolean>>>({})
  const [reqCsvMsg,     setReqCsvMsg]     = useState<Partial<Record<ReqCsvKey, string>>>({})
  const reqCsvRefs = useRef<Partial<Record<ReqCsvKey, HTMLInputElement | null>>>({})

  useEffect(() => {
    http.get('/distribution/upload-req-csv/status').then(r => {
      const d = r.data?.data ?? {}
      setReqCsvMeta(d)
    }).catch(() => {})
  }, [])

  const handleReqCsvUpload = async (key: ReqCsvKey, file: File) => {
    setReqCsvUploading(p => ({ ...p, [key]: true })); setReqCsvMsg(p => ({ ...p, [key]: undefined }))
    try {
      const form = new FormData(); form.append('file', file)
      const res = await http.post<{ success: boolean; data: { filename: string; rows: number }; message: string }>(`/distribution/upload-req-csv/${key}`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (res.data.success) { setReqCsvMeta(p => ({ ...p, [key]: res.data.data })); setReqCsvMsg(p => ({ ...p, [key]: `✓ ${res.data.message}` })) }
      else { setReqCsvMsg(p => ({ ...p, [key]: `✗ ${res.data.message}` })) }
    } catch (e: any) { setReqCsvMsg(p => ({ ...p, [key]: `✗ ${e?.response?.data?.message ?? e?.message ?? 'Upload failed'}` })) }
    finally { setReqCsvUploading(p => ({ ...p, [key]: false })) }
  }

  const clearReqCsv = async (key: ReqCsvKey) => {
    await http.delete(`/distribution/upload-req-csv/${key}`).catch(() => {})
    setReqCsvMeta(p => { const n = { ...p }; delete n[key]; return n })
    setReqCsvMsg(p => { const n = { ...p }; delete n[key]; return n })
  }

  const [imStatus,    setImStatus]    = useState<ItemMasterStatus | null>(null)
  const [olStatus,    setOlStatus]    = useState<{ready: boolean; rows: number; cached_at?: string} | null>(null)
  const [olDownloading, setOlDownloading] = useState(false)
  const [applyOL,     setApplyOL]     = useState(() => ssLoad('applyOL', false))

  const [baseLoading, setBaseLoading] = useState(false)
  const [baseResult,  setBaseResult]  = useState<BaseResult | null>(null)
  const [baseMsg,     setBaseMsg]     = useState<string | null>(null)

  const [baseCacheReady, setBaseCacheReady] = useState(false)
  const [maxRound, setMaxRound] = useState(() => ssLoad('maxRound', 10))

  const [distLoading,   setDistLoading]   = useState(false)
  const [distResult,    setDistResult]    = useState<DistResult | null>(null)
  const [distMsg,       setDistMsg]       = useState<string | null>(null)
  const [fetchError,    setFetchError]    = useState<string | null>(null)

  // ── Hold Rules ─────────────────────────────────────────────────────────────
  type HoldRule =
    | { type: 'store'; stores: string[] }
    | { type: 'attr1'; attr1: string; except_stores: string[] }
  const [holdRules, setHoldRules] = useState<HoldRule[]>([])
  const [holdStoreSelected, setHoldStoreSelected] = useState<string[]>([])
  const [holdAttr1Selected, setHoldAttr1Selected] = useState<string[]>([])
  const [holdExceptSelected, setHoldExceptSelected] = useState<string[]>([])

  const addStoreHold = () => {
    const stores = holdStoreSelected.map(s => s.toUpperCase()).filter(Boolean)
    if (!stores.length) return
    setHoldRules(r => [...r.filter(x => x.type !== 'store'), { type: 'store', stores }])
    setHoldStoreSelected([])
  }
  const addAttr1Hold = () => {
    if (!holdAttr1Selected.length) return
    const a1 = holdAttr1Selected[0]
    const except = holdExceptSelected.map(s => s.toUpperCase())
    setHoldRules(r => [...r.filter(x => !(x.type === 'attr1' && x.attr1.toUpperCase() === a1.toUpperCase())), { type: 'attr1', attr1: a1, except_stores: except }])
    setHoldAttr1Selected([])
    setHoldExceptSelected([])
  }
  const removeHold = (idx: number) => setHoldRules(r => r.filter((_, i) => i !== idx))

  useEffect(() => { ssSave({ maxRound }) }, [maxRound])
  const [exportLoading, setExportLoading] = useState(false)
  const [invalidating, setInvalidating] = useState(false)
  const [invalidateMsg, setInvalidateMsg] = useState('')
  async function handleInvalidate() {
    if (!confirm('Distribution cache clear hoga — next load Oracle se fresh data lega. Continue?')) return
    setInvalidating(true)
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/cache/invalidate')
      setInvalidateMsg(res.data.message ?? 'Cache cleared')
    } catch { setInvalidateMsg('Error clearing cache') }
    setInvalidating(false)
    setTimeout(() => setInvalidateMsg(''), 4000)
  }

  const fetchImStatus = useCallback(async () => {
    try {
      const d = await apiFetch<ItemMasterStatus>('GET', '/distribution/item-master/status')
      setImStatus(d)
    } catch (e: any) {
      setFetchError(e?.response?.data?.message || 'Item master status fetch failed')
    }
  }, [])

  const fetchOlStatus = useCallback(async () => {
    try {
      const d = await apiFetch<{ready: boolean; rows: number; cached_at?: string}>('GET', '/distribution/option-listing/status')
      setOlStatus(d)
    } catch (e: any) {
      setFetchError(e?.response?.data?.message || 'Option listing status fetch failed')
    }
  }, [])

  useEffect(() => {
    fetchImStatus()
    fetchOlStatus()
    apiFetch<{ready: boolean}>('GET', '/distribution/base/status')
      .then(d => setBaseCacheReady(d.ready))
      .catch((e: any) => setFetchError(e?.response?.data?.message || 'Backend unreachable'))
  }, [fetchImStatus, fetchOlStatus])

  useEffect(() => { ssSave({ applyOL }) }, [applyOL])

  const buildBase = async () => {
    setBaseLoading(true); setBaseMsg(null); setBaseResult(null)
    try {
      const params: Record<string, string> = { req_source: reqSource, biz_segment: bizSegment, sort_mode: sortMode, req_fallback: reqFallback }
      const activeScopes = scopes.filter(s => s.divisions.length > 0 || s.attribute1s.length > 0)
      if (activeScopes.length > 0) params.scopes = JSON.stringify(activeScopes)
      if (selStores.length > 0) params.stores = JSON.stringify(selStores)
      const activeFF = Object.fromEntries(Object.entries(activeFieldFilters).filter(([, v]) => v.length > 0))
      if (Object.keys(activeFF).length > 0) params.store_field_filters = JSON.stringify(activeFF)
      const d = await apiFetch<BaseResult>('POST', '/distribution/build-base', params)
      setBaseResult(d)
      setBaseCacheReady(true)
      setBaseMsg(`✓ Base built — ${d.rows.toLocaleString('en-IN')} rows · ${d.columns.length} cols · ${Math.round(d.elapsed_ms / 1000)}s`)
    } catch (e: unknown) {
      setBaseMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally { setBaseLoading(false) }
  }

  const S = {
    page: { padding: isMobile ? '16px 12px' : '24px 32px', minHeight: '100vh', background: tokens.shellBg, color: tokens.textPrimary } as React.CSSProperties,
    card: { background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 10, padding: '18px 20px' } as React.CSSProperties,
    cardTitle: { fontSize: 12, fontWeight: 600, color: tokens.textMuted, marginBottom: 14, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
    btn: (color: string, disabled?: boolean) => ({
      padding: '7px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? tokens.cardBorder : color,
      color: '#fff', opacity: disabled ? 0.6 : 1,
    } as React.CSSProperties),
    msg: (ok: boolean) => ({ marginTop: 10, fontSize: 12, color: ok ? '#34d399' : '#f87171' } as React.CSSProperties),
  }

  const runDistribution = async () => {
    setDistLoading(true); setDistMsg(null); setDistResult(null)
    try {
      const res = await http.post<{ success: boolean; data: DistResult; message: string | null }>(
        `/distribution/distribute`,
        { wh_col: 'wh_q', max_round: maxRound, hold_rules: holdRules, apply_option_listing: applyOL },
        { timeout: 300_000 }
      )
      if (!res.data.success) throw new Error(res.data.message ?? 'API error')
      const d = res.data.data
      setDistResult(d)
      setDistMsg(`✓ Distribution done — ${d.total_allocated.toLocaleString('en-IN')} units allocated · ${Math.round(d.elapsed_ms / 1000)}s`)
    } catch (e: unknown) {
      setDistMsg(`✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally { setDistLoading(false) }
  }

  // ── Large-export modal state ────────────────────────────────────────────────
  interface DivisionRow { division: string; rows_total: number; rows_nonzero: number; rows_grc?: number | null; rows_wms?: number | null }
  const [exportModal, setExportModal] = useState<'csv' | 'xlsx' | null>(null)
  const [divSummary, setDivSummary] = useState<DivisionRow[] | null>(null)
  const [divSummaryTotal, setDivSummaryTotal] = useState(0)
  const [divSummaryLoading, setDivSummaryLoading] = useState(false)
  const [divDownloading, setDivDownloading] = useState<Record<string, boolean>>({})

  const openExportModal = async (fmt: 'csv' | 'xlsx') => {
    setExportModal(fmt)
    setDivSummary(null)
    setDivSummaryLoading(true)
    try {
      const res = await http.get<{ rows_total: number; divisions: DivisionRow[] }>(
        `/distribution/division-summary?max_round=${maxRound}`
      )
      setDivSummaryTotal(res.data.rows_total)
      setDivSummary(res.data.divisions)
    } catch { setDivSummary([]) } finally { setDivSummaryLoading(false) }
  }

  const doDownload = async (opts: { division?: string; exclude_zero?: boolean; fmt: 'csv' | 'xlsx' }) => {
    const { division = '', exclude_zero = false, fmt } = opts
    const key = division || (exclude_zero ? '__nonzero__' : '__all__')
    setDivDownloading(d => ({ ...d, [key]: true }))
    try {
      const endpoint = fmt === 'csv' ? '/distribution/export-csv' : '/distribution/export'
      const params = new URLSearchParams({ max_round: String(maxRound) })
      if (division) params.set('division', division)
      if (exclude_zero) params.set('exclude_zero', 'true')
      const res = await http.request<Blob>({
        method: 'POST',
        url: `${endpoint}?${params}`,
        responseType: 'blob',
        timeout: 120_000,
      })
      const mime = fmt === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const blob = new Blob([res.data], { type: mime })
      const cd = res.headers['content-disposition'] ?? ''
      const fname = cd.match(/filename="([^"]+)"/)?.[1] ?? `distribution_${Date.now()}.${fmt === 'csv' ? 'csv' : 'xlsx'}`
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click(); URL.revokeObjectURL(a.href)
    } catch (e: unknown) {
      setDistMsg(`✗ Download error: ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setDivDownloading(d => { const n = { ...d }; delete n[key]; return n })
    }
  }

  const exportDistribution = async () => {
    if ((distResult?.rows ?? 0) > 1_000_000) { openExportModal('xlsx'); return }
    setExportLoading(true); setDistMsg(null)
    try {
      const res = await http.request<Blob>({
        method: 'POST', url: `/distribution/export?max_round=${maxRound}`,
        responseType: 'blob', timeout: 120_000,
      })
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const cd = res.headers['content-disposition'] ?? ''
      const fname = cd.match(/filename="([^"]+)"/)?.[1] ?? `distribution_${Date.now()}.xlsx`
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click(); URL.revokeObjectURL(a.href)
    } catch (e: unknown) { setDistMsg(`✗ Export error: ${e instanceof Error ? e.message : 'Error'}`)
    } finally { setExportLoading(false) }
  }

  const [csvLoading, setCsvLoading] = useState(false)

  const exportCsv = async () => {
    if ((distResult?.rows ?? 0) > 1_000_000) { openExportModal('csv'); return }
    setCsvLoading(true); setDistMsg(null)
    try {
      const res = await http.request<Blob>({
        method: 'POST', url: `/distribution/export-csv?max_round=${maxRound}`,
        responseType: 'blob', timeout: 60_000,
      })
      const blob = new Blob([res.data], { type: 'text/csv' })
      const cd = res.headers['content-disposition'] ?? ''
      const fname = cd.match(/filename="([^"]+)"/)?.[1] ?? `distribution_${Date.now()}.csv`
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click(); URL.revokeObjectURL(a.href)
    } catch (e: unknown) { setDistMsg(`✗ CSV export error: ${e instanceof Error ? e.message : 'Error'}`)
    } finally { setCsvLoading(false) }
  }

  const baseReady = imStatus?.ready && !baseLoading

  // ── Large-export modal ────────────────────────────────────────────────────
  const ExportModal = () => {
    if (!exportModal) return null
    const fmt = exportModal
    const fmtLabel = fmt === 'csv' ? 'CSV' : 'Excel'
    const totalRows = divSummaryTotal || distResult?.rows || 0
    const nonzeroTotal = divSummary ? divSummary.reduce((s, r) => s + r.rows_nonzero, 0) : 0
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 12, padding: 24, width: 620, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.textPrimary }}>Download {fmtLabel} — {(totalRows / 10_00_000).toFixed(1)}M rows</div>
              <div style={{ fontSize: 12, color: tokens.textMuted, marginTop: 2 }}>Result has &gt;10 lakh rows — choose download method</div>
            </div>
            <button onClick={() => setExportModal(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: tokens.textMuted, lineHeight: 1 }}>×</button>
          </div>

          {/* Option 1 — Filtered download */}
          <div style={{ background: tokens.contentBg, borderRadius: 8, padding: 14, border: `1px solid ${tokens.cardBorder}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary, marginBottom: 4 }}>Option 1 — Final Allocation &gt; 0 only</div>
            <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 10 }}>
              Download only allocated rows — reduces size significantly.
              {nonzeroTotal > 0 && <span style={{ color: '#4ade80', marginLeft: 6 }}>{nonzeroTotal.toLocaleString('en-IN')} rows</span>}
            </div>
            <button
              onClick={() => doDownload({ exclude_zero: true, fmt })}
              disabled={!!divDownloading['__nonzero__']}
              style={{ padding: '7px 18px', background: tokens.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: divDownloading['__nonzero__'] ? 0.6 : 1 }}
            >{divDownloading['__nonzero__'] ? 'Downloading…' : `↓ Download ${fmtLabel} (Allocated only)`}</button>
          </div>

          {/* Option 2 — Division wise */}
          <div style={{ background: tokens.contentBg, borderRadius: 8, padding: 14, border: `1px solid ${tokens.cardBorder}`, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary, marginBottom: 4 }}>Option 2 — Division-wise (separate files)</div>
            <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 10 }}>One file per division — click each to download individually</div>
            {divSummaryLoading && <div style={{ fontSize: 12, color: tokens.textMuted }}>Loading division summary…</div>}
            {!divSummaryLoading && divSummary && (
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${tokens.cardBorder}` }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px', color: tokens.textMuted, fontWeight: 600 }}>Division</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: tokens.textMuted, fontWeight: 600 }}>Total</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: '#60a5fa', fontWeight: 600 }}>GRC</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: '#f59e0b', fontWeight: 600 }}>WMS</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: '#4ade80', fontWeight: 600 }}>Alloc &gt; 0</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px', color: tokens.textMuted, fontWeight: 600 }}>Zero</th>
                      <th style={{ padding: '4px 8px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {divSummary.map(row => {
                      const zeroRows = row.rows_total - row.rows_nonzero
                      const busy = !!divDownloading[row.division]
                      return (
                        <tr key={row.division} style={{ borderBottom: `1px solid ${tokens.cardBorder}30` }}>
                          <td style={{ padding: '5px 8px', color: tokens.textPrimary, fontWeight: 600 }}>{row.division}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: tokens.textSecondary }}>{row.rows_total.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#60a5fa' }}>{row.rows_grc != null ? row.rows_grc.toLocaleString('en-IN') : '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#f59e0b' }}>{row.rows_wms != null ? row.rows_wms.toLocaleString('en-IN') : '—'}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: '#4ade80' }}>{row.rows_nonzero.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: tokens.textMuted }}>{zeroRows.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                            <button
                              onClick={() => doDownload({ division: row.division, fmt })}
                              disabled={busy}
                              style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, border: `1px solid ${tokens.accent}`, background: 'transparent', color: tokens.accent, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
                            >{busy ? '…' : `↓ ${fmtLabel}`}</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <ExportModal />
      <StaleBanner />
      {fetchError && (
        <div style={{ background: '#7f1d1d', border: '1px solid #b91c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚠ {fetchError}</span>
          <button onClick={() => setFetchError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>
      )}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>🔀 Distribution Model</h1>
          <button
            onClick={handleInvalidate}
            disabled={invalidating}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, background: '#7f1d1d', border: 'none', color: '#fff', cursor: invalidating ? 'not-allowed' : 'pointer', opacity: invalidating ? 0.7 : 1 }}
          >{invalidating ? 'Clearing…' : '🗑 Clear Cache'}</button>
          {invalidateMsg && <span style={{ fontSize: 12, color: '#4ade80' }}>{invalidateMsg}</span>}
        </div>
        <p style={{ fontSize: 13, color: tokens.textMuted, marginTop: 4 }}>
          Warehouse stock distribution — barcode × store replenishment engine
        </p>
      </div>

      {/* ── Pipeline bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20,
        background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 10, padding: '14px 18px' }}>
        {[
          { n: 1, title: 'Configure', sub: 'Source · filters', state: 'done' },
          { n: 2, title: 'Build base', sub: 'REQ · stock · priority', state: baseCacheReady ? 'done' : 'active' },
          { n: 3, title: 'Run loop', sub: 'Allocate · export', state: distResult ? 'done' : (baseCacheReady ? 'active' : 'idle') },
        ].map((step, idx) => (
          <React.Fragment key={step.n}>
            {idx > 0 && (
              <div style={{ width: 28, height: 2, background: step.state === 'done' ? '#22c55e' : tokens.cardBorder, flexShrink: 0, margin: '0 6px' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0, border: '2px solid transparent',
                background: step.state === 'done' ? '#1c3a2a' : step.state === 'active' ? '#1e3a5f' : '#2a2a2c',
                borderColor: step.state === 'done' ? '#22c55e' : step.state === 'active' ? '#3b82f6' : '#4a4a4c',
                color: step.state === 'done' ? '#4ade80' : step.state === 'active' ? '#60a5fa' : '#6b6b6e',
              }}>
                {step.state === 'done' ? '✓' : step.n}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: tokens.textPrimary }}>{step.title}</div>
                <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 1 }}>{step.sub}</div>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>

        {/* Step 1 — Selections */}
        <div style={S.card}>
          {/* Step 1 header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1e3a5f', color: '#60a5fa',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.textPrimary }}>Configure</div>
              <div style={{ fontSize: 11, color: tokens.textMuted }}>Source · filters · stock override</div>
            </div>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
              background: '#1c3a2a', color: '#4ade80', border: '1px solid #22c55e40' }}>Ready</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PillToggle label="Req Source"    options={[{val:'GRC',text:'GRC'},{val:'WMS',text:'WMS'},{val:'BOTH',text:'GRC + WMS'}]}  value={reqSource}  onChange={v => { setReqSource(v); clearCsvUpload() }}  accent="#6366f1" />
            <PillToggle label="Biz Segment"   options={[{val:'APPS',text:'APPS'},{val:'GM',text:'GM'},{val:'BOTH',text:'Both'}]}         value={bizSegment} onChange={setBizSegment} accent="#0ea5e9" />
            <PillToggle label="Sort Priority" options={[{val:'fill_rate',text:'MC Fill Rate ↑'},{val:'combined_req',text:'Combined Req ↓'},{val:'festive_req',text:'Festive + Req ↓'}]} value={sortMode} onChange={setSortMode} accent="#f59e0b" />

            {/* CSV Stock Upload */}
            <DkUploadZone
              label="Stock QTY override"
              hint="BARCODE, GRC_QTY / WMS_QTY / MSA_QTY / ASN_QTY"
              active={csvUploadActive}
              filename={csvUploadMeta?.filename}
              rows={csvUploadMeta?.rows}
              uploading={csvUploading}
              onUpload={handleCsvUpload}
              onClear={clearCsvUpload}
              inputRef={csvInputRef}
            />
            {csvUploadMsg && (
              <div style={{ marginTop: 4, fontSize: 11, color: csvUploadMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{csvUploadMsg}</div>
            )}

            {/* Scope Builder: Row-based Division × Attr1 (OR between rows, multi-select within row) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: tokens.textMuted, minWidth: 90 }}>Scope Filter</span>
                <button onClick={addScope} style={{
                  padding: '3px 12px', fontSize: 11, borderRadius: 12, border: `1px solid ${tokens.cardBorder}`,
                  cursor: 'pointer', background: 'transparent', color: tokens.textMuted,
                }}>+ Add Row</button>
                {scopes.some(s => s.divisions.length > 0 || s.attribute1s.length > 0) && (
                  <button onClick={() => setScopes([{ divisions: [], attribute1s: [] }])} style={{
                    padding: '3px 12px', fontSize: 11, borderRadius: 12, border: '1px solid #ef444440',
                    cursor: 'pointer', background: 'transparent', color: '#f87171',
                  }}>Clear All</button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {scopes.map((sc, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: tokens.textMuted, minWidth: 90 }}>
                      {i === 0 ? 'Division × Attr1' : <span style={{ color: '#f59e0b', fontWeight: 600 }}>OR row {i + 1}</span>}
                    </span>
                    <MultiSelect label="Division" options={divisionOptions} selected={sc.divisions} onChange={v => updateScope(i, 'divisions', v)} width={180} />
                    <MultiSelect label="Attribute1" options={attribute1Options} selected={sc.attribute1s} onChange={v => updateScope(i, 'attribute1s', v)} width={180} />
                    {scopes.length > 1 && (
                      <button onClick={() => removeScope(i)} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: tokens.textMuted, marginLeft: 98 }}>
                Blank = include all. Within a row = AND. Rows = OR combined.
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 — Build Base */}
        <div style={S.card}>
          {/* Step 2 header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%',
              background: baseCacheReady ? '#1c3a2a' : '#1e3a5f',
              color: baseCacheReady ? '#4ade80' : '#60a5fa',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {baseCacheReady ? '✓' : '2'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.textPrimary }}>Build base</div>
              <div style={{ fontSize: 11, color: tokens.textMuted }}>Item master · stores · REQ overrides · priority</div>
            </div>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
              background: baseCacheReady ? '#1c3a2a' : '#2a2a2c',
              color: baseCacheReady ? '#4ade80' : '#6b6b6e',
              border: baseCacheReady ? '1px solid #22c55e40' : '1px solid #3a3a3c' }}>
              {baseCacheReady ? 'Built' : 'Not built'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: tokens.textMuted }}>
            <span>Item Master:</span>
            <StatusBadge ready={imStatus?.ready ?? false} />
            {imStatus?.ready && imStatus.rows > 0 && (
              <span style={{ fontSize: 11, color: tokens.textMuted }}>{imStatus.rows.toLocaleString('en-IN')} rows</span>
            )}
            {!imStatus?.ready && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>— download from <strong>Master Data</strong> page first</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 10 }}>
            Joins all REQ views (MC · ART · MRP · SIZE · SPARKY · OPTION) on Barcode × Store base
          </div>
          {/* Store filter — by name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: tokens.textMuted, minWidth: 72 }}>Store Filter</span>
            <MultiSelect label="Store" options={storeOptions} selected={selStores} onChange={setSelStores} width={220} />
            {selStores.length > 0 && (
              <button onClick={() => setSelStores([])} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid #ef444440', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>Clear</button>
            )}
            <span style={{ fontSize: 11, color: tokens.textMuted }}>(blank = all stores)</span>
          </div>

          {/* Store master field filters */}
          {addedFilterFields.map(col => {
            const meta = storeFieldMeta[col]
            if (!meta) return null
            const sel = activeFieldFilters[col] ?? []
            return (
              <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: tokens.textMuted, minWidth: 72 }}>{meta.label}</span>
                <MultiSelect label={meta.label} options={meta.values} selected={sel}
                  onChange={v => setActiveFieldFilters(f => ({ ...f, [col]: v }))} width={220} />
                {sel.length > 0 && (
                  <button onClick={() => setActiveFieldFilters(f => ({ ...f, [col]: [] }))}
                    style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid #ef444440', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>Clear</button>
                )}
                <button onClick={() => {
                  setAddedFilterFields(f => f.filter(k => k !== col))
                  setActiveFieldFilters(f => { const n = { ...f }; delete n[col]; return n })
                }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid #52525240', background: 'transparent', color: tokens.textMuted, cursor: 'pointer' }}>✕</button>
              </div>
            )
          })}

          {/* Add field filter button */}
          <div ref={fieldPickerRef} style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
            <button onClick={() => setFieldPickerOpen(o => !o)} style={{
              fontSize: 11, padding: '4px 12px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${tokens.cardBorder}`, background: 'transparent', color: tokens.textMuted,
            }}>+ Add Field Filter</button>
            {fieldPickerOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: 0, zIndex: 999, minWidth: 180,
                background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 8,
                boxShadow: '0 6px 24px rgba(0,0,0,0.4)', padding: 6,
              }}>
                {Object.entries(storeFieldMeta).length === 0 && (
                  <div style={{ fontSize: 12, color: tokens.textMuted, padding: '6px 8px' }}>Loading fields…</div>
                )}
                {Object.entries(storeFieldMeta).map(([col, meta]) => (
                  <button key={col} onClick={() => {
                    if (!addedFilterFields.includes(col)) setAddedFilterFields(f => [...f, col])
                    setFieldPickerOpen(false)
                  }} style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                    fontSize: 12, border: 'none', borderRadius: 5, cursor: 'pointer',
                    background: addedFilterFields.includes(col) ? '#6366f115' : 'transparent',
                    color: addedFilterFields.includes(col) ? '#818cf8' : tokens.textPrimary,
                  }}>
                    {meta.label} {addedFilterFields.includes(col) ? '✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Store Priority CSVs */}
          <DkCollapse
            title="Store priority"
            defaultOpen={Object.keys(priorityMeta).length > 0}
            badge={Object.keys(priorityMeta).length > 0
              ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: '#1c3a2a', color: '#4ade80', border: '1px solid #22c55e40' }}>{Object.keys(priorityMeta).length} active</span>
              : <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: '#2a2a2c', color: '#6b6b6e', border: '1px solid #3a3a3c' }}>optional</span>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: Object.keys(priorityMeta).length > 0 ? 10 : 0 }}>
              {PRIORITY_CSV_SPECS.map(spec => {
                const meta = priorityMeta[spec.key]
                const uploading = priorityUploading[spec.key]
                const msg = priorityMsg[spec.key]
                return (
                  <div key={spec.key}>
                    <DkUploadZone
                      label={spec.label}
                      hint={spec.hint}
                      active={!!meta}
                      filename={meta?.filename}
                      rows={meta?.rows}
                      uploading={uploading}
                      onUpload={f => handlePriorityUpload(spec.key, f)}
                      onClear={() => clearPriority(spec.key)}
                      inputRef={{ current: priorityRefs.current[spec.key] ?? null }}
                    />
                    {msg && <div style={{ marginTop: 3, fontSize: 11, color: msg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{msg}</div>}
                  </div>
                )
              })}
            </div>
            {Object.keys(priorityMeta).length > 0 && (
              <div style={{ padding: '8px 12px', background: '#1a1a3e', border: '1px solid #2d1f5e', borderRadius: 6,
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#6b6b9e', marginRight: 2 }}>Sort:</span>
                {['Override stores first', 'Fill-rate rank', 'Concept listed', 'Highest REQ'].map((item, i, arr) => (
                  <React.Fragment key={item}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>{item}</span>
                    {i < arr.length - 1 && <span style={{ fontSize: 10, color: '#4a4a6e' }}>›</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
          </DkCollapse>

          {/* REQ CSV Overrides */}
          <DkCollapse
            title="REQ CSV overrides"
            defaultOpen={false}
            badge={Object.keys(reqCsvMeta).length > 0
              ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: '#1c3a2a', color: '#4ade80', border: '1px solid #22c55e40' }}>{Object.keys(reqCsvMeta).length} active</span>
              : <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: '#2a2a2c', color: '#6b6b6e', border: '1px solid #3a3a3c' }}>optional</span>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {REQ_CSV_SPECS.map(spec => {
                const meta = reqCsvMeta[spec.key]
                const uploading = reqCsvUploading[spec.key]
                const msg = reqCsvMsg[spec.key]
                return (
                  <div key={spec.key}>
                    <DkUploadZone
                      label={spec.label}
                      hint={spec.hint}
                      active={!!meta}
                      filename={meta?.filename}
                      rows={meta?.rows}
                      uploading={uploading}
                      onUpload={f => handleReqCsvUpload(spec.key, f)}
                      onClear={() => clearReqCsv(spec.key)}
                      inputRef={{ current: reqCsvRefs.current[spec.key] ?? null }}
                    />
                    {msg && <div style={{ marginTop: 3, fontSize: 11, color: msg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{msg}</div>}
                  </div>
                )
              })}
            </div>
            {Object.keys(reqCsvMeta).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '8px 12px',
                background: '#2a2000', borderRadius: 7, border: '1px solid #f59e0b40' }}>
                <span style={{ fontSize: 12, color: '#f59e0b' }}>Unmatched rows:</span>
                {(['parquet', 'zero'] as const).map(opt => (
                  <button key={opt}
                    onClick={() => { setReqFallback(opt); ssSave({ reqFallback: opt }) }}
                    style={{ fontSize: 12, padding: '3px 11px', borderRadius: 5, fontWeight: 600, cursor: 'pointer',
                      border: '1px solid #f59e0b40',
                      background: reqFallback === opt ? '#f59e0b' : 'transparent',
                      color: reqFallback === opt ? '#000' : '#f59e0b' }}>
                    {opt === 'parquet' ? 'Use parquet' : 'Use 0'}
                  </button>
                ))}
              </div>
            )}
          </DkCollapse>

          <button onClick={buildBase} disabled={!baseReady} style={S.btn('#10b981', !baseReady)}>
            {baseLoading ? 'â³ Building…' : '▶ Build Base'}
          </button>
          {!imStatus?.ready && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#f59e0b' }}>
              ⚠ Download Item Master from Master Data page first
            </span>
          )}
          {baseMsg && <div style={S.msg(baseMsg.startsWith('✓'))}>{baseMsg}</div>}

          {baseResult && (
            <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Total Rows',  val: baseResult.rows.toLocaleString('en-IN') },
                { label: 'Columns',     val: baseResult.columns.length },
                { label: 'Time',        val: `${Math.round(baseResult.elapsed_ms / 1000)}s` },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontSize: 11, color: tokens.textMuted }}>{stat.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#34d399' }}>{stat.val}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 3 — Distribution Loop */}
        <div style={S.card}>
          {/* Step 3 header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%',
              background: distResult ? '#1c3a2a' : '#2a2a2c',
              color: distResult ? '#4ade80' : '#6b6b6e',
              fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {distResult ? '✓' : '3'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.textPrimary }}>Run distribution</div>
              <div style={{ fontSize: 11, color: tokens.textMuted }}>Allocation loop · results · export</div>
            </div>
            {distResult && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                background: '#1c3a2a', color: '#4ade80', border: '1px solid #22c55e40' }}>Done</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: tokens.textMuted, marginBottom: 14 }}>
            Per-barcode: Round 1 = art_grid · Round 2+ = +1 per store until max_grid or GRC stock exhausted
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: tokens.textMuted }}>Max Rounds</label>
            <input
              type="number" min={1} max={20} value={maxRound}
              onChange={e => setMaxRound(Math.max(1, Math.min(20, Number(e.target.value))))}
              style={{ width: 60, padding: '4px 8px', fontSize: 13, borderRadius: 6,
                border: `1px solid ${tokens.cardBorder}`, background: tokens.cardBg, color: tokens.textPrimary }}
            />
            <span style={{ fontSize: 11, color: tokens.textMuted }}>
              (1–20 rounds; Round 1 = art_grid, Round 2+ = +1/store)
            </span>
          </div>
          {/* ── Option Listing Rule ────────────────────────────────────────── */}
          <div style={{ background: tokens.cardBg, border: `1px solid ${applyOL ? '#8b5cf6' : tokens.cardBorder}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: applyOL ? 10 : 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                <input type="checkbox" checked={applyOL} onChange={e => setApplyOL(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#8b5cf6', cursor: 'pointer' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: applyOL ? '#a78bfa' : tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Option Listing Filter
                </span>
                <span style={{ fontSize: 10, color: tokens.textMuted }}>PREWINTER · LT WINTER — T_CLR_CONCEPT_AW26_V1</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {olStatus?.ready
                  ? <span style={{ fontSize: 10, color: '#4ade80' }}>✓ {olStatus.rows.toLocaleString('en-IN')} rows</span>
                  : <span style={{ fontSize: 10, color: '#f87171' }}>✗ Not cached</span>}
                <button
                  onClick={async () => {
                    setOlDownloading(true)
                    try {
                      await apiFetch('POST', '/distribution/option-listing/download')
                      await fetchOlStatus()
                    } catch { /* silent */ } finally { setOlDownloading(false) }
                  }}
                  disabled={olDownloading}
                  style={{ ...S.btn('#7c3aed'), padding: '3px 10px', fontSize: 11 }}
                >
                  {olDownloading ? '…' : '↓ Refresh'}
                </button>
              </div>
            </div>
            {applyOL && (
              <div style={{ fontSize: 11, color: tokens.textMuted, paddingLeft: 23 }}>
                Stores × concept_new not in YES list → <span style={{ color: '#f87171' }}>Final Alloc = 0</span> · Remark: <em>HOLD FOR OPTION_LISTING NO</em>
              </div>
            )}
          </div>

          {/* ── Hold Rules UI ─────────────────────────────────────────────── */}
          <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.textMuted, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Hold Rules {holdRules.length > 0 && <span style={{ color: '#f59e0b', marginLeft: 6 }}>({holdRules.length} active)</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: tokens.textSecondary, width: 70, flexShrink: 0 }}>Store Hold</span>
              <MultiSelect label="Stores" options={storeOptions} selected={holdStoreSelected} onChange={setHoldStoreSelected} width={260} />
              <button onClick={addStoreHold} style={{ ...S.btn('#dc2626'), padding: '4px 12px', fontSize: 12 }}>+ Hold</button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: tokens.textSecondary, width: 70, flexShrink: 0 }}>Attr1 Hold</span>
              <MultiSelect label="Attr1" options={attribute1Options} selected={holdAttr1Selected} onChange={setHoldAttr1Selected} width={160} />
              <span style={{ fontSize: 11, color: tokens.textMuted }}>except</span>
              <MultiSelect label="Stores" options={storeOptions} selected={holdExceptSelected} onChange={setHoldExceptSelected} width={240} />
              <button onClick={addAttr1Hold} style={{ ...S.btn('#dc2626'), padding: '4px 12px', fontSize: 12 }}>+ Hold</button>
            </div>
            {holdRules.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {holdRules.map((r, i) => (
                  <span key={i} style={{ background: '#7f1d1d33', border: '1px solid #dc2626aa', borderRadius: 4,
                    padding: '2px 8px', fontSize: 11, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.type === 'store'
                      ? `Store Hold: ${r.stores.join(', ')}`
                      : `Attr1 "${r.attr1}"${r.except_stores.length ? ` (except ${r.except_stores.join(', ')})` : ''}`}
                    <span onClick={() => removeHold(i)} style={{ cursor: 'pointer', color: '#f87171', fontWeight: 700 }}>x</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={runDistribution} disabled={(!baseResult && !baseCacheReady) || distLoading} style={S.btn('#8b5cf6', (!baseResult && !baseCacheReady) || distLoading)}>
              {distLoading ? 'â³ Running…' : '▶ Run Distribution'}
            </button>
          </div>
          {!baseResult && !baseCacheReady && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#f59e0b' }}>
              ⚠ Build Base first (Step 2)
            </span>
          )}
          {!baseResult && baseCacheReady && (
            <span style={{ marginLeft: 12, fontSize: 12, color: '#34d399' }}>
              ✓ Cached base ready
            </span>
          )}
          {distMsg && <div style={S.msg(distMsg.startsWith('✓'))}>{distMsg}</div>}

          {distResult && (
            <div style={{ display: 'flex', gap: 16, marginTop: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Left — KPIs + sample table */}
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
                  {[
                    { label: 'Units Allocated',     val: distResult.total_allocated.toLocaleString('en-IN') },
                    { label: 'Stores Covered',      val: distResult.stores_covered.toLocaleString('en-IN') },
                    { label: 'Barcodes Total',      val: distResult.icodes_total },
                    { label: 'Fully Covered',       val: distResult.icodes_fully_covered },
                    ...(distResult.ol_held_count ? [{ label: 'OL Hold',  val: distResult.ol_held_count.toLocaleString('en-IN') }] : []),
                    { label: 'Time',                val: `${Math.round(distResult.elapsed_ms / 1000)}s` },
                  ].map(stat => (
                    <div key={stat.label}>
                      <div style={{ fontSize: 11, color: tokens.textMuted }}>{stat.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa' }}>{stat.val}</div>
                    </div>
                  ))}
                </div>

                {/* Sample rows — dynamic columns */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
                    <thead>
                      <tr>
                        {distResult.columns.map(h => (
                          <th key={h} style={{ padding: '4px 10px', textAlign: 'left', color: tokens.textMuted,
                            borderBottom: `1px solid ${tokens.cardBorder}`, whiteSpace: 'nowrap',
                            background: h === 'final_allocate' ? '#8b5cf620' : h === 'reason_not_allocated' ? '#f59e0b20' : 'transparent' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {distResult.sample.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : tokens.cardBg + '40' }}>
                          {distResult.columns.map(col => (
                            <td key={col} style={{ padding: '3px 10px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                              color: col === 'reason_not_allocated' && row[col] ? '#f87171'
                                   : col === 'final_allocate' && Number(row[col]) > 0 ? '#a78bfa' : 'inherit' }}>
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right — Division Summary panel */}
              <div style={{
                width: 300, flexShrink: 0,
                background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary, marginBottom: 10 }}>
                  🎨 Division Summary
                </div>
                {divSummaryLoading && (
                  <div style={{ fontSize: 12, color: tokens.textMuted }}>Loading…</div>
                )}
                {!divSummaryLoading && (divSummary ?? []).length > 0 && (
                  <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                    <thead>
                      <tr>
                        {(['Division', 'Total', 'Alloc>0', 'Zero'] as const).map(h => (
                          <th key={h} style={{
                            padding: '4px 6px', textAlign: h === 'Division' ? 'left' : 'right',
                            color: tokens.textMuted, fontWeight: 600, fontSize: 11,
                            borderBottom: `1px solid ${tokens.cardBorder}`,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(divSummary ?? []).map(row => {
                        const zero = row.rows_total - row.rows_nonzero
                        return (
                          <tr key={row.division}>
                            <td style={{ padding: '5px 6px', color: tokens.textPrimary, fontWeight: 600 }}>{row.division}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'right', color: tokens.textSecondary }}>{row.rows_total.toLocaleString('en-IN')}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'right', color: '#4ade80', fontWeight: 600 }}>{row.rows_nonzero.toLocaleString('en-IN')}</td>
                            <td style={{ padding: '5px 6px', textAlign: 'right', color: tokens.textMuted }}>{zero.toLocaleString('en-IN')}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: `1px solid ${tokens.cardBorder}` }}>
                        <td style={{ padding: '5px 6px', color: tokens.textMuted, fontSize: 11 }}>Total</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: tokens.textSecondary, fontWeight: 700 }}>
                          {(divSummary ?? []).reduce((s, r) => s + r.rows_total, 0).toLocaleString('en-IN')}
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: '#4ade80', fontWeight: 700 }}>
                          {(divSummary ?? []).reduce((s, r) => s + r.rows_nonzero, 0).toLocaleString('en-IN')}
                        </td>
                        <td style={{ padding: '5px 6px', textAlign: 'right', color: tokens.textMuted, fontWeight: 700 }}>
                          {(divSummary ?? []).reduce((s, r) => s + (r.rows_total - r.rows_nonzero), 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
                {!divSummaryLoading && (divSummary ?? []).length === 0 && (
                  <div style={{ fontSize: 12, color: tokens.textMuted }}>No division data</div>
                )}

                {/* Coverage bar */}
                {distResult.rows > 0 && (() => {
                  const totalNonzero = (divSummary ?? []).reduce((s, r) => s + r.rows_nonzero, 0)
                  const pct = (divSummary ?? []).length > 0
                    ? Math.round(totalNonzero / (divSummary ?? []).reduce((s, r) => s + r.rows_total, 0) * 100)
                    : Math.round(distResult.stores_covered / distResult.rows * 100)
                  return (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: tokens.textMuted, marginBottom: 4 }}>
                        <span>Alloc Coverage</span>
                        <span style={{ color: pct >= 60 ? '#4ade80' : '#f87171', fontWeight: 700 }}>{pct}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: tokens.cardBorder }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: pct >= 60 ? '#4ade80' : '#f87171', transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                })()}

                {/* Download buttons */}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button onClick={exportCsv} disabled={csvLoading} style={{ ...S.btn('#0284c7', csvLoading), fontSize: 12, padding: '6px 12px' }}>
                    {csvLoading ? '⏳ CSV…' : '⬇ Download CSV'}
                  </button>
                  <button onClick={exportDistribution} disabled={exportLoading} style={{ ...S.btn('#059669', exportLoading), fontSize: 12, padding: '6px 12px' }}>
                    {exportLoading ? '⏳ Excel…' : '⬇ Download Excel'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

