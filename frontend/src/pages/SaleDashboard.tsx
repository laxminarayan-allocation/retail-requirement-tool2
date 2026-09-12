import { useEffect, useState, useMemo } from 'react'
import http from '@/api/http'

interface WeekGroup {
  week: number
  label: string
  dates: string[]   // newest first
  start: string
  end: string
}

interface SaleRow {
  store_name: string
  store_name_short: string
  store_name_f: string
  zone: string
  state: string
  grade: string
  yesterday_val: number
  yesterday_qty: number
  six_w_val: number
  six_w_qty: number
  week_sums: number[]   // index = week index (0=W1 newest)
  mtd_val: number
  lm_val: number
  dates: Record<string, number>
}

interface Summary {
  rows: SaleRow[]
  count: number
  sale_date: string
  period_start: string
  mtd_start: string
  lm_start: string
  lm_end: string
  dates: string[]
  weeks: WeekGroup[]
}

const fmt   = (n: number) => n.toLocaleString('en-IN')
const fmtV  = (n: number) =>
  n >= 1_00_00_000 ? `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  : n >= 1_00_000   ? `₹${(n / 1_00_000).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`

const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getDate()}-${dt.toLocaleString('en', { month: 'short' })}`
}

type SortKey = 'store_name' | 'yesterday_val' | 'six_w_val' | 'max_week_val' | 'mtd_val' | 'lm_val' | string

