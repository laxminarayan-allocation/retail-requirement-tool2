import React, { useState, useMemo, useRef, useEffect } from 'react'

export interface FTColumn {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  color?: string
  bold?: boolean
  noFilter?: boolean  // skip filter for this column
  noSort?: boolean
  render?: (val: unknown, row: Record<string, unknown>) => React.ReactNode
}

interface Props {
  columns: FTColumn[]
  rows: Record<string, unknown>[]
  maxHeight?: number
  globalSearch?: boolean  // show global search bar
  stickyHeader?: boolean
  footerRow?: Record<string, unknown> | null
  fontSize?: number
  rowStyle?: (row: Record<string, unknown>, i: number) => React.CSSProperties
}

// ── theme tokens ────────────────────────────────────────────────────────────
const T = {
  bg:        'var(--content-bg)',
  bgAlt:     '#ffffff04',
  bgDrop:    'var(--card-bg)',
  bgDropHov: 'var(--table-row-hover)',
  border:    'var(--card-border)',
  borderMid: 'var(--card-border)',
  text:      'var(--text-primary)',
  muted:     'var(--text-muted)',
  dim:       'var(--text-muted)',
  accent:    'var(--accent)',
  active:    'var(--accent)',
}

type SortDir = 'asc' | 'desc' | null

function sortRows(
  rows: Record<string, unknown>[],
  col: string | null,
  dir: SortDir,
): Record<string, unknown>[] {
  if (!col || !dir) return rows
  return [...rows].sort((a, b) => {
    const av = a[col]; const bv = b[col]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number')
      return dir === 'asc' ? av - bv : bv - av
    const as = String(av).toLowerCase(); const bs = String(bv).toLowerCase()
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
  })
}

