import { useEffect, useState, useMemo } from 'react'
import http from '@/api/http'

interface SaleRow {
  store_name: string
  store_name_f: string
  zone: string
  state: string
  grade: string
  yesterday_val: number
  yesterday_qty: number
  mtd_val: number
  mtd_qty: number
  dates: Record<string, number>  // "YYYY-MM-DD" → sale_netamt
}

interface Summary {
  rows: SaleRow[]
  count: number
  sale_date: string   // T-1
  mtd_start: string
  dates: string[]     // sorted MTD dates
}

const fmt   = (n: number) => n.toLocaleString('en-IN')
const fmtV  = (n: number) =>
  n >= 1_00_00_000 ? `₹${(n / 1_00_00_000).toFixed(2)}Cr`
  : n >= 1_00_000   ? `₹${(n / 1_00_000).toFixed(1)}L`
  : `₹${Math.round(n).toLocaleString('en-IN')}`

// "2026-09-11" → "11-Sep"
const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getDate()}-${dt.toLocaleString('en', { month: 'short' })}`
}

type SortKey = 'store_name' | 'yesterday_val' | 'mtd_val' | string

export default function SaleDashboard() {
  const [data, setData]       = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<SortKey>('yesterday_val')
  const [asc, setAsc]         = useState(false)

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
      if (sort === 'store_name')      { av = a.store_name; bv = b.store_name }
      else if (sort === 'yesterday_val') { av = a.yesterday_val; bv = b.yesterday_val }
      else if (sort === 'mtd_val')    { av = a.mtd_val; bv = b.mtd_val }
      else { av = a.dates[sort] ?? 0; bv = b.dates[sort] ?? 0 }    // date column
      if (typeof av === 'number' && typeof bv === 'number')
        return asc ? av - bv : bv - av
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return r
  }, [data, search, sort, asc])

  const dates    = data?.dates ?? []
  const t1       = data?.sale_date ?? ''

  const totYday  = rows.reduce((s, r) => s + r.yesterday_val, 0)
  const totMtd   = rows.reduce((s, r) => s + r.mtd_val,       0)
  const totDate  = (d: string) => rows.reduce((s, r) => s + (r.dates[d] ?? 0), 0)

  const toggleSort = (k: SortKey) => {
    if (sort === k) setAsc(a => !a); else { setSort(k); setAsc(false) }
  }
  const arrow = (k: SortKey) => sort === k ? (asc ? ' ↑' : ' ↓') : ''

  const thBase: React.CSSProperties = {
    padding: '7px 8px', fontSize: 10, fontWeight: 700,
    color: 'var(--text-muted)', letterSpacing: 0.5, textTransform: 'uppercase',
    borderBottom: '1px solid var(--card-border)', background: 'var(--card-bg)',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'right',
  }
  const td: React.CSSProperties = {
    padding: '6px 8px', fontSize: 11, borderBottom: '1px solid var(--card-border)',
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
            &nbsp;·&nbsp; MTD: <strong style={{ color: '#818cf8' }}>{fmtDate(data?.mtd_start ?? '')} – {fmtDate(t1)}</strong>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { label: `${fmtDate(t1)} Sale`, val: fmtV(totYday), sub: `${fmt(rows.reduce((s,r)=>s+r.yesterday_qty,0))} pcs`, color: '#38bdf8' },
          { label: 'MTD Sale',            val: fmtV(totMtd),  sub: `${fmt(rows.reduce((s,r)=>s+r.mtd_qty,0))} pcs`,       color: '#818cf8' },
          { label: 'Stores Selling',      val: String(rows.filter(r => r.yesterday_val > 0).length), sub: `of ${rows.length}`, color: '#34d399' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, padding: '10px 14px', borderLeft: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{k.val}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Pivot table */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...thBase, textAlign: 'left', width: 28 }}>#</th>
                <th style={{ ...thBase, textAlign: 'left', minWidth: 90 }} onClick={() => toggleSort('store_name')}>
                  Store{arrow('store_name')}
                </th>
                {/* Date columns — newest (T-1) first */}
                {[...dates].reverse().map(d => (
                  <th
                    key={d}
                    onClick={() => toggleSort(d)}
                    style={{
                      ...thBase,
                      color: d === t1 ? '#38bdf8' : 'var(--text-muted)',
                      fontWeight: d === t1 ? 800 : 700,
                      minWidth: 72,
                    }}
                  >
                    {fmtDate(d)}{arrow(d)}
                  </th>
                ))}
                <th style={{ ...thBase, color: '#818cf8', minWidth: 80, fontWeight: 800 }} onClick={() => toggleSort('mtd_val')}>
                  MTD ₹{arrow('mtd_val')}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Total row */}
              <tr style={{ background: '#0f172a' }}>
                <td style={{ ...tdL, color: 'var(--text-muted)' }}></td>
                <td style={{ ...tdL, fontWeight: 700, fontSize: 10, color: 'var(--text-secondary)' }}>
                  TOTAL ({rows.length})
                </td>
                {[...dates].reverse().map(d => (
                  <td key={d} style={{ ...td, fontWeight: 700, color: d === t1 ? '#38bdf8' : 'var(--text-secondary)', fontSize: 11 }}>
                    {fmtV(totDate(d))}
                  </td>
                ))}
                <td style={{ ...td, fontWeight: 800, color: '#818cf8' }}>{fmtV(totMtd)}</td>
              </tr>

              {rows.map((r, i) => (
                <tr
                  key={r.store_name}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'var(--content-bg)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--content-bg)')}
                >
                  <td style={{ ...tdL, color: 'var(--text-muted)', fontSize: 10 }}>{i + 1}</td>
                  <td style={tdL}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>{r.store_name}</div>
                    {r.store_name_f && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{r.store_name_f}</div>}
                  </td>
                  {[...dates].reverse().map(d => {
                    const v = r.dates[d] ?? 0
                    return (
                      <td
                        key={d}
                        style={{
                          ...td,
                          color: v > 0 ? (d === t1 ? '#38bdf8' : 'var(--text-secondary)') : 'var(--text-muted)',
                          fontWeight: d === t1 && v > 0 ? 600 : 400,
                          opacity: v === 0 ? 0.35 : 1,
                        }}
                      >
                        {v > 0 ? fmtV(v) : '—'}
                      </td>
                    )
                  })}
                  <td style={{ ...td, color: r.mtd_val > 0 ? '#818cf8' : 'var(--text-muted)', fontWeight: r.mtd_val > 0 ? 700 : 400 }}>
                    {fmtV(r.mtd_val)}
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
