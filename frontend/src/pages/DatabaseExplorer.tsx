/**
 * Database Explorer — Phase 2
 *
 * Three-panel layout:
 *   Left  : schema selector + object type toggle (Tables / Views)
 *   Centre : object list with search
 *   Right  : column detail for selected object
 */
import { useEffect, useState, useCallback, Fragment } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { api } from '@/api/client'
import http from '@/api/http'
import { useAuth } from '@/context/AuthContext'
import { DataGrid } from '@/components/DataGrid'
import { Card } from '@/components/Card'
import MasterData from '@/pages/MasterData'
import { StatusBadge } from '@/components/StatusBadge'
import type { SchemaRow, TableRow, ViewRow, ColumnRow } from '@/types/api'

// ── Tiny shared primitives ────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading…
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div
      style={{
        margin: 12,
        padding: '10px 14px',
        background: '#7f1d1d',
        borderRadius: 6,
        fontSize: 12,
        color: '#fca5a5',
      }}
    >
      {msg}
    </div>
  )
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'var(--content-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 6,
        padding: '7px 10px',
        fontSize: 12,
        color: 'var(--text-primary)',
        outline: 'none',
        marginBottom: 8,
      }}
    />
  )
}

// ── Left panel — schema list ──────────────────────────────────────────────────

