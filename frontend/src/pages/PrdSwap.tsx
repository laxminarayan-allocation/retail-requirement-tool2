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
  util_pct: number
  store_priority: number
  reason: string
}

interface UnassignedItem {
  challan_no: string
  from_store: string
  current_dest: string
  top7_depts: string
  reason: string
}

interface SwapSummary { keep: number; redirect: number; unassigned: number; total_challans: number }

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

  // Stores
  const [stores, setStores] = useState<string[]>([])
  const [selectedStores, setSelectedStores] = useState<string[]>([])
  const [loadingStores, setLoadingStores] = useState(false)
  const [storeErr, setStoreErr] = useState('')

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

  // Results
  const [results, setResults] = useState<SwapResult[]>([])
  const [unassigned, setUnassigned] = useState<UnassignedItem[]>([])
  const [summary, setSummary] = useState<SwapSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState('')

  // Filter for results table
  const [actionFilter, setActionFilter] = useState<'ALL' | 'KEEP' | 'REDIRECT' | 'UNASSIGNED'>('ALL')

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function fetchStores() {
    setLoadingStores(true); setStoreErr('')
    try {
      const data = await apiGet<string[]>('/prd-swap/stores')
      setStores(data)
      setSelectedStores(data) // select all by default
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

  async function loadMcReq() {
    setLoadingMcReq(true); setReqErr('')
    try {
      const data = await apiGet<{ requirements: Req[]; stores: number; rows: number }>('/prd-swap/mc-req')
      setReqs(data.requirements)
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
      } catch (err: any) { setReqErr(err.message) }
    }
    reader.readAsText(file)
  }

  async function runSwap() {
    if (!prdRows.length) { setRunErr('Fetch PRD data first'); return }
    if (!reqs.length) { setRunErr('Load requirements CSV first'); return }
    setRunning(true); setRunErr(''); setResults([]); setUnassigned([])
    try {
      const data = await apiPost<{ results: SwapResult[]; unassigned: UnassignedItem[]; summary: SwapSummary }>(
        '/prd-swap/run', { stores: selectedStores, requirements: reqs })
      setResults(data.results)
      setUnassigned(data.unassigned)
      setSummary(data.summary)
    } catch (e: any) { setRunErr(e.message) }
    finally { setRunning(false) }
  }

  function exportCsv() {
    const all: (SwapResult | (UnassignedItem & { action: string; recommended_dest: string; depts_matched: string; util_pct: string; store_priority: string; reason: string }))[] = [
      ...results,
      ...unassigned.map(u => ({
        ...u, action: 'UNASSIGNED', recommended_dest: '-',
        depts_matched: u.top7_depts, util_pct: '', store_priority: '', reason: u.reason,
      })),
    ]
    const header = 'CHALLAN_NO,FROM_STORE,CURRENT_DEST,RECOMMENDED_DEST,ACTION,DEPTS_MATCHED,UTIL_%,PRIORITY,REASON'
    const rows = all.map(r => [
      r.challan_no, r.from_store, r.current_dest, (r as any).recommended_dest,
      r.action, (r as any).depts_matched, (r as any).util_pct,
      (r as any).store_priority, `"${(r as any).reason}"`,
    ].join(','))
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
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

      {/* Step 1: Destination Stores */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontWeight: 800, color: '#58a6ff', fontSize: 15 }}>Step 1 — Select Destination Stores</span>
          <button style={btn('#58a6ff')} onClick={fetchStores} disabled={loadingStores}>
            {loadingStores ? 'Loading...' : 'Fetch from Oracle'}
          </button>
          {stores.length > 0 && <>
            <button style={btn('#3fb950', '#000')} onClick={() => setSelectedStores([...stores])}>Select All</button>
            <button style={btn('#f85149')} onClick={() => setSelectedStores([])}>Clear</button>
            <span style={{ color: tokens.textMuted, fontSize: 13 }}>{selectedStores.length}/{stores.length} selected</span>
          </>}
        </div>
        {storeErr && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 8 }}>{storeErr}</div>}
        {stores.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            maxHeight: 160, overflowY: 'auto',
            background: tokens.inputBg ?? '#21262d', borderRadius: 6, padding: 10,
          }}>
            {stores.map(s => (
              <div key={s} onClick={() => toggleStore(s)} style={{
                padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: selectedStores.includes(s) ? '#58a6ff' : (tokens.cardBg ?? '#161b22'),
                color: selectedStores.includes(s) ? '#000' : tokens.textMuted,
                border: `1px solid ${selectedStores.includes(s) ? '#58a6ff' : (tokens.border ?? '#30363d')}`,
                userSelect: 'none',
              }}>{s}</div>
            ))}
          </div>
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
            <div style={{ display: 'flex', gap: 16 }}>
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
            </div>
          )}
          {summary && (
            <button style={{ ...btn('#db6d28'), marginLeft: 'auto' }} onClick={exportCsv}>⬇ Export CSV</button>
          )}
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
