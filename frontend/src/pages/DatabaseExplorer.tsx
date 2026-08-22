/**
 * Database Explorer — Phase 2
 *
 * Three-panel layout:
 *   Left  : schema selector + object type toggle (Tables / Views)
 *   Centre : object list with search
 *   Right  : column detail for selected object
 */
import { useEffect, useState, useCallback } from 'react'
import { api } from '@/api/client'
import http from '@/api/http'
import { useAuth } from '@/context/AuthContext'
import { DataGrid } from '@/components/DataGrid'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import type { SchemaRow, TableRow, ViewRow, ColumnRow } from '@/types/api'

// ── Tiny shared primitives ────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
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
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '7px 10px',
        fontSize: 12,
        color: '#e2e8f0',
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
        <div style={{ fontSize: 12, color: '#475569', padding: 8 }}>No schemas found</div>
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
      <div style={{ padding: 20, fontSize: 13, color: '#475569' }}>
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

      <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>
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
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>No local output file yet.</div>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
            Fetches up to 5,000 rows from Oracle and saves a Parquet file.<br />
            Use <strong style={{ color: '#7dd3fc' }}>Refresh</strong> anytime to re-download.
          </div>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
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
        <span style={{ fontSize: 11, color: '#64748b' }}>
          📅 Downloaded: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fetchedLabel}</span>
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          background: 'rgba(148,163,184,.12)', color: '#94a3b8',
        }}>
          {formatAge(meta.age_seconds)}
        </span>
        <span style={{ fontSize: 10, color: '#475569' }}>
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
              padding: '4px 12px', background: '#0f172a', color: '#7dd3fc',
              border: '1px solid #334155', borderRadius: 5, fontSize: 11,
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
          <div style={{ padding: 20, fontSize: 12, color: '#475569', textAlign: 'center' }}>
            No rows returned.
          </div>
        ) : (
          <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                {meta.columns.map(col => (
                  <th key={col} style={{
                    padding: '5px 10px', color: '#64748b', fontWeight: 600,
                    position: 'sticky', top: 0, background: '#0f172a',
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
                      padding: '4px 10px', color: '#94a3b8', fontFamily: 'monospace',
                      maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                      title={String(row[col] ?? '')}>
                      {row[col] == null
                        ? <span style={{ color: '#334155', fontStyle: 'italic' }}>NULL</span>
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
      <div style={{ padding: 20, fontSize: 13, color: '#475569' }}>
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
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
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
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!loading && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#0f172a' }}>
                    {['#', 'COLUMN', 'TYPE', 'LEN', 'NULL', 'DEFAULT'].map(h => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left', padding: '6px 8px', color: '#64748b',
                          fontWeight: 600, position: 'sticky', top: 0,
                          background: '#0f172a', whiteSpace: 'nowrap',
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
                      <td style={{ padding: '5px 8px', color: '#475569' }}>{col.column_id}</td>
                      <td style={{ padding: '5px 8px', color: '#7dd3fc', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {col.column_name}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#a78bfa', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {col.data_type}
                        {col.data_precision != null
                          ? `(${col.data_precision}${col.data_scale ? `,${col.data_scale}` : ''})`
                          : col.data_length ? `(${col.data_length})` : ''}
                      </td>
                      <td style={{ padding: '5px 8px', color: '#64748b' }}>{col.data_length}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <StatusBadge status={col.nullable === 'Y' ? 'ok' : 'error'} />
                      </td>
                      <td style={{
                        padding: '5px 8px', color: '#94a3b8', fontFamily: 'monospace',
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
    <div style={{ marginTop: 10, border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header toggle */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: '#1e293b', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>
          🗂 SQL Query & Export  <span style={{ fontSize: 10, color: '#475569', fontWeight: 400 }}>(Admin · SELECT only · saves to output/)</span>
        </span>
        <span style={{ color: '#475569', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding: 14, background: '#0f172a' }}>
          {/* SQL input */}
          <textarea
            value={sql}
            onChange={e => setSql(e.target.value)}
            placeholder={"SELECT * FROM all_views WHERE owner = 'CK_A2166'"}
            rows={4}
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155',
              borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#e2e8f0',
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
                flex: 1, background: '#1e293b', border: '1px solid #334155',
                borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#e2e8f0',
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
                <span style={{ fontSize: 10, color: '#64748b' }}>{result.rows_in_file.toLocaleString()} rows · {result.fetch_ms} ms · showing {result.rows_returned}</span>
                <span style={{ fontSize: 10, color: '#475569' }}>
                  {new Date(result.fetched_at ?? '').toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })}
                </span>
              </div>

              {/* Mini grid */}
              <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ background: '#0f172a' }}>
                      {result.columns.map(c => (
                        <th key={c} style={{
                          padding: '4px 10px', color: '#64748b', fontWeight: 600,
                          position: 'sticky', top: 0, background: '#0f172a',
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
                            padding: '3px 10px', color: '#94a3b8', fontFamily: 'monospace',
                            maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
                          }} title={String(row[c] ?? '')}>
                            {row[c] == null
                              ? <span style={{ color: '#334155', fontStyle: 'italic' }}>NULL</span>
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
    fontSize: 9, fontWeight: 700, color: '#475569',
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
              style={{ fontSize: 9, fontWeight: 700, color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer' }}>
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
                style={{ padding: '4px 10px', background: 'transparent', color: '#64748b', border: '1px solid #334155', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
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

function DownloadedFilesPanel() {
  const [files, setFiles] = useState<OutputFile[]>([])
  const [loading, setLoading] = useState(false)
  const [wins, setWins] = useState<Record<string, DlWinState>>({})
  const [activeWin, setActiveWin] = useState<string | null>(null)
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [mdStatus,      setMdStatus]      = useState<Record<string, 'idle' | 'adding' | 'done' | 'exists'>>({})
  const [refreshStatus, setRefreshStatus] = useState<Record<string, 'idle' | 'refreshing' | 'done' | 'error'>>({})
  const [removeStatus,  setRemoveStatus]  = useState<Record<string, 'idle' | 'removing'>>({})

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
    try {
      const url = `/database/table/${encodeURIComponent(owner)}/${encodeURIComponent(obj)}/preview?limit=200&force_refresh=true`
      await http.get(url, { timeout: 300000 })
      setRefreshStatus(prev => ({ ...prev, [key]: 'done' }))
      loadList()
      setTimeout(() => setRefreshStatus(prev => ({ ...prev, [key]: 'idle' })), 3000)
    } catch {
      setRefreshStatus(prev => ({ ...prev, [key]: 'error' }))
      setTimeout(() => setRefreshStatus(prev => ({ ...prev, [key]: 'idle' })), 3000)
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

  function loadList() {
    setLoading(true)
    http.get('/database/output/list')
      .then(res => { if (res.data.success) setFiles(res.data.data.files) })
      .catch(() => null)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>
          {files.length} file{files.length !== 1 ? 's' : ''} · available to all users
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={loadList}
            style={{ fontSize: 10, color: '#7dd3fc', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            ↻ Refresh
          </button>
          <button onClick={() => setPanelExpanded(true)}
            style={{ fontSize: 10, color: '#a78bfa', background: 'none', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontWeight: 600, padding: '2px 8px' }}>
            ⊞ View All
          </button>
        </div>
      </div>

      {/* Column headers — sticky, outside scroll container */}
      {files.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 90px 330px', gap: 6, padding: '4px 6px', borderBottom: '1px solid #1e293b', marginBottom: 2, flexShrink: 0, background: '#0f1c2e' }}>
          {[
            { label: 'TABLE / QUERY', color: '#334155' },
            { label: 'ROWS',          color: '#334155' },
            { label: 'SIZE',          color: '#334155' },
            { label: 'DOWNLOADED',    color: '#334155' },
            { label: 'ACTIONS',       color: '#64748b' },
          ].map(h => (
            <span key={h.label} style={{ fontSize: 9, fontWeight: 700, color: h.color, letterSpacing: '.06em', textTransform: 'uppercase' }}>{h.label}</span>
          ))}
        </div>
      )}

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {loading && <div style={{ fontSize: 12, color: '#64748b', padding: '8px 0' }}>Loading…</div>}
        {!loading && files.length === 0 && (
          <div style={{ fontSize: 12, color: '#475569', padding: '12px 0', textAlign: 'center' }}>
            No files yet. Admin can download tables/views using the Data Preview tab or SQL Query &amp; Export.
          </div>
        )}

        {files.map(f => {
          const key = `${f.owner}__${f.object}`
          const isOpen = !!wins[key]
          return (
            <div key={key}>
              {/* File row */}
              {(() => {
                const rowKey = `${f.owner}__${f.object}`
                const mdSt  = mdStatus[rowKey]      ?? 'idle'
                const rfSt  = refreshStatus[rowKey] ?? 'idle'
                const rmSt  = removeStatus[rowKey]  ?? 'idle'

                const mdLabel: Record<string, string> = { idle: '＋ MD', adding: '…', done: '✓ MD', exists: '⚠ MD' }
                const rfLabel: Record<string, string> = { idle: '↻ Refresh', refreshing: '↻ Fetching…', done: '✓ Refreshed', error: '✕ Failed' }
                const mdColor: Record<string, string> = { idle: '#38bdf8', adding: '#64748b', done: '#4ade80', exists: '#fbbf24' }
                const rfColor: Record<string, string> = { idle: '#a78bfa', refreshing: '#64748b', done: '#4ade80', error: '#f87171' }

                return (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 60px 90px 330px',
                    gap: 6, alignItems: 'center', padding: '5px 6px',
                    borderBottom: '1px solid #1e293b',
                    background: isOpen ? '#0c1628' : 'transparent',
                  }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={`${f.owner}.${f.object}`}>
                      {f.owner}.{f.object}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{f.rows.toLocaleString()}</span>
                    <span style={{ fontSize: 10, color: '#475569' }}>{fmtSize(f.size_bytes)}</span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>{f.age_label}</span>

                    {/* Actions row */}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {/* View */}
                      <button onClick={() => openWindow(f)}
                        style={{ padding: '3px 9px', background: activeWin === key ? '#0c4a6e' : isOpen ? '#0f2a3f' : '#1e293b', color: '#7dd3fc', border: '1px solid #334155', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {activeWin === key ? '▼ Close' : isOpen ? '👁 View ✓' : '👁 View'}
                      </button>

                      {/* CSV */}
                      <button onClick={() => downloadCsv(f.owner, f.object)}
                        style={{ padding: '3px 9px', background: '#14532d', color: '#4ade80', border: '1px solid #166534', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        ⬇ CSV
                      </button>

                      {/* Add to Master Data */}
                      <button
                        onClick={() => addToMasterData(f.owner, f.object)}
                        disabled={mdSt === 'adding' || mdSt === 'done'}
                        title="Add to Master Data page"
                        style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: (mdSt === 'adding' || mdSt === 'done') ? 'default' : 'pointer', color: mdColor[mdSt], background: 'transparent', border: `1px solid ${mdColor[mdSt]}33` }}>
                        {mdLabel[mdSt]}
                      </button>

                      {/* Refresh Now */}
                      <button
                        onClick={() => refreshFile(f.owner, f.object)}
                        disabled={rfSt === 'refreshing'}
                        title="Re-fetch from Oracle and overwrite local file"
                        style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: rfSt === 'refreshing' ? 'default' : 'pointer', color: rfColor[rfSt], background: 'transparent', border: `1px solid ${rfColor[rfSt]}44` }}>
                        {rfLabel[rfSt]}
                      </button>

                      {/* Remove */}
                      <button
                        onClick={() => removeFile(f.owner, f.object)}
                        disabled={rmSt === 'removing'}
                        title="Delete this file from the server"
                        style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: rmSt === 'removing' ? 'default' : 'pointer', color: '#f87171', background: 'transparent', border: '1px solid rgba(248,113,113,.3)' }}>
                        {rmSt === 'removing' ? '…' : '✕ Remove'}
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* SQL block inline (QUERY rows only, not a popup) */}
              {f.owner === 'QUERY' && isOpen && (
                <div style={{ background: '#080f1a', borderBottom: '1px solid #1e293b', padding: '8px 12px' }}>
                  <SqlTextBlock file={f} onSaved={(sql) => {
                    setFiles(prev => prev.map(x =>
                      x.owner === f.owner && x.object === f.object ? { ...x, sql_text: sql } : x
                    ))
                  }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Downloaded Files expanded panel popup */}
      {panelExpanded && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'stretch' }}
          onClick={e => { if (e.target === e.currentTarget) setPanelExpanded(false) }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />
          <div style={{ position: 'relative', margin: '32px auto', width: 'min(96vw, 1200px)', background: '#0c1628', border: '1px solid #334155', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,.75)', zIndex: 1 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#0a1220' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>📁 Downloaded Files</span>
              <span style={{ fontSize: 11, color: '#475569' }}>{files.length} files</span>
              {/* Search */}
              <input value={fileFilter} onChange={e => setFileFilter(e.target.value)}
                placeholder="🔍 Search table name…"
                style={{ marginLeft: 12, flex: 1, maxWidth: 340, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 12, padding: '5px 10px', outline: 'none' }} />
              <span style={{ fontSize: 11, color: '#475569', marginLeft: 4 }}>
                {fileFilter ? `${files.filter(f => `${f.owner}.${f.object}`.toLowerCase().includes(fileFilter.toLowerCase())).length} match` : ''}
              </span>
              <button onClick={() => { setPanelExpanded(false); setFileFilter('') }}
                style={{ marginLeft: 'auto', width: 26, height: 26, border: '1px solid #334155', borderRadius: 5, background: '#1e2030', color: '#94a3b8', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 100px 340px', gap: 6, padding: '6px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#080f1a' }}>
              {['TABLE / QUERY', 'ROWS', 'SIZE', 'DOWNLOADED', 'ACTIONS'].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '.07em', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
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
                    <div key={rowKey} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 100px 340px', gap: 6, alignItems: 'center', padding: '6px 16px', borderBottom: '1px solid #1e293b', background: isOpen ? '#0c1a30' : 'transparent' }}>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${f.owner}.${f.object}`}>
                        {f.owner}.{f.object}
                      </span>
                      <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>{f.rows.toLocaleString()}</span>
                      <span style={{ fontSize: 10, color: '#475569' }}>{fmtSize(f.size_bytes)}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>{f.age_label}</span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button onClick={() => openWindow(f)}
                          style={{ padding: '3px 9px', background: isOpen ? '#0f2a3f' : '#1e293b', color: '#7dd3fc', border: '1px solid #334155', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {isOpen ? '👁 View ✓' : '👁 View'}
                        </button>
                        <button onClick={() => downloadCsv(f.owner, f.object)}
                          style={{ padding: '3px 9px', background: '#14532d', color: '#4ade80', border: '1px solid #166534', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>⬇ CSV</button>
                        <button onClick={() => addToMasterData(f.owner, f.object)} disabled={mdSt === 'adding' || mdSt === 'done'}
                          style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: (mdSt === 'adding' || mdSt === 'done') ? 'default' : 'pointer', color: mdColor[mdSt], background: 'transparent', border: `1px solid ${mdColor[mdSt]}33` }}>
                          {mdLabel[mdSt]}
                        </button>
                        <button onClick={() => refreshFile(f.owner, f.object)} disabled={rfSt === 'refreshing'}
                          style={{ padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: rfSt === 'refreshing' ? 'default' : 'pointer', color: rfColor[rfSt], background: 'transparent', border: `1px solid ${rfColor[rfSt]}44` }}>
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
        const btnSt: React.CSSProperties = { width: 24, height: 24, border: '1px solid #334155', borderRadius: 4, background: '#1e2030', color: '#64748b', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }
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
                <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>{rows.toLocaleString()} rows · {columns.length} cols</span>
                {/* limit selector */}
                <label style={{ fontSize: 10, color: '#475569' }}>Show</label>
                <select value={limit} onChange={e => {
                  const nl = Number(e.target.value)
                  setWins(p => ({ ...p, [activeWin]: { ...p[activeWin], limit: nl } }))
                  const [owner, ...rest] = activeWin.split('__')
                  loadWinData(activeWin, owner, rest.join('__'), nl, rows, label)
                }} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#94a3b8', fontSize: 11, padding: '2px 6px' }}>
                  {[100, 200, 500, 1000, 2000].concat(rows <= 2000 ? [] : []).map(n => <option key={n} value={n}>{n}</option>)}
                  {rows <= 2000 && <option value={rows}>{rows.toLocaleString()} (all)</option>}
                </select>
                <button title="Minimize" onClick={() => setActiveWin(null)} style={btnSt}>▬</button>
                <button title="Close" onClick={() => closeWindow(activeWin)} style={{ ...btnSt, color: '#94a3b8' }}>✕</button>
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
                  {!w.loading && <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>{w.rows.toLocaleString()}</span>}
                  {w.loading && <span style={{ fontSize: 10, color: '#334155', flexShrink: 0 }}>…</span>}
                  <button title="Restore" onClick={e => { e.stopPropagation(); setActiveWin(wk) }}
                    style={{ width: 20, height: 20, border: '1px solid #334155', borderRadius: 4, background: '#1e2030', color: '#64748b', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>▲</button>
                  <button title="Close" onClick={e => { e.stopPropagation(); closeWindow(wk) }}
                    style={{ width: 20, height: 20, border: '1px solid #334155', borderRadius: 4, background: '#1e2030', color: '#94a3b8', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
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
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            color: '#e2e8f0',
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
            background: '#1e293b',
            border: '1px solid #334155',
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
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#e2e8f0' }}>
                {r.owner}.{r.object_name}
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{r.object_type}</span>
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
  const [selectedSchema, setSelectedSchema] = useState('')
  const [objectType, setObjectType] = useState<ObjType>('TABLE')
  const [selectedName, setSelectedName] = useState('')
  const [selectedType, setSelectedType] = useState<ObjType>('TABLE')

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', gap: 10 }}>

      {/* Title + search + SQL export */}
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 10 }}>
          Database Explorer
        </h1>
        <div style={{ position: 'relative' }}>
          <GlobalSearch onSelect={handleSearchSelect} />
        </div>
        <SqlQueryPanel userRole={user?.role ?? ''} />
      </div>

      {/* Three-panel body — flex: 1 but capped so Downloaded Files fits */}
      <div style={{ display: 'flex', gap: 10, flex: '1 1 0', minHeight: 0 }}>
        {/* Schemas */}
        <Card
          title="Schemas"
          style={{ width: 200, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          <SchemaPanel selectedSchema={selectedSchema} onSelect={handleSchemaSelect} />
        </Card>

        {/* Object list */}
        <Card
          title={selectedSchema ? `${selectedSchema} — Objects` : 'Objects'}
          style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ObjectPanel
            schema={selectedSchema}
            objectType={objectType}
            onObjectTypeChange={t => { setObjectType(t); setSelectedName('') }}
            onSelect={handleObjectSelect}
            selectedName={selectedName}
          />
        </Card>

        {/* Column detail */}
        <Card
          title={selectedName ? `${selectedName} — Columns` : 'Column Detail'}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <ColumnPanel
            schema={selectedSchema}
            name={selectedName}
            type={selectedType}
          />
        </Card>
      </div>

      {/* Downloaded Files — full-width panel at bottom */}
      <Card
        title="📁 Downloaded Files"
        style={{ flexShrink: 0, maxHeight: 260, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <DownloadedFilesPanel />
      </Card>

    </div>
  )
}