export default function SaleDashboard() {
  const [data, setData]       = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<SortKey>('yesterday_val')
  const [asc, setAsc]         = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set([2, 3, 4, 5, 6, 7, 8]))
  // selectedWeeks: which weeks (1-indexed) to include in Max Wk column
  const [selectedWeeks, setSelectedWeeks] = useState<Set<number>>(new Set([1]))

  useEffect(() => {
    http.get('/sale/store-summary')
      .then(r => {
        const d = r.data
        if (d.success) setData(d.data)
        else setError(d.message || 'Load failed')
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const toggleWeek = (w: number) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(w)) next.delete(w); else next.add(w)
      return next
    })
  }

  // Week sum per store
  const weekSum = (row: SaleRow, wk: WeekGroup) =>
    wk.dates.reduce((s, d) => s + (row.dates[d] ?? 0), 0)

  // Sum of specifically selected weeks (1-indexed) per store
  const topNVal = (row: SaleRow) =>
    row.week_sums.reduce((s, v, i) => selectedWeeks.has(i + 1) ? s + v : s, 0)

  const toggleSelWk = (w: number) => {
    setSelectedWeeks(prev => {
      const next = new Set(prev)
      if (next.has(w)) { if (next.size > 1) next.delete(w) }  // keep ≥1 selected
      else next.add(w)
      return next
    })
  }

  const rows = useMemo(() => {
    if (!data) return []
    let r = data.rows
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(s =>
        s.store_name.toLowerCase().includes(q) ||
        s.store_name_f.toLowerCase().includes(q) ||
        s.zone.toLowerCase().includes(q) ||
        s.state.toLowerCase().includes(q)
      )
    }
    r = [...r].sort((a, b) => {
      let av: number | string, bv: number | string
      if (sort === 'store_name')        { av = a.store_name; bv = b.store_name }
      else if (sort === 'yesterday_val'){ av = a.yesterday_val; bv = b.yesterday_val }
      else if (sort === 'six_w_val')    { av = a.six_w_val; bv = b.six_w_val }
      else if (sort === 'max_week_val') { av = topNVal(a); bv = topNVal(b) }
      else if (sort === 'mtd_val')      { av = a.mtd_val; bv = b.mtd_val }
      else if (sort === 'lm_val')       { av = a.lm_val; bv = b.lm_val }
      else { av = a.dates[sort] ?? 0; bv = b.dates[sort] ?? 0 }
      if (typeof av === 'number' && typeof bv === 'number')
        return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return r
  }, [data, search, sort, asc])

  const weeks  = data?.weeks ?? []
  const t1     = data?.sale_date ?? ''

  const totYday   = rows.reduce((s, r) => s + r.yesterday_val, 0)
  const totSixW   = rows.reduce((s, r) => s + r.six_w_val, 0)
  const totMtd    = rows.reduce((s, r) => s + r.mtd_val, 0)
  const totLm     = rows.reduce((s, r) => s + r.lm_val, 0)

  const toggleSort = (k: SortKey) => {
    if (sort === k) setAsc(a => !a); else { setSort(k); setAsc(false) }
  }
  const arrow = (k: SortKey) => sort === k ? (asc ? ' ↑' : ' ↓') : ''

  const thBase: React.CSSProperties = {
    padding: '7px 6px', fontSize: 10, fontWeight: 700,
    color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase',
    borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'right',
  }
  const td: React.CSSProperties = {
    padding: '5px 6px', fontSize: 11, borderBottom: '1px solid var(--card-border)',
    fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap',
  }
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-muted)', fontSize: 14 }}>
      Loading sale data...
    </div>
  )
  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12, padding: '2rem', textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontWeight: 700 }}>Could not load sale data</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 440 }}>{error}</div>
    </div>
  )

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>Sale Dashboard</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            T-1: <strong style={{ color: '#38bdf8' }}>{fmtDate(t1)} ({t1})</strong>
            &nbsp;·&nbsp; 6 Weeks: <strong style={{ color: '#818cf8' }}>{fmtDate(data?.period_start ?? '')} – {fmtDate(t1)}</strong>
            &nbsp;·&nbsp; {data?.count} stores
          </div>
        </div>
        <input
          placeholder="Search store..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: 'var(--card-bg)', border: '1px solid var(--card-border)',
            borderRadius: 6, padding: '5px 10px', fontSize: 12,
            color: 'var(--text-primary)', outline: 'none', width: 190,
          }}
        />
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {[
          { label: `${fmtDate(t1)} Sale`, val: fmtV(totYday), sub: `${fmt(rows.reduce((s,r)=>s+r.yesterday_qty,0))} pcs`, color: '#38bdf8' },
          { label: 'MTD Sale',            val: fmtV(totMtd),  sub: fmtDate(data?.mtd_start ?? '') + ' – ' + fmtDate(t1), color: '#818cf8' },
          { label: 'Last Month',          val: fmtV(totLm),   sub: fmtDate(data?.lm_start ?? '') + ' – ' + fmtDate(data?.lm_end ?? ''), color: '#a78bfa' },
          { label: '8-Week Sale',         val: fmtV(totSixW), sub: `${fmt(rows.reduce((s,r)=>s+r.six_w_qty,0))} pcs`,    color: '#22d3ee' },
          { label: 'Stores Selling',      val: String(rows.filter(r => r.yesterday_val > 0).length), sub: `of ${rows.length}`, color: '#34d399' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Collapse legend */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Weeks:</span>
        {weeks.map(wk => (
          <button
            key={wk.week}
            onClick={() => toggleWeek(wk.week)}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              background: collapsed.has(wk.week) ? 'var(--card-bg)' : '#1e293b',
              border: `1px solid ${collapsed.has(wk.week) ? 'var(--card-border)' : '#818cf8'}`,
              color: collapsed.has(wk.week) ? 'var(--text-muted)' : '#818cf8',
              fontWeight: collapsed.has(wk.week) ? 400 : 700,
            }}
          >
            {wk.label} {fmtDate(wk.end)}–{fmtDate(wk.start)} {collapsed.has(wk.week) ? '▶' : '▼'}
          </button>
        ))}
        <button
          onClick={() => setCollapsed(new Set(weeks.map(w => w.week)))}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}
        >Collapse All</button>
        <button
          onClick={() => setCollapsed(new Set())}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: 'var(--text-muted)' }}
        >Expand All</button>

        {/* Max Wk week multi-selector */}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>Max Wk weeks:</span>
        {Array.from({ length: weeks.length }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => toggleSelWk(n)}
            style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4, cursor: 'pointer',
              background: selectedWeeks.has(n) ? '#f59e0b' : 'transparent',
              border: `1px solid ${selectedWeeks.has(n) ? '#f59e0b' : 'var(--card-border)'}`,
              color: selectedWeeks.has(n) ? '#000' : 'var(--text-muted)',
              fontWeight: selectedWeeks.has(n) ? 800 : 400,
            }}
          >W{n}</button>
        ))}
        <button
          onClick={() => setSelectedWeeks(new Set(weeks.map(w => w.week)))}
          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, cursor: 'pointer', background: 'transparent', border: '1px solid var(--card-border)', color: '#f59e0b' }}
        >All</button>
      </div>

      {/* Pivot table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...thBase, textAlign: 'left', width: 24 }}>#</th>
                <th style={{ ...thBase, textAlign: 'left', minWidth: 90 }} onClick={() => toggleSort('store_name')}>
                  Store{arrow('store_name')}
                </th>

                {/* Yesterday (T-1) — always visible */}
                <th
                  onClick={() => toggleSort('yesterday_val')}
                  style={{ ...thBase, color: '#38bdf8', fontWeight: 800, minWidth: 76, borderLeft: '2px solid #38bdf826' }}
                >
                  {fmtDate(t1)}{arrow('yesterday_val')}
                </th>

                {/* Week groups */}
                {weeks.map(wk => {
                  const isCollapsed = collapsed.has(wk.week)
                  const wkColor = '#818cf8'
                  if (isCollapsed) {
                    return (
                      <th
                        key={`wk-${wk.week}`}
                        onClick={() => toggleWeek(wk.week)}
                        style={{ ...thBase, color: wkColor, minWidth: 76, borderLeft: '2px solid #818cf826', background: '#0f172a' }}
                      >
                        {wk.label} ▶
                      </th>
                    )
                  }
                  // expanded: show each date in this week (skip T-1 as it's already shown)
                  return wk.dates
                    .filter(d => d !== t1)
                    .map((d, di) => (
                      <th
                        key={d}
                        onClick={() => di === 0 ? toggleWeek(wk.week) : toggleSort(d)}
                        style={{
                          ...thBase,
                          color: di === 0 ? wkColor : 'var(--text-muted)',
                          fontWeight: di === 0 ? 700 : 400,
                          minWidth: 66,
                          borderLeft: di === 0 ? '2px solid #818cf826' : undefined,
                        }}
                      >
                        {di === 0 ? `${wk.label} ▼ ` : ''}{fmtDate(d)}{di > 0 ? arrow(d) : ''}
                      </th>
                    ))
                })}

                {/* Max Week top-N */}
                <th
                  onClick={() => toggleSort('max_week_val')}
                  style={{ ...thBase, color: '#f59e0b', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #f59e0b26' }}
                >
                  {selectedWeeks.size === weeks.length ? 'All' : `W${[...selectedWeeks].sort().join('+W')}`} ₹{arrow('max_week_val')}
                </th>

                {/* MTD */}
                <th
                  onClick={() => toggleSort('mtd_val')}
                  style={{ ...thBase, color: '#818cf8', minWidth: 80, fontWeight: 800, borderLeft: '2px solid #818cf826' }}
                >
                  MTD{arrow('mtd_val')}
                </th>

                {/* LM */}
                <th
                  onClick={() => toggleSort('lm_val')}
                  style={{ ...thBase, color: '#a78bfa', minWidth: 80, fontWeight: 800 }}
                >
                  LM{arrow('lm_val')}
                </th>

                {/* 6W Total */}
                <th
                  onClick={() => toggleSort('six_w_val')}
                  style={{ ...thBase, color: '#22d3ee', minWidth: 80, fontWeight: 800 }}
                >
                  8W ₹{arrow('six_w_val')}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Total row */}
              <tr style={{ background: '#0f172a' }}>
                <td style={{ ...tdL, color: 'var(--text-muted)' }}></td>
                <td style={{ ...tdL, fontWeight: 700, fontSize: 10, color: 'var(--text-secondary)' }}>TOTAL ({rows.length})</td>

                {/* T-1 total */}
                <td style={{ ...td, fontWeight: 800, color: '#38bdf8', borderLeft: '2px solid #38bdf826' }}>
                  {fmtV(totYday)}
                </td>

                {weeks.map(wk => {
                  const isCollapsed = collapsed.has(wk.week)
                  const wkTotal = rows.reduce((s, r) => s + weekSum(r, wk), 0)
                  if (isCollapsed) {
                    return (
                      <td key={`wk-${wk.week}`} style={{ ...td, fontWeight: 700, color: '#818cf8', borderLeft: '2px solid #818cf826', background: '#0f172a' }}>
                        {fmtV(wkTotal)}
                      </td>
                    )
                  }
                  return wk.dates
                    .filter(d => d !== t1)
                    .map((d, di) => {
                      const dTotal = rows.reduce((s, r) => s + (r.dates[d] ?? 0), 0)
                      return (
                        <td key={d} style={{ ...td, fontWeight: 700, color: di === 0 ? '#818cf8' : 'var(--text-secondary)', fontSize: 11, borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>
                          {fmtV(dTotal)}
                        </td>
                      )
                    })
                })}

                <td style={{ ...td, fontWeight: 800, color: '#f59e0b', borderLeft: '2px solid #f59e0b26' }}>
                  {fmtV(rows.reduce((s, r) => s + topNVal(r), 0))}
                </td>
                <td style={{ ...td, fontWeight: 800, color: '#818cf8', borderLeft: '2px solid #818cf826' }}>
                  {fmtV(totMtd)}
                </td>
                <td style={{ ...td, fontWeight: 800, color: '#a78bfa' }}>
                  {fmtV(totLm)}
                </td>
                <td style={{ ...td, fontWeight: 800, color: '#22d3ee' }}>
                  {fmtV(totSixW)}
                </td>
              </tr>

              {/* Store count row — stores with sale > 0 per column */}
              {(() => {
                const cntStyle: React.CSSProperties = {
                  ...td, fontSize: 10, fontWeight: 600,
                  color: 'var(--text-muted)', letterSpacing: 0.3,
                }
                const cntBadge = (n: number, total: number) => {
                  const pct = total > 0 ? n / total : 0
                  const color = pct >= 0.9 ? '#34d399' : pct >= 0.7 ? '#f59e0b' : '#f87171'
                  return (
                    <span style={{ color, fontWeight: 700, fontSize: 10 }}>{n}</span>
                  )
                }
                const t = rows.length
                const ydayCnt = rows.filter(r => r.yesterday_val > 0).length
                return (
                  <tr style={{ background: '#080d18', borderTop: '1px dashed #1e293b' }}>
                    <td style={{ ...tdL, fontSize: 9, color: 'var(--text-muted)' }}></td>
                    <td style={{ ...tdL, fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>stores &gt;0</td>

                    {/* T-1 count */}
                    <td style={{ ...cntStyle, borderLeft: '2px solid #38bdf826' }}>
                      {cntBadge(ydayCnt, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                    </td>

                    {weeks.map(wk => {
                      const isCollapsed = collapsed.has(wk.week)
                      if (isCollapsed) {
                        const cnt = rows.filter(r => weekSum(r, wk) > 0).length
                        return (
                          <td key={`cnt-wk-${wk.week}`} style={{ ...cntStyle, borderLeft: '2px solid #818cf826', background: '#080d18' }}>
                            {cntBadge(cnt, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                          </td>
                        )
                      }
                      return wk.dates
                        .filter(d => d !== t1)
                        .map((d, di) => {
                          const cnt = rows.filter(r => (r.dates[d] ?? 0) > 0).length
                          return (
                            <td key={`cnt-${d}`} style={{ ...cntStyle, borderLeft: di === 0 ? '2px solid #818cf826' : undefined }}>
                              {cntBadge(cnt, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                            </td>
                          )
                        })
                    })}

                    <td style={{ ...cntStyle, borderLeft: '2px solid #f59e0b26' }}>
                      {cntBadge(rows.filter(r => topNVal(r) > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                    </td>
                    <td style={{ ...cntStyle, borderLeft: '2px solid #818cf826' }}>
                      {cntBadge(rows.filter(r => r.mtd_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                    </td>
                    <td style={cntStyle}>
                      {cntBadge(rows.filter(r => r.lm_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                    </td>
                    <td style={cntStyle}>
                      {cntBadge(rows.filter(r => r.six_w_val > 0).length, t)}<span style={{ color: 'var(--text-muted)', fontSize: 9 }}>/{t}</span>
                    </td>
                  </tr>
                )
              })()}

              {rows.map((r, i) => (
                <tr
                  key={r.store_name}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'var(--content-bg)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--content-bg)')}
                >
                  <td style={{ ...tdL, color: 'var(--text-muted)', fontSize: 10 }}>{i + 1}</td>
                  <td style={tdL}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>
                      {r.store_name_f || r.store_name_short || r.store_name}
                    </div>
                    {(r.store_name_f || r.store_name_short) && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>#{r.store_name}</div>
                    )}
                  </td>

                  {/* T-1 */}
                  <td style={{ ...td, color: r.yesterday_val > 0 ? '#38bdf8' : 'var(--text-muted)', fontWeight: r.yesterday_val > 0 ? 700 : 400, opacity: r.yesterday_val === 0 ? 0.35 : 1, borderLeft: '2px solid #38bdf826' }}>
                    {r.yesterday_val > 0 ? fmtV(r.yesterday_val) : '—'}
                  </td>

                  {weeks.map(wk => {
                    const isCollapsed = collapsed.has(wk.week)
                    const ws = weekSum(r, wk)
                    if (isCollapsed) {
                      return (
                        <td key={`wk-${wk.week}`} style={{ ...td, color: ws > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: ws > 0 ? 600 : 400, opacity: ws === 0 ? 0.35 : 1, borderLeft: '2px solid #818cf826', background: '#0a0f1a' }}>
                          {ws > 0 ? fmtV(ws) : '—'}
                        </td>
                      )
                    }
                    return wk.dates
                      .filter(d => d !== t1)
                      .map((d, di) => {
                        const v = r.dates[d] ?? 0
                        return (
                          <td
                            key={d}
                            style={{
                              ...td,
                              color: v > 0 ? (di === 0 ? '#818cf8' : 'var(--text-secondary)') : 'var(--text-muted)',
                              fontWeight: di === 0 && v > 0 ? 600 : 400,
                              opacity: v === 0 ? 0.35 : 1,
                              borderLeft: di === 0 ? '2px solid #818cf826' : undefined,
                            }}
                          >
                            {v > 0 ? fmtV(v) : '—'}
                          </td>
                        )
                      })
                  })}

                  {/* Top-N Max Week */}
                  {(() => { const v = topNVal(r); return (
                    <td style={{ ...td, color: v > 0 ? '#f59e0b' : 'var(--text-muted)', fontWeight: v > 0 ? 700 : 400, borderLeft: '2px solid #f59e0b26' }}>
                      {v > 0 ? fmtV(v) : '—'}
                    </td>
                  )})()}

                  {/* MTD */}
                  <td style={{ ...td, color: r.mtd_val > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: r.mtd_val > 0 ? 600 : 400, borderLeft: '2px solid #818cf826' }}>
                    {r.mtd_val > 0 ? fmtV(r.mtd_val) : '—'}
                  </td>

                  {/* LM */}
                  <td style={{ ...td, color: r.lm_val > 0 ? '#a78bfa' : 'var(--text-muted)', fontWeight: r.lm_val > 0 ? 600 : 400 }}>
                    {r.lm_val > 0 ? fmtV(r.lm_val) : '—'}
                  </td>

                  {/* 6W Total */}
                  <td style={{ ...td, color: r.six_w_val > 0 ? '#22d3ee' : 'var(--text-muted)', fontWeight: r.six_w_val > 0 ? 700 : 400 }}>
                    {fmtV(r.six_w_val)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
