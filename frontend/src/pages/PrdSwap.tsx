/**
 * PRD Swap — Package Ready to Dispatch swap engine.
 * Recommends KEEP / REDIRECT / UNASSIGNED for pending challans.
 */
import { useState, useRef } from 'react'
import http from '@/api/http'
import { useTheme } from '@/context/ThemeContext'

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet<T>(url: string, timeout = 120000): Promise<T> {
  const res = await http.get<{ success: boolean; data: T; message: string | null }>(url, { timeout })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await http.post<{ success: boolean; data: T; message: string | null }>(url, body, { timeout: 120000 })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PrdRow {
  CHALLAN_NO: string
  OUT_LOCATION: string
  DES_SITEALIAS: string
  DEPARTMENT: string
  DISPLAY_TYPE: string
  CHALLAN_QTY: number
  CHALLAN_AMOUNT: number
}

interface SwapResult {
  challan_no: string
  from_store: string
  current_dest: string
  recommended_dest: string
  action: 'KEEP' | 'REDIRECT' | 'UNASSIGNED'
  depts_matched: string
  mc_listing: string
  util_pct: number
  store_priority: number
  total_qty: number
  total_value: number
  reason: string
}

interface UnassignedItem {
  challan_no: string
  from_store: string
  current_dest: string
  top7_depts: string
  total_qty: number
  total_value: number
  reason: string
}

interface SwapSummary { keep: number; redirect: number; unassigned: number; total_challans: number; listing_filter?: boolean; listing_pairs?: number }

// ── Requirement upload parser ─────────────────────────────────────────────────
// Expects CSV with columns: store_name, department, req_qty, match_pct, priority
// (same as CL.py Requirements sheet columns)

interface Req { store_name: string; department: string; req_qty: number; match_pct: number; priority: number }

function parseRequirementsCsv(text: string): Req[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
  const idx = (names: string[]) => names.reduce((f, n) => f >= 0 ? f : headers.indexOf(n), -1)
  const si = idx(['store_name', 'storename', 'store'])
  const di = idx(['department', 'dept'])
  const qi = idx(['requirement_qty', 'req_qty', 'requirement', 'qty'])
  const mi = idx(['match', 'match_pct', 'match%'])
  const pi = idx(['store_priority', 'priority', 'storepriority'])
  if (si < 0 || di < 0 || qi < 0) throw new Error('CSV needs: store_name, department, req_qty (and optionally match_pct, priority)')
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = line.split(',')
    return {
      store_name: (cols[si] ?? '').trim().replace(/^"|"$/g, ''),
      department: (cols[di] ?? '').trim().replace(/^"|"$/g, ''),
      req_qty: parseFloat(cols[qi]) || 0,
      match_pct: mi >= 0 ? (parseFloat(cols[mi]) || 50) : 50,
      priority: pi >= 0 ? (parseInt(cols[pi]) || 1) : 1,
    }
  }).filter(r => r.store_name && r.department && r.req_qty > 0)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PrdSwap() {
  const { tokens } = useTheme()
  const card: React.CSSProperties = {
    background: tokens.cardBg ?? '#161b22',
    border: `1px solid ${tokens.border ?? '#30363d'}`,
    borderRadius: 8, padding: '16px 20px', marginBottom: 16,
  }
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }
  const btn = (bg: string, color = '#fff'): React.CSSProperties => ({
    background: bg, color, border: 'none', borderRadius: 6, padding: '7px 16px',
    fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
  })

  // Manual store entry (pre-Step 1)
  const [manualInput, setManualInput] = useState('')
  const [manualOpen, setManualOpen] = useState(false)

  // Stores
  const [stores, setStores] = useState<{ store: string; count: number }[]>([])
  const [selectedStores, setSelectedStores] = useState<string[]>([])
  const [loadingStores, setLoadingStores] = useState(false)
  const [storeErr, setStoreErr] = useState('')
  const [storeSearch, setStoreSearch] = useState('')

  // PRD data
  const [prdRows, setPrdRows] = useState<PrdRow[]>([])
  const [prdMeta, setPrdMeta] = useState<{ total_rows: number; challans: number } | null>(null)
  const [loadingPrd, setLoadingPrd] = useState(false)
  const [prdErr, setPrdErr] = useState('')

  // Requirements
  const [reqs, setReqs] = useState<Req[]>([])
  const [reqErr, setReqErr] = useState('')
  const [loadingMcReq, setLoadingMcReq] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Store priorities — persisted in localStorage
  const [storePriorities, setStorePriorities] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('prd_swap_priorities') ?? '{}') } catch { return {} }
  })
  const [priorityOpen, setPriorityOpen] = useState(false)
  const [prioritySearch, setPrioritySearch] = useState('')
  const [prioritySaved, setPrioritySaved] = useState(false)
  const prioritySavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function savePriorities(pmap: Record<string, number>) {
    setStorePriorities(pmap)
    try { localStorage.setItem('prd_swap_priorities', JSON.stringify(pmap)) } catch {}
    setPrioritySaved(true)
    if (prioritySavedTimer.current) clearTimeout(prioritySavedTimer.current)
    prioritySavedTimer.current = setTimeout(() => setPrioritySaved(false), 2000)
  }

  // Results
  const [results, setResults] = useState<SwapResult[]>([])
  const [unassigned, setUnassigned] = useState<UnassignedItem[]>([])
  const [summary, setSummary] = useState<SwapSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState('')

  // Swap parameters
  const [params, setParams] = useState({
    value_cap: 2000000,
    default_match_pct: 50,
    top_n_depts: 7,
    min_util_pct: 0,
    max_stores: 15,
  })

  // Filter for results table
  const [actionFilter, setActionFilter] = useState<'ALL' | 'KEEP' | 'REDIRECT' | 'UNASSIGNED'>('ALL')

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function fetchStores() {
    setLoadingStores(true); setStoreErr('')
    try {
      const data = await apiGet<{ store: string; count: number }[]>('/prd-swap/stores')
      setStores(data)
      setSelectedStores(data.map(s => s.store)) // select all by default
    } catch (e: any) { setStoreErr(e.message) }
    finally { setLoadingStores(false) }
  }

  function toggleStore(s: string) {
    setSelectedStores(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function fetchPrdData() {
    if (!selectedStores.length) { setPrdErr('Select at least 1 store'); return }
    setLoadingPrd(true); setPrdErr(''); setPrdRows([])
    try {
      const data = await apiPost<{ rows: PrdRow[]; total_rows: number; challans: number }>(
        '/prd-swap/fetch', { stores: selectedStores })
      setPrdRows(data.rows)
      setPrdMeta({ total_rows: data.total_rows, challans: data.challans })
    } catch (e: any) { setPrdErr(e.message) }
    finally { setLoadingPrd(false) }
  }

  function applyAutoPriority(rows: Req[]) {
    // Sum req_qty per store, sort high→low, assign priority 1,2,3...
    const totals: Record<string, number> = {}
    for (const r of rows) totals[r.store_name] = (totals[r.store_name] ?? 0) + r.req_qty
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
    const pmap: Record<string, number> = {}
    sorted.forEach(([s], i) => { pmap[s] = i + 1 })
    return pmap
  }

  const [mcReqSources, setMcReqSources] = useState<string[]>([])

  async function loadMcReq() {
    setLoadingMcReq(true); setReqErr('')
    try {
      const data = await apiGet<{ requirements: Req[]; stores: number; rows: number; sources: string[] }>('/prd-swap/mc-req')
      setReqs(data.requirements)
      setMcReqSources(data.sources ?? [])
      // Auto-priority: only set for stores that have no saved priority yet
      const saved = storePriorities
      const auto = applyAutoPriority(data.requirements)
      const merged = { ...auto, ...Object.fromEntries(Object.entries(saved).filter(([k]) => k in auto)) }
      savePriorities(merged)
      setPriorityOpen(true)
    } catch (e: any) { setReqErr(e.message) }
    finally { setLoadingMcReq(false) }
  }

  function handleReqFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setReqErr('')
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const parsed = parseRequirementsCsv(ev.target?.result as string)
        if (!parsed.length) throw new Error('No valid rows found')
        setReqs(parsed)
        const auto = applyAutoPriority(parsed)
        const merged = { ...auto, ...Object.fromEntries(Object.entries(storePriorities).filter(([k]) => k in auto)) }
        savePriorities(merged)
        setPriorityOpen(true)
      } catch (err: any) { setReqErr(err.message) }
    }
    reader.readAsText(file)
  }

  async function runSwap() {
    if (!prdRows.length) { setRunErr('Fetch PRD data first'); return }
    if (!reqs.length) { setRunErr('Load requirements CSV first'); return }
    setRunning(true); setRunErr(''); setResults([]); setUnassigned([])
    try {
      // Merge user-set priorities into requirements before sending
      const reqsWithPriority = reqs.map(r => ({
        ...r,
        priority: storePriorities[r.store_name] ?? r.priority,
      }))
      const data = await apiPost<{ results: SwapResult[]; unassigned: UnassignedItem[]; summary: SwapSummary }>(
        '/prd-swap/run', { stores: selectedStores, requirements: reqsWithPriority, params })
      setResults(data.results)
      setUnassigned(data.unassigned)
      setSummary(data.summary)
    } catch (e: any) { setRunErr(e.message) }
    finally { setRunning(false) }
  }

  function exportCsv() {
    const esc = (v: any) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = 'CHALLAN_NO,SRC_STORE,CURRENT_DEST,RECOMMENDED_DEST,ACTION,TOTAL_QTY,TOTAL_VALUE,DEPTS_MATCHED,MC_LISTING,UTIL_%,PRIORITY,REASON'
    const assignedRows = results.map(r => [
      esc(r.challan_no), esc(r.from_store), esc(r.current_dest), esc(r.recommended_dest),
      r.action, r.total_qty ?? '', r.total_value ?? '',
      esc(r.depts_matched), esc(r.mc_listing ?? 'Y'), r.util_pct, r.store_priority, esc(r.reason),
    ].join(','))
    const unassignedRows = unassigned.map(u => [
      esc(u.challan_no), esc(u.from_store), esc(u.current_dest), '-',
      'UNASSIGNED', u.total_qty ?? '', u.total_value ?? '',
      esc(u.top7_depts), 'N - Listing blocked / No req match', '', '', esc(u.reason),
    ].join(','))
    const blob = new Blob([header + '\n' + [...assignedRows, ...unassignedRows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `PRD_Swap_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  // ── Filtered results ────────────────────────────────────────────────────────

  const filteredResults = actionFilter === 'ALL'
    ? results
    : actionFilter === 'UNASSIGNED'
    ? []
    : results.filter(r => r.action === actionFilter)

  const showUnassigned = actionFilter === 'ALL' || actionFilter === 'UNASSIGNED'

  // ── Action colors ───────────────────────────────────────────────────────────

  const actionColor = (a: string) =>
    a === 'KEEP' ? '#3fb950' : a === 'REDIRECT' ? '#d29922' : '#f85149'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: tokens.textPrimary }}>
          📦 PRD Swap
        </h1>
        <p style={{ margin: '4px 0 0', color: tokens.textMuted, fontSize: 13 }}>
          Package Ready to Dispatch — match pending challans against store requirements
        </p>
      </div>

      {/* Manual Store Entry (pre-Step 1) */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setManualOpen(o => !o)}
            style={{ ...btn('#30363d', tokens.textMuted as string), fontSize: 12, padding: '4px 12px' }}>
            {manualOpen ? '▲' : '▼'} Manual Store Entry
          </button>
          <span style={{ fontSize: 12, color: tokens.textMuted }}>
            Already decided stores? Type directly — no Oracle refresh needed
          </span>
        </div>
        {manualOpen && (
          <div style={{ marginTop: 10 }}>
            <textarea
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              placeholder={'Enter store aliases, comma or newline separated\ne.g. MIC, GWG, MCN\nor one per line'}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: tokens.inputBg ?? '#21262d',
                border: `1px solid ${tokens.border ?? '#30363d'}`,
                borderRadius: 6, padding: '8px 10px',
                color: tokens.textPrimary, fontSize: 13,
                resize: 'vertical', outline: 'none', fontFamily: 'monospace',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                style={{ ...btn('#238636'), fontSize: 12, padding: '5px 14px' }}
                onClick={() => {
                  const names = manualInput
                    .split(/[\n,]+/)
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean)
                  if (!names.length) return
                  setSelectedStores(prev => {
                    const merged = [...new Set([...prev, ...names])]
                    return merged
                  })
                  setManualInput('')
                  setManualOpen(false)
                }}>
                ✓ Add to Selection
              </button>
              <button
                style={{ ...btn('#30363d', tokens.textMuted as string), fontSize: 12, padding: '5px 14px' }}
                onClick={() => setManualInput('')}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 1: Destination Stores */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: '#58a6ff', fontSize: 15 }}>Step 1 — Select Destination Stores</span>
          <button style={{ ...btn('#58a6ff'), display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={fetchStores} disabled={loadingStores}>
            {loadingStores ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
          {stores.length > 0 && <>
            <button style={btn('#3fb950', '#000')} onClick={() => setSelectedStores(stores.map(s => s.store))}>Select All</button>
            <button style={btn('#f85149')} onClick={() => setSelectedStores([])}>Clear</button>
            <span style={{ color: tokens.textMuted, fontSize: 13, fontWeight: 600 }}>
              {selectedStores.length}/{stores.length} selected
              {selectedStores.length > 0 && (
                <span style={{ color: '#3fb950', marginLeft: 6 }}>
                  ({stores.filter(s => selectedStores.includes(s.store)).reduce((a, s) => a + s.count, 0).toLocaleString()} challans)
                </span>
              )}
            </span>
          </>}
        </div>
        {storeErr && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 8 }}>{storeErr}</div>}
        {stores.length > 0 && (
          <>
            {/* Search */}
            <input
              value={storeSearch}
              onChange={e => setStoreSearch(e.target.value)}
              placeholder="Search stores..."
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 8,
                background: tokens.inputBg ?? '#21262d', border: `1px solid ${tokens.border ?? '#30363d'}`,
                borderRadius: 6, padding: '6px 12px', color: tokens.textPrimary, fontSize: 13,
                outline: 'none',
              }}
            />
            {/* Store chips — sorted high-to-low count (already from backend), filtered by search */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              maxHeight: 220, overflowY: 'auto',
              background: tokens.inputBg ?? '#21262d', borderRadius: 6, padding: 10,
            }}>
              {stores
                .filter(s => !storeSearch || s.store.toLowerCase().includes(storeSearch.toLowerCase()))
                .map(s => {
                  const sel = selectedStores.includes(s.store)
                  return (
                    <div key={s.store} onClick={() => toggleStore(s.store)} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: sel ? '#58a6ff' : (tokens.cardBg ?? '#161b22'),
                      color: sel ? '#000' : tokens.textMuted,
                      border: `1px solid ${sel ? '#58a6ff' : (tokens.border ?? '#30363d')}`,
                      userSelect: 'none',
                    }}>
                      {sel && <span style={{ fontSize: 10 }}>✓</span>}
                      {s.store}
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        background: sel ? 'rgba(0,0,0,0.2)' : (tokens.inputBg ?? '#21262d'),
                        borderRadius: 10, padding: '1px 5px',
                        color: sel ? '#000' : '#58a6ff',
                      }}>{s.count}</span>
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </div>

      {/* Step 2: Fetch PRD Data */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontWeight: 800, color: '#58a6ff', fontSize: 15 }}>Step 2 — Fetch PRD Data</span>
          <button style={btn('#58a6ff')} onClick={fetchPrdData} disabled={loadingPrd || !selectedStores.length}>
            {loadingPrd ? 'Fetching...' : 'Fetch PRD Data (Oracle)'}
          </button>
          {prdMeta && (
            <span style={{ color: '#3fb950', fontSize: 13, fontWeight: 700 }}>
              ✓ {prdMeta.total_rows} rows | {prdMeta.challans} challans
            </span>
          )}
        </div>
        {prdErr && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 8 }}>{prdErr}</div>}
        {prdRows.length > 0 && (
          <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ background: tokens.inputBg ?? '#21262d', position: 'sticky', top: 0 }}>
                  {['CHALLAN_NO','FROM (WH)','DEST','DEPARTMENT','TYPE','QTY','AMOUNT'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#39d2c0', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prdRows.slice(0, 200).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${tokens.border ?? '#30363d'}` }}>
                    <td style={{ padding: '4px 10px', color: tokens.textPrimary }}>{r.CHALLAN_NO}</td>
                    <td style={{ padding: '4px 10px', color: tokens.textMuted }}>{r.OUT_LOCATION}</td>
                    <td style={{ padding: '4px 10px', color: '#d29922' }}>{r.DES_SITEALIAS}</td>
                    <td style={{ padding: '4px 10px', color: tokens.textPrimary }}>{r.DEPARTMENT}</td>
                    <td style={{ padding: '4px 10px', color: tokens.textMuted }}>{r.DISPLAY_TYPE}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', color: '#3fb950' }}>{r.CHALLAN_QTY}</td>
                    <td style={{ padding: '4px 10px', textAlign: 'right', color: tokens.textMuted }}>{r.CHALLAN_AMOUNT}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {prdRows.length > 200 && (
              <div style={{ color: tokens.textMuted, fontSize: 12, padding: '6px 10px' }}>
                Showing first 200 of {prdRows.length} rows
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 3: Requirements */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontWeight: 800, color: '#58a6ff', fontSize: 15 }}>Step 3 — Load Requirements</span>
          <button style={btn('#3fb950', '#000')} onClick={loadMcReq} disabled={loadingMcReq}>
            {loadingMcReq ? 'Loading...' : '📥 Load MC_REQ'}
          </button>
          <button style={btn('#bc8cff')} onClick={() => fileRef.current?.click()}>
            Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleReqFile} />
          {reqs.length > 0 && (
            <span style={{ color: '#3fb950', fontSize: 13, fontWeight: 700 }}>
              ✓ {reqs.length} rows | {new Set(reqs.map(r => r.store_name)).size} stores
              {mcReqSources.length > 0 && (
                <span style={{ color: tokens.textMuted, fontWeight: 400, marginLeft: 6 }}>
                  ({mcReqSources.length} files: {mcReqSources.map(s => s.replace('CK_A2166__', '')).join(' + ')})
                </span>
              )}
            </span>
          )}
        </div>
        <div style={{ color: tokens.textMuted, fontSize: 12 }}>
          Load MC_REQ from downloaded V_MC_REQ_APPS_2, or upload CSV:
          <code style={{ background: tokens.inputBg, padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>
            store_name, department, req_qty, match_pct, priority
          </code>
        </div>
        {reqErr && <div style={{ color: '#f85149', fontSize: 13, marginTop: 6 }}>{reqErr}</div>}

        {/* Priority Editor */}
        {reqs.length > 0 && (() => {
          // Build per-store totals for display
          const totals: Record<string, number> = {}
          for (const r of reqs) totals[r.store_name] = (totals[r.store_name] ?? 0) + r.req_qty
          const storeList = Object.entries(totals).sort(
            (a, b) => (storePriorities[a[0]] ?? 999) - (storePriorities[b[0]] ?? 999)
          )
          return (
            <div style={{ marginTop: 12, borderTop: `1px solid ${tokens.border ?? '#30363d'}`, paddingTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <button
                  onClick={() => setPriorityOpen(o => !o)}
                  style={{ ...btn('#30363d', tokens.textMuted as string), fontSize: 12, padding: '4px 12px' }}>
                  {priorityOpen ? '▲' : '▼'} Store Priority Editor
                  <span style={{ marginLeft: 6, color: '#58a6ff' }}>({storeList.length} stores)</span>
                </button>
                <button
                  onClick={() => savePriorities(applyAutoPriority(reqs))}
                  style={{ ...btn('#21262d', tokens.textMuted as string), fontSize: 12, padding: '4px 10px' }}>
                  ↺ Reset Auto
                </button>
                <span style={{ fontSize: 12, color: tokens.textMuted }}>
                  Priority 1 = highest; lower number → processed first
                </span>
                {prioritySaved && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#3fb950',
                    background: '#1a2e1a', border: '1px solid #3fb950',
                    borderRadius: 4, padding: '2px 8px',
                    transition: 'opacity 0.3s',
                  }}>✓ Saved</span>
                )}
              </div>
              {priorityOpen && (
                <div style={{ background: tokens.inputBg ?? '#21262d', borderRadius: 6, padding: 10 }}>
                  {/* Search box */}
                  <input
                    value={prioritySearch}
                    onChange={e => setPrioritySearch(e.target.value)}
                    placeholder="Search store name..."
                    style={{
                      width: '100%', boxSizing: 'border-box', marginBottom: 8,
                      background: tokens.cardBg ?? '#161b22',
                      border: `1px solid ${tokens.border ?? '#30363d'}`,
                      borderRadius: 6, padding: '6px 10px',
                      color: tokens.textPrimary, fontSize: 13, outline: 'none',
                    }}
                  />
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: 6, maxHeight: 260, overflowY: 'auto',
                  }}>
                  {storeList
                    .filter(([s]) => !prioritySearch || s.toLowerCase().includes(prioritySearch.toLowerCase()))
                    .map(([store, total]) => (
                    <div key={store} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: tokens.cardBg ?? '#161b22', borderRadius: 6,
                      padding: '5px 10px', border: `1px solid ${tokens.border ?? '#30363d'}`,
                    }}>
                      <span style={{
                        minWidth: 24, textAlign: 'center', fontWeight: 800, fontSize: 13,
                        color: '#58a6ff',
                      }}>#{storePriorities[store] ?? '?'}</span>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: tokens.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={store}>{store}</span>
                      <span style={{ fontSize: 11, color: '#3fb950', whiteSpace: 'nowrap' }}>
                        {Math.round(total).toLocaleString()} req
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={storePriorities[store] ?? ''}
                        onChange={e => {
                          const v = parseInt(e.target.value)
                          if (!isNaN(v) && v > 0)
                            savePriorities({ ...storePriorities, [store]: v })
                        }}
                        style={{
                          width: 46, background: tokens.inputBg ?? '#21262d',
                          border: `1px solid ${tokens.border ?? '#30363d'}`,
                          borderRadius: 4, padding: '3px 6px', color: tokens.textPrimary,
                          fontSize: 12, fontWeight: 700, textAlign: 'center', outline: 'none',
                        }}
                      />
                    </div>
                  ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Parameters */}
      <div style={card}>
        <div style={{ fontWeight: 800, color: '#58a6ff', fontSize: 15, marginBottom: 14 }}>⚙ Swap Parameters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {([
            { key: 'value_cap',         title: 'Value Cap per Store (₹)', hint: 'Max value allocated to one store', step: 100000, min: 0 },
            { key: 'default_match_pct', title: 'Default Match %',          hint: 'Fraction of req_qty allowed per dept (if not set in MC_REQ)', step: 5, min: 1, max: 100 },
            { key: 'top_n_depts',       title: 'Top N Departments',        hint: 'How many top depts (by qty) per challan to consider', step: 1, min: 1, max: 20 },
            { key: 'min_util_pct',      title: 'Min Utilization %',        hint: 'Minimum util% to accept a store match', step: 5, min: 0, max: 100 },
            { key: 'max_stores',        title: 'Max Stores to Allocate',   hint: 'Only top-N priority stores considered (by Store Priority Editor)', step: 1, min: 1, max: 231 },
          ] as const).map(({ key, title, hint, step, min, max }) => (
            <div key={key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  value={params[key]}
                  step={step}
                  min={min}
                  max={max}
                  onChange={e => setParams(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                  style={{
                    flex: 1, background: tokens.inputBg ?? '#21262d',
                    border: `1px solid ${tokens.border ?? '#30363d'}`,
                    borderRadius: 6, padding: '6px 10px', color: tokens.textPrimary,
                    fontSize: 13, fontWeight: 700, outline: 'none',
                  }}
                />
                {key === 'value_cap' && (
                  <span style={{ fontSize: 12, color: '#3fb950', whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {(params.value_cap / 100000).toFixed(1)}L
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 3 }}>{hint}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button style={{ ...btn('#30363d', tokens.textMuted), fontSize: 12 }}
            onClick={() => setParams({ value_cap: 2000000, default_match_pct: 50, top_n_depts: 7, min_util_pct: 0, max_stores: 15 })}>
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Step 4: Run */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            style={{ ...btn('#3fb950', '#000'), fontSize: 15, padding: '10px 28px', opacity: running ? .6 : 1 }}
            onClick={runSwap} disabled={running || !prdRows.length || !reqs.length}>
            {running ? '⏳ Running PRD Swap...' : '▶ Run PRD Swap'}
          </button>
          {summary && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { label: 'KEEP', val: summary.keep, color: '#3fb950' },
                { label: 'REDIRECT', val: summary.redirect, color: '#d29922' },
                { label: 'UNASSIGNED', val: summary.unassigned, color: '#f85149' },
                { label: 'TOTAL', val: summary.total_challans, color: '#58a6ff' },
              ].map(({ label: l, val, color }) => (
                <div key={l} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: tokens.textMuted, fontWeight: 700 }}>{l}</div>
                </div>
              ))}
              {summary.listing_filter !== undefined && (
                <div style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 12,
                  background: summary.listing_filter ? 'rgba(63,185,80,0.15)' : 'rgba(248,81,73,0.15)',
                  color: summary.listing_filter ? '#3fb950' : '#f85149',
                  fontWeight: 700, border: `1px solid ${summary.listing_filter ? '#3fb950' : '#f85149'}`,
                }}>
                  {summary.listing_filter
                    ? `✓ MC Listing filter ON (${summary.listing_pairs?.toLocaleString()} Y pairs)`
                    : '⚠ MC Listing file missing — no filter applied'}
                </div>
              )}
            </div>
          )}
          {summary && (
            <button style={{ ...btn('#db6d28'), marginLeft: 'auto' }} onClick={exportCsv}>⬇ Export CSV</button>
          )}
          <button
            style={{ ...btn('#1f6feb') }}
            onClick={async () => {
              try {
                const res = await http.get('/prd-swap/mc-listing-csv', { responseType: 'blob', timeout: 30000 })
                const url = URL.createObjectURL(res.data)
                const a = document.createElement('a')
                a.href = url; a.download = 'MC_LISTING.csv'; a.click()
                URL.revokeObjectURL(url)
              } catch { alert('MC Listing file not found — refresh from Database Explorer first') }
            }}>
            ⬇ MC Listing CSV
          </button>
        </div>
        {runErr && <div style={{ color: '#f85149', fontSize: 13, marginTop: 8 }}>{runErr}</div>}
      </div>

      {/* Results */}
      {(results.length > 0 || unassigned.length > 0) && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 800, color: '#3fb950', fontSize: 15 }}>Results</span>
            {(['ALL', 'KEEP', 'REDIRECT', 'UNASSIGNED'] as const).map(f => (
              <button key={f} onClick={() => setActionFilter(f)} style={{
                ...btn(actionFilter === f ? actionColor(f === 'ALL' ? 'KEEP' : f) : (tokens.inputBg ?? '#21262d')),
                color: actionFilter === f ? (f === 'KEEP' ? '#000' : '#fff') : tokens.textMuted,
                fontSize: 12, padding: '4px 12px',
              }}>{f}</button>
            ))}
          </div>

          <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ background: tokens.inputBg ?? '#21262d', position: 'sticky', top: 0 }}>
                  {['#','CHALLAN_NO','FROM','CURRENT DEST','RECOMMENDED','ACTION','DEPTS MATCHED','UTIL%','REASON'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#39d2c0', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${tokens.border ?? '#30363d'}` }}>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{i + 1}</td>
                    <td style={{ padding: '5px 10px', color: tokens.textPrimary, fontWeight: 600 }}>{r.challan_no}</td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{r.from_store}</td>
                    <td style={{ padding: '5px 10px', color: '#d29922' }}>{r.current_dest}</td>
                    <td style={{ padding: '5px 10px', color: r.action === 'KEEP' ? '#3fb950' : '#58a6ff', fontWeight: 700 }}>{r.recommended_dest}</td>
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{ background: actionColor(r.action), color: r.action === 'KEEP' ? '#000' : '#fff', borderRadius: 12, padding: '2px 10px', fontWeight: 700, fontSize: 11 }}>{r.action}</span>
                    </td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{r.depts_matched}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#3fb950' }}>{r.util_pct}%</td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted, maxWidth: 300 }}>{r.reason}</td>
                  </tr>
                ))}
                {showUnassigned && unassigned.map((u, i) => (
                  <tr key={`u${i}`} style={{ borderBottom: `1px solid ${tokens.border ?? '#30363d'}`, opacity: .7 }}>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>—</td>
                    <td style={{ padding: '5px 10px', color: tokens.textPrimary, fontWeight: 600 }}>{u.challan_no}</td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{u.from_store}</td>
                    <td style={{ padding: '5px 10px', color: '#d29922' }}>{u.current_dest}</td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>—</td>
                    <td style={{ padding: '5px 10px' }}>
                      <span style={{ background: '#f85149', color: '#fff', borderRadius: 12, padding: '2px 10px', fontWeight: 700, fontSize: 11 }}>UNASSIGNED</span>
                    </td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{u.top7_depts}</td>
                    <td style={{ padding: '5px 10px' }}>—</td>
                    <td style={{ padding: '5px 10px', color: tokens.textMuted }}>{u.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
