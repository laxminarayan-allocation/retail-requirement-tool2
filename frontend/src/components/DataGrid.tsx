import { useState } from 'react'

const PAGE = 100

function isNumCol(records: Record<string, unknown>[], col: string) {
  return records.slice(0, 30).some(r => typeof r[col] === 'number')
    && !records.slice(0, 30).some(r => r[col] != null && typeof r[col] !== 'number')
}

export function DataGrid({
  records,
  columns,
  loading,
  loadingMessage = 'Loading…',
  accent = '#38bdf8',
}: {
  records: Record<string, unknown>[]
  columns: string[]
  loading?: boolean
  loadingMessage?: string
  accent?: string
}) {
  const [colFilter, setColFilter] = useState('')
  const [rowFilter, setRowFilter] = useState('')
  const [page, setPage]           = useState(0)
  const [sortCol, setSortCol]     = useState<string | null>(null)
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')
  const [colWidths, setColWidths] = useState<Record<string, number>>({})

  const visCols  = colFilter ? columns.filter(c => c.toLowerCase().includes(colFilter.toLowerCase())) : columns
  const numCols  = new Set(visCols.filter(c => isNumCol(records, c)))

  const filtered = rowFilter
    ? records.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(rowFilter.toLowerCase())))
    : records

  const sorted = sortCol ? [...filtered].sort((a, b) => {
    const av = a[sortCol]; const bv = b[sortCol]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = numCols.has(sortCol)
      ? Number(av) - Number(bv)
      : String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  }) : filtered

  const totalPages = Math.ceil(sorted.length / PAGE)
  const pageRows   = sorted.slice(page * PAGE, (page + 1) * PAGE)

  function handleSort(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') }
    } else { setSortCol(col); setSortDir('asc') }
    setPage(0)
  }

  function startResize(col: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[col] ?? 120
    function onMove(me: MouseEvent) {
      setColWidths(p => ({ ...p, [col]: Math.max(40, startW + me.clientX - startX) }))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>⏳</div>
      {loadingMessage}
    </div>
  )

  const hasWidths = Object.keys(colWidths).length > 0
  const tableW = hasWidths ? visCols.reduce((s, c) => s + (colWidths[c] ?? 120), 0) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid #1e293b', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={rowFilter} onChange={e => { setRowFilter(e.target.value); setPage(0) }}
          placeholder="🔍 Filter rows…"
          style={{ flex: 1, minWidth: 140, background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, padding: '4px 9px', outline: 'none' }} />
        <input value={colFilter} onChange={e => setColFilter(e.target.value)}
          placeholder="Filter columns…"
          style={{ width: 140, background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', fontSize: 11, padding: '4px 9px', outline: 'none' }} />
        {sortCol && (
          <span style={{ fontSize: 10, color: accent, background: 'var(--content-bg)', border: `1px solid ${accent}44`, borderRadius: 4, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
            {sortCol} {sortDir === 'asc' ? '↑' : '↓'}
            <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => { setSortCol(null); setSortDir('asc') }}>✕</span>
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {sorted.length.toLocaleString()} rows · {visCols.length} cols
          {totalPages > 1 && ` · page ${page + 1}/${totalPages}`}
        </span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              style={{ padding: '3px 9px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer' }}>‹</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              style={{ padding: '3px 9px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-muted)', fontSize: 11, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>›</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {records.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No data.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', tableLayout: hasWidths ? 'fixed' : 'auto', width: tableW ?? '100%', fontSize: 11, whiteSpace: 'nowrap' }}>
            {hasWidths && <colgroup>{visCols.map(c => <col key={c} style={{ width: colWidths[c] ?? 120 }} />)}</colgroup>}
            <thead>
              <tr style={{ background: 'var(--content-bg)', position: 'sticky', top: 0, zIndex: 1 }}>
                {visCols.map(c => {
                  const isSorted = sortCol === c
                  return (
                    <th key={c} onClick={() => handleSort(c)} title={`Sort by ${c}`}
                      style={{ position: 'relative', padding: '5px 10px', fontWeight: 700, letterSpacing: '.04em', textAlign: numCols.has(c) ? 'right' : 'left', borderBottom: `2px solid ${isSorted ? accent : '#1e293b'}`, color: isSorted ? accent : '#64748b', cursor: 'pointer', userSelect: 'none', background: isSorted ? '#0f1f2e' : '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c} <span style={{ fontSize: 9, opacity: isSorted ? 1 : 0.3 }}>{isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                      <span onMouseDown={e => startResize(c, e)} onClick={e => e.stopPropagation()}
                        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', background: 'transparent', borderRight: '2px solid transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.borderRightColor = '#334155')}
                        onMouseLeave={e => (e.currentTarget.style.borderRightColor = 'transparent')} />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b', background: i % 2 === 0 ? 'transparent' : '#ffffff05' }}>
                  {visCols.map(c => {
                    const v = row[c]; const s = v == null ? '' : String(v)
                    return (
                      <td key={c} title={s}
                        style={{ padding: '4px 10px', color: v == null ? '#334155' : numCols.has(c) ? '#7dd3fc' : '#94a3b8', textAlign: numCols.has(c) ? 'right' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: numCols.has(c) ? 'monospace' : 'inherit' }}>
                        {v == null ? <i>NULL</i> : s}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