function SchemaPanel({
  selectedSchema,
  onSelect,
}: {
  selectedSchema: string
  onSelect: (s: string) => void
}) {
  const [schemas, setSchemas] = useState<SchemaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    api
      .schemas()
      .then(r => {
        if (r.success && r.data) setSchemas(r.data.schemas)
        else setError(r.message ?? 'Failed')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const visible = filter
    ? schemas.filter(s => s.owner.toLowerCase().includes(filter.toLowerCase()))
    : schemas

  return (
    <div>
      <SearchBox value={filter} onChange={setFilter} placeholder="Filter schemas…" />
      {loading && <Spinner />}
      {error && <ErrorMsg msg={error} />}
      {visible.map(s => (
        <div
          key={s.owner}
          onClick={() => onSelect(s.owner)}
          style={{
            padding: '7px 10px',
            borderRadius: 5,
            fontSize: 12,
            fontFamily: 'monospace',
            cursor: 'pointer',
            background: selectedSchema === s.owner ? '#1d4ed8' : 'transparent',
            color: selectedSchema === s.owner ? '#fff' : '#94a3b8',
            marginBottom: 2,
            userSelect: 'none',
          }}
        >
          {s.owner}
        </div>
      ))}
      {!loading && !error && visible.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>No schemas found</div>
      )}
    </div>
  )
}

// ── Centre panel — object list ────────────────────────────────────────────────

type ObjType = 'TABLE' | 'VIEW'
type AnyObj = (TableRow | ViewRow) & { _name: string }

function toAny(rows: TableRow[], type: 'TABLE'): AnyObj[]
function toAny(rows: ViewRow[], type: 'VIEW'): AnyObj[]
function toAny(rows: (TableRow | ViewRow)[], type: ObjType): AnyObj[] {
  return rows.map(r => ({
    ...r,
    _name: type === 'TABLE' ? (r as TableRow).table_name : (r as ViewRow).view_name,
  }))
}

function ObjectPanel({
  schema,
  objectType,
  onObjectTypeChange,
  onSelect,
  selectedName,
}: {
  schema: string
  objectType: ObjType
  onObjectTypeChange: (t: ObjType) => void
  onSelect: (name: string, type: ObjType) => void
  selectedName: string
}) {
  const [objects, setObjects] = useState<AnyObj[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!schema) return
    setLoading(true)
    setError(null)
    const fetch =
      objectType === 'TABLE'
        ? api.tables(schema).then(r => {
            if (r.success && r.data) return toAny(r.data.tables, 'TABLE')
            throw new Error(r.message ?? 'Failed')
          })
        : api.views(schema).then(r => {
            if (r.success && r.data) return toAny(r.data.views, 'VIEW')
            throw new Error(r.message ?? 'Failed')
          })

    fetch
      .then(setObjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [schema, objectType])

  const visible = filter
    ? objects.filter(o => o._name.toLowerCase().includes(filter.toLowerCase()))
    : objects

  if (!schema) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        ← Select a schema
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {(['TABLE', 'VIEW'] as ObjType[]).map(t => (
          <button
            key={t}
            onClick={() => onObjectTypeChange(t)}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 5,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              background: objectType === t ? '#1d4ed8' : '#1e293b',
              color: objectType === t ? '#fff' : '#64748b',
            }}
          >
            {t}S
          </button>
        ))}
      </div>

      <SearchBox value={filter} onChange={setFilter} placeholder={`Filter ${objectType.toLowerCase()}s…`} />

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
        {loading ? '…' : `${visible.length} of ${objects.length}`}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <Spinner />}
        {error && <ErrorMsg msg={error} />}
        {!loading &&
          visible.map(obj => (
            <div
              key={obj._name}
              onClick={() => onSelect(obj._name, objectType)}
              style={{
                padding: '6px 10px',
                borderRadius: 5,
                fontSize: 11,
                fontFamily: 'monospace',
                cursor: 'pointer',
                background: selectedName === obj._name ? '#0c4a6e' : 'transparent',
                color: selectedName === obj._name ? '#7dd3fc' : '#94a3b8',
                marginBottom: 1,
                userSelect: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={obj._name}
            >
              {obj._name}
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Right panel — column detail + data preview ────────────────────────────────

interface PreviewMeta {
  fetched_at: string | null
  age_seconds: number
  rows_in_file: number
  rows_returned: number
  served_from: string
  columns: string[]
  records: Record<string, unknown>[]
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}min ago`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hrs < 24) return remMins > 0 ? `${hrs}hr ${remMins}min ago` : `${hrs}hr ago`
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  return remHrs > 0 ? `${days}d ${remHrs}hr ago` : `${days}d ago`
}

function DataPreviewTab({ schema, name }: { schema: string; name: string }) {
  const [meta, setMeta] = useState<PreviewMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetched, setFetched] = useState(false)
  const [addStatus, setAddStatus] = useState<'idle' | 'adding' | 'done' | 'exists'>('idle')

  function load(forceRefresh = false) {
    setLoading(true)
    setError(null)
    const url = `/database/table/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/preview?limit=200${forceRefresh ? '&force_refresh=true' : ''}`
    http.get(url, { timeout: 300000 })
      .then(res => {
        const d = res.data
        if (d.success && d.data) {
          setMeta(d.data as PreviewMeta)
          setFetched(true)
        } else {
          setError(d.message ?? 'Failed to fetch preview')
        }
      })
      .catch((e: { response?: { data?: { message?: string } }; message?: string }) =>
        setError(e.response?.data?.message ?? e.message ?? 'Network error'))
      .finally(() => setLoading(false))
  }

  if (!fetched && !loading) {
    return (
      <div style={{ padding: '20px 16px' }}>
        {/* Download button — top so it's always visible regardless of panel height */}
        <button
          onClick={() => load(true)}
          style={{
            display: 'block', width: '100%', padding: '11px 0',
            background: '#1d4ed8', color: '#fff',
            border: '1px solid #2563eb', borderRadius: 7,
            fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 14,
          }}
        >
          ⬇ Download Output File
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>No local output file yet.</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Fetches up to 5,000 rows from Oracle and saves a Parquet file.<br />
            Use <strong style={{ color: '#7dd3fc' }}>Refresh</strong> anytime to re-download.
          </div>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
      Fetching from Oracle… this may take up to a minute for large tables.
    </div>
  )
  if (error) return <ErrorMsg msg={error} />
  if (!meta) return null

  const fetchedLabel = meta.fetched_at
    ? new Date(meta.fetched_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Info bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '6px 0', marginBottom: 8, borderBottom: '1px solid #1e293b',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          📅 Downloaded: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fetchedLabel}</span>
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          background: 'rgba(148,163,184,.12)', color: 'var(--text-secondary)',
        }}>
          {formatAge(meta.age_seconds)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {meta.rows_in_file.toLocaleString()} rows in file · showing {meta.rows_returned}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {/* Add to Master Data */}
          <button
            onClick={async () => {
              if (addStatus === 'done' || addStatus === 'adding') return
              setAddStatus('adding')
              try {
                const res = await http.post('/master/custom', {
                  schema_owner: schema,
                  object_name: name,
                  label: `${schema}.${name}`,
                })
                setAddStatus(res.data.success ? 'done' : 'exists')
              } catch { setAddStatus('exists') }
            }}
            title="Add this table to Master Data page"
            style={{
              padding: '4px 12px',
              background: addStatus === 'done' ? '#052e16' : addStatus === 'exists' ? '#1e293b' : '#1a3a5c',
              color: addStatus === 'done' ? '#4ade80' : addStatus === 'exists' ? '#f59e0b' : '#38bdf8',
              border: `1px solid ${addStatus === 'done' ? '#166534' : addStatus === 'exists' ? '#d97706' : '#2563eb'}`,
              borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {addStatus === 'done' ? '✓ Added' : addStatus === 'exists' ? '⚠ Already added' : addStatus === 'adding' ? '…' : '＋ Add to Master Data'}
          </button>
          <button
            onClick={() => load(true)}
            disabled={loading}
            title="Re-fetch from Oracle and overwrite output file"
            style={{
              padding: '4px 12px', background: 'var(--content-bg)', color: '#7dd3fc',
              border: '1px solid var(--card-border)', borderRadius: 5, fontSize: 11,
              fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Data grid */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {meta.records.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            No rows returned.
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: 'var(--content-bg)' }}>
                {meta.columns.map(col => (
                  <th key={col} style={{
                    padding: '5px 10px', color: 'var(--text-muted)', fontWeight: 600,
                    position: 'sticky', top: 0, background: 'var(--content-bg)',
                    textAlign: 'left', borderBottom: '1px solid #1e293b',
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {meta.records.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  {meta.columns.map(col => (
                    <td key={col} style={{
                      padding: '4px 10px', color: 'var(--text-secondary)', fontFamily: 'monospace',
                      maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                      title={String(row[col] ?? '')}>
                      {row[col] == null
                        ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span>
                        : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ColumnPanel({
  schema,
  name,
  type,
}: {
  schema: string
  name: string
  type: ObjType
}) {
  const [columns, setColumns] = useState<ColumnRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowEst, setRowEst] = useState<number | null | undefined>(undefined)
  const [qms, setQms] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [activeTab, setActiveTab] = useState<'columns' | 'data'>('columns')

  useEffect(() => {
    if (!schema || !name) return
    setLoading(true)
    setError(null)
    setActiveTab('columns')
    const fetch =
      type === 'TABLE'
        ? api.tableColumns(schema, name)
        : api.viewColumns(schema, name)

    fetch
      .then(r => {
        if (r.success && r.data) {
          setColumns(r.data.columns)
          setRowEst(r.data.row_estimate)
          setQms(r.data.query_ms)
        } else {
          setError(r.message ?? 'Failed')
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [schema, name, type])

  const visible = filter
    ? columns.filter(c => c.column_name.toLowerCase().includes(filter.toLowerCase()))
    : columns

  if (!name) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        ← Select a table or view
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', fontFamily: 'monospace' }}>
          {schema}.{name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
          {type}
          {rowEst != null && ` · ~${rowEst.toLocaleString()} rows`}
          {qms != null && ` · ${qms} ms`}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {(['columns', 'data'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '5px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: activeTab === tab ? '#1d4ed8' : '#1e293b',
              color: activeTab === tab ? '#fff' : '#64748b',
            }}
          >
            {tab === 'columns' ? '📋 Columns' : '📦 Data Preview'}
          </button>
        ))}
      </div>

      {/* Tab: Columns */}
      {activeTab === 'columns' && (
        <>
          <SearchBox value={filter} onChange={setFilter} placeholder="Filter columns…" />
          {loading && <Spinner />}
          {error && <ErrorMsg msg={error} />}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            {!loading && (
              <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--content-bg)' }}>
                    {['#', 'COLUMN', 'TYPE', 'LEN', 'NULL', 'DEFAULT'].map(h => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)',
                          fontWeight: 600, position: 'sticky', top: 0,
                          background: 'var(--content-bg)', whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(col => (
                    <tr key={col.column_id} style={{ borderBottom: '1px solid #1e293b' }} title={col.comments ?? ''}>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{col.column_id}</td>
                      <td style={{ padding: '5px 8px', color: '#7dd3fc', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {col.column_name}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#a78bfa', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {col.data_type}
                        {col.data_precision != null
                          ? `(${col.data_precision}${col.data_scale ? `,${col.data_scale}` : ''})`
                          : col.data_length ? `(${col.data_length})` : ''}
                      </td>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{col.data_length}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <StatusBadge status={col.nullable === 'Y' ? 'ok' : 'error'} />
                      </td>
                      <td style={{
                        padding: '5px 8px', color: 'var(--text-secondary)', fontFamily: 'monospace',
                        fontSize: 10, maxWidth: 140, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {col.data_default ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Tab: Data Preview — tables and views */}
      {activeTab === 'data' && (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <DataPreviewTab key={`${schema}.${name}`} schema={schema} name={name} />
        </div>
      )}
    </div>
  )
}

// ── SQL Query & Export panel (admin) ─────────────────────────────────────────

interface QueryResult {
  label: string
  rows_in_file: number
  rows_returned: number
  columns: string[]
  records: Record<string, unknown>[]
  fetched_at: string | null
  age_seconds: number
  fetch_ms: number
}

function SqlQueryPanel({ userRole }: { userRole: string }) {
  const [sql, setSql] = useState('')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  if (userRole !== 'admin') return null

  function run() {
    if (!sql.trim()) return
    setLoading(true); setError(null); setResult(null)
    http.post('/database/query/export', {
      sql: sql.trim(),
      label: label.trim() || 'custom_query',
    }, { timeout: 300000 })
      .then(res => {
        const d = res.data
        if (d.success && d.data) setResult(d.data)
        else setError(d.message ?? 'Query failed')
      })
      .catch((e: { response?: { data?: { message?: string } }; message?: string }) =>
        setError(e.response?.data?.message ?? e.message ?? 'Network error'))
      .finally(() => setLoading(false))
  }

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header toggle */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: 'var(--card-bg)', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>
          🗂 SQL Query & Export  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>(Admin · SELECT only · saves to output/)</span>
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: 14, background: 'var(--content-bg)' }}>
          {/* SQL input */}
          <textarea
            value={sql}
            onChange={e => setSql(e.target.value)}
            placeholder={"SELECT * FROM all_views WHERE owner = 'CK_A2166'"}
            rows={4}
            style={{
              width: '100%', background: 'var(--card-bg)', border: '1px solid var(--card-border)',
              borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text-primary)',
              fontFamily: 'monospace', outline: 'none', resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Output filename (e.g. CK_A2166_VIEWS)"
              style={{
                flex: 1, background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            <button
              onClick={run}
              disabled={loading || !sql.trim()}
              style={{
                padding: '8px 20px', background: loading ? '#334155' : '#1d4ed8',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? '⏳ Running…' : '⬇ Run & Export'}
            </button>
          </div>

          {error && <ErrorMsg msg={error} />}

          {result && (
            <div style={{ marginTop: 12 }}>
              {/* Result meta */}
              <div style={{
                display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
                padding: '6px 0', marginBottom: 8, borderBottom: '1px solid #1e293b',
              }}>
                <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700 }}>✓ Saved to output/QUERY__{result.label}.parquet</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{result.rows_in_file.toLocaleString()} rows · {result.fetch_ms} ms · showing {result.rows_returned}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {new Date(result.fetched_at ?? '').toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })}
                </span>
              </div>

              {/* Mini grid */}
              <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: 'var(--content-bg)' }}>
                      {result.columns.map(c => (
                        <th key={c} style={{
                          padding: '4px 10px', color: 'var(--text-muted)', fontWeight: 600,
                          position: 'sticky', top: 0, background: 'var(--content-bg)',
                          textAlign: 'left', borderBottom: '1px solid #1e293b',
                        }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                        {result.columns.map(c => (
                          <td key={c} style={{
                            padding: '3px 10px', color: 'var(--text-secondary)', fontFamily: 'monospace',
                            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                          }} title={String(row[c] ?? '')}>
                            {row[c] == null
                              ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span>
                              : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SQL text block (for custom query rows) ───────────────────────────────────

function SqlTextBlock({ file, onSaved }: { file: OutputFile; onSaved: (sql: string) => void }) {
  const [editing, setEditing] = useState(!file.sql_text)
  const [draft, setDraft] = useState(file.sql_text ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!draft.trim()) { setErr('SQL cannot be empty'); return }
    setSaving(true); setErr(null)
    try {
      await http.patch(
        `/database/output/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.object)}/sql`,
        { sql_text: draft.trim() }
      )
      onSaved(draft.trim())
      setEditing(false)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '.07em',
  }

  return (
    <div style={{ marginBottom: 10, background: '#0a1628', border: '1px solid #1e3052', borderRadius: 6, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #1e3052' }}>
        <span style={labelStyle}>SQL Query</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {!editing && file.sql_text && (
            <button onClick={() => navigator.clipboard.writeText(file.sql_text!)}
              style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ⧉ Copy
            </button>
          )}
          <button onClick={() => { setDraft(file.sql_text ?? ''); setEditing(e => !e); setErr(null) }}
            style={{ fontSize: 9, fontWeight: 700, color: '#38bdf8', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            {editing ? 'Cancel' : '✎ Edit'}
          </button>
        </div>
      </div>

      {/* Read mode */}
      {!editing && file.sql_text && (
        <pre style={{
          margin: 0, padding: '10px 14px', fontSize: 11,
          fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace",
          color: '#7dd3fc', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          lineHeight: 1.7, maxHeight: 160, overflowY: 'auto',
        }}>
          {file.sql_text}
        </pre>
      )}

      {/* Edit / add mode */}
      {editing && (
        <div style={{ padding: '10px 12px' }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={4}
            placeholder="Paste the SQL query that generated this file…"
            style={{
              width: '100%', background: '#060e1c', border: '1px solid #253761',
              borderRadius: 5, padding: '8px 10px', fontSize: 11,
              fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace",
              color: '#7dd3fc', outline: 'none', resize: 'vertical',
              lineHeight: 1.7, boxSizing: 'border-box',
            }}
          />
          {err && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: '4px 14px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {file.sql_text && (
              <button onClick={() => { setEditing(false); setErr(null) }}
                style={{ padding: '4px 10px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--card-border)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Downloaded Files panel (viewer+) ─────────────────────────────────────────

interface OutputFile {
  owner: string
  object: string
  rows: number
  columns: string[]
  fetched_at: string
  age_label: string
  size_bytes: number
  sql_text?: string
}

interface DlWinState {
  columns: string[]
  records: Record<string, unknown>[]
  loading: boolean
  error: string | null
  limit: number
  label: string
  rows: number
}

// ── Used In mapping: owner__object → page names ───────────────────────────────
const USED_IN: Record<string, string[]> = {
  'CK_A2166__STORE_MASTER_NSO':            ['Distribution', 'NSO', 'Sale', 'Simulation'],
  'CK_A2166__V_ALL_WITH_NSO':              ['NSO'],
  'CK_A2166__V_ART_PIVOT':                 ['Requirements'],
  'CK_A2166__V_ART_PIVOT_V2':              ['Requirements'],
  'CK_A2166__V_ART_REQ_APPS':              ['Distribution', 'Requirements'],
  'CK_A2166__V_ART_REQ_GM':               ['Distribution', 'Requirements'],
  'CK_A2166__V_BARCODE_PIVOT':             ['Requirements'],
  'CK_A2166__V_BARCODE_REQ_APPS_GRC_V2':  ['Distribution', 'Requirements'],
  'CK_A2166__V_BARCODE_REQ_APPS_WMS_V2':  ['Distribution', 'Requirements'],
  'CK_A2166__V_LIST_PBS_REQ':              ['Requirements'],
  'CK_A2166__V_LIST_PIVOT':               ['Requirements'],
  'CK_A2166__V_MC_PIVOT':                  ['Requirements'],
  'CK_A2166__V_MC_PIVOT_V2':               ['Requirements'],
  'CK_A2166__V_MC_REQ_APPS_2':             ['Distribution', 'Requirements', 'Simulation'],
  'CK_A2166__V_MC_REQ_GM':                ['Distribution', 'Requirements'],
  'CK_A2166__V_MC_ALLOCATION':             ['Master Data'],
  'CK_A2166__V_MC_MDQ_STR':               ['Master Data'],
  'CK_A2166__V_MRP_PIVOT':                 ['Requirements'],
  'CK_A2166__V_MRP_REQ_APPS':              ['Distribution', 'Requirements'],
  'CK_A2166__V_NSO':                       ['NSO'],
  'CK_A2166__V_OPTION_PIVOT':              ['Requirements'],
  'CK_A2166__V_OPTION_REQ_APPS':           ['Distribution', 'Requirements'],
  'CK_A2166__V_SIZE_PIVOT':                ['Requirements'],
  'CK_A2166__V_SPARKY_PBS_REQ':            ['Requirements'],
  'CK_A2166__V_SPARKY_PIVOT':              ['Requirements'],
  'CK_A2166__V_STORE_NAMES':               ['Requirements'],
  'CK_A2166__V_SZ_REQ_APPS':              ['Distribution', 'Requirements'],
  'CK_A2166__V_TABLE_REQ_APPS':            ['Requirements'],
  'CK_A2166__V_WH_STOCK':                  ['Requirements'],
  'CK_A2166__T_ALLOCATION_FOR_ALL_DIVISION': ['Dashboard', 'Requirements'],
  'CK_A2166__T_STK_REPORT_DC_STOCK':       ['Warehouse'],
  'CK_A2166__T_STORE_OPENING_DATE':        ['Dashboard', 'Distribution'],
  'CK_A2166__T_CLR_CONCEPT_AW26_V1':       ['Distribution'],
  'CK_A2166__T_GRID':                      ['Option Listing'],
  'CK_A2166__V_ITEM_MASTER':               ['Distribution', 'Option Listing', 'Warehouse'],
  'CK_A2166__ITEM_MV_FILTER_META_V2':      ['Requirements'],
}

// Pivot files are created by backend (req_dashboard pivot endpoint), not directly from Oracle
const PIVOT_OBJECTS = new Set([
  'V_ART_PIVOT', 'V_ART_PIVOT_V2', 'V_BARCODE_PIVOT', 'V_LIST_PIVOT',
  'V_MC_PIVOT', 'V_MC_PIVOT_V2', 'V_MRP_PIVOT', 'V_OPTION_PIVOT',
  'V_SIZE_PIVOT', 'V_SPARKY_PIVOT',
])

function getFileSource(owner: string, obj: string): { label: string; color: string } {
  if (owner === 'QUERY') return { label: 'SQL Query', color: '#fbbf24' }
  if (PIVOT_OBJECTS.has(obj)) return { label: 'Backend Pivot', color: '#a78bfa' }
  return { label: 'Oracle', color: '#34d399' }
}

const PAGE_CHIP_COLOR: Record<string, string> = {
  'Dashboard':    '#38bdf8',
  'Requirements': '#a78bfa',
  'Distribution': '#fb923c',
  'NSO':          '#f472b6',
  'Sale':         '#4ade80',
  'Simulation':   '#facc15',
  'Warehouse':    '#67e8f9',
  'Master Data':  '#94a3b8',
  'Option Listing':'#f97316',
}

function DownloadedFilesPanel() {
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [refreshAllState, setRefreshAllState] = useState<'idle' | 'running' | 'done'>('idle')
  const [files, setFiles] = useState<OutputFile[]>([])
  const [loading, setLoading] = useState(false)
  const [wins, setWins] = useState<Record<string, DlWinState>>({})
  const [activeWin, setActiveWin] = useState<string | null>(null)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [mdStatus,      setMdStatus]      = useState<Record<string, 'idle' | 'adding' | 'done' | 'exists'>>({})
  const [refreshStatus, setRefreshStatus] = useState<Record<string, 'idle' | 'refreshing' | 'done' | 'error'>>({})
  const [removeStatus,  setRemoveStatus]  = useState<Record<string, 'idle' | 'removing'>>({})
  const [sqlOpen,       setSqlOpen]       = useState<Record<string, boolean>>({})
  const [sqlDraft,      setSqlDraft]      = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'idle' | 'refreshing' | 'removing'>('idle')
  type SortKey = 'name' | 'rows' | 'size' | 'age' | 'freq'
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [freqFilter, setFreqFilter] = useState<'all' | 'daily' | 'weekly' | 'once'>('all')

  type RefreshFreq = 'daily' | 'weekly' | 'once'
  const FREQ_CYCLE: RefreshFreq[] = ['daily', 'weekly', 'once']
  const FREQ_LABEL: Record<RefreshFreq, string> = { daily: '⟳ Daily', weekly: '⟳ Weekly', once: '— Once' }
  const FREQ_COLOR: Record<RefreshFreq, string> = { daily: '#38bdf8', weekly: '#fbbf24', once: '#64748b' }

  const [freqMap, setFreqMap] = useState<Record<string, RefreshFreq>>({})
  const [autoTime, setAutoTime] = useState<string>('06:00')
  const [autoRunLog, setAutoRunLog] = useState<string | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)

  // Load freq map + schedule time from backend on mount
  useEffect(() => {
    http.get('/database/output/freq').then(r => {
      if (r.data.success) setFreqMap(r.data.data.freq_map ?? {})
    }).catch(() => {
      // fallback to localStorage if backend fails
      try { setFreqMap(JSON.parse(localStorage.getItem('db_refresh_freq') ?? '{}')) } catch {}
    })
    http.get('/database/output/schedule').then(r => {
      if (r.data.success) setAutoTime(r.data.data.time ?? '06:00')
    }).catch(() => {
      try { setAutoTime(localStorage.getItem('db_auto_refresh_time') ?? '06:00') } catch {}
    })
  }, [])

  async function saveAutoTime(t: string) {
    setAutoTime(t)
    try { await http.put('/database/output/schedule', { time: t }) } catch {
      try { localStorage.setItem('db_auto_refresh_time', t) } catch {}
    }
  }

  function cycleFreq(key: string) {
    const [owner, obj] = key.split('__')
    setFreqMap(prev => {
      const cur = prev[key] ?? 'once'
      const next = FREQ_CYCLE[(FREQ_CYCLE.indexOf(cur) + 1) % FREQ_CYCLE.length]
      const updated = { ...prev, [key]: next }
      // Persist to backend (fire-and-forget)
      http.post('/database/output/freq', { owner, object_name: obj, freq: next }).catch(() => {
        try { localStorage.setItem('db_refresh_freq', JSON.stringify(updated)) } catch {}
      })
      return updated
    })
  }

  async function addToMasterData(owner: string, obj: string) {
    const key = `${owner}__${obj}`
    if (mdStatus[key] === 'adding' || mdStatus[key] === 'done') return
    setMdStatus(prev => ({ ...prev, [key]: 'adding' }))
    try {
      const res = await http.post('/master/custom', {
        schema_owner: owner,
        object_name: obj,
        label: `${owner}.${obj}`,
      })
      setMdStatus(prev => ({ ...prev, [key]: res.data.success ? 'done' : 'exists' }))
    } catch {
      setMdStatus(prev => ({ ...prev, [key]: 'exists' }))
    }
  }

  async function refreshFile(owner: string, obj: string) {
    const key = `${owner}__${obj}`
    if (refreshStatus[key] === 'refreshing') return
    setRefreshStatus(prev => ({ ...prev, [key]: 'refreshing' }))
    setAutoRunLog(`⟳ Refreshing ${owner}.${obj}…`)
    try {
      // Start background refresh
      await http.post(`/database/output/refresh/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}`)
      // Poll status every 3s
      const poll = setInterval(async () => {
        try {
          const r = await http.get(`/database/output/refresh-status/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}`)
          const st = r.data?.data?.status
          const rows = r.data?.data?.rows
          const err = r.data?.data?.error
          if (st === 'done') {
            clearInterval(poll)
            setRefreshStatus(prev => ({ ...prev, [key]: 'done' }))
            setAutoRunLog(`✓ ${owner}.${obj} refreshed — ${rows?.toLocaleString() ?? '?'} rows`)
            loadList()
            setTimeout(() => { setRefreshStatus(prev => ({ ...prev, [key]: 'idle' })); setAutoRunLog('') }, 4000)
          } else if (st === 'error') {
            clearInterval(poll)
            setRefreshStatus(prev => ({ ...prev, [key]: 'error' }))
            setAutoRunLog(`✗ ${owner}.${obj} failed: ${err}`)
            setTimeout(() => setRefreshStatus(prev => ({ ...prev, [key]: 'idle' })), 4000)
          } else {
            setAutoRunLog(`⟳ Refreshing ${owner}.${obj}… (running)`)
          }
        } catch { /* ignore poll error */ }
      }, 3000)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed'
      setRefreshStatus(prev => ({ ...prev, [key]: 'error' }))
      setAutoRunLog(`✗ ${owner}.${obj}: ${msg}`)
      setTimeout(() => setRefreshStatus(prev => ({ ...prev, [key]: 'idle' })), 4000)
    }
  }

  async function removeFile(owner: string, obj: string) {
    const key = `${owner}__${obj}`
    if (!confirm(`Remove "${owner}.${obj}" from Downloaded Files?\nThe Parquet file will be deleted.`)) return
    setRemoveStatus(prev => ({ ...prev, [key]: 'removing' }))
    try {
      await http.delete(`/database/output/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}`)
    } catch { /* ignore — remove from UI regardless */ }
    setFiles(prev => prev.filter(f => !(f.owner === owner && f.object === obj)))
    setRemoveStatus(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  const [listError, setListError] = useState<string | null>(null)

  function loadList() {
    setLoading(true)
    setListError(null)
    http.get('/database/output/list', { timeout: 10000 })
      .then(res => { if (res.data.success) setFiles(res.data.data.files ?? []) })
      .catch(err => {
        setFiles([])
        const msg = err?.response?.data?.message || err?.message || 'Backend unreachable'
        setListError(msg)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadList() }, [])

  async function loadWinData(key: string, owner: string, obj: string, limit: number, fileRows: number, label: string) {
    setWins(p => ({ ...p, [key]: { ...(p[key] ?? { columns: [], records: [], error: null, limit, label, rows: fileRows }), loading: true, error: null } }))
    try {
      const res = await http.get(`/database/table/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}/preview?limit=${limit}`, { timeout: 30000 })
      if (res.data.success) {
        setWins(p => ({ ...p, [key]: { ...p[key], columns: res.data.data.columns ?? [], records: res.data.data.records ?? [], loading: false } }))
      } else {
        setWins(p => ({ ...p, [key]: { ...p[key], loading: false, error: res.data.message || 'Error' } }))
      }
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown; message?: unknown } } })?.response?.data?.detail
        ?? (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
        ?? (err as { message?: string })?.message ?? 'Request failed.'
      const msg = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? (raw as { msg?: string }[]).map(e => e?.msg ?? JSON.stringify(e)).join('; ')
        : JSON.stringify(raw)
      setWins(p => ({ ...p, [key]: { ...p[key], loading: false, error: msg } }))
    }
  }

  async function openWindow(f: OutputFile) {
    const key = `${f.owner}__${f.object}`
    const label = `${f.owner}.${f.object}`
    if (activeWin === key) { setActiveWin(null); return }
    setActiveWin(key)
    if (!wins[key]) {
      const limit = Math.min(f.rows, 2000)
      setWins(p => ({ ...p, [key]: { columns: [], records: [], loading: false, error: null, limit, label, rows: f.rows } }))
      await loadWinData(key, f.owner, f.object, limit, f.rows, label)
    }
  }

  function closeWindow(key: string) {
    setWins(p => { const n = { ...p }; delete n[key]; return n })
    if (activeWin === key) setActiveWin(null)
  }

  function downloadCsv(owner: string, obj: string) {
    http.get(`/database/output/download/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}`, {
      responseType: 'blob', timeout: 60000,
    }).then(res => {
      const blobUrl = window.URL.createObjectURL(new Blob([res.data as BlobPart]))
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${owner}__${obj}.csv`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(blobUrl)
    }).catch(() => alert('Download failed. Try refreshing the file first.'))
  }

  const fmtSize = (b: number) => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1024).toFixed(0)} KB`

  const FREQ_BORDER: Record<RefreshFreq, string> = { daily: '#185FA5', weekly: '#854F0B', once: '#334155' }
  const FREQ_BG: Record<RefreshFreq, string>     = { daily: '#0c2340', weekly: '#1c0f02', once: '#0f172a' }

  function isStale(f: OutputFile): boolean {
    const freq = freqMap[`${f.owner}__${f.object}`] ?? 'once'
    const ageMs = Date.now() - new Date(f.fetched_at).getTime()
    if (freq === 'daily'  && ageMs > 86_400_000) return true
    if (freq === 'weekly' && ageMs > 604_800_000) return true
    return false
  }

  const totalSize = files.reduce((s, f) => s + f.size_bytes, 0)
  const fmtTotalSize = totalSize > 1073741824
    ? `${(totalSize / 1073741824).toFixed(1)} GB`
    : totalSize > 1048576 ? `${(totalSize / 1048576).toFixed(0)} MB` : `${(totalSize / 1024).toFixed(0)} KB`
  const staleCount  = files.filter(f => isStale(f)).length

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(a => !a)
    else { setSortKey(k); setSortAsc(true) }
  }

  const FREQ_ORDER: Record<RefreshFreq, number> = { daily: 0, weekly: 1, once: 2 }

  const filteredFiles = files
    .filter(f => {
      const key = `${f.owner}__${f.object}`
      if (freqFilter !== 'all' && (freqMap[key] ?? 'once') !== freqFilter) return false
      if (fileFilter.trim() && !`${f.owner}.${f.object}`.toLowerCase().includes(fileFilter.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      const ak = `${a.owner}__${a.object}`, bk = `${b.owner}__${b.object}`
      let cmp = 0
      if (sortKey === 'name')  cmp = `${a.owner}.${a.object}`.localeCompare(`${b.owner}.${b.object}`)
      else if (sortKey === 'rows') cmp = a.rows - b.rows
      else if (sortKey === 'size') cmp = a.size_bytes - b.size_bytes
      else if (sortKey === 'age')  cmp = new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
      else if (sortKey === 'freq') cmp = FREQ_ORDER[freqMap[ak] ?? 'once'] - FREQ_ORDER[freqMap[bk] ?? 'once']
      return sortAsc ? cmp : -cmp
    })

  function toggleSelect(key: string) {
    setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }
  function toggleAll() {
    if (selected.size === filteredFiles.length) setSelected(new Set())
    else setSelected(new Set(filteredFiles.map(f => `${f.owner}__${f.object}`)))
  }

  async function bulkRefresh() {
    const keys = [...selected]
    setBulkAction('refreshing')
    for (const key of keys) {
      const [owner, obj] = key.split('__')
      await refreshFile(owner, obj).catch(() => {})
    }
    setBulkAction('idle')
    setSelected(new Set())
  }

  async function bulkRemove() {
    if (!confirm(`Remove ${selected.size} file(s)?`)) return
    setBulkAction('removing')
    for (const key of [...selected]) {
      const [owner, obj] = key.split('__')
      try { await http.delete(`/database/output/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}`) } catch { /* ignore */ }
      setFiles(prev => prev.filter(f => !(f.owner === owner && f.object === obj)))
    }
    setBulkAction('idle')
    setSelected(new Set())
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} style={{
      padding: '2px 8px', fontSize: 9, fontWeight: 600, border: '0.5px solid #1e293b',
      borderRadius: 4, background: sortKey === k ? '#0f2a3f' : 'transparent',
      color: sortKey === k ? '#38bdf8' : '#475569', cursor: 'pointer', whiteSpace: 'nowrap' as const,
    }}>
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </button>
  )

  const chipStyle = (active: boolean, color: string) => ({
    padding: '2px 8px', fontSize: 9, fontWeight: 600, borderRadius: 10,
    border: `1px solid ${active ? color : '#1e293b'}`,
    background: active ? `${color}22` : 'transparent',
    color: active ? color : '#475569', cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  const actBtn = (color: string) => ({
    padding: '2px 7px', fontSize: 9, fontWeight: 700, borderRadius: 4,
    border: `1px solid ${color}44`, background: 'transparent', color, cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Toolbar */}
      {files.length > 0 && (
        <div style={{ overflowX: 'auto', flexShrink: 0, borderBottom: '1px solid #1e293b', marginBottom: 4 }}>
        <div style={{ display: 'flex', flexWrap: 'nowrap' as const, gap: 4, alignItems: 'center', padding: '4px 2px 6px', minWidth: 'max-content' }}>
          {/* Select-all */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, userSelect: 'none' as const, marginRight: 2 }}>
            <input type="checkbox"
              checked={filteredFiles.length > 0 && selected.size === filteredFiles.length}
              onChange={toggleAll}
              style={{ accentColor: '#38bdf8', width: 11, height: 11 }}
            />
            ALL
          </label>

          {/* Sort buttons */}
          <SortBtn k="name" label="Name" />
          <SortBtn k="rows" label="Rows" />
          <SortBtn k="size" label="Size" />
          <SortBtn k="age"  label="Age"  />
          <SortBtn k="freq" label="Freq" />

          <div style={{ width: 1, height: 14, background: 'var(--card-bg)', margin: '0 2px' }} />

          {/* Freq filter chips */}
          {(['all','daily','weekly','once'] as const).map(f => (
            <button key={f} onClick={() => setFreqFilter(f)}
              style={chipStyle(freqFilter === f, f === 'daily' ? '#38bdf8' : f === 'weekly' ? '#fbbf24' : f === 'once' ? '#64748b' : '#7dd3fc')}>
              {f === 'all' ? 'All' : f === 'daily' ? '⟳ Daily' : f === 'weekly' ? '⟳ Weekly' : '— Once'}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Search */}
          <input value={fileFilter} onChange={e => setFileFilter(e.target.value)} placeholder="Filter…"
            style={{ padding: '2px 8px', fontSize: 10, background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', width: 110 }} />

          {/* Bulk actions (visible when selection exists) */}
          {selected.size > 0 && (
            <>
              <button onClick={bulkRefresh} disabled={bulkAction !== 'idle'} style={actBtn('#a78bfa')}>
                {bulkAction === 'refreshing' ? '↻…' : `↻ (${selected.size})`}
              </button>
              <button onClick={bulkRemove} disabled={bulkAction !== 'idle'} style={actBtn('#f87171')}>
                {bulkAction === 'removing' ? '…' : `✕ (${selected.size})`}
              </button>
            </>
          )}

          {/* Stats summary */}
          <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' as const }}>
            {filteredFiles.length}/{files.length} · {fmtTotalSize}
            {staleCount > 0 && <span style={{ color: '#f87171' }}> · ⚠{staleCount}</span>}
          </span>

          <button onClick={loadList} style={{ fontSize: 9, color: '#7dd3fc', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: '0 2px' }} title="Reload list">↻</button>

          {/* Auto-refresh time setting */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderLeft: '1px solid #1e293b', paddingLeft: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' as const }}>Auto:</span>
            <input
              type="time"
              value={autoTime}
              onChange={e => saveAutoTime(e.target.value)}
              style={{ fontSize: 9, padding: '1px 4px', background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: '#38bdf8', outline: 'none', cursor: 'pointer', width: 72 }}
              title="Auto-refresh time for Daily files"
            />
            {autoRunning && <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 700 }}>⟳</span>}
          </div>

          {/* Admin: Refresh All Daily button */}
          {isAdmin && (
            <button
              disabled={refreshAllState === 'running'}
              onClick={async () => {
                setRefreshAllState('running')
                try {
                  const r = await http.post('/database/output/refresh-all')
                  if (r.data.success) {
                    setAutoRunLog(`⟳ Refresh All started — ${r.data.data?.daily_count ?? '?'} files. Check back in ~2 min.`)
                    setRefreshAllState('done')
                    setTimeout(() => setRefreshAllState('idle'), 5000)
                  } else {
                    setAutoRunLog(`✗ ${r.data.message}`)
                    setRefreshAllState('idle')
                  }
                } catch {
                  setAutoRunLog('✗ Refresh All failed')
                  setRefreshAllState('idle')
                }
              }}
              style={{
                fontSize: 9, fontWeight: 700, padding: '2px 8px',
                background: refreshAllState === 'running' ? '#1e293b' : '#1e3a5f',
                border: '1px solid #2563eb', borderRadius: 4,
                color: refreshAllState === 'running' ? '#64748b' : '#60a5fa',
                cursor: refreshAllState === 'running' ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap' as const,
              }}
              title="Refresh all Daily-freq files from Oracle now (Admin only)"
            >
              {refreshAllState === 'running' ? '⟳ Running…' : refreshAllState === 'done' ? '✓ Started' : '⚡ Refresh All Daily'}
            </button>
          )}
        </div>
        </div>
      )}

      {/* Auto-refresh log banner */}
      {autoRunLog && (
        <div style={{ fontSize: 10, color: autoRunLog.startsWith('✓') ? '#4ade80' : '#fbbf24', background: '#0c1628', border: '1px solid var(--card-border)', borderRadius: 4, padding: '4px 10px', marginBottom: 4, flexShrink: 0 }}>
          {autoRunLog}
        </div>
      )}

      {/* File list — Table style (Master Data look) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid var(--card-border)', borderRadius: 8, background: 'var(--card-bg)' }}>
        {loading && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '16px', textAlign: 'center' }}>Loading…</div>}
        {!loading && listError && (
          <div style={{ fontSize: 11, padding: '24px', textAlign: 'center' }}>
            <div style={{ color: '#f87171', marginBottom: 8 }}>⚠ Could not load files: {listError}</div>
            <button onClick={loadList} style={{ fontSize: 11, padding: '4px 14px', borderRadius: 5, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>↺ Retry</button>
          </div>
        )}
        {!loading && !listError && files.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '32px 0', textAlign: 'center' }}>
            No files yet. Admin can download tables/views using Data Preview or SQL Query &amp; Export.
          </div>
        )}
        {!loading && filteredFiles.length === 0 && files.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>No match</div>
        )}
        {filteredFiles.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1000, fontSize: 12, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 28 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 200 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 200 }} />
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
              <tr>
                {[['', ''], ['NAME', 'name'], ['ROWS', 'rows'], ['SIZE', 'size'], ['AGE', 'age'], ['FREQ', 'freq'], ['SOURCE', ''], ['USED IN', ''], ['ACTIONS', '']].map(([label, key]) => (
                  <th key={label} onClick={key ? () => toggleSort(key as SortKey) : undefined}
                    style={{
                      padding: '7px 10px', fontSize: 10, fontWeight: 700,
                      color: sortKey === key ? '#38bdf8' : '#475569',
                      textAlign: 'left', letterSpacing: '.05em', textTransform: 'uppercase',
                      borderBottom: `2px solid ${sortKey === key ? '#38bdf8' : '#334155'}`,
                      background: sortKey === key ? '#0c1829' : '#0f172a',
                      whiteSpace: 'nowrap', cursor: key ? 'pointer' : 'default',
                      userSelect: 'none',
                    }}>
                    {label}
                    {sortKey === key && <span style={{ marginLeft: 3, fontSize: 8 }}>{sortAsc ? '▲' : '▼'}</span>}
                    {key && sortKey !== key && label && <span style={{ marginLeft: 3, opacity: 0.25, fontSize: 8 }}>⇅</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
        {filteredFiles.map(f => {
          const key = `${f.owner}__${f.object}`
          const isOpen = !!wins[key]
          const mdSt  = mdStatus[key]      ?? 'idle'
          const rfSt  = refreshStatus[key] ?? 'idle'
          const rmSt  = removeStatus[key]  ?? 'idle'
          const freq: RefreshFreq = freqMap[key] ?? 'once'
          const stale = isStale(f)
          const isSel = selected.has(key)

          const mdColor: Record<string, string> = { idle: '#38bdf8', adding: '#64748b', done: '#4ade80', exists: '#fbbf24' }
          const rfColor: Record<string, string> = { idle: '#a78bfa', refreshing: '#64748b', done: '#4ade80', error: '#f87171' }

          const rowBg = isSel ? 'rgba(56,189,248,.07)' : isOpen ? 'rgba(56,189,248,.04)' : 'transparent'
          const TD: React.CSSProperties = {
            padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)',
            borderBottom: '1px solid #1e293b', verticalAlign: 'middle',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: rowBg,
          }

          return (
            <Fragment key={key}>
              <tr style={{ borderLeft: `3px solid ${isSel ? '#38bdf8' : stale ? '#f87171' : FREQ_BORDER[freq]}` }}>
                {/* Checkbox */}
                <td style={{ ...TD, padding: '8px 6px', textAlign: 'center' }}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleSelect(key)}
                    style={{ accentColor: '#38bdf8', width: 12, height: 12, cursor: 'pointer' }} />
                </td>

                {/* Name */}
                <td style={{ ...TD, color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 600 }}
                  title={`${f.owner}.${f.object}`}>
                  {stale && <span title="Stale" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f87171', marginRight: 6, verticalAlign: 'middle' }} />}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{f.owner}.</span>
                  <span style={{ color: '#7dd3fc' }}>{f.object}</span>
                  {f.owner === 'QUERY' && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text-muted)', background: 'var(--content-bg)', padding: '1px 5px', borderRadius: 6, border: '1px solid var(--card-border)' }}>query</span>}
                </td>

                {/* Rows */}
                <td style={{ ...TD, color: 'var(--text-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {f.rows.toLocaleString()}
                </td>

                {/* Size */}
                <td style={{ ...TD, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtSize(f.size_bytes)}
                </td>

                {/* Age */}
                <td style={{ ...TD, color: stale ? '#f87171' : 'var(--text-muted)' }}>
                  {f.age_label}
                </td>

                {/* Freq badge */}
                <td style={{ ...TD }}>
                  <button onClick={() => cycleFreq(key)} title="Click to cycle frequency"
                    style={{ padding: '3px 10px', fontSize: 10, fontWeight: 700, borderRadius: 8,
                      border: `1px solid ${FREQ_COLOR[freq]}55`, color: FREQ_COLOR[freq],
                      background: `${FREQ_COLOR[freq]}15`, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {FREQ_LABEL[freq]}
                  </button>
                </td>

                {/* Source */}
                {(() => {
                  const src = getFileSource(f.owner, f.object)
                  return (
                    <td style={{ ...TD }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                        border: `1px solid ${src.color}44`, color: src.color, background: `${src.color}15`,
                        whiteSpace: 'nowrap' }}>
                        {src.label}
                      </span>
                    </td>
                  )
                })()}

                {/* Used In */}
                <td style={{ ...TD, overflow: 'visible' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(USED_IN[key] ?? []).length === 0
                      ? <span style={{ fontSize: 9, color: '#475569', fontStyle: 'italic' }}>—</span>
                      : (USED_IN[key] ?? []).map(page => (
                          <span key={page} style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                            border: `1px solid ${PAGE_CHIP_COLOR[page] ?? '#64748b'}44`,
                            color: PAGE_CHIP_COLOR[page] ?? '#94a3b8',
                            background: `${PAGE_CHIP_COLOR[page] ?? '#64748b'}12`,
                            whiteSpace: 'nowrap',
                          }}>{page}</span>
                        ))
                    }
                  </div>
                </td>

                {/* Actions */}
                <td style={{ ...TD }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button onClick={() => openWindow(f)} title="View"
                      style={{ ...actBtn('#7dd3fc'), background: isOpen ? '#0f2a3f' : 'transparent', padding: '3px 9px', fontSize: 10 }}>
                      {isOpen ? '▼ View' : '👁 View'}
                    </button>
                    {f.owner === 'QUERY' && (
                      <button
                        onClick={() => {
                          const open = !sqlOpen[key]
                          setSqlOpen(p => ({ ...p, [key]: open }))
                          if (open && !sqlDraft[key]) setSqlDraft(p => ({ ...p, [key]: f.sql_text ?? '' }))
                        }}
                        title="Edit SQL query"
                        style={{ ...actBtn('#fbbf24'), background: sqlOpen[key] ? '#1c1200' : 'transparent', padding: '3px 9px', fontSize: 10 }}>
                        {sqlOpen[key] ? '▼ SQL' : '✎ SQL'}
                      </button>
                    )}
                    <button onClick={() => downloadCsv(f.owner, f.object)} title="Download CSV"
                      style={{ ...actBtn('#4ade80'), padding: '3px 9px', fontSize: 10 }}>⬇ CSV</button>
                    <button onClick={() => addToMasterData(f.owner, f.object)} disabled={mdSt === 'adding' || mdSt === 'done'} title="Add to Master Data"
                      style={{ ...actBtn(mdColor[mdSt]), padding: '3px 9px', fontSize: 10 }}>
                      {mdSt === 'idle' ? '+MD' : mdSt === 'adding' ? '…' : mdSt === 'done' ? '✓ MD' : '⚠'}
                    </button>
                    <button onClick={() => refreshFile(f.owner, f.object)} disabled={rfSt === 'refreshing'} title="Re-fetch from Oracle"
                      style={{ ...actBtn(rfColor[rfSt]), padding: '3px 9px', fontSize: 10 }}>
                      {rfSt === 'refreshing' ? '↻…' : '↻'}
                    </button>
                    <button onClick={() => removeFile(f.owner, f.object)} disabled={rmSt === 'removing'} title="Delete file"
                      style={{ ...actBtn('#f87171'), padding: '3px 9px', fontSize: 10 }}>
                      {rmSt === 'removing' ? '…' : '✕'}
                    </button>
                  </div>
                </td>
              </tr>

              {/* Inline SQL editor (QUERY rows only) */}
              {f.owner === 'QUERY' && sqlOpen[key] && (() => {
                const draft = sqlDraft[key] ?? f.sql_text ?? ''
                const saving = rfSt === 'refreshing'
                async function saveAndRun() {
                  if (!draft.trim()) return
                  try {
                    await http.patch(
                      `/database/output/${encodeURIComponent(f.owner)}/${encodeURIComponent(f.object)}/sql`,
                      { sql_text: draft.trim() }
                    )
                    setFiles(prev => prev.map(x =>
                      x.owner === f.owner && x.object === f.object ? { ...x, sql_text: draft.trim() } : x
                    ))
                  } catch { /* ignore save error, still try refresh */ }
                  await refreshFile(f.owner, f.object)
                }
                return (
                  <tr>
                    <td colSpan={9} style={{ padding: 0, borderBottom: '1px solid #253050' }}>
                      <div style={{ background: '#060d1a', padding: '10px 14px', borderLeft: '3px solid #fbbf24' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#fbbf24', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                          SQL Query — {f.owner}.{f.object}
                        </div>
                        <textarea
                          value={draft}
                          onChange={e => setSqlDraft(p => ({ ...p, [key]: e.target.value }))}
                          rows={4}
                          placeholder="Enter SQL query…"
                          style={{
                            width: '100%', background: '#030810', border: '1px solid #253761',
                            borderRadius: 5, padding: '8px 10px', fontSize: 11,
                            fontFamily: "'Cascadia Code','Fira Code','SF Mono',monospace",
                            color: '#7dd3fc', outline: 'none', resize: 'vertical',
                            lineHeight: 1.7, boxSizing: 'border-box',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          <button
                            onClick={saveAndRun}
                            disabled={saving || !draft.trim()}
                            style={{
                              padding: '5px 16px', background: saving ? '#1e293b' : '#1a3a5c',
                              color: saving ? '#64748b' : '#38bdf8',
                              border: `1px solid ${saving ? '#334155' : '#2563eb'}`,
                              borderRadius: 5, fontSize: 11, fontWeight: 700,
                              cursor: saving || !draft.trim() ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {saving ? '↻ Running…' : '▶ Save & Run'}
                          </button>
                          {f.sql_text && draft !== f.sql_text && (
                            <button
                              onClick={() => setSqlDraft(p => ({ ...p, [key]: f.sql_text ?? '' }))}
                              style={{ padding: '5px 10px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--card-border)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}
                            >Reset</button>
                          )}
                          <span style={{ fontSize: 10, color: rfSt === 'done' ? '#4ade80' : rfSt === 'error' ? '#f87171' : 'var(--text-muted)', marginLeft: 4 }}>
                            {rfSt === 'done' ? '✓ Refreshed' : rfSt === 'error' ? '✗ Failed' : ''}
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })()}

              {/* View data window inline */}
              {isOpen && !sqlOpen[key] && (
                <tr><td colSpan={9} style={{ padding: 0, borderBottom: '1px solid #1e293b' }} /></tr>
              )}
            </Fragment>
          )
        })}
            </tbody>
          </table>
        )}
      </div>

      {/* Downloaded Files expanded panel popup */}
      {panelExpanded && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'stretch' }}
          onClick={e => { if (e.target === e.currentTarget) setPanelExpanded(false) }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />
          <div style={{
            position: 'relative',
            margin: isMobile ? '0' : '32px auto',
            width: isMobile ? '100vw' : 'min(96vw, 1200px)',
            height: isMobile ? '100dvh' : undefined,
            borderRadius: isMobile ? 0 : 12,
            background: '#0c1628', border: '1px solid var(--card-border)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,.75)', zIndex: 1,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#0a1220', flexWrap: 'wrap' as const }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>📁 Downloaded Files</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{files.length} files</span>
              <input value={fileFilter} onChange={e => setFileFilter(e.target.value)}
                placeholder="🔍 Search table name…"
                style={{ flex: 1, minWidth: 120, background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '5px 10px', outline: 'none' }} />
              <button onClick={() => { setPanelExpanded(false); setFileFilter('') }}
                style={{ width: 28, height: 28, border: '1px solid var(--card-border)', borderRadius: 5, background: '#1e2030', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>
            {/* Column headers — hidden on mobile */}
            {!isMobile && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 100px 340px', gap: 6, padding: '6px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#080f1a' }}>
                {['TABLE / QUERY', 'ROWS', 'SIZE', 'DOWNLOADED', 'ACTIONS'].map(h => (
                  <span key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.07em', textTransform: 'uppercase' }}>{h}</span>
                ))}
              </div>
            )}
            {/* File list */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              {files
                .filter(f => !fileFilter || `${f.owner}.${f.object}`.toLowerCase().includes(fileFilter.toLowerCase()))
                .map(f => {
                  const rowKey = `${f.owner}__${f.object}`
                  const isOpen = !!wins[rowKey]
                  const mdSt  = mdStatus[rowKey]      ?? 'idle'
                  const rfSt  = refreshStatus[rowKey] ?? 'idle'
                  const rmSt  = removeStatus[rowKey]  ?? 'idle'
                  const mdLabel: Record<string, string> = { idle: '＋ MD', adding: '…', done: '✓ MD', exists: '⚠ MD' }
                  const rfLabel: Record<string, string> = { idle: '↻ Refresh', refreshing: '↻…', done: '✓ Done', error: '✕ Failed' }
                  const mdColor: Record<string, string> = { idle: '#38bdf8', adding: '#64748b', done: '#4ade80', exists: '#fbbf24' }
                  const rfColor: Record<string, string> = { idle: '#a78bfa', refreshing: '#64748b', done: '#4ade80', error: '#f87171' }
                  return (
                    <div key={rowKey} style={{
                      display: isMobile ? 'flex' : 'grid',
                      gridTemplateColumns: isMobile ? undefined : '1fr 90px 70px 100px 340px',
                      flexDirection: isMobile ? 'column' as const : undefined,
                      gap: isMobile ? 6 : 6,
                      alignItems: isMobile ? undefined : 'center',
                      padding: isMobile ? '10px 14px' : '6px 16px',
                      borderBottom: '1px solid #1e293b',
                      background: isOpen ? '#0c1a30' : 'transparent',
                    }}>
                      {/* Table name — always visible */}
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all' as const, fontWeight: 600 }}>
                        {f.owner}.{f.object}
                      </span>
                      {/* Meta info — inline on mobile, separate columns on desktop */}
                      {isMobile
                        ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.rows.toLocaleString()} rows · {fmtSize(f.size_bytes)} · {f.age_label}</span>
                        : <>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{f.rows.toLocaleString()}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtSize(f.size_bytes)}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{f.age_label}</span>
                          </>
                      }
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
                        <button onClick={() => openWindow(f)}
                          style={{ padding: '5px 12px', background: isOpen ? '#0f2a3f' : '#1e293b', color: '#7dd3fc', border: '1px solid var(--card-border)', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {isOpen ? '👁 View ✓' : '👁 View'}
                        </button>
                        <button onClick={() => downloadCsv(f.owner, f.object)}
                          style={{ padding: '5px 12px', background: '#14532d', color: '#4ade80', border: '1px solid #166534', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>⬇ CSV</button>
                        <button onClick={() => addToMasterData(f.owner, f.object)} disabled={mdSt === 'adding' || mdSt === 'done'}
                          style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: (mdSt === 'adding' || mdSt === 'done') ? 'default' : 'pointer', color: mdColor[mdSt], background: 'transparent', border: `1px solid ${mdColor[mdSt]}33` }}>
                          {mdLabel[mdSt]}
                        </button>
                        <button onClick={() => refreshFile(f.owner, f.object)} disabled={rfSt === 'refreshing'}
                          style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', cursor: rfSt === 'refreshing' ? 'default' : 'pointer', color: rfColor[rfSt], background: 'transparent', border: `1px solid ${rfColor[rfSt]}44` }}>
                          {rfLabel[rfSt]}
                        </button>
                        <button onClick={() => removeFile(f.owner, f.object)} disabled={rmSt === 'removing'}
                          style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: rmSt === 'removing' ? 'default' : 'pointer', color: '#f87171', background: 'transparent', border: '1px solid rgba(248,113,113,.3)' }}>
                          {rmSt === 'removing' ? '…' : '✕ Remove'}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      {/* Active floating popup */}
      {activeWin && wins[activeWin] && (() => {
        const win = wins[activeWin]
        const btnSt: React.CSSProperties = { width: 24, height: 24, border: '1px solid var(--card-border)', borderRadius: 4, background: '#1e2030', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }
        const { columns, records, loading: wLoading, error, limit, label, rows } = win
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'stretch' }}
            onClick={e => { if (e.target === e.currentTarget) setActiveWin(null) }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
            <div style={{ position: 'relative', margin: '28px auto', width: 'min(96vw, 1300px)', background: '#0c1628', border: '1px solid #1e40af55', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,.7)', zIndex: 1 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#0a1220' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#38bdf8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{rows.toLocaleString()} rows · {columns.length} cols</span>
                {/* limit selector */}
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Show</label>
                <select value={limit} onChange={e => {
                  const nl = Number(e.target.value)
                  setWins(p => ({ ...p, [activeWin]: { ...p[activeWin], limit: nl } }))
                  const [owner, ...rest] = activeWin.split('__')
                  loadWinData(activeWin, owner, rest.join('__'), nl, rows, label)
                }} style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4, color: 'var(--text-secondary)', fontSize: 11, padding: '2px 6px' }}>
                  {[100, 200, 500, 1000, 2000].concat(rows <= 2000 ? [] : []).map(n => <option key={n} value={n}>{n}</option>)}
                  {rows <= 2000 && <option value={rows}>{rows.toLocaleString()} (all)</option>}
                </select>
                <button title="Minimize" onClick={() => setActiveWin(null)} style={btnSt}>▬</button>
                <button title="Close" onClick={() => closeWindow(activeWin)} style={{ ...btnSt, color: 'var(--text-secondary)' }}>✕</button>
              </div>
              {/* Body */}
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {error && <div style={{ padding: 20, color: '#f87171', fontSize: 12 }}>{error}</div>}
                {!error && (
                  <DataGrid records={records} columns={columns} loading={wLoading} loadingMessage="Loading…" />
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Minimized taskbar */}
      {Object.keys(wins).filter(k => k !== activeWin).length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, display: 'flex', gap: 4, alignItems: 'flex-end', padding: '0 8px' }}>
          {Object.keys(wins).filter(k => k !== activeWin).map(wk => {
            const w = wins[wk]
            return (
              <div key={wk} onClick={() => setActiveWin(wk)}
                style={{ background: '#131e30', border: '1.5px solid #38bdf855', borderBottom: 'none', borderRadius: '8px 8px 0 0', flex: '1 1 0', minWidth: 80, maxWidth: 280, cursor: 'pointer', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 8px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{w.label}</span>
                  {!w.loading && <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{w.rows.toLocaleString()}</span>}
                  {w.loading && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>…</span>}
                  <button title="Restore" onClick={e => { e.stopPropagation(); setActiveWin(wk) }}
                    style={{ width: 20, height: 20, border: '1px solid var(--card-border)', borderRadius: 4, background: '#1e2030', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>▲</button>
                  <button title="Close" onClick={e => { e.stopPropagation(); closeWindow(wk) }}
                    style={{ width: 20, height: 20, border: '1px solid var(--card-border)', borderRadius: 4, background: '#1e2030', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Search overlay ────────────────────────────────────────────────────────────

function GlobalSearch({ onSelect }: { onSelect: (owner: string, name: string, type: 'TABLE' | 'VIEW') => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<import('@/types/api').SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  const doSearch = useCallback(() => {
    if (q.length < 2) return
    setLoading(true)
    api
      .searchObjects(q, { limit: 50 })
      .then(r => {
        if (r.success && r.data) setResults(r.data.results)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [q])

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doSearch()}
          placeholder="Search across all schemas (Enter to search)…"
          style={{
            width: '100%',
            background: 'var(--content-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
      <button
        onClick={doSearch}
        style={{
          padding: '8px 18px',
          background: '#1d4ed8',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {loading ? '…' : 'Search'}
      </button>

      {results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            left: 0,
            right: 80,
            background: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: 6,
            zIndex: 100,
            maxHeight: 300,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {results.map(r => (
            <div
              key={`${r.owner}.${r.object_name}`}
              onClick={() => {
                onSelect(r.owner, r.object_name, r.object_type as 'TABLE' | 'VIEW')
                setResults([])
                setQ('')
              }}
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid #0f172a',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {r.owner}.{r.object_name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.object_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DatabaseExplorer() {
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const [selectedSchema, setSelectedSchema] = useState('')
  const [objectType, setObjectType] = useState<ObjType>('TABLE')
  const [selectedName, setSelectedName] = useState('')
  const [selectedType, setSelectedType] = useState<ObjType>('TABLE')
  const [mobilePanelTab, setMobilePanelTab] = useState(0)
  const [mainTab, setMainTab] = useState<'explorer' | 'downloads' | 'masterdata'>('explorer')

  const handleObjectSelect = (name: string, type: ObjType) => {
    setSelectedName(name)
    setSelectedType(type)
  }

  const handleSearchSelect = (owner: string, name: string, type: 'TABLE' | 'VIEW') => {
    setSelectedSchema(owner)
    setObjectType(type)
    setSelectedName(name)
    setSelectedType(type)
  }

  const handleSchemaSelect = (schema: string) => {
    setSelectedSchema(schema)
    setSelectedName('')
  }

  const TAB_STYLE = (active: boolean) => ({
    padding: '7px 18px', fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? '#38bdf8' : '#64748b',
    background: 'none', border: 'none', borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', gap: 10 }}>

      {/* Title + search + SQL export */}
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#f1f5f9', marginBottom: 10, letterSpacing: '-0.5px' }}>
          Database Explorer
        </h1>
        {mainTab === 'explorer' && (
          <>
            <div style={{ position: 'relative' }}>
              <GlobalSearch onSelect={handleSearchSelect} />
            </div>
            <SqlQueryPanel userRole={user?.role ?? ''} />
          </>
        )}
      </div>

      {/* Main tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', flexShrink: 0, gap: 2 }}>
        <button style={TAB_STYLE(mainTab === 'explorer')} onClick={() => setMainTab('explorer')}>
          🗃 Schema Explorer
        </button>
        <button style={TAB_STYLE(mainTab === 'downloads')} onClick={() => setMainTab('downloads')}>
          📁 Downloaded Files
        </button>
        <button style={TAB_STYLE(mainTab === 'masterdata')} onClick={() => setMainTab('masterdata')}>
          📂 Master Data
        </button>
      </div>

      {/* Downloaded Files — always mounted so it loads once, hidden when not active */}
      <div style={{ flex: '1 1 0', minHeight: 0, display: mainTab === 'downloads' ? 'flex' : 'none', flexDirection: 'column' }}>
        <DownloadedFilesPanel />
      </div>

      {/* Master Data — always mounted, hidden when not active */}
      <div style={{ flex: '1 1 0', minHeight: 0, display: mainTab === 'masterdata' ? 'flex' : 'none', flexDirection: 'column', overflowY: 'auto' }}>
        <MasterData />
      </div>

      {mainTab === 'explorer' && isMobile ? (
        // Mobile: tab switcher — Schema → Objects → Columns
        <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
            {(['Schemas', 'Objects', 'Columns'] as const).map((tab, i) => {
              const active = mobilePanelTab === i
              return (
                <button key={tab} onClick={() => setMobilePanelTab(i)} style={{
                  flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: active ? 700 : 400,
                  color: active ? '#38bdf8' : '#64748b',
                  background: 'none', border: 'none', borderBottom: active ? '2px solid #38bdf8' : '2px solid transparent',
                  cursor: 'pointer',
                }}>
                  {tab}
                  {i === 1 && selectedSchema ? ` (${selectedSchema})` : ''}
                  {i === 2 && selectedName ? ` ✓` : ''}
                </button>
              )
            })}
          </div>
          {/* Panel content */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {mobilePanelTab === 0 && (
              <Card title="Schemas" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <SchemaPanel selectedSchema={selectedSchema} onSelect={s => { handleSchemaSelect(s); setMobilePanelTab(1) }} />
              </Card>
            )}
            {mobilePanelTab === 1 && (
              <Card title={selectedSchema ? `${selectedSchema} — Objects` : 'Objects'} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <ObjectPanel
                  schema={selectedSchema}
                  objectType={objectType}
                  onObjectTypeChange={t => { setObjectType(t); setSelectedName('') }}
                  onSelect={(n, t) => { handleObjectSelect(n, t); setMobilePanelTab(2) }}
                  selectedName={selectedName}
                />
              </Card>
            )}
            {mobilePanelTab === 2 && (
              <Card title={selectedName ? `${selectedName} — Columns` : 'Column Detail'} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <ColumnPanel schema={selectedSchema} name={selectedName} type={selectedType} />
              </Card>
            )}
          </div>
        </div>
      ) : mainTab === 'explorer' ? (
        // Desktop: three panels side by side
        <div style={{ display: 'flex', gap: 10, flex: '1 1 0', minHeight: 0 }}>
          <Card title="Schemas" style={{ width: 200, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <SchemaPanel selectedSchema={selectedSchema} onSelect={handleSchemaSelect} />
          </Card>
          <Card title={selectedSchema ? `${selectedSchema} — Objects` : 'Objects'} style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ObjectPanel
              schema={selectedSchema}
              objectType={objectType}
              onObjectTypeChange={t => { setObjectType(t); setSelectedName('') }}
              onSelect={handleObjectSelect}
              selectedName={selectedName}
            />
          </Card>
          <Card title={selectedName ? `${selectedName} — Columns` : 'Column Detail'} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ColumnPanel schema={selectedSchema} name={selectedName} type={selectedType} />
          </Card>
        </div>
      ) : null}

    </div>
  )
}