// ── FilterDropdown ───────────────────────────────────────────────────────────
function FilterDropdown({
  colKey,
  values,
  selected,
  onChange,
  onClose,
  anchor,
}: {
  colKey: string
  values: string[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
  onClose: () => void
  anchor: DOMRect
}) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = values.filter(v => v.toLowerCase().includes(search.toLowerCase()))

  function toggle(v: string) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }
  function toggleAll() {
    onChange(selected.size === values.length ? new Set<string>() : new Set(values))
  }

  const top = anchor.bottom + window.scrollY + 4
  const left = Math.min(anchor.left + window.scrollX, window.innerWidth - 240)

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchor.bottom + 4,
        left: Math.min(anchor.left, window.innerWidth - 240),
        zIndex: 9999,
        width: 220,
        background: T.bgDrop,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        boxShadow: '0 12px 32px rgba(0,0,0,.7)',
        overflow: 'hidden',
      }}
    >
      {/* search */}
      <div style={{ padding: '8px 8px 6px' }}>
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search values…"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--content-bg)', border: `1px solid ${T.border}`,
            borderRadius: 5, color: T.text, fontSize: 11,
            padding: '4px 8px', outline: 'none',
          }}
        />
      </div>
      {/* select all */}
      <div
        onClick={toggleAll}
        style={{ padding: '5px 10px', fontSize: 10, color: T.muted, cursor: 'pointer',
          borderBottom: `1px solid ${T.borderMid}`,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = T.bgDropHov)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ color: selected.size === values.length ? T.accent : T.dim, fontSize: 12 }}>
          {selected.size === values.length ? '☑' : '☐'}
        </span>
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {selected.size === 0 ? 'All' : `${selected.size} selected`}
        </span>
        {selected.size > 0 && (
          <span
            onClick={e => { e.stopPropagation(); onChange(new Set()) }}
            style={{ marginLeft: 'auto', color: T.muted, fontSize: 10, cursor: 'pointer' }}
          >clear</span>
        )}
      </div>
      {/* list */}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '8px 10px', fontSize: 11, color: T.muted }}>No matches</div>
        ) : filtered.map(v => (
          <div
            key={v}
            onClick={() => toggle(v)}
            style={{
              padding: '5px 10px', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 7,
              background: selected.has(v) ? '#0f1f2e' : 'transparent',
              color: selected.has(v) ? T.accent : T.text,
            }}
            onMouseEnter={e => { if (!selected.has(v)) e.currentTarget.style.background = T.bgDropHov }}
            onMouseLeave={e => { if (!selected.has(v)) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ color: selected.has(v) ? T.accent : T.dim, fontSize: 12, flexShrink: 0 }}>
              {selected.has(v) ? '☑' : '☐'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v || '(blank)'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function FilterableTable({
  columns,
  rows,
  maxHeight = 420,
  globalSearch = true,
  stickyHeader = true,
  footerRow = null,
  fontSize = 12,
  rowStyle,
}: Props) {
  const [sortCol, setSortCol]   = useState<string | null>(null)
  const [sortDir, setSortDir]   = useState<SortDir>(null)
  const [globalQ, setGlobalQ]   = useState('')
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({})
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null)

  function handleSort(key: string) {
    if (sortCol === key) {
      setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
      if (sortDir === 'desc') setSortCol(null)
    } else {
      setSortCol(key); setSortDir('asc')
    }
  }

  function openColFilter(key: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (openFilter === key) { setOpenFilter(null); return }
    setFilterAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())
    setOpenFilter(key)
  }

  // unique values per column (from original rows)
  const uniqueVals = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const col of columns) {
      if (col.noFilter) continue
      const set = new Set<string>()
      for (const row of rows) {
        const v = row[col.key]
        set.add(v == null ? '' : String(v))
      }
      map[col.key] = [...set].sort((a, b) => {
        const an = Number(a); const bn = Number(b)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        return a.localeCompare(b)
      })
    }
    return map
  }, [columns, rows])

  const displayed = useMemo(() => {
    let r = rows
    // global search
    if (globalQ.trim()) {
      const q = globalQ.toLowerCase()
      r = r.filter(row => columns.some(c => {
        const v = row[c.key]; return v != null && String(v).toLowerCase().includes(q)
      }))
    }
    // column filters
    for (const [key, sel] of Object.entries(colFilters)) {
      if (!sel.size) continue
      r = r.filter(row => {
        const v = row[key]; return sel.has(v == null ? '' : String(v))
      })
    }
    // sort
    r = sortRows(r, sortCol, sortDir)
    return r
  }, [rows, globalQ, colFilters, sortCol, sortDir, columns])

  const activeFilters = Object.values(colFilters).filter(s => s.size > 0).length

  const PAGE_SIZE = 500
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE))
  const visibleRows = useMemo(() => displayed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [displayed, page])

  // Reset to page 0 when filters/sort change
  const prevDisplayedLen = useRef(displayed.length)
  if (prevDisplayedLen.current !== displayed.length) { prevDisplayedLen.current = displayed.length; if (page !== 0) setPage(0) }

  function clearAll() {
    setGlobalQ(''); setColFilters({}); setSortCol(null); setSortDir(null); setPage(0)
  }

  const sortIcon = (key: string) => {
    if (sortCol !== key) return <span style={{ opacity: 0.2, fontSize: 9, marginLeft: 3 }}>⇅</span>
    return <span style={{ color: T.accent, fontSize: 9, marginLeft: 3 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const filterIcon = (key: string) => {
    const active = (colFilters[key]?.size ?? 0) > 0
    return (
      <span
        onClick={e => openColFilter(key, e)}
        title="Filter"
        style={{
          marginLeft: 4, cursor: 'pointer', fontSize: 9,
          color: active ? T.accent : T.muted,
          background: active ? '#0f1f2e' : '#ffffff08',
          border: active ? `1px solid ${T.accent}` : `1px solid ${T.borderMid}`,
          borderRadius: 3, padding: '0 3px', lineHeight: '14px',
          display: 'inline-block', verticalAlign: 'middle',
        }}
      >▾</span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* toolbar */}
      {globalSearch && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', background: '#0d1525',
          borderBottom: `1px solid ${T.borderMid}`,
        }}>
          <input
            value={globalQ}
            onChange={e => setGlobalQ(e.target.value)}
            placeholder="Search all columns…"
            style={{
              flex: 1, background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 6, color: T.text, fontSize: 11,
              padding: '5px 10px', outline: 'none',
            }}
          />
          <span style={{ fontSize: 10, color: T.muted, whiteSpace: 'nowrap' }}>
            {displayed.length.toLocaleString()} / {rows.length.toLocaleString()} rows
            {activeFilters > 0 && <span style={{ color: T.accent }}> · {activeFilters} filter{activeFilters > 1 ? 's' : ''}</span>}
          </span>
          {(globalQ || activeFilters > 0 || sortCol) && (
            <button
              onClick={clearAll}
              style={{
                background: 'transparent', border: `1px solid ${T.border}`,
                borderRadius: 4, color: T.muted, fontSize: 10,
                padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >✕ Clear</button>
          )}
        </div>
      )}

      {/* table */}
      <div style={{ overflowX: 'auto', maxHeight, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize, whiteSpace: 'nowrap', width: '100%' }}>
          <thead style={stickyHeader ? { position: 'sticky', top: 0, zIndex: 2 } : {}}>
            <tr style={{ background: T.bg }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => !col.noSort && handleSort(col.key)}
                  style={{
                    padding: '7px 10px',
                    fontWeight: 700,
                    fontSize: fontSize - 1,
                    color: T.muted,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    borderBottom: `1px solid ${T.border}`,
                    textAlign: col.align ?? 'left',
                    cursor: col.noSort ? 'default' : 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                  {!col.noSort && sortIcon(col.key)}
                  {!col.noFilter && filterIcon(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: '24px', textAlign: 'center', color: T.muted, fontSize: 12 }}>
                  No matching rows
                </td>
              </tr>
            ) : visibleRows.map((row, i) => (
              <tr
                key={i}
                style={{
                  background: i % 2 === 0 ? 'transparent' : T.bgAlt,
                  borderBottom: `1px solid ${T.borderMid}`,
                  ...(rowStyle ? rowStyle(row, i) : {}),
                }}
              >
                {columns.map(col => {
                  const val = row[col.key]
                  return (
                    <td
                      key={col.key}
                      style={{
                        padding: '5px 10px',
                        textAlign: col.align ?? 'left',
                        color: col.color ?? T.text,
                        fontWeight: col.bold ? 700 : 400,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {col.render
                        ? col.render(val, row)
                        : val == null || val === ''
                          ? <span style={{ color: T.dim }}>—</span>
                          : String(val)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {footerRow && (
            <tfoot style={{ position: 'sticky', bottom: 0 }}>
              <tr style={{ background: '#0f1f2e', borderTop: `2px solid ${T.border}` }}>
                {columns.map((col, ci) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '7px 10px',
                      textAlign: col.align ?? 'left',
                      color: col.color ?? T.text,
                      fontWeight: 800,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {ci === 0 ? 'TOTAL' : (() => {
                      const v = footerRow[col.key]
                      return v == null ? '—' : typeof v === 'number' ? v.toLocaleString() : String(v)
                    })()}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: `1px solid ${T.borderMid}`, background: '#0d1525' }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            style={{ padding: '2px 9px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4, color: T.muted, fontSize: 10, cursor: page === 0 ? 'not-allowed' : 'pointer' }}>‹</button>
          <span style={{ fontSize: 10, color: T.muted }}>Page {page + 1} / {totalPages} · rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, displayed.length)} of {displayed.length.toLocaleString()}</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
            style={{ padding: '2px 9px', background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4, color: T.muted, fontSize: 10, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>›</button>
        </div>
      )}

      {/* filter dropdown portal */}
      {openFilter && filterAnchor && (
        <FilterDropdown
          colKey={openFilter}
          values={uniqueVals[openFilter] ?? []}
          selected={colFilters[openFilter] ?? new Set()}
          onChange={sel => setColFilters(prev => ({ ...prev, [openFilter]: sel }))}
          onClose={() => setOpenFilter(null)}
          anchor={filterAnchor}
        />
      )}
    </div>
  )
}
