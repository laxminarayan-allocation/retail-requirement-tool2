import React, { useEffect, useState, useCallback, useRef } from 'react'
import http from '@/api/http'
import NumFilterDropdown, { NumFilterIcon, useNumFilter } from '@/components/NumFilterDropdown'
import StaleBanner from '@/components/StaleBanner'

interface SparkRow {
  department: string
  article_name: string
  cat4: string | null
  lm_sl_q: number
  mtd_sl_q: number
  ttl_stk_q: number
  max_slq: number
  sparky_pbs: number
  sparky_req: number
  to_q: number
  grc_q: number
  msa_q: number
  alloc_q: number
  wms_q: number
  rest_dc_q: number
  ppo_q: number
}

interface SparkData {
  columns: string[]
  rows: SparkRow[]
  total_rows: number
}

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
  'WH_STOCK',
  'MC_REQ', 'ART_REQ', 'MRP_REQ', 'BARCODE_REQ',
  'SIZE_REQ', 'SPARKY_REQ', 'TABLE_REQ', 'OPTION_REQ', 'LIST_REQ',
]

const GROUP_META: Record<string, { label: string; icon: string; color: string }> = {
  WH_STOCK:    { label: 'WH Stock',            icon: '🏭', color: '#22d3ee' },
  MC_REQ:      { label: 'MC Requirement',      icon: '🧩', color: '#6366f1' },
  ART_REQ:     { label: 'Article Requirement', icon: '📦', color: '#0ea5e9' },
  MRP_REQ:     { label: 'MRP Requirement',     icon: '💰', color: '#f59e0b' },
  BARCODE_REQ: { label: 'Barcode Requirement', icon: '🔖', color: '#10b981' },
  SIZE_REQ:    { label: 'Size Requirement',    icon: '📐', color: '#ec4899' },
  SPARKY_REQ:  { label: 'Sparky Requirement',  icon: '⚡', color: '#f97316' },
  TABLE_REQ:   { label: 'Table Requirement',   icon: '📋', color: '#8b5cf6' },
  OPTION_REQ:  { label: 'Option Requirement',  icon: '🎛️', color: '#14b8a6' },
  LIST_REQ:    { label: 'List Requirement',    icon: '📝', color: 'var(--text-muted)' },
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

const n = (v: number | null) => v == null ? 0 : v
const fmtN = (v: number | null) => v == null ? '—' : v === 0 ? '-' : v.toLocaleString('en-IN')

function MultiSelect({ label, options, value, onChange, accentColor = '#0ea5e9' }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; accentColor?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  const pill = value.length ? `${value.length} selected` : label
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(o => !o)} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${value.length ? accentColor : '#334155'}`, background: 'var(--card-bg)', color: value.length ? accentColor : '#94a3b8', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 120 }}>
        {pill} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 200, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '6px 0', minWidth: 180, maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 24px #00000088' }}>
          {options.length === 0 && <div style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}
          {value.length > 0 && <button onClick={() => onChange([])} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 12px', background: 'none', border: 'none', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>✕ Clear all</button>}
          {options.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer', color: value.includes(opt) ? accentColor : '#cbd5e1', fontSize: 12 }}>
              <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} style={{ accentColor }} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function StoreSelect({ stores, value, onChange, accentColor = '#0ea5e9' }: {
  stores: string[]; value: string[]; onChange: (v: string[]) => void; accentColor?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const filtered = search ? stores.filter(s => s.toLowerCase().includes(search.toLowerCase())) : stores
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter(x => x !== s) : [...value, s])
  const nsoStores = stores.filter(s => /nso/i.test(s))
  const pill = value.length ? `${value.length} stores` : 'All Stores'
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <button onClick={() => setOpen(o => !o)} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${value.length ? accentColor : '#334155'}`, background: 'var(--card-bg)', color: value.length ? accentColor : '#94a3b8', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', minWidth: 110 }}>
        🏪 {pill} ▾
      </button>
      {nsoStores.length > 0 && (
        <button onClick={() => onChange(nsoStores)} title="Select NSO stores only" style={{ height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${JSON.stringify(value.sort()) === JSON.stringify(nsoStores.sort()) ? accentColor : '#334155'}`, background: 'var(--card-bg)', color: '#f59e0b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>NSO</button>
      )}
      {value.length > 0 && (
        <button onClick={() => onChange([])} title="All stores" style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>All</button>
      )}
      {open && (
        <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 300, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '8px 0 6px', minWidth: 220, maxHeight: 320, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px #00000099' }}>
          <div style={{ padding: '0 8px 6px' }}>
            <input autoFocus placeholder="Search store…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #475569', background: 'var(--content-bg)', color: 'var(--text-primary)', fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 8px 6px', borderBottom: '1px solid #1e293b' }}>
            <button onClick={() => onChange(filtered)} style={{ flex: 1, fontSize: 10, padding: '2px 0', borderRadius: 4, border: '1px solid var(--card-border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Select All</button>
            <button onClick={() => onChange([])} style={{ flex: 1, fontSize: 10, padding: '2px 0', borderRadius: 4, border: '1px solid var(--card-border)', background: 'none', color: '#f87171', cursor: 'pointer' }}>Clear</button>
            {nsoStores.length > 0 && <button onClick={() => onChange(nsoStores)} style={{ flex: 1, fontSize: 10, padding: '2px 0', borderRadius: 4, border: '1px solid #92400e', background: 'none', color: '#f59e0b', cursor: 'pointer' }}>NSO Only</button>}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>No match</div>}
            {filtered.map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px', cursor: 'pointer', color: value.includes(s) ? accentColor : '#cbd5e1', fontSize: 12, background: value.includes(s) ? '#0f2a1a' : 'transparent' }}>
                <input type="checkbox" checked={value.includes(s)} onChange={() => toggle(s)} style={{ accentColor }} />
                {s}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReqDashboard() {
  const numFilter = useNumFilter()
  const [activeTab, setActiveTab] = useState<'views' | 'sparky' | 'size' | 'mrp' | 'art' | 'mc' | 'barcode' | 'option' | 'list'>('views')
  const [views, setViews] = useState<ViewStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ owner: string; obj: string; group: string } | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Sparky pivot state
  const [sparkData, setSparkData] = useState<SparkData | null>(null)
  const [sparkLoading, setSparkLoading] = useState(false)
  const [sparkError, setSparkError] = useState<string | null>(null)
  const [sparkFilter, setSparkFilter] = useState({ dept: [] as string[], article: '', cat4: '' })
  const sparkFetched = useRef(false)

  // Size Req pivot state
  const [sizeData, setSizeData] = useState<SparkData | null>(null)
  const [sizeLoading, setSizeLoading] = useState(false)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [sizeFilter, setSizeFilter] = useState({ dept: [] as string[], article: '', cat4: '', division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const sizeFetched = useRef(false)

  // Filter meta (Division + Attribute1 options from SSRK.ITEM_MV)
  const [filterMeta, setFilterMeta] = useState<{ divisions: string[]; attribute1s: string[]; departments: string[]; display_types: string[] }>({ divisions: [], attribute1s: [], departments: [], display_types: [] })
  const [allStores, setAllStores] = useState<string[]>([])
  useEffect(() => {
    http.get('/req/filter_meta').then(r => setFilterMeta(r.data.data)).catch(() => {})
    http.get('/req/store_names').then(r => setAllStores(r.data.data.stores)).catch(() => {})
  }, [])

  // MRP Req state
  const [mrpData, setMrpData] = useState<SparkData | null>(null)
  const [mrpLoading, setMrpLoading] = useState(false)
  const [mrpError, setMrpError] = useState<string | null>(null)
  const [mrpFilter, setMrpFilter] = useState({ dept: [] as string[], display_type: [] as string[], article: '', division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const mrpFetched = useRef(false)

  // Article Req state
  const [artData, setArtData] = useState<SparkData | null>(null)
  const [artLoading, setArtLoading] = useState(false)
  const [artError, setArtError] = useState<string | null>(null)
  const [artFilter, setArtFilter] = useState({ dept: [] as string[], display_type: [] as string[], article: '', division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const artFetched = useRef(false)

  // MC Req state
  const [mcData, setMcData] = useState<SparkData | null>(null)
  const [mcLoading, setMcLoading] = useState(false)
  const [mcError, setMcError] = useState<string | null>(null)
  const [mcFilter, setMcFilter] = useState({ dept: [] as string[], display_type: [] as string[], division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const mcFetched = useRef(false)

  // Barcode Req state
  const [barcodeData, setBarcodeData] = useState<SparkData | null>(null)
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeFilter, setBarcodeFilter] = useState({ dept: [] as string[], display_type: [] as string[], article: '', division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const barcodeFetched = useRef(false)

  // Option Req state
  const [optionData, setOptionData] = useState<SparkData | null>(null)
  const [optionLoading, setOptionLoading] = useState(false)
  const [optionError, setOptionError] = useState<string | null>(null)
  const [optionFilter, setOptionFilter] = useState({ dept: [] as string[], display_type: [] as string[], division: [] as string[], attribute1: [] as string[], store_names: [] as string[] })
  const optionFetched = useRef(false)

  // List Req state
  const [listData, setListData] = useState<SparkData | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState({ dept: [] as string[], display_type: [] as string[], article: '', store_names: [] as string[] })
  const listFetched = useRef(false)

  const [invalidating, setInvalidating] = useState(false)
  const [invalidateMsg, setInvalidateMsg] = useState('')
  async function handleInvalidate() {
    if (!confirm('Requirement cache clear hoga — next load Oracle se fresh data lega. Continue?')) return
    setInvalidating(true)
    try {
      const res = await http.post<{ success: boolean; message: string }>('/system/cache/invalidate')
      setInvalidateMsg(res.data.message ?? 'Cache cleared')
    } catch { setInvalidateMsg('Error clearing cache') }
    setInvalidating(false)
    setTimeout(() => setInvalidateMsg(''), 4000)
  }

  const loadMrp = useCallback(async () => {
    setMrpLoading(true); setMrpError(null)
    try {
      const params = new URLSearchParams()
      mrpFilter.dept.forEach(v => params.append('department', v))
      mrpFilter.display_type.forEach(v => params.append('display_type', v))
      if (mrpFilter.article)      params.set('article',      mrpFilter.article)
      mrpFilter.division.forEach(v    => params.append('division',    v))
      mrpFilter.attribute1.forEach(v  => params.append('attribute1',  v))
      mrpFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/mrp_pivot', { params })
      setMrpData(r.data.data)
    } catch (e: unknown) {
      setMrpError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load MRP data')
    }
    setMrpLoading(false)
  }, [mrpFilter])

  const loadArt = useCallback(async () => {
    setArtLoading(true); setArtError(null)
    try {
      const params = new URLSearchParams()
      artFilter.dept.forEach(v => params.append('department', v))
      artFilter.display_type.forEach(v => params.append('display_type', v))
      if (artFilter.article)      params.set('article',      artFilter.article)
      artFilter.division.forEach(v    => params.append('division',    v))
      artFilter.attribute1.forEach(v  => params.append('attribute1',  v))
      artFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/art_pivot', { params })
      setArtData(r.data.data)
    } catch (e: unknown) {
      setArtError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load Article Req data')
    }
    setArtLoading(false)
  }, [artFilter])

  const loadMc = useCallback(async () => {
    setMcLoading(true); setMcError(null)
    try {
      const params = new URLSearchParams()
      mcFilter.dept.forEach(v => params.append('department', v))
      mcFilter.display_type.forEach(v => params.append('display_type', v))
      mcFilter.division.forEach(v    => params.append('division',    v))
      mcFilter.attribute1.forEach(v  => params.append('attribute1',  v))
      mcFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/mc_pivot', { params })
      setMcData(r.data.data)
    } catch (e: unknown) {
      setMcError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load MC Req data')
    }
    setMcLoading(false)
  }, [mcFilter])

  const loadBarcode = useCallback(async () => {
    setBarcodeLoading(true); setBarcodeError(null)
    try {
      const params = new URLSearchParams()
      barcodeFilter.dept.forEach(v => params.append('department', v))
      barcodeFilter.display_type.forEach(v => params.append('display_type', v))
      if (barcodeFilter.article)      params.set('article',      barcodeFilter.article)
      barcodeFilter.division.forEach(v    => params.append('division',    v))
      barcodeFilter.attribute1.forEach(v  => params.append('attribute1',  v))
      barcodeFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/barcode_pivot', { params })
      setBarcodeData(r.data.data)
    } catch (e: unknown) {
      setBarcodeError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load Barcode data')
    }
    setBarcodeLoading(false)
  }, [barcodeFilter])

  const loadOption = useCallback(async () => {
    setOptionLoading(true); setOptionError(null)
    try {
      const params = new URLSearchParams()
      optionFilter.dept.forEach(v => params.append('department', v))
      optionFilter.display_type.forEach(v => params.append('display_type', v))
      optionFilter.division.forEach(v    => params.append('division',    v))
      optionFilter.attribute1.forEach(v  => params.append('attribute1',  v))
      optionFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/option_pivot', { params })
      setOptionData(r.data.data)
    } catch (e: unknown) {
      setOptionError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load Option data')
    }
    setOptionLoading(false)
  }, [optionFilter])

  const loadList = useCallback(async () => {
    setListLoading(true); setListError(null)
    try {
      const params = new URLSearchParams()
      listFilter.dept.forEach(v => params.append('department', v))
      listFilter.display_type.forEach(v => params.append('display_type', v))
      if (listFilter.article)      params.set('article',      listFilter.article)
      listFilter.store_names.forEach(v => params.append('store_names', v))
      const r = await http.get('/req/list_pivot', { params })
      setListData(r.data.data)
    } catch (e: unknown) {
      setListError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load List data')
    }
    setListLoading(false)
  }, [listFilter])

  useEffect(() => { if (activeTab === 'mrp'     && !mrpFetched.current)     { mrpFetched.current     = true; loadMrp()     } }, [activeTab, loadMrp])
  useEffect(() => { if (activeTab === 'art'     && !artFetched.current)     { artFetched.current     = true; loadArt()     } }, [activeTab, loadArt])
  useEffect(() => { if (activeTab === 'mc'      && !mcFetched.current)      { mcFetched.current      = true; loadMc()      } }, [activeTab, loadMc])
  useEffect(() => { if (activeTab === 'barcode' && !barcodeFetched.current) { barcodeFetched.current = true; loadBarcode() } }, [activeTab, loadBarcode])
  useEffect(() => { if (activeTab === 'option'  && !optionFetched.current)  { optionFetched.current  = true; loadOption()  } }, [activeTab, loadOption])
  useEffect(() => { if (activeTab === 'list'    && !listFetched.current)    { listFetched.current    = true; loadList()    } }, [activeTab, loadList])

  const loadSize = useCallback(async () => {
    setSizeLoading(true)
    setSizeError(null)
    try {
      const params = new URLSearchParams()
      sizeFilter.dept.forEach(v => params.append('department', v))
      if (sizeFilter.article) params.set('article',    sizeFilter.article)
      if (sizeFilter.cat4)    params.set('cat4',       sizeFilter.cat4)
      sizeFilter.division.forEach(v     => params.append('division',    v))
      sizeFilter.attribute1.forEach(v   => params.append('attribute1',  v))
      sizeFilter.store_names.forEach(v  => params.append('store_names', v))
      const r = await http.get('/req/size_pivot', { params })
      setSizeData(r.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load Size data'
      setSizeError(msg)
    }
    setSizeLoading(false)
  }, [sizeFilter])

  useEffect(() => {
    if (activeTab === 'size' && !sizeFetched.current) {
      sizeFetched.current = true
      loadSize()
    }
  }, [activeTab, loadSize])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const r = await http.get('/req/status')
      setViews(r.data.data ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  const loadSparky = useCallback(async () => {
    setSparkLoading(true)
    setSparkError(null)
    try {
      const params = new URLSearchParams()
      sparkFilter.dept.forEach(v => params.append('department', v))
      if (sparkFilter.article) params.set('article', sparkFilter.article)
      if (sparkFilter.cat4)    params.set('cat4',    sparkFilter.cat4)
      const r = await http.get('/req/sparky_pivot', { params })
      setSparkData(r.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Failed to load Sparky data'
      setSparkError(msg)
    }
    setSparkLoading(false)
  }, [sparkFilter])

  useEffect(() => {
    if (activeTab === 'sparky' && !sparkFetched.current) {
      sparkFetched.current = true
      loadSparky()
    }
  }, [activeTab, loadSparky])

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

  const TAB_BTN = (tab: 'views' | 'sparky' | 'size' | 'mrp' | 'art' | 'mc' | 'barcode' | 'option' | 'list', label: string, icon: string) => (
    <button onClick={() => setActiveTab(tab)} style={{
      fontSize: 13, padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
      background: activeTab === tab ? '#6366f1' : '#1e293b',
      border: activeTab === tab ? '1px solid #6366f1' : '1px solid #334155',
      color: activeTab === tab ? '#fff' : '#94a3b8',
    }}>{icon} {label}</button>
  )

  // Sparky grouped rows for rendering subtotals
  const sparkRows = sparkData?.rows ?? []
  const filteredSparkRows = numFilter.applyToRows(sparkRows as unknown as Record<string, unknown>[]) as unknown as SparkRow[]
  const sparkDepts = Array.from(new Set(filteredSparkRows.map(r => r.department)))

  return (
    <div style={{ padding: '20px 24px', background: '#0a0f1e', minHeight: '100vh', color: 'var(--text-primary)' }}>
      <StaleBanner />

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
            Requirements Dashboard
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            Oracle views — auto-refreshed daily at 06:00 AM
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleInvalidate}
            disabled={invalidating}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: '#7f1d1d', border: 'none', color: '#fff', cursor: invalidating ? 'not-allowed' : 'pointer', opacity: invalidating ? 0.7 : 1 }}
          >{invalidating ? 'Clearing…' : '🗑 Clear Cache'}</button>
          {invalidateMsg && <span style={{ fontSize: 12, color: '#4ade80' }}>{invalidateMsg}</span>}
          {activeTab === 'views' && (
            <button onClick={loadStatus} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 8,
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}>↻ Reload</button>
          )}
          {activeTab === 'sparky' && (
            <button onClick={() => { sparkFetched.current = false; loadSparky() }} style={{
              fontSize: 12, padding: '6px 14px', borderRadius: 8,
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              color: 'var(--text-secondary)', cursor: 'pointer',
            }}>↻ Refresh</button>
          )}
          {activeTab === 'size' && (
            <button onClick={() => { sizeFetched.current = false; loadSize() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'mrp' && (
            <button onClick={() => { mrpFetched.current = false; loadMrp() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'art' && (
            <button onClick={() => { artFetched.current = false; loadArt() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'mc' && (
            <button onClick={() => { mcFetched.current = false; loadMc() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'barcode' && (
            <button onClick={() => { barcodeFetched.current = false; loadBarcode() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'option' && (
            <button onClick={() => { optionFetched.current = false; loadOption() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
          {activeTab === 'list' && (
            <button onClick={() => { listFetched.current = false; loadList() }} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>↻ Refresh</button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TAB_BTN('views',   'Req Views',    '📋')}
        {TAB_BTN('mrp',     'MRP Req',      '🏷️')}
        {TAB_BTN('art',     'Article Req',  '📦')}
        {TAB_BTN('mc',      'MC Req',       '🧩')}
        {TAB_BTN('barcode', 'Barcode Req',  '🔖')}
        {TAB_BTN('option',  'Option Req',   '🎯')}
        {TAB_BTN('list',    'List Req',     '📝')}
        {TAB_BTN('sparky',  'Sparky Req',   '⚡')}
        {TAB_BTN('size',    'Size Req',     '📐')}
      </div>

      {/* ── Views tab ── */}
      {activeTab === 'views' && <>

      {/* ── Summary strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Total Views', value: '12', sub: '9 groups' },
          { label: 'Cached', value: `${totalCached}/12`, sub: totalCached === 12 ? 'All ready' : `${12 - totalCached} pending` },
          { label: 'Total Rows', value: fmtRows(totalRows), sub: 'across all views' },
          { label: 'Last Refresh', value: fmtTs(lastRefresh ?? null), sub: 'most recent' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#131929', border: '1px solid var(--card-border)', borderRadius: 10,
            padding: '12px 16px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
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
                        <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          {v.obj}
                        </div>
                        {v.fetched_at && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fmtTs(v.fetched_at)}
                          </div>
                        )}
                      </div>

                      {v.cached && (
                        <div style={{ textAlign: 'right', minWidth: 60 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: gm.color, fontVariantNumeric: 'tabular-nums' }}>
                            {fmtRows(v.rows)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>rows</div>
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
                        : <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 60 }}>Not cached</span>
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
            background: '#131929', border: '1px solid var(--card-border)', borderRadius: 14,
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
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{meta?.label}</div>
              </div>
              {preview && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', background: '#0d1525', padding: '4px 10px', borderRadius: 6 }}>
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
                <div style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>Loading preview…</div>
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
                          padding: '8px 12px', background: '#0a0f1e', color: 'var(--text-muted)',
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
      </> }

      {/* ── MRP Req Tab ── */}
      {activeTab === 'mrp' && (() => {
        type MrpRow = { department: string; display_type: string; mrp: number; article_name: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; to_q: number; pbs: number; req: number; grc_q: number; msa_q: number; alloc_q: number; wms_q: number; rest_dc_q: number; ppo_q: number }
        const rows = (mrpData?.rows ?? []) as unknown as MrpRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={mrpFilter.dept} onChange={v => setMrpFilter(f => ({ ...f, dept: v }))} accentColor="#f59e0b" />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={mrpFilter.display_type} onChange={v => setMrpFilter(f => ({ ...f, display_type: v }))} accentColor="#f59e0b" />
              <input placeholder="Filter Article…" value={mrpFilter.article} onChange={e => setMrpFilter(f => ({ ...f, article: e.target.value }))} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 160 }} />
              <MultiSelect label="Division" options={filterMeta.divisions} value={mrpFilter.division} onChange={v => setMrpFilter(f => ({ ...f, division: v }))} accentColor="#f59e0b" />
              <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={mrpFilter.attribute1} onChange={v => setMrpFilter(f => ({ ...f, attribute1: v }))} accentColor="#f59e0b" />
              <StoreSelect stores={allStores} value={mrpFilter.store_names} onChange={v => setMrpFilter(f => ({ ...f, store_names: v }))} accentColor="#f59e0b" />
              <button onClick={() => { mrpFetched.current = false; loadMrp() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: '#f59e0b', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {mrpData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mrpData.total_rows.toLocaleString()} rows</span>}
            </div>
            {mrpLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading MRP data from Oracle…</div>}
            {mrpError && !mrpData && <div style={{ color: '#f87171', padding: 20 }}>{mrpError}</div>}
            {mrpError && mrpData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {mrpData && !mrpLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={4} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={2} style={{ padding: '4px 10px', color: '#f59e0b', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>MRP Req</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#10b981', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                      <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],['MRP','#f59e0b'],['Article Name','#cbd5e1'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['TO Qty','#64748b'],
                        ['PBS','#f59e0b'],['MRP Req','#f59e0b'],
                        ['GRC','#10b981'],['MSA','#10b981'],['Alloc','#10b981'],['WMS','#10b981'],['Rest DC','#10b981'],
                        ['PPO Qty','#8b5cf6'],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 3 ? 'right' : 'left', borderRight: [3,8,10,15].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lm: a.lm+n(r.lm_sl_q), mtd: a.mtd+n(r.mtd_sl_q), stk: a.stk+n(r.ttl_stk_q), to: a.to+n(r.to_q), pbs: a.pbs+n(r.pbs), req: a.req+n(r.req), grc: a.grc+n(r.grc_q), msa: a.msa+n(r.msa_q), alloc: a.alloc+n(r.alloc_q), wms: a.wms+n(r.wms_q), rest: a.rest+n(r.rest_dc_q), ppo: a.ppo+n(r.ppo_q) }), { sc:0,lm:0,mtd:0,stk:0,to:0,pbs:0,req:0,grc:0,msa:0,alloc:0,wms:0,rest:0,ppo:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={17} style={{ padding: '6px 10px', color: '#f59e0b', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>🏷️ {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#f59e0b', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mrp)}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.article_name}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.to_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#f59e0b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.req>0?'#fbbf24':'#334155', fontWeight: r.req>0?700:400, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#8b5cf6', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={4} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.to].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.req].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#fbbf24', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===1?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.grc,tot.msa,tot.alloc,tot.wms,tot.rest].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===4?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#a78bfa', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Article Req Tab ── */}
      {activeTab === 'art' && (() => {
        type ArtRow = { department: string; display_type: string; article_name: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; to_q: number; pbs: number; req: number; grc_q: number; msa_q: number; alloc_q: number; wms_q: number; rest_dc_q: number; ppo_q: number }
        const rows = (artData?.rows ?? []) as unknown as ArtRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={artFilter.dept} onChange={v => setArtFilter(f => ({ ...f, dept: v }))} accentColor="#0ea5e9" />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={artFilter.display_type} onChange={v => setArtFilter(f => ({ ...f, display_type: v }))} accentColor="#0ea5e9" />
              <input placeholder="Filter Article…" value={artFilter.article} onChange={e => setArtFilter(f => ({ ...f, article: e.target.value }))} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 160 }} />
              <MultiSelect label="Division" options={filterMeta.divisions} value={artFilter.division} onChange={v => setArtFilter(f => ({ ...f, division: v }))} accentColor="#0ea5e9" />
              <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={artFilter.attribute1} onChange={v => setArtFilter(f => ({ ...f, attribute1: v }))} accentColor="#0ea5e9" />
              <StoreSelect stores={allStores} value={artFilter.store_names} onChange={v => setArtFilter(f => ({ ...f, store_names: v }))} accentColor="#0ea5e9" />
              <button onClick={() => { artFetched.current = false; loadArt() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: '#0ea5e9', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {artData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{artData.total_rows.toLocaleString()} rows</span>}
            </div>
            {artLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading Article Req data from Oracle…</div>}
            {artError && !artData && <div style={{ color: '#f87171', padding: 20 }}>{artError}</div>}
            {artError && artData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {artData && !artLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={3} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={2} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Art Req</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#10b981', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                      <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],['Article Name','#cbd5e1'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['TO Qty','#64748b'],
                        ['PBS','#0ea5e9'],['Art Req','#0ea5e9'],
                        ['GRC','#10b981'],['MSA','#10b981'],['Alloc','#10b981'],['WMS','#10b981'],['Rest DC','#10b981'],
                        ['PPO Qty','#8b5cf6'],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 2 ? 'right' : 'left', borderRight: [2,7,9,14].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lm: a.lm+n(r.lm_sl_q), mtd: a.mtd+n(r.mtd_sl_q), stk: a.stk+n(r.ttl_stk_q), to: a.to+n(r.to_q), pbs: a.pbs+n(r.pbs), req: a.req+n(r.req), grc: a.grc+n(r.grc_q), msa: a.msa+n(r.msa_q), alloc: a.alloc+n(r.alloc_q), wms: a.wms+n(r.wms_q), rest: a.rest+n(r.rest_dc_q), ppo: a.ppo+n(r.ppo_q) }), { sc:0,lm:0,mtd:0,stk:0,to:0,pbs:0,req:0,grc:0,msa:0,alloc:0,wms:0,rest:0,ppo:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={16} style={{ padding: '6px 10px', color: '#0ea5e9', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>📦 {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.article_name}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.to_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#0ea5e9', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.req>0?'#38bdf8':'#334155', fontWeight: r.req>0?700:400, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#8b5cf6', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={3} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.to].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.req].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===1?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.grc,tot.msa,tot.alloc,tot.wms,tot.rest].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===4?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#a78bfa', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── MC Req Tab ── */}
      {activeTab === 'mc' && (() => {
        type McRow = { department: string; display_type: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; to_q: number; pbs: number; req: number; grc_q: number; msa_q: number; alloc_q: number; wms_q: number; rest_dc_q: number; ppo_q: number }
        const rows = (mcData?.rows ?? []) as unknown as McRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={mcFilter.dept} onChange={v => setMcFilter(f => ({ ...f, dept: v }))} accentColor="#6366f1" />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={mcFilter.display_type} onChange={v => setMcFilter(f => ({ ...f, display_type: v }))} accentColor="#6366f1" />
              <MultiSelect label="Division" options={filterMeta.divisions} value={mcFilter.division} onChange={v => setMcFilter(f => ({ ...f, division: v }))} accentColor="#6366f1" />
              <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={mcFilter.attribute1} onChange={v => setMcFilter(f => ({ ...f, attribute1: v }))} accentColor="#6366f1" />
              <StoreSelect stores={allStores} value={mcFilter.store_names} onChange={v => setMcFilter(f => ({ ...f, store_names: v }))} accentColor="#6366f1" />
              <button onClick={() => { mcFetched.current = false; loadMc() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: '#6366f1', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {mcData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{mcData.total_rows.toLocaleString()} rows</span>}
            </div>
            {mcLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading MC Req data from Oracle…</div>}
            {mcError && !mcData && <div style={{ color: '#f87171', padding: 20 }}>{mcError}</div>}
            {mcError && mcData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {mcData && !mcLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={2} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>MC</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={2} style={{ padding: '4px 10px', color: '#6366f1', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>MC Req</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#10b981', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                      <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['TO Qty','#64748b'],
                        ['PBS','#6366f1'],['MC Req','#6366f1'],
                        ['GRC','#10b981'],['MSA','#10b981'],['Alloc','#10b981'],['WMS','#10b981'],['Rest DC','#10b981'],
                        ['PPO Qty','#8b5cf6'],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 1 ? 'right' : 'left', borderRight: [1,6,8,13].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lm: a.lm+n(r.lm_sl_q), mtd: a.mtd+n(r.mtd_sl_q), stk: a.stk+n(r.ttl_stk_q), to: a.to+n(r.to_q), pbs: a.pbs+n(r.pbs), req: a.req+n(r.req), grc: a.grc+n(r.grc_q), msa: a.msa+n(r.msa_q), alloc: a.alloc+n(r.alloc_q), wms: a.wms+n(r.wms_q), rest: a.rest+n(r.rest_dc_q), ppo: a.ppo+n(r.ppo_q) }), { sc:0,lm:0,mtd:0,stk:0,to:0,pbs:0,req:0,grc:0,msa:0,alloc:0,wms:0,rest:0,ppo:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={15} style={{ padding: '6px 10px', color: '#6366f1', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>🧩 {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.to_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#6366f1', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.req>0?'#818cf8':'#334155', fontWeight: r.req>0?700:400, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#8b5cf6', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={2} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.to].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.req].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#818cf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===1?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.grc,tot.msa,tot.alloc,tot.wms,tot.rest].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===4?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#a78bfa', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Barcode Req Tab ── */}
      {activeTab === 'barcode' && (() => {
        type BarcodeRow = { department: string; display_type: string; article_name: string; mrp: number; division: string; attribute1: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; to_q: number; pbs: number; grc_req: number; wms_req: number; grc_q: number; msa_q: number; alloc_q: number; wms_q: number; rest_dc_q: number; ppo_q: number }
        const rows = (barcodeData?.rows ?? []) as unknown as BarcodeRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        const AC = '#10b981'
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={barcodeFilter.dept} onChange={v => setBarcodeFilter(f => ({ ...f, dept: v }))} accentColor={AC} />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={barcodeFilter.display_type} onChange={v => setBarcodeFilter(f => ({ ...f, display_type: v }))} accentColor={AC} />
              <input placeholder="Filter Article…" value={barcodeFilter.article} onChange={e => setBarcodeFilter(f => ({ ...f, article: e.target.value }))} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 160 }} />
              <MultiSelect label="Division" options={filterMeta.divisions} value={barcodeFilter.division} onChange={v => setBarcodeFilter(f => ({ ...f, division: v }))} accentColor={AC} />
              <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={barcodeFilter.attribute1} onChange={v => setBarcodeFilter(f => ({ ...f, attribute1: v }))} accentColor={AC} />
              <StoreSelect stores={allStores} value={barcodeFilter.store_names} onChange={v => setBarcodeFilter(f => ({ ...f, store_names: v }))} accentColor={AC} />
              <button onClick={() => { barcodeFetched.current = false; loadBarcode() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: AC, border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {barcodeData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{barcodeData.total_rows.toLocaleString()} rows</span>}
            </div>
            {barcodeLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading Barcode data from Oracle…</div>}
            {barcodeError && !barcodeData && <div style={{ color: '#f87171', padding: 20 }}>{barcodeError}</div>}
            {barcodeError && barcodeData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {barcodeData && !barcodeLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={4} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={3} style={{ padding: '4px 10px', color: AC, borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Barcode Req</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#34d399', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                      <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],['Article Name','#cbd5e1'],['MRP','#f59e0b'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['TO Qty','#64748b'],
                        ['PBS',AC],['GRC Req',AC],['WMS Req','#6ee7b7'],
                        ['GRC DC','#34d399'],['MSA','#34d399'],['Alloc','#34d399'],['WMS DC','#34d399'],['Rest DC','#34d399'],
                        ['PPO Qty','#8b5cf6'],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 3 ? 'right' : 'left', borderRight: [3,8,11,16].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lm: a.lm+n(r.lm_sl_q), mtd: a.mtd+n(r.mtd_sl_q), stk: a.stk+n(r.ttl_stk_q), to: a.to+n(r.to_q), pbs: a.pbs+n(r.pbs), greq: a.greq+n(r.grc_req), wreq: a.wreq+n(r.wms_req), grc: a.grc+n(r.grc_q), msa: a.msa+n(r.msa_q), alloc: a.alloc+n(r.alloc_q), wms: a.wms+n(r.wms_q), rest: a.rest+n(r.rest_dc_q), ppo: a.ppo+n(r.ppo_q) }), { sc:0,lm:0,mtd:0,stk:0,to:0,pbs:0,greq:0,wreq:0,grc:0,msa:0,alloc:0,wms:0,rest:0,ppo:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={18} style={{ padding: '6px 10px', color: AC, fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>🔖 {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.article_name}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#f59e0b', fontWeight:600, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mrp)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.to_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:AC, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.grc_req>0?'#34d399':'#334155', fontWeight: r.grc_req>0?700:400, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.wms_req>0?'#6ee7b7':'#334155', fontWeight: r.wms_req>0?700:400, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#8b5cf6', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={4} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.to].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.greq,tot.wreq].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#34d399', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===2?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.grc,tot.msa,tot.alloc,tot.wms,tot.rest].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===4?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#a78bfa', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Option Req Tab ── */}
      {activeTab === 'option' && (() => {
        type OptionRow = { department: string; display_type: string; option_level: string; allocation_option: string; division: string; attribute1: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; ttl_stk_q_adj: number; pbs: number; option_pbs: number; option_req: number }
        const rows = (optionData?.rows ?? []) as unknown as OptionRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        const AC = '#14b8a6'
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={optionFilter.dept} onChange={v => setOptionFilter(f => ({ ...f, dept: v }))} accentColor={AC} />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={optionFilter.display_type} onChange={v => setOptionFilter(f => ({ ...f, display_type: v }))} accentColor={AC} />
              <MultiSelect label="Division" options={filterMeta.divisions} value={optionFilter.division} onChange={v => setOptionFilter(f => ({ ...f, division: v }))} accentColor={AC} />
              <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={optionFilter.attribute1} onChange={v => setOptionFilter(f => ({ ...f, attribute1: v }))} accentColor={AC} />
              <StoreSelect stores={allStores} value={optionFilter.store_names} onChange={v => setOptionFilter(f => ({ ...f, store_names: v }))} accentColor={AC} />
              <button onClick={() => { optionFetched.current = false; loadOption() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: AC, border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {optionData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{optionData.total_rows.toLocaleString()} rows</span>}
            </div>
            {optionLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading Option data from Oracle…</div>}
            {optionError && !optionData && <div style={{ color: '#f87171', padding: 20 }}>{optionError}</div>}
            {optionError && optionData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {optionData && !optionLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={4} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Option</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={3} style={{ padding: '4px 10px', color: AC, borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>Option Req</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],['Option Level','#cbd5e1'],['Alloc Option','#cbd5e1'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['Adj Stk','#64748b'],
                        ['PBS',AC],['Option PBS',AC],['Option Req',AC],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 3 ? 'right' : 'left', borderRight: [3,8].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lm: a.lm+n(r.lm_sl_q), mtd: a.mtd+n(r.mtd_sl_q), stk: a.stk+n(r.ttl_stk_q), adj: a.adj+n(r.ttl_stk_q_adj), pbs: a.pbs+n(r.pbs), opbs: a.opbs+n(r.option_pbs), oreq: a.oreq+n(r.option_req) }), { sc:0,lm:0,mtd:0,stk:0,adj:0,pbs:0,opbs:0,oreq:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={12} style={{ padding: '6px 10px', color: AC, fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>🎯 {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.option_level ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#cbd5e1', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.allocation_option ?? '—'}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q_adj)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:AC, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:AC, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.option_pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.option_req>0?'#2dd4bf':'#334155', fontWeight: r.option_req>0?700:400, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.option_req)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={4} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.adj].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.opbs,tot.oreq].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#2dd4bf', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(v)}</td>)}
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── List Req Tab ── */}
      {activeTab === 'list' && (() => {
        type ListRow = { department: string; display_type: string; article_name: string; mrp: number; list_tag: string; store_cnt: number; list_q: number; adj_ttl_stk_q: number; list_req: number }
        const rows = (listData?.rows ?? []) as unknown as ListRow[]
        const depts = Array.from(new Set(rows.map(r => r.department)))
        const AC = '#f59e0b'
        return (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <MultiSelect label="Department" options={filterMeta.departments} value={listFilter.dept} onChange={v => setListFilter(f => ({ ...f, dept: v }))} accentColor={AC} />
              <MultiSelect label="Display Type" options={filterMeta.display_types} value={listFilter.display_type} onChange={v => setListFilter(f => ({ ...f, display_type: v }))} accentColor={AC} />
              <input placeholder="Filter Article…" value={listFilter.article} onChange={e => setListFilter(f => ({ ...f, article: e.target.value }))} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 160 }} />
              <StoreSelect stores={allStores} value={listFilter.store_names} onChange={v => setListFilter(f => ({ ...f, store_names: v }))} accentColor={AC} />
              <button onClick={() => { listFetched.current = false; loadList() }} style={{ height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer', background: AC, border: 'none', color: '#fff', fontSize: 12, fontWeight: 600 }}>Search</button>
              {listData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{listData.total_rows.toLocaleString()} rows</span>}
            </div>
            {listLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading List data from Oracle…</div>}
            {listError && !listData && <div style={{ color: '#f87171', padding: 20 }}>{listError}</div>}
            {listError && listData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}
            {listData && !listLoading && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={5} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                      <th colSpan={4} style={{ padding: '4px 10px', color: AC, borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>List Req</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[['Department','#cbd5e1'],['Display Type','#94a3b8'],['Article Name','#cbd5e1'],['MRP','#f59e0b'],['List Tag','#94a3b8'],
                        ['Stores','#38bdf8'],['List Qty',AC],['Adj Stock',AC],['List Req',AC],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{ padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap', textAlign: i > 4 ? 'right' : 'left', borderRight: [4].includes(i) ? '1px solid #1e293b' : undefined, position: 'sticky', top: 0, background: '#131929' }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const dr = rows.filter(r => r.department === dept)
                      const tot = dr.reduce((a, r) => ({ sc: a.sc+n(r.store_cnt), lq: a.lq+n(r.list_q), adj: a.adj+n(r.adj_ttl_stk_q), lreq: a.lreq+n(r.list_req) }), { sc:0,lq:0,adj:0,lreq:0 })
                      return [
                        <tr key={`h-${dept}`} style={{ background: 'var(--content-bg)' }}><td colSpan={9} style={{ padding: '6px 10px', color: AC, fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>📝 {dept}</td></tr>,
                        ...dr.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i%2===0?'transparent':'#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.article_name}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#f59e0b', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mrp)}</td>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', whiteSpace:'nowrap' }}>{r.list_tag ?? '—'}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:AC, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.list_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:AC, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.adj_ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.list_req>0?'#fbbf24':'#334155', fontWeight: r.list_req>0?700:400, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.list_req)}</td>
                          </tr>
                        )),
                        <tr key={`t-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={5} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.sc)}</td>
                          {[tot.lq,tot.adj,tot.lreq].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#fbbf24', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(v)}</td>)}
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Sparky Req Tab ── */}
      {activeTab === 'sparky' && (
        <div>
          {/* filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <MultiSelect label="Department" options={filterMeta.departments} value={sparkFilter.dept} onChange={v => setSparkFilter(f => ({ ...f, dept: v }))} accentColor="#f97316" />
            <input placeholder="Filter Article…" value={sparkFilter.article}
              onChange={e => setSparkFilter(f => ({ ...f, article: e.target.value }))}
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 200 }} />
            <input placeholder="Filter CAT4…" value={sparkFilter.cat4}
              onChange={e => setSparkFilter(f => ({ ...f, cat4: e.target.value }))}
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 160 }} />
            <button onClick={() => { sparkFetched.current = false; loadSparky() }} style={{
              height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer',
              background: '#f97316', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
            }}>Search</button>
            {sparkData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sparkData.total_rows.toLocaleString()} rows</span>}
          </div>

          {sparkLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading Sparky data from Oracle…</div>}
          {sparkError && !sparkData && <div style={{ color: '#f87171', padding: 20 }}>{sparkError}</div>}
          {sparkError && sparkData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data. {sparkError}</div>}

          {sparkData && !sparkLoading && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#0a0f1e' }}>
                    {/* section headers */}
                    <th colSpan={3} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                    <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                    <th colSpan={2} style={{ padding: '4px 10px', color: '#f97316', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Sparky</th>
                    <th colSpan={5} style={{ padding: '4px 10px', color: '#10b981', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                    <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                  </tr>
                  <tr style={{ background: '#131929' }}>
                    {[
                      ['Department', '#cbd5e1', ''], ['Article Name', '#cbd5e1', ''], ['CAT4', '#cbd5e1', ''],
                      ['Stores', '#38bdf8', 'store_cnt'], ['LM Sale', '#64748b', 'lm_sl_q'], ['MTD Sale', '#64748b', 'mtd_sl_q'], ['Store Stk', '#64748b', 'ttl_stk_q'], ['TO Qty', '#64748b', 'to_q'],
                      ['PBS', '#f97316', 'sparky_pbs'], ['Sparky Req', '#f97316', 'sparky_req'],
                      ['GRC', '#10b981', 'grc_q'], ['MSA', '#10b981', 'msa_q'], ['Alloc', '#10b981', 'alloc_q'], ['WMS', '#10b981', 'wms_q'], ['Rest DC', '#10b981', 'rest_dc_q'],
                      ['PPO Qty', '#8b5cf6', 'ppo_q'],
                    ].map(([lbl, col, fld], i) => (
                      <th key={i} style={{
                        padding: '6px 10px', color: col as string, fontWeight: 600,
                        fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4,
                        borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
                        textAlign: i > 2 ? 'right' : 'left',
                        borderRight: [2, 7, 9, 14].includes(i) ? '1px solid #1e293b' : undefined,
                        position: 'sticky', top: 0, background: numFilter.numFilters[fld as string] ? '#1a2e1a' : '#131929',
                      }}>
                        {lbl}
                        {fld && <NumFilterIcon col={fld as string} active={!!numFilter.numFilters[fld as string]} onOpen={numFilter.openFilter} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sparkDepts.map(dept => {
                    const deptRows = filteredSparkRows.filter(r => r.department === dept)
                    const tot = deptRows.reduce((a, r) => ({
                      lm: a.lm + n(r.lm_sl_q), mtd: a.mtd + n(r.mtd_sl_q), stk: a.stk + n(r.ttl_stk_q),
                      to: a.to + n(r.to_q), pbs: a.pbs + n(r.sparky_pbs), req: a.req + n(r.sparky_req),
                      grc: a.grc + n(r.grc_q), msa: a.msa + n(r.msa_q), alloc: a.alloc + n(r.alloc_q),
                      wms: a.wms + n(r.wms_q), rest: a.rest + n(r.rest_dc_q), ppo: a.ppo + n(r.ppo_q),
                    }), { lm: 0, mtd: 0, stk: 0, to: 0, pbs: 0, req: 0, grc: 0, msa: 0, alloc: 0, wms: 0, rest: 0, ppo: 0 })

                    return [
                      // dept header row
                      <tr key={`hdr-${dept}`} style={{ background: 'var(--content-bg)' }}>
                        <td colSpan={16} style={{ padding: '6px 10px', color: '#f97316', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>
                          ⚡ {dept}
                        </td>
                      </tr>,
                      // data rows
                      ...deptRows.map((r, i) => (
                        <tr key={`${dept}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1525' }}>
                          <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontSize: 11, borderBottom: '1px solid #131929', borderRight: '1px solid #0f172a', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.department}</td>
                          <td style={{ padding: '5px 10px', color: 'var(--text-primary)', borderBottom: '1px solid #131929', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.article_name}</td>
                          <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', fontSize: 11, borderBottom: '1px solid #131929', borderRight: '1px solid #0f172a', whiteSpace: 'nowrap' }}>{r.cat4 ?? '—'}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#38bdf8', fontWeight: 600, borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN((r as unknown as Record<string,number>).store_cnt)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid #131929', borderRight: '1px solid #0f172a', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.to_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#f97316', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.sparky_pbs)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: r.sparky_req > 0 ? '#fb923c' : '#334155', fontWeight: r.sparky_req > 0 ? 700 : 400, borderBottom: '1px solid #131929', borderRight: '1px solid #0f172a', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.sparky_req)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#10b981', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#10b981', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#10b981', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#10b981', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#10b981', borderBottom: '1px solid #131929', borderRight: '1px solid #0f172a', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                          <td style={{ padding: '5px 10px', textAlign: 'right', color: '#8b5cf6', borderBottom: '1px solid #131929', fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                        </tr>
                      )),
                      // dept total row
                      <tr key={`tot-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                        <td colSpan={3} style={{ padding: '5px 10px', color: '#4ade80', fontWeight: 700, fontSize: 11, borderBottom: '1px solid #1e293b', borderRight: '1px solid #0f172a' }}>{dept} Total</td>
                        {[n(deptRows.reduce((s,r)=>s+n((r as unknown as Record<string,number>).store_cnt),0)), tot.lm, tot.mtd, tot.stk, tot.to].map((v, i) => <td key={i} style={{ padding: '5px 10px', textAlign: 'right', color: i===0?'#38bdf8':'#4ade80', fontWeight: 700, borderBottom: '1px solid #1e293b', fontVariantNumeric: 'tabular-nums', ...(i === 4 ? { borderRight: '1px solid #0f172a' } : {}) }}>{fmtN(v)}</td>)}
                        {[tot.pbs, tot.req].map((v, i) => <td key={i} style={{ padding: '5px 10px', textAlign: 'right', color: '#fb923c', fontWeight: 700, borderBottom: '1px solid #1e293b', fontVariantNumeric: 'tabular-nums', ...(i === 1 ? { borderRight: '1px solid #0f172a' } : {}) }}>{fmtN(v)}</td>)}
                        {[tot.grc, tot.msa, tot.alloc, tot.wms, tot.rest].map((v, i) => <td key={i} style={{ padding: '5px 10px', textAlign: 'right', color: '#4ade80', fontWeight: 700, borderBottom: '1px solid #1e293b', fontVariantNumeric: 'tabular-nums', ...(i === 4 ? { borderRight: '1px solid #0f172a' } : {}) }}>{fmtN(v)}</td>)}
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#a78bfa', fontWeight: 700, borderBottom: '1px solid #1e293b', fontVariantNumeric: 'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                      </tr>
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Size Req Tab ── */}
      {activeTab === 'size' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <MultiSelect label="Department" options={filterMeta.departments} value={sizeFilter.dept} onChange={v => setSizeFilter(f => ({ ...f, dept: v }))} accentColor="#ec4899" />
            <input placeholder="Filter Article…" value={sizeFilter.article}
              onChange={e => setSizeFilter(f => ({ ...f, article: e.target.value }))}
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 200 }} />
            <input placeholder="Filter Size (CAT4)…" value={sizeFilter.cat4}
              onChange={e => setSizeFilter(f => ({ ...f, cat4: e.target.value }))}
              style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 12, width: 140 }} />
            <MultiSelect label="Division" options={filterMeta.divisions} value={sizeFilter.division} onChange={v => setSizeFilter(f => ({ ...f, division: v }))} accentColor="#ec4899" />
            <MultiSelect label="Attribute1" options={filterMeta.attribute1s} value={sizeFilter.attribute1} onChange={v => setSizeFilter(f => ({ ...f, attribute1: v }))} accentColor="#ec4899" />
            <StoreSelect stores={allStores} value={sizeFilter.store_names} onChange={v => setSizeFilter(f => ({ ...f, store_names: v }))} accentColor="#ec4899" />
            <button onClick={() => { sizeFetched.current = false; loadSize() }} style={{
              height: 32, padding: '0 16px', borderRadius: 8, cursor: 'pointer',
              background: '#ec4899', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600,
            }}>Search</button>
            {sizeData && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sizeData.total_rows.toLocaleString()} rows</span>}
          </div>

          {sizeLoading && <div style={{ color: 'var(--text-muted)', padding: 32, textAlign: 'center' }}>Loading Size data from Oracle…</div>}
          {sizeError && !sizeData && <div style={{ color: '#f87171', padding: 20 }}>{sizeError}</div>}
          {sizeError && sizeData && <div style={{ color: '#f59e0b', padding: '6px 12px', marginBottom: 8, background: '#422006', borderRadius: 8, fontSize: 12 }}>⚠ Refresh failed — showing cached data.</div>}

          {sizeData && !sizeLoading && (() => {
            type SzRow = { department: string; display_type: string; article_name: string; cat4: string; store_cnt: number; lm_sl_q: number; mtd_sl_q: number; ttl_stk_q: number; adj_stk_q: number; sz_pbs: number; sz_req: number; grc_q: number; msa_q: number; alloc_q: number; wms_q: number; rest_dc_q: number; ppo_q: number }
            const rows = sizeData.rows as unknown as SzRow[]
            const depts = Array.from(new Set(rows.map(r => r.department)))
            return (
              <div style={{ overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#0a0f1e' }}>
                      <th colSpan={4} style={{ padding: '4px 10px', color: 'var(--text-muted)', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'left', borderRight: '1px solid #1e293b' }}>Article</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#0ea5e9', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Store Data</th>
                      <th colSpan={2} style={{ padding: '4px 10px', color: '#ec4899', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>Size Req</th>
                      <th colSpan={5} style={{ padding: '4px 10px', color: '#10b981', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center', borderRight: '1px solid #1e293b' }}>DC Stock (WH)</th>
                      <th colSpan={1} style={{ padding: '4px 10px', color: '#8b5cf6', borderBottom: '1px solid #1e293b', fontSize: 10, textAlign: 'center' }}>PPO</th>
                    </tr>
                    <tr style={{ background: '#131929' }}>
                      {[
                        ['Department','#cbd5e1'],['Display Type','#94a3b8'],['Article Name','#cbd5e1'],['Size','#cbd5e1'],
                        ['Stores','#38bdf8'],['LM Sale','#64748b'],['MTD Sale','#64748b'],['Store Stk','#64748b'],['Adj Stk','#64748b'],
                        ['SZ PBS','#ec4899'],['SZ Req','#ec4899'],
                        ['GRC','#10b981'],['MSA','#10b981'],['Alloc','#10b981'],['WMS','#10b981'],['Rest DC','#10b981'],
                        ['PPO Qty','#8b5cf6'],
                      ].map(([lbl, col], i) => (
                        <th key={i} style={{
                          padding: '6px 10px', color: col, fontWeight: 600, fontSize: 10,
                          textTransform: 'uppercase', letterSpacing: 0.4,
                          borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
                          textAlign: i > 3 ? 'right' : 'left',
                          borderRight: [3, 8, 10, 15].includes(i) ? '1px solid #1e293b' : undefined,
                          position: 'sticky', top: 0, background: '#131929',
                        }}>{lbl}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(dept => {
                      const deptRows = rows.filter(r => r.department === dept)
                      const tot = deptRows.reduce((a, r) => ({
                        lm: a.lm + n(r.lm_sl_q), mtd: a.mtd + n(r.mtd_sl_q),
                        stk: a.stk + n(r.ttl_stk_q), adj: a.adj + n(r.adj_stk_q),
                        pbs: a.pbs + n(r.sz_pbs), req: a.req + n(r.sz_req),
                        grc: a.grc + n(r.grc_q), msa: a.msa + n(r.msa_q),
                        alloc: a.alloc + n(r.alloc_q), wms: a.wms + n(r.wms_q),
                        rest: a.rest + n(r.rest_dc_q), ppo: a.ppo + n(r.ppo_q),
                      }), { lm:0,mtd:0,stk:0,adj:0,pbs:0,req:0,grc:0,msa:0,alloc:0,wms:0,rest:0,ppo:0 })
                      return [
                        <tr key={`hdr-${dept}`} style={{ background: 'var(--content-bg)' }}>
                          <td colSpan={17} style={{ padding: '6px 10px', color: '#ec4899', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #1e293b' }}>📐 {dept}</td>
                        </tr>,
                        ...deptRows.map((r, i) => (
                          <tr key={`${dept}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1525' }}>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.department}</td>
                            <td style={{ padding:'5px 10px', color:'#64748b', fontSize:11, borderBottom:'1px solid #131929', whiteSpace:'nowrap' }}>{r.display_type ?? '—'}</td>
                            <td style={{ padding:'5px 10px', color:'#e2e8f0', borderBottom:'1px solid #131929', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.article_name}</td>
                            <td style={{ padding:'5px 10px', color:'#94a3b8', fontSize:11, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', whiteSpace:'nowrap' }}>{r.cat4 ?? '—'}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:600, borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.store_cnt)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.lm_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.mtd_sl_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ttl_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.adj_stk_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#ec4899', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.sz_pbs)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color: r.sz_req > 0 ? '#f472b6' : '#334155', fontWeight: r.sz_req > 0 ? 700 : 400, borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.sz_req)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.grc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.msa_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.alloc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.wms_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#10b981', borderBottom:'1px solid #131929', borderRight:'1px solid #0f172a', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.rest_dc_q)}</td>
                            <td style={{ padding:'5px 10px', textAlign:'right', color:'#8b5cf6', borderBottom:'1px solid #131929', fontVariantNumeric:'tabular-nums' }}>{fmtN(r.ppo_q)}</td>
                          </tr>
                        )),
                        <tr key={`tot-${dept}`} style={{ background: '#0f1f35', borderTop: '1px solid #1e3a2f' }}>
                          <td colSpan={4} style={{ padding:'5px 10px', color:'#4ade80', fontWeight:700, fontSize:11, borderBottom:'1px solid #1e293b', borderRight:'1px solid #0f172a' }}>{dept} Total</td>
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#38bdf8', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(deptRows.reduce((s,r)=>s+n(r.store_cnt),0))}</td>
                          {[tot.lm,tot.mtd,tot.stk,tot.adj].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===3?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.pbs,tot.req].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#f472b6', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===1?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          {[tot.grc,tot.msa,tot.alloc,tot.wms,tot.rest].map((v,i)=><td key={i} style={{ padding:'5px 10px', textAlign:'right', color:'#4ade80', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums', ...(i===4?{borderRight:'1px solid #0f172a'}:{}) }}>{fmtN(v)}</td>)}
                          <td style={{ padding:'5px 10px', textAlign:'right', color:'#a78bfa', fontWeight:700, borderBottom:'1px solid #1e293b', fontVariantNumeric:'tabular-nums' }}>{fmtN(tot.ppo)}</td>
                        </tr>
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}
      {numFilter.openCol && numFilter.anchor && (
        <NumFilterDropdown
          col={numFilter.openCol}
          value={numFilter.numFilters[numFilter.openCol]}
          onChange={v => numFilter.applyFilter(numFilter.openCol!, v)}
          onClose={() => numFilter.setOpenCol(null)}
          anchor={numFilter.anchor}
        />
      )}
    </div>
  )
}
