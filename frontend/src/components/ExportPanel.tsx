/**
 * ExportPanel — Phase 11
 *
 * Sheet-selection drawer for the enhanced Excel export.
 * Pass runId + runLabel; renders a button that opens an inline panel.
 */
import { useState } from 'react'

interface Sheet {
  key: string
  label: string
  description: string
  defaultOn: boolean
}

const SHEETS: Sheet[] = [
  { key: 'cover',         label: 'Cover',          description: 'Run metadata, parameters, factor config snapshot', defaultOn: true },
  { key: 'summary',       label: 'Summary KPIs',   description: 'Fill rate, REQ qty, stores, capped rows', defaultOn: true },
  { key: 'results',       label: 'Results Grid',   description: 'Full allocation rows with formatting (up to 200k)', defaultOn: true },
  { key: 'breakdown',     label: 'Breakdown',      description: 'REQ aggregated by Division, Department, Store Grade', defaultOn: true },
  { key: 'exceptions',    label: 'Exceptions',     description: 'Validation flags with sample rows', defaultOn: true },
  { key: 'factor_config', label: 'Factor Config',  description: 'Grade multipliers and division exclusions', defaultOn: true },
]

const S: Record<string, React.CSSProperties> = {
  btn: { background: '#0ea5e9', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 14px', cursor: 'pointer' },
  btnSm: { background: 'transparent', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 11, padding: '3px 10px', cursor: 'pointer' },
  panel: { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '14px 16px', marginTop: 6, minWidth: 320 },
  row: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, cursor: 'pointer' },
  label: { fontSize: 12, fontWeight: 600, color: '#e2e8f0' },
  desc: { fontSize: 10, color: '#64748b', marginTop: 1 },
  footer: { display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #334155', alignItems: 'center' },
}

interface Props {
  runId: string
  runLabel?: string
  inline?: boolean   // true = always shown expanded, false = toggle button
}

export default function ExportPanel({ runId, runLabel, inline = false }: Props) {
  const [open, setOpen] = useState(inline)
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(SHEETS.map(s => [s.key, s.defaultOn]))
  )
  const [downloading, setDownloading] = useState(false)

  function toggle(key: string) {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function selectAll(on: boolean) {
    setSelected(Object.fromEntries(SHEETS.map(s => [s.key, on])))
  }

  async function download() {
    const params = new URLSearchParams()
    SHEETS.forEach(s => params.set(s.key, selected[s.key] ? 'true' : 'false'))
    setDownloading(true)
    try {
      window.open(`/api/calculation/runs/${runId}/export?${params}`, '_blank')
    } finally {
      // Small delay to feel responsive
      setTimeout(() => setDownloading(false), 1200)
    }
  }

  if (!inline && !open) {
    return (
      <button style={S.btn} onClick={() => setOpen(true)}>
        Export Excel ↓
      </button>
    )
  }

  return (
    <div>
      {!inline && (
        <button style={S.btnSm} onClick={() => setOpen(false)}>✕</button>
      )}
      <div style={S.panel}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 }}>
          Excel Export — Select Sheets
        </div>

        {runLabel && (
          <div style={{ fontSize: 11, color: '#475569', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Run: {runLabel}
          </div>
        )}

        {SHEETS.map(sheet => (
          <label key={sheet.key} style={S.row} onClick={() => toggle(sheet.key)}>
            <input
              type="checkbox"
              checked={selected[sheet.key]}
              onChange={() => toggle(sheet.key)}
              style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
            />
            <div>
              <div style={S.label}>{sheet.label}</div>
              <div style={S.desc}>{sheet.description}</div>
            </div>
          </label>
        ))}

        <div style={S.footer}>
          <button style={S.btn} onClick={download} disabled={downloading || !Object.values(selected).some(Boolean)}>
            {downloading ? 'Preparing…' : '↓ Download'}
          </button>
          <button style={S.btnSm} onClick={() => selectAll(true)}>All</button>
          <button style={S.btnSm} onClick={() => selectAll(false)}>None</button>
          {!inline && (
            <button style={{ ...S.btnSm, marginLeft: 'auto' }} onClick={() => setOpen(false)}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
