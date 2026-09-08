import React, { useEffect, useRef, useState } from 'react'

export type NumOp = 'gte' | 'lte' | 'between'
export interface NumFilterVal { op: NumOp; v1: string; v2: string }

interface Props {
  col: string
  value: NumFilterVal | undefined
  onChange: (v: NumFilterVal | null) => void
  onClose: () => void
  anchor: DOMRect
}

export default function NumFilterDropdown({ col, value, onChange, onClose, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [op, setOp] = useState<NumOp>(value?.op ?? 'gte')
  const [v1, setV1] = useState(value?.v1 ?? '')
  const [v2, setV2] = useState(value?.v2 ?? '')

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  function apply() {
    if (!v1.trim()) { onChange(null); onClose(); return }
    onChange({ op, v1: v1.trim(), v2: v2.trim() }); onClose()
  }
  function clear() { onChange(null); onClose() }

  const inp: React.CSSProperties = {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
    color: 'var(--text-primary)', fontSize: 11, padding: '4px 8px', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  }
  const btn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '4px 0', fontSize: 10, border: '1px solid var(--card-border)', borderRadius: 4,
    background: active ? '#0ea5e920' : 'transparent',
    color: active ? '#38bdf8' : '#64748b', cursor: 'pointer',
  })

  const left = Math.min(anchor.left, window.innerWidth - 220)
  const top  = anchor.bottom + 4

  return (
    <div ref={ref} style={{
      position: 'fixed', top, left, zIndex: 9999,
      width: 210, background: 'var(--card-bg)', border: '1px solid var(--card-border)',
      borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.7)', padding: 12,
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
        {col.replace(/_/g, ' ')} filter
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button style={btn(op === 'gte')} onClick={() => setOp('gte')}>≥ Greater</button>
        <button style={btn(op === 'lte')} onClick={() => setOp('lte')}>≤ Less</button>
        <button style={btn(op === 'between')} onClick={() => setOp('between')}>Between</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input style={inp} type="number" placeholder={op === 'between' ? 'Min value' : 'Value'} value={v1} onChange={e => setV1(e.target.value)} autoFocus />
        {op === 'between' && (
          <input style={inp} type="number" placeholder="Max value" value={v2} onChange={e => setV2(e.target.value)} />
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={apply} style={{ flex: 1, padding: '5px 0', fontSize: 11, background: '#0ea5e9', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer' }}>Apply</button>
        <button onClick={clear}  style={{ padding: '5px 10px', fontSize: 11, background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-muted)', cursor: 'pointer' }}>Clear</button>
      </div>
    </div>
  )
}

/** Icon shown in table header for numeric columns */
export function NumFilterIcon({ col, active, onOpen }: {
  col: string; active: boolean; onOpen: (col: string, anchor: DOMRect) => void
}) {
  return (
    <span
      onClick={e => { e.stopPropagation(); onOpen(col, (e.currentTarget as HTMLElement).getBoundingClientRect()) }}
      title="Numeric filter"
      style={{
        marginLeft: 4, fontSize: 9, cursor: 'pointer', verticalAlign: 'middle',
        color: active ? '#4ade80' : '#475569',
        border: `1px solid ${active ? '#4ade80' : '#334155'}`,
        borderRadius: 3, padding: '0 3px', lineHeight: '14px',
        display: 'inline-block',
        background: active ? '#14291480' : '#ffffff08',
      }}
    >=</span>
  )
}

/** Hook: manages numFilters state + open/close dropdown */
export function useNumFilter() {
  const [numFilters, setNumFilters] = useState<Record<string, NumFilterVal>>({})
  const [openCol, setOpenCol]       = useState<string | null>(null)
  const [anchor, setAnchor]         = useState<DOMRect | null>(null)

  function openFilter(col: string, rect: DOMRect) {
    if (openCol === col) { setOpenCol(null); return }
    setAnchor(rect); setOpenCol(col)
  }

  function applyFilter(col: string, val: NumFilterVal | null) {
    setNumFilters(prev => {
      const next = { ...prev }
      if (val) next[col] = val; else delete next[col]
      return next
    })
  }

  function applyToRows<T extends Record<string, unknown>>(rows: T[]): T[] {
    if (!Object.keys(numFilters).length) return rows
    return rows.filter(row => Object.entries(numFilters).every(([col, f]) => {
      const v = Number(row[col])
      if (isNaN(v)) return true
      const v1 = parseFloat(f.v1)
      if (f.op === 'gte') return v >= v1
      if (f.op === 'lte') return v <= v1
      const v2 = parseFloat(f.v2)
      return v >= v1 && v <= v2
    }))
  }

  const activeCount = Object.keys(numFilters).length

  return { numFilters, openCol, anchor, openFilter, applyFilter, applyToRows, activeCount, setOpenCol }
}
