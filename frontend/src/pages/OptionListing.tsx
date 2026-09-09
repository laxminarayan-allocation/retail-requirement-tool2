import { useState, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { useTheme } from '@/context/ThemeContext'
import { useOracleRefresh } from '@/context/OracleRefreshContext'

// ─── Types ────────────────────────────────────────────────────────────────────
interface QueryMeta { name: string; description: string; table: string; has_params: boolean }
interface QueryDetail { name: string; description: string; table: string; sql: string; dynamic_params: Record<string,string> }
interface TestResult  { columns: string[]; rows: Record<string,any>[]; count: number }

interface StepEntry { step: string; script: string; ok: boolean; log: string; ts: string }
interface PipelineStatus { status: 'idle'|'running'|'done'|'failed'; run_id?: string; steps?: string[]; entries?: StepEntry[] }

const PIPELINE_STEPS = [
  { id: '00', label: 'Download GRC / REQ / SALE / ART_GRID / MC_REQ / COLOR_FAMILY from Oracle' },
  { id: '02', label: 'Process GRC + PPO → dispatch/hold split' },
  { id: '03', label: 'Process REQ + sale-floor adjustment' },
  { id: '07', label: 'LY Sell-Through analysis (Oracle)' },
  { id: '08', label: 'Listing eligibility (LIST Y/N/CONDITIONAL)' },
  { id: '04', label: 'Colour distribution engine (core allocation)' },
  { id: '05', label: 'Management summary workbook' },
  { id: '06', label: 'Self-audit against all allocation rules' },
]

// ─── Tab components ───────────────────────────────────────────────────────────

function PipelineTab({ tokens }: { tokens: any }) {
  const [dispatchRatio, setDispatchRatio] = useState(0.60)
  const [stepStatus, setStepStatus]       = useState<Record<string,string>>({})
  const [logs, setLogs]                   = useState<{text:string;cls:string;key:number}[]>([])
  const [running, setRunning]             = useState(false)
  const [result, setResult]               = useState<'done'|'failed'|null>(null)
  const [offline, setOffline]             = useState(false)
  const [activeStep, setActiveStep]       = useState<string|null>(null)
  const [elapsedSec, setElapsedSec]       = useState(0)
  const stepStartRef = useRef<Record<string,number>>({})
  type OutputFile = { name: string; size_kb: number; modified: string }
  const [outputFiles, setOutputFiles]     = useState<OutputFile[]>([])

  async function loadOutputFiles() {
    try {
      const r = await fetch('/api/option-listing/output/files', {
        headers: { Authorization: `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` },
      })
      const d = await r.json()
      setOutputFiles(Array.isArray(d) ? d : [])
    } catch {}
  }
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  type DeptRow = { department: string; display_type: string; article_name: string; mrp_sale: string }
  const blankRow = (): DeptRow => ({ department: '', display_type: '', article_name: '', mrp_sale: '' })

  const [newDept, setNewDeptRaw]   = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem('pw_new_dept') ?? 'false') } catch { return false }
  })
  const [deptRows, setDeptRowsRaw] = useState<DeptRow[]>(() => {
    try { const v = JSON.parse(localStorage.getItem('pw_dept_rows') ?? 'null'); return Array.isArray(v) && v.length ? v : [blankRow()] } catch { return [blankRow()] }
  })

  function setNewDept(v: boolean) {
    setNewDeptRaw(v)
    try { localStorage.setItem('pw_new_dept', JSON.stringify(v)) } catch {}
  }
  function setDeptRows(rows: DeptRow[]) {
    setDeptRowsRaw(rows)
    try { localStorage.setItem('pw_dept_rows', JSON.stringify(rows)) } catch {}
  }
  function updateRow(i: number, field: keyof DeptRow, val: string) {
    const next = deptRows.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
    setDeptRows(next)
  }
  function addRow() { setDeptRows([...deptRows, blankRow()]) }
  function removeRow(i: number) { setDeptRows(deptRows.length > 1 ? deptRows.filter((_, idx) => idx !== i) : [blankRow()]) }

  type Candidate = { DEPARTMENT: string; DISPLAY_TYPE: string; ARTICLE_NAME: string; MRP: number }
  const [candidates, setCandidates]     = useState<Candidate[]>([])
  const [candLoading, setCandLoading]   = useState(false)
  const [candError, setCandError]       = useState('')
  const [candSearch, setCandSearch]     = useState('')

  async function loadCandidates() {
    setCandLoading(true); setCandError('')
    try {
      const res = await fetch('/api/option-listing/new-dept-search', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      const arr = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []
      setCandidates(arr)
    } catch (e: any) {
      setCandError(e.message ?? 'Failed to load')
    } finally {
      setCandLoading(false)
    }
  }

  // Auto-load MC candidates when Oracle Refresh completes
  useEffect(() => {
    if (lastCompletedAt) loadCandidates()
  }, [lastCompletedAt])

  const filteredCand = (() => {
    const q = candSearch.trim().toUpperCase()
    if (!q) return candidates.slice(0, 100)
    return candidates.filter(c =>
      c.DEPARTMENT?.toUpperCase().includes(q) ||
      c.DISPLAY_TYPE?.toUpperCase().includes(q) ||
      c.ARTICLE_NAME?.toUpperCase().includes(q) ||
      String(c.MRP).includes(q)
    ).slice(0, 100)
  })()

  function addCandidate(c: Candidate) {
    const newRow: DeptRow = {
      department: c.DEPARTMENT ?? '',
      display_type: c.DISPLAY_TYPE ?? '',
      article_name: c.ARTICLE_NAME ?? '',
      mrp_sale: c.MRP != null ? String(c.MRP) : '',
    }
    const exists = deptRows.some(r =>
      r.department === newRow.department &&
      r.display_type === newRow.display_type &&
      r.article_name === newRow.article_name
    )
    if (exists) return
    // replace blank placeholder if only one empty row
    if (deptRows.length === 1 && !deptRows[0].department.trim()) {
      setDeptRows([newRow])
    } else {
      setDeptRows([...deptRows, newRow])
    }
  }

  const logRef   = useRef<HTMLDivElement>(null)
  const pollRef  = useRef<any>(null)
  const seenLogs = useRef<Record<string,boolean>>({})

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])
  useEffect(() => { loadOutputFiles(); return () => clearInterval(pollRef.current) }, [])

  function addLog(text: string, cls = '') {
    setLogs(p => [...p, { text, cls, key: Date.now() + Math.random() }])
  }

  function reset() {
    setStepStatus({}); setLogs([]); setResult(null); seenLogs.current = {}
  }

  async function runSteps(stepIds: string[], label: string) {
    reset(); setRunning(true); setOffline(false)
    addLog(`▶ ${label} (${stepIds.join(', ')})`, 'sys')
    try {
      const res = await fetch('/api/option-listing/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` },
        body: JSON.stringify({
          steps: stepIds,
          dispatch_ratio: dispatchRatio,
          new_department: newDept,
          dept_rows: newDept ? deptRows.filter(r => r.department.trim()) : [],
          // legacy single-row fields (first row fallback)
          department: newDept && deptRows[0]?.department.trim() || '',
          display_type: newDept && deptRows[0]?.display_type.trim() || '',
          article_name: newDept && deptRows[0]?.article_name.trim() || '',
          mrp_sale: newDept && deptRows[0]?.mrp_sale ? parseFloat(deptRows[0].mrp_sale) : 0,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      addLog(`Started — ${d.steps?.length} step(s)`, 'sys')
    } catch {
      setOffline(true); setRunning(false); return
    }

    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch('/api/option-listing/pipeline/status', {
          headers: { Authorization: `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` },
        })
        const data: PipelineStatus = await res.json()

        const statuses: Record<string,string> = {}
        const completed = new Set<string>()
        for (const e of data.entries ?? []) {
          statuses[e.step] = e.ok ? 'done' : 'failed'
          completed.add(e.step)
          const key = e.step + '_' + e.ts
          if (!seenLogs.current[key]) {
            seenLogs.current[key] = true
            const step = PIPELINE_STEPS.find(s => s.id === e.step)
            addLog(`── Step ${e.step}: ${step?.label?.slice(0,50) ?? ''}`, 'sys')
            ;(e.log || '').split('\n').filter(l => l.trim()).forEach(l => addLog(l, e.ok ? '' : 'err'))
            addLog(e.ok ? '✓ done' : '✗ failed', e.ok ? 'ok' : 'err')
          }
        }
        if (data.status === 'running') {
          const next = PIPELINE_STEPS.find(s => !completed.has(s.id))
          if (next) {
            statuses[next.id] = 'active'
            if (!stepStartRef.current[next.id]) stepStartRef.current[next.id] = Date.now()
            setActiveStep(next.id)
            setElapsedSec(Math.floor((Date.now() - stepStartRef.current[next.id]) / 1000))
          }
        } else {
          setActiveStep(null)
        }
        setStepStatus(statuses)

        if (data.status === 'done') {
          addLog('✓ Pipeline completed successfully.', 'ok')
          setResult('done'); setRunning(false); clearInterval(pollRef.current)
          loadOutputFiles()
        } else if (data.status === 'failed') {
          addLog('✗ Pipeline failed.', 'err')
          setResult('failed'); setRunning(false); clearInterval(pollRef.current)
        }
      } catch {}
    }, 800)
  }

  function stop() {
    clearInterval(pollRef.current); addLog('⏹ Stopped by user.', 'sys'); setRunning(false)
  }

  const runSingle  = (id: string) => runSteps([id], `Step ${id}`)
  const runAll     = () => runSteps(PIPELINE_STEPS.map(s => s.id), 'All 8 steps')
  const runSel     = () => {
    const ids = PIPELINE_STEPS.map(s => s.id).filter(id => selected.has(id))
    if (ids.length) runSteps(ids, `${ids.length} selected step(s)`)
  }

  function toggleStep(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(prev => prev.size === PIPELINE_STEPS.length ? new Set() : new Set(PIPELINE_STEPS.map(s => s.id)))
  }

  const stepIcon = (s: string) => s === 'done' ? '✓' : s === 'failed' ? '✗' : s === 'active' ? '◌' : '○'

  const clr = (cls: string) => ({
    '':    tokens.textSecondary,
    sys:   tokens.accent,
    ok:    '#22c55e',
    err:   '#ef4444',
  }[cls] ?? tokens.textSecondary)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: tokens.textPrimary, marginBottom: 4 }}>
        AW26 Pre-Winter · Allocation Pipeline
      </div>
      <div style={{ color: tokens.textMuted, fontSize: 13, marginBottom: 20 }}>
        8 steps — runs on the server at D:\Prewinter Color Option Listing New Repeat\Codes\
      </div>

      {offline && (
        <div style={{ background: '#3b0f0f', border: '1px solid #ef444433', borderRadius: 8,
          padding: '12px 16px', color: '#ef4444', fontSize: 13, marginBottom: 18 }}>
          ✗ Backend unreachable — make sure the server is running on port 8000.
        </div>
      )}
      {result === 'done' && (
        <div style={{ background: '#0f3320', border: '1px solid #22c55e44', borderRadius: 8,
          padding: '12px 16px', color: '#22c55e', fontWeight: 600, marginBottom: 18 }}>
          ✓ Pipeline completed successfully.
        </div>
      )}

      {/* ── Output Files Download Panel ── */}
      {outputFiles.length > 0 && (
        <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
          borderRadius: 8, padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: tokens.textPrimary }}>
              📂 Output Files — <span style={{ color: tokens.textMuted, fontWeight: 400 }}>
                D:\Prewinter Color Option Listing New Repeat\Codes\OUTPUT\
              </span>
            </span>
            <button onClick={loadOutputFiles} style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 4,
              background: 'transparent', border: `1px solid ${tokens.cardBorder}`,
              color: tokens.textMuted, cursor: 'pointer'
            }}>↺ Refresh</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: tokens.textMuted, borderBottom: `1px solid ${tokens.cardBorder}` }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px' }}>File</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px' }}>Size</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px' }}>Modified</th>
                  <th style={{ padding: '4px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {outputFiles.map(f => (
                  <tr key={f.name} style={{ borderBottom: `1px solid ${tokens.cardBorder}22` }}>
                    <td style={{ padding: '5px 8px', color: tokens.textPrimary }}>{f.name}</td>
                    <td style={{ padding: '5px 8px', color: tokens.textMuted, textAlign: 'right' }}>{f.size_kb} KB</td>
                    <td style={{ padding: '5px 8px', color: tokens.textMuted, textAlign: 'right' }}>
                      {f.modified.replace('T', ' ').slice(0, 16)}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <button onClick={async () => {
                        const res = await fetch(`/api/option-listing/output/download/${encodeURIComponent(f.name)}`, {
                          headers: { Authorization: `Bearer ${localStorage.getItem('ck_ss27_token') ?? ''}` }
                        })
                        if (!res.ok) return alert('Download failed')
                        const blob = await res.blob()
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = f.name; a.click()
                        URL.revokeObjectURL(url)
                      }} style={{ color: '#60a5fa', background: 'transparent', border: '1px solid #60a5fa44',
                        borderRadius: 4, fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>
                        ⬇ Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {result === 'failed' && (
        <div style={{ background: '#3b0f0f', border: '1px solid #ef444444', borderRadius: 8,
          padding: '12px 16px', color: '#ef4444', fontWeight: 600, marginBottom: 18 }}>
          ✗ Pipeline failed — see log below.
        </div>
      )}

      {/* ── New Department Section ── */}
      <div style={{
        background: newDept ? '#0f2010' : tokens.cardBg,
        border: `1px solid ${newDept ? '#22c55e55' : tokens.cardBorder}`,
        borderRadius: 10, padding: '12px 16px', marginBottom: 16,
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="new-dept" checked={newDept} onChange={e => setNewDept(e.target.checked)}
            disabled={running}
            style={{ accentColor: '#22c55e', width: 15, height: 15, cursor: running ? 'not-allowed' : 'pointer' }}
          />
          <label htmlFor="new-dept" style={{ fontSize: 13, fontWeight: 700, color: newDept ? '#22c55e' : tokens.textPrimary, cursor: 'pointer' }}>
            New Department Launch
          </label>
          <span style={{ fontSize: 11, color: tokens.textMuted, flex: 1 }}>
            {newDept ? '⚠ Step 07 runs for all — selected new articles get LY sell-through = 0 inside script' : 'Enable for new launches (no LY sale history)'}
          </span>
          {newDept && (
            <span style={{ fontSize: 10, background: '#22c55e22', color: '#22c55e', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
              {deptRows.filter(r => r.department.trim()).length} dept(s) — saved locally
            </span>
          )}
        </div>

        {newDept && (
          <div style={{ marginTop: 14 }}>

            {/* ── Oracle Search Panel ── */}
            <div style={{ background: '#0a1a0a', border: '1px solid #22c55e33', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  🔍 New MC Search
                </span>
                <span style={{ fontSize: 11, color: tokens.textMuted, flex: 1 }}>
                  AW26 / PREWINTER articles from Oracle (REPORT.V_ITEM_MASTER)
                </span>
                <button onClick={loadCandidates} disabled={candLoading} style={{
                  background: '#22c55e22', border: '1px solid #22c55e55', borderRadius: 5,
                  color: '#22c55e', fontSize: 11, padding: '3px 10px', cursor: candLoading ? 'wait' : 'pointer', fontWeight: 600,
                }}>
                  {candLoading ? '⟳ Loading…' : candidates.length ? `↺ Refresh (${candidates.length})` : '▶ Load from Oracle'}
                  {lastCompletedAt && candidates.length > 0 && !candLoading && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: '#22c55e' }}>✓ auto</span>
                  )}
                </button>
              </div>

              {candError && (
                <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{candError}</div>
              )}

              {candidates.length > 0 && (
                <>
                  <input
                    value={candSearch}
                    onChange={e => setCandSearch(e.target.value)}
                    placeholder="Filter by dept / display type / article name / MRP…"
                    style={{
                      width: '100%', boxSizing: 'border-box' as const,
                      background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
                      borderRadius: 6, color: tokens.textPrimary, fontSize: 12, padding: '5px 10px',
                      outline: 'none', marginBottom: 8,
                    }}
                  />
                  <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 5, border: `1px solid ${tokens.cardBorder}` }}>
                    {/* header */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr 70px',
                      gap: 0, padding: '4px 8px',
                      background: tokens.cardBg, borderBottom: `1px solid ${tokens.cardBorder}`,
                      position: 'sticky', top: 0,
                    }}>
                      {['Department','Display Type','Article Name','MRP'].map(h => (
                        <div key={h} style={{ fontSize: 10, color: tokens.textMuted, fontWeight: 700, textTransform: 'uppercase' }}>{h}</div>
                      ))}
                    </div>
                    {filteredCand.length === 0 ? (
                      <div style={{ fontSize: 12, color: tokens.textMuted, padding: '8px 10px' }}>No matches</div>
                    ) : filteredCand.map((c, i) => {
                      const alreadyAdded = deptRows.some(r =>
                        r.department === c.DEPARTMENT && r.display_type === c.DISPLAY_TYPE && r.article_name === c.ARTICLE_NAME
                      )
                      return (
                        <div key={i}
                          onClick={() => !alreadyAdded && addCandidate(c)}
                          title={alreadyAdded ? 'Already added' : 'Click to add'}
                          style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr 70px',
                            gap: 0, padding: '5px 8px',
                            background: alreadyAdded ? '#22c55e11' : 'transparent',
                            borderBottom: `1px solid ${tokens.cardBorder}`,
                            cursor: alreadyAdded ? 'default' : 'pointer',
                            opacity: alreadyAdded ? 0.5 : 1,
                          }}
                          onMouseEnter={e => { if (!alreadyAdded) (e.currentTarget as HTMLDivElement).style.background = '#22c55e18' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = alreadyAdded ? '#22c55e11' : 'transparent' }}
                        >
                          <div style={{ fontSize: 11, color: tokens.textPrimary }}>{c.DEPARTMENT}</div>
                          <div style={{ fontSize: 11, color: tokens.textSecondary }}>{c.DISPLAY_TYPE}</div>
                          <div style={{ fontSize: 11, color: tokens.textSecondary }}>{c.ARTICLE_NAME}</div>
                          <div style={{ fontSize: 11, color: '#22c55e' }}>₹{c.MRP}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: tokens.textMuted }}>
                      {filteredCand.length} of {candidates.length} shown · Click a row to add it below
                    </span>
                    <button onClick={() => {
                      const csv = ['DEPARTMENT,DISPLAY_TYPE,ARTICLE_NAME,MRP',
                        ...candidates.map(c => `${c.DEPARTMENT},${c.DISPLAY_TYPE},${c.ARTICLE_NAME},${c.MRP ?? ''}`)
                      ].join('\n')
                      const a = document.createElement('a')
                      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
                      a.download = 'new_dept_candidates.csv'
                      a.click()
                    }} style={{
                      background: 'transparent', border: `1px solid ${tokens.cardBorder}`, borderRadius: 5,
                      color: tokens.textSecondary, fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                    }}>⬇ Download CSV</button>
                  </div>
                </>
              )}
            </div>

            {/* ── Selected Departments (manual / added) ── */}
            <div style={{ fontSize: 10, color: tokens.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Selected Departments ({deptRows.filter(r => r.department.trim()).length})
            </div>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 90px 32px', gap: 8, marginBottom: 4, padding: '0 2px' }}>
              {['Department', 'Display Type', 'Article Name', 'MRP Sale ≥', ''].map(h => (
                <div key={h} style={{ fontSize: 10, color: tokens.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            {deptRows.map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 90px 32px', gap: 8, marginBottom: 6 }}>
                {(['department','display_type','article_name','mrp_sale'] as (keyof DeptRow)[]).map(f => (
                  <input key={f} value={row[f]}
                    onChange={e => updateRow(i, f, e.target.value)}
                    placeholder={f === 'department' ? 'MENSWEAR' : f === 'display_type' ? 'HANGER' : f === 'article_name' ? 'SLIM FIT SHIRT' : '999'}
                    disabled={running}
                    style={{
                      background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
                      borderRadius: 6, color: tokens.textPrimary, fontSize: 12, padding: '5px 8px',
                      outline: 'none', width: '100%', boxSizing: 'border-box' as const,
                    }}
                  />
                ))}
                <button onClick={() => removeRow(i)} disabled={running} title="Remove row" style={{
                  background: 'transparent', border: `1px solid ${tokens.cardBorder}`, borderRadius: 6,
                  color: '#ef4444', fontSize: 14, cursor: running ? 'not-allowed' : 'pointer', lineHeight: 1,
                }}>×</button>
              </div>
            ))}

            {/* Add row + note */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <button onClick={addRow} disabled={running} style={{
                background: 'transparent', border: `1px solid ${tokens.cardBorder}`, borderRadius: 6,
                color: '#22c55e', fontSize: 12, padding: '4px 12px', cursor: running ? 'not-allowed' : 'pointer', fontWeight: 600,
              }}>+ Add Manually</button>
              <span style={{ fontSize: 11, color: tokens.textMuted }}>Selection saved in browser — persists after refresh</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={runAll} disabled={running} style={{
          background: running ? tokens.cardBorder : tokens.accent,
          color: running ? tokens.textMuted : '#fff',
          border: 'none', borderRadius: 7, padding: '9px 20px',
          fontSize: 13, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer',
        }}>
          {running ? '◌ Running…' : '▶ Run All Steps'}
        </button>
        <button onClick={runSel} disabled={running || selected.size === 0} style={{
          background: 'transparent',
          color: running || selected.size === 0 ? tokens.textMuted : tokens.accent,
          border: `1px solid ${running || selected.size === 0 ? tokens.cardBorder : tokens.accent}`,
          borderRadius: 7, padding: '9px 16px', fontSize: 13, fontWeight: 600,
          cursor: running || selected.size === 0 ? 'not-allowed' : 'pointer',
        }}>
          ▶ Run Selected {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
        {running && (
          <button onClick={stop} style={{
            background: 'transparent', color: '#ef4444', border: '1px solid #ef4444',
            borderRadius: 7, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>⏹ Stop</button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: tokens.textMuted }}>Dispatch ratio</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: tokens.textPrimary }}>{Math.round(dispatchRatio * 100)}%</span>
          <input type="range" min={10} max={100} step={5}
            value={Math.round(dispatchRatio * 100)}
            onChange={e => setDispatchRatio(Number(e.target.value) / 100)}
            disabled={running}
            style={{ accentColor: tokens.accent, verticalAlign: 'middle' }}
          />
        </div>
      </div>

      {/* Select all row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingLeft: 2 }}>
        <input type="checkbox" id="sel-all"
          checked={selected.size === PIPELINE_STEPS.length}
          onChange={toggleAll}
          style={{ accentColor: tokens.accent, width: 14, height: 14, cursor: 'pointer' }}
        />
        <label htmlFor="sel-all" style={{ fontSize: 11, color: tokens.textMuted, cursor: 'pointer' }}>Select All</label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {PIPELINE_STEPS.map((s, i) => {
          const st = stepStatus[s.id] ?? 'pending'
          const isSel = selected.has(s.id)
          const isSkipped = false // step 07 now runs for all; new dept articles get 0 sell-through inside script
          const borderClr = isSkipped ? '#ffffff11' : st === 'active' ? tokens.accent : st === 'done' ? '#22c55e44' : st === 'failed' ? '#ef444444' : isSel ? tokens.accent + '88' : tokens.cardBorder
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: isSkipped ? 'transparent' : st === 'active' ? tokens.accentBg : isSel ? tokens.accentBg : tokens.cardBg,
              border: `1px solid ${borderClr}`, borderRadius: 8, padding: '8px 14px',
              opacity: isSkipped ? 0.4 : 1,
            }}>
              <input type="checkbox" checked={isSel} onChange={() => toggleStep(s.id)}
                disabled={running}
                style={{ accentColor: tokens.accent, width: 14, height: 14, cursor: running ? 'not-allowed' : 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: 11, color: tokens.textMuted, width: 20, flexShrink: 0 }}>{String(i+1).padStart(2,'0')}</span>
              <span style={{ fontSize: 14, width: 18, flexShrink: 0 }}>{stepIcon(st)}</span>
              <span style={{ flex: 1, fontSize: 12, color: tokens.textSecondary, lineHeight: 1.4 }}>{s.label}</span>
              {isSkipped
                ? <span style={{ fontSize: 10, background: '#ffffff18', color: tokens.textMuted, borderRadius: 4, padding: '2px 7px', flexShrink: 0, marginRight: 6 }}>SKIPPED</span>
                : <span style={{ fontSize: 11, color: st === 'done' ? '#22c55e' : st === 'failed' ? '#ef4444' : st === 'active' ? tokens.accent : tokens.textMuted, flexShrink: 0, marginRight: 6 }}>{st}</span>
              }
              <button onClick={() => runSingle(s.id)} disabled={running} title={`Run step ${s.id} only`} style={{
                background: 'transparent', border: `1px solid ${running ? tokens.cardBorder : tokens.accent}`,
                color: running ? tokens.textMuted : tokens.accent, borderRadius: 5,
                padding: '2px 8px', fontSize: 11, cursor: running ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}>▶</button>
            </div>
          )
        })}
      </div>

      <div ref={logRef} style={{
        background: '#060f18', border: `1px solid ${tokens.cardBorder}`, borderRadius: 8,
        padding: '12px 14px', height: 280, overflowY: 'auto',
        fontFamily: '"Courier New", Consolas, monospace', fontSize: 11.5, lineHeight: 1.65,
      }}>
        {logs.length === 0 && !activeStep && <span style={{ color: tokens.textMuted }}>Press Run All Steps to start…</span>}
        {logs.map(l => <div key={l.key} style={{ color: clr(l.cls) }}>{l.text}</div>)}
        {activeStep && (() => {
          const step = PIPELINE_STEPS.find(s => s.id === activeStep)
          const dots = '.'.repeat((elapsedSec % 3) + 1)
          return (
            <div style={{ color: '#f5c518', marginTop: 4 }}>
              ⏳ Step {activeStep}: {step?.label?.slice(0, 55) ?? ''}{dots} ({elapsedSec}s elapsed)
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function QueriesTab({ tokens }: { tokens: any }) {
  const [queries, setQueries]       = useState<QueryMeta[]>([])
  const [selected, setSelected]     = useState<string|null>(null)
  const [detail, setDetail]         = useState<QueryDetail|null>(null)
  const [editedSql, setEditedSql]   = useState('')
  const [editedParams, setEditedParams] = useState<Record<string,string>>({})
  const [dirty, setDirty]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [savedOk, setSavedOk]       = useState(false)
  const [testing, setTesting]       = useState(false)
  const [testResult, setTestResult] = useState<TestResult|null>(null)
  const [testError, setTestError]   = useState<string|null>(null)

  const token = () => localStorage.getItem('ck_ss27_token') ?? ''
  const auth = { headers: { Authorization: `Bearer ${token()}` } }
  const unwrap = (d: any) => (d && 'data' in d && d.data !== null) ? d.data : d

  useEffect(() => {
    fetch('/api/option-listing/queries', auth).then(r => r.json()).then(d => setQueries(unwrap(d)))
  }, [])

  useEffect(() => {
    if (!selected) return
    setTestResult(null); setTestError(null); setDirty(false)
    fetch(`/api/option-listing/queries/${selected}`, auth)
      .then(r => r.json())
      .then((d) => { const q: QueryDetail = unwrap(d); setDetail(q); setEditedSql(q.sql); setEditedParams({...q.dynamic_params}) })
  }, [selected])

  async function handleSave() {
    if (!detail) return
    setSaving(true)
    try {
      await fetch(`/api/option-listing/queries/${detail.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth.headers },
        body: JSON.stringify({ sql: editedSql, dynamic_params: editedParams, description: detail.description }),
      })
      setSavedOk(true); setDirty(false)
      setTimeout(() => setSavedOk(false), 2000)
    } finally { setSaving(false) }
  }

  async function handleTest() {
    if (!detail) return
    await handleSave()
    setTesting(true); setTestResult(null); setTestError(null)
    try {
      const res  = await fetch(`/api/option-listing/queries/${detail.name}/test`, { method: 'POST', headers: auth.headers })
      const data = await res.json()
      if (!res.ok) setTestError(data.detail ?? data.message ?? 'Error')
      else         setTestResult(unwrap(data))
    } catch (e) { setTestError(String(e)) }
    finally      { setTesting(false) }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Query list */}
      <div style={{
        width: 210, minWidth: 210, background: tokens.pageBg,
        borderRight: `1px solid ${tokens.cardBorder}`, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 14px 8px', borderBottom: `1px solid ${tokens.cardBorder}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: tokens.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Oracle Queries</div>
          <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 2 }}>Step 00 — AW26 Pre-Winter</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {queries.map(q => (
            <button key={q.name} onClick={() => setSelected(q.name)} style={{
              width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
              borderLeft: `2px solid ${selected === q.name ? tokens.accent : 'transparent'}`,
              padding: '8px 14px', cursor: 'pointer',
              background: selected === q.name ? tokens.accentBg : 'transparent',
            } as any}>
              <div style={{ fontSize: 12, fontWeight: 600, color: selected === q.name ? tokens.textPrimary : tokens.textSecondary }}>{q.name}</div>
              <div style={{ fontSize: 10, color: tokens.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.table}</div>
              {q.has_params && (
                <span style={{ fontSize: 9, background: '#3b2810', color: '#d97706', borderRadius: 3, padding: '1px 5px', display: 'inline-block', marginTop: 2 }}>dynamic params</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Editor pane */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.textMuted, fontSize: 13 }}>
            ← Select a query to edit
          </div>
        ) : !detail ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.accent, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '8px 14px', background: tokens.pageBg, borderBottom: `1px solid ${tokens.cardBorder}`, flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: tokens.textPrimary }}>{detail.name}</span>
              <span style={{ fontSize: 11, color: tokens.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.description}</span>
              {dirty && <span style={{ fontSize: 11, background: '#3b2810', color: '#d97706', borderRadius: 4, padding: '2px 7px' }}>unsaved</span>}
              {savedOk && <span style={{ fontSize: 11, color: '#22c55e' }}>✓ Saved</span>}
              <button onClick={handleSave} disabled={saving || !dirty} style={{
                background: dirty ? tokens.accent : tokens.cardBg, color: dirty ? '#fff' : tokens.textMuted,
                border: `1px solid ${tokens.cardBorder}`, borderRadius: 6, padding: '5px 12px',
                fontSize: 12, fontWeight: 600, cursor: dirty ? 'pointer' : 'not-allowed',
              }}>
                {saving ? '…' : '💾'} Save
              </button>
              <button onClick={handleTest} disabled={testing} style={{
                background: '#14532d', color: '#4ade80',
                border: 'none', borderRadius: 6, padding: '5px 12px',
                fontSize: 12, fontWeight: 600, cursor: testing ? 'not-allowed' : 'pointer', opacity: testing ? 0.6 : 1,
              }}>
                {testing ? '◌ Running…' : '▶ Test Run (50 rows)'}
              </button>
            </div>

            {/* Dynamic params */}
            {Object.keys(editedParams).length > 0 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
                padding: '8px 14px', background: tokens.cardBg, borderBottom: `1px solid ${tokens.cardBorder}`, flexShrink: 0,
              }}>
                <span style={{ fontSize: 11, color: tokens.textMuted }}>Dynamic params:</span>
                {Object.entries(editedParams).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, background: '#3b2810', color: '#d97706', borderRadius: 3, padding: '2px 6px' }}>{`{${k}}`}</span>
                    <input value={v}
                      onChange={e => { setEditedParams(p => ({...p,[k]:e.target.value})); setDirty(true) }}
                      style={{
                        background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 5,
                        color: tokens.textPrimary, fontSize: 11, padding: '4px 8px', width: 260, outline: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Monaco editor */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={editedSql}
                onChange={v => { setEditedSql(v ?? ''); setDirty(true) }}
                options={{ fontSize: 12, lineHeight: 19, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, padding: { top: 12, bottom: 12 }, tabSize: 4 }}
              />
            </div>

            {/* Test result */}
            {(testResult || testError) && (
              <div style={{ height: 220, display: 'flex', flexDirection: 'column', borderTop: `1px solid ${tokens.cardBorder}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: tokens.pageBg, borderBottom: `1px solid ${tokens.cardBorder}`, flexShrink: 0, fontSize: 12 }}>
                  {testError
                    ? <span style={{ color: '#ef4444' }}>✗ Error</span>
                    : <span style={{ color: '#22c55e' }}>✓ {testResult!.count} rows returned</span>
                  }
                </div>
                {testError && <pre style={{ flex: 1, overflow: 'auto', padding: '10px 14px', fontSize: 11, color: '#ef4444', whiteSpace: 'pre-wrap', fontFamily: '"Courier New", monospace', margin: 0 }}>{testError}</pre>}
                {testResult && (
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <table style={{ fontSize: 11, color: tokens.textSecondary, width: 'max-content', minWidth: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ background: tokens.pageBg, position: 'sticky', top: 0 } as any}>
                        <tr>{testResult.columns.map(c => <th key={c} style={{ padding: '5px 10px', textAlign: 'left', color: tokens.textMuted, borderRight: `1px solid ${tokens.cardBorder}`, whiteSpace: 'nowrap', fontWeight: 500 }}>{c}</th>)}</tr>
                      </thead>
                      <tbody>
                        {testResult.rows.map((row, i) => (
                          <tr key={i}>
                            {testResult.columns.map(c => (
                              <td key={c} title={row[c] === null ? 'NULL' : String(row[c])} style={{ padding: '4px 10px', borderRight: `1px solid ${tokens.cardBg}`, borderBottom: `1px solid ${tokens.cardBg}`, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row[c] === null ? <span style={{ color: tokens.textMuted, fontStyle: 'italic' }}>NULL</span> : String(row[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OptionListing() {
  const { tokens } = useTheme()
  const { lastCompletedAt } = useOracleRefresh()
  const [tab, setTab] = useState<'pipeline'|'queries'>('pipeline')

  const tabBtn = (id: 'pipeline'|'queries', label: string) => (
    <button key={id} onClick={() => setTab(id)} style={{
      background: tab === id ? tokens.accentBg : 'transparent',
      color: tab === id ? tokens.accent : tokens.textMuted,
      border: 'none', borderBottom: `2px solid ${tab === id ? tokens.accent : 'transparent'}`,
      padding: '10px 20px', fontSize: 13, fontWeight: tab === id ? 700 : 400,
      cursor: 'pointer', transition: 'all 0.15s',
    }}>{label}</button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Page header */}
      <div style={{ padding: '16px 28px 0', borderBottom: `1px solid ${tokens.cardBorder}`, flexShrink: 0, background: tokens.pageBg }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: tokens.textPrimary, marginBottom: 2 }}>Option Listing</div>
        <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 10 }}>AW26 Pre-Winter Allocation — Pipeline Runner &amp; Oracle Query Editor</div>
        <div style={{ display: 'flex', gap: 0 }}>
          {tabBtn('pipeline', '▶ Pipeline')}
          {tabBtn('queries',  '⬡ Oracle Queries')}
        </div>
      </div>

      {/* Tab content — both always mounted so pipeline keeps running when tab switches */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: tab === 'pipeline' ? 'block' : 'none' }}>
          <PipelineTab tokens={tokens} />
        </div>
        <div style={{ display: tab === 'queries' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
          <QueriesTab tokens={tokens} />
        </div>
      </div>
    </div>
  )
}
