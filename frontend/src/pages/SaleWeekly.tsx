import { useEffect, useState, useMemo } from 'react'
import http from '@/api/http'

interface WeekMeta  { key: string; start: string }
interface MonthMeta { key: string; label: string; weeks: WeekMeta[] }

interface SaleRow {
  store_name: string
  total_val:  number
  total_qty:  number
  month_val:  Record<string, number>
  month_qty:  Record<string, number>
  week_val:   Record<string, number>
  week_qty:   Record<string, number>
}

interface Summary {
  rows:   SaleRow[]
  count:  number
  months: MonthMeta[]
}

const fmtV = (n: number) =>
  n >= 1_00_00_000 ? `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  : n >= 1_00_000   ? `₹${(n / 1_00_000).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`

const fmtQ = (n: number) =>
  n >= 100_000 ? `${(n / 100_000).toFixed(1)}L`
  : n >= 1000  ? `${(n / 1000).toFixed(1)}K`
  : String(Math.round(n))

// "2026-W09" → "W09"
const wkLabel = (k: string) => k.split('-')[1] ?? k

type SortKey = 'store_name' | 'total_val' | 'total_qty' | string

export default function SaleWeekly() {
  const [data,     setData]     = useState<Summary | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [search,   setSearch]   = useState('')
  const [sort,     setSort]     = useState<SortKey>('total_val')
  const [asc,      setAsc]      = useState(false)
  const [mode,     setMode]     = useState<'val' | 'qty'>('val')
  // collapsed months: Set of month keys that are collapsed (default all collapsed)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    http.get('/sale/weekly-summary')
      .then(r => {
        const d = r.data
        if (d.success) {
          setData(d.data)
          // Default: collapse all months
          if (d.data?.months) {
            setCollapsed(new Set(d.data.months.map((m: MonthMeta) => m.key)))
          }
        } else setError(d.message || 'Load failed')
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const toggleMonth = (mk: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(mk)) next.delete(mk); else next.add(mk)
      return next
    })
  }

  const val = (r: SaleRow, key: string, type: 'week' | 'month') =>
    mode === 'val'
      ? (type === 'week' ? r.week_val[key] ?? 0 : r.month_val[key] ?? 0)
      : (type === 'week' ? r.week_qty[key] ?? 0 : r.month_qty[key] ?? 0)

  const fmt = (n: number) => mode === 'val' ? fmtV(n) : fmtQ(n)

  const rows = useMemo(() => {
    if (!data) return []
    let r = data.rows
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(s => s.store_name.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      let av: number | string, bv: number | string
      if (sort === 'store_name')  { av = a.store_name; bv = b.store_name }
      else if (sort === 'total_val') { av = mode === 'val' ? a.total_val : a.total_qty; bv = mode === 'val' ? b.total_val : b.total_qty }
      else { av = val(a, sort, 'month'); bv = val(b, sort, 'month') }
      if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [data, search, sort, asc, mode])

  const months = data?.months ?? []

  const toggleSort = (k: SortKey) => { if (sort === k) setAsc(a => !a); else { setSort(k); setAsc(false) } }
  const arrow = (k: SortKey) => sort === k ? (asc ? ' ↑' : ' ↓') : ''

  const thBase: React.CSSProperties = {
    padding: '6px 5px', fontSize: 10, fontWeight: 700,
    color: 'var(--text-muted)', letterSpacing: 0.4, textTransform: 'uppercase',
    borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'right',
  }
  const td: React.CSSProperties = {
    padding: '4px 5px', fontSize: 11, borderBottom: '1px solid var(--card-border)',
    fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap',
  }
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-muted)', fontSize: 14 }}>
      Loading 2-year weekly data...
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12, padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: 36 }}>⚠️</div>
      <div style={{ fontWeight: 700 }}>Could not load data</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440 }}>{error}</div>
    </div>
  )

  const totVal = rows.reduce((s, r) => s + (mode === 'val' ? r.total_val : r.total_qty), 0)

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>2-Year Weekly Sale</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {data?.count} stores · {months.length} months · TY + LY
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* ₹ / Qty toggle */}
          <div style={{ display: 'flex', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
            {(['val', 'qty'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '4px 14px', fontSize: 11, cursor: 'pointer', border: 'none',
                  background: mode === m ? '#818cf8' : 'transparent',
                  color: mode === m ? '#fff' : 'var(--text-muted)',
                  fontWeight: mode === m ? 700 : 400,
                }}
              >{m === 'val' ? '₹ Value' : 'Qty'}</button>
            ))}
          </div>
          <input
            placeholder="Search store..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: 6, padding: '5px 10px', fontSize: 12,
              color: 'var(--text-primary)', outline: 'none', width: 170,
            }}
          />
        </div>
      </div>

      {/* Month collapse bar */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Months:</span>
        {months.map(m => (
          <button
            key={m.key}
            onClick={() => toggleMonth(m.key)}
            style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
              background: collapsed.has(m.key) ? 'var(--card-bg)' : '#1e293b',
              border: `1px solid ${collapsed.has(m.key) ? 'var(--card-border)' : '#818cf8'}`,
              color: collapsed.has(m.key) ? 'var(--text-muted)' : '#818cf8',
              fontWeight: collapsed.has(m.key) ? 400 : 700,
            }}
          >{m.label} {collapsed.has(m.key) ? '▶' : '▼'}</button>
        ))}
        <button onClick={() => setCollapsed(new Set(months.map(m => m.key)))}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
          Collapse All
        </button>
        <button onClick={() => setCollapsed(new Set())}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}>
          Expand All
        </button>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...thBase, textAlign: 'left', width: 24 }}>#</th>
                <th style={{ ...thBase, textAlign: 'left', minWidth: 80 }} onClick={() => toggleSort('store_name')}>
                  Store{arrow('store_name')}
                </th>

                {months.map(m => {
                  const isCollapsed = collapsed.has(m.key)
                  const mColor = '#818cf8'
                  if (isCollapsed) {
                    return (
                      <th key={m.key} onClick={() => toggleMonth(m.key)}
                        style={{ ...thBase, color: mColor, minWidth: 76, borderLeft: '2px solid #818cf826', background: '#0a0f1a', cursor: 'pointer' }}>
                        {m.label} ▶{arrow(m.key)}
                      </th>
                    )
                  }
                  return m.weeks.map((wk, wi) => (
                    <th key={wk.key}
                      onClick={() => wi === 0 ? toggleMonth(m.key) : toggleSort(wk.key)}
                      style={{
                        ...thBase,
                        color: wi === 0 ? mColor : 'var(--text-muted)',
                        fontWeight: wi === 0 ? 700 : 400,
                        minWidth: 60,
                        borderLeft: wi === 0 ? '2px solid #818cf826' : undefined,
                      }}>
                      {wi === 0 ? `${m.label} ▼ ` : ''}{wkLabel(wk.key)}{wi > 0 ? arrow(wk.key) : ''}
                    </th>
                  ))
                })}

                <th style={{ ...thBase, color: '#34d399', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #34d39926' }}
                  onClick={() => toggleSort('total_val')}>
                  2Y Total{arrow('total_val')}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Total row */}
              <tr style={{ background: '#0f172a' }}>
                <td style={{ ...tdL, color: 'var(--text-muted)' }}></td>
                <td style={{ ...tdL, fontWeight: 700, fontSize: 10 }}>TOTAL ({rows.length})</td>
                {months.map(m => {
                  const isCollapsed = collapsed.has(m.key)
                  if (isCollapsed) {
                    const mTotal = rows.reduce((s, r) => s + val(r, m.key, 'month'), 0)
                    return <td key={m.key} style={{ ...td, fontWeight: 700, color: '#818cf8', borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>{fmt(mTotal)}</td>
                  }
                  return m.weeks.map((wk, wi) => {
                    const wTotal = rows.reduce((s, r) => s + val(r, wk.key, 'week'), 0)
                    return <td key={wk.key} style={{ ...td, fontWeight: 700, color: wi === 0 ? '#818cf8' : 'var(--text-secondary)', borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>{fmt(wTotal)}</td>
                  })
                })}
                <td style={{ ...td, fontWeight: 800, color: '#34d399', borderLeft: '2px solid #34d39926' }}>{fmt(totVal)}</td>
              </tr>

              {/* Store count row */}
              {(() => {
                const t = rows.length
                const cntBadge = (n: number) => {
                  const pct = t > 0 ? n / t : 0
                  const color = pct >= 0.9 ? '#34d399' : pct >= 0.7 ? '#f59e0b' : '#f87171'
                  return <span style={{ color, fontWeight: 700, fontSize: 10 }}>{n}</span>
                }
                return (
                  <tr style={{ background: '#080d18', borderTop: '1px dashed #1e293b' }}>
                    <td style={{ ...tdL, fontSize: 9 }}></td>
                    <td style={{ ...tdL, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>stores &gt;0</td>
                    {months.map(m => {
                      const isCollapsed = collapsed.has(m.key)
                      if (isCollapsed) {
                        const cnt = rows.filter(r => val(r, m.key, 'month') > 0).length
                        return <td key={m.key} style={{ ...td, fontSize: 10, borderLeft: '2px solid #818cf826', background: '#080d18' }}>{cntBadge(cnt)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                      }
                      return m.weeks.map((wk, wi) => {
                        const cnt = rows.filter(r => val(r, wk.key, 'week') > 0).length
                        return <td key={wk.key} style={{ ...td, fontSize: 10, borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>{cntBadge(cnt)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                      })
                    })}
                    <td style={{ ...td, fontSize: 10, borderLeft: '2px solid #34d39926' }}>{cntBadge(rows.filter(r => (mode === 'val' ? r.total_val : r.total_qty) > 0).length)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span></td>
                  </tr>
                )
              })()}

              {rows.map((r, i) => {
                const rowTotal = mode === 'val' ? r.total_val : r.total_qty
                return (
                  <tr key={r.store_name}
                    style={{ background: i % 2 === 0 ? 'transparent' : 'var(--content-bg)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--content-bg)')}>
                    <td style={{ ...tdL, color: 'var(--text-muted)', fontSize: 10 }}>{i + 1}</td>
                    <td style={{ ...tdL, fontWeight: 600, color: 'var(--text-primary)' }}>{r.store_name}</td>
                    {months.map(m => {
                      const isCollapsed = collapsed.has(m.key)
                      if (isCollapsed) {
                        const v = val(r, m.key, 'month')
                        return <td key={m.key} style={{ ...td, color: v > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: v > 0 ? 600 : 400, opacity: v === 0 ? 0.3 : 1, borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>
                          {v > 0 ? fmt(v) : '—'}
                        </td>
                      }
                      return m.weeks.map((wk, wi) => {
                        const v = val(r, wk.key, 'week')
                        return <td key={wk.key} style={{ ...td, color: v > 0 ? (wi === 0 ? '#818cf8' : 'var(--text-secondary)') : 'var(--text-muted)', fontWeight: wi === 0 && v > 0 ? 600 : 400, opacity: v === 0 ? 0.3 : 1, borderLeft: wi === 0 ? '2px solid #818cf826' : undefined }}>
                          {v > 0 ? fmt(v) : '—'}
                        </td>
                      })
                    })}
                    <td style={{ ...td, color: rowTotal > 0 ? '#34d399' : 'var(--text-muted)', fontWeight: 700, borderLeft: '2px solid #34d39926' }}>
                      {fmt(rowTotal)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
