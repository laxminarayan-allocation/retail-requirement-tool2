import { useState, useEffect, useCallback } from 'react'
import http from '@/api/http'
import { useAuth } from '@/context/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SopDocument {
  id: string
  category: string
  title: string
  description: string
  content: string
  version: string
  status: string
  tags: string
  created_by: string
  updated_by?: string
  created_at: string
  updated_at: string
  steps?: SopStep[]
}

interface SopStep {
  id: string
  doc_id: string
  step_no: number
  title: string
  detail: string
  responsible: string
}

interface DataTable {
  id: string
  table_type: string
  table_name: string
  schema_owner: string
  description: string
  purpose: string
  parent_id: string | null
  columns_json: string
  relations_json: string
  created_by: string
  created_at: string
  updated_at: string
}

interface ColDef { col: string; type: string; desc: string; is_pk: boolean; is_fk: boolean }
interface RelDef { table: string; key: string; rel_type: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { code: 'SOP',        label: 'SOP',             icon: '📄', color: '#38bdf8' },
  { code: 'DATA_PROC',  label: 'Data Procedures', icon: '📊', color: '#a78bfa' },
  { code: 'PROCEDURE',  label: 'Procedure',        icon: '🔄', color: '#34d399' },
  { code: 'ROADMAP',    label: 'Road Map',         icon: '🗺️', color: '#fbbf24' },
  { code: 'LOGIC',      label: 'Logic',            icon: '💡', color: '#f472b6' },
  { code: 'ALGORITHM',  label: 'Algorithm',        icon: '⚙️', color: '#fb923c' },
]

const STATUS_COLORS: Record<string, string> = {
  draft: '#d97706', active: '#16a34a', archived: '#475569',
}
const STATUS_BG: Record<string, string> = {
  draft: '#451a03', active: '#052e16', archived: '#0f172a',
}

const emptyDoc = (): Partial<SopDocument> => ({
  category: 'SOP', title: '', description: '', content: '',
  version: '1.0', status: 'draft', tags: '',
})

const emptyTable = (): Partial<DataTable> => ({
  table_name: '', table_type: 'MAIN', schema_owner: '',
  description: '', purpose: '', parent_id: null,
  columns_json: '[]', relations_json: '[]',
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function parseCols(json: string): ColDef[] {
  try { return JSON.parse(json) || [] } catch { return [] }
}
function parseRels(json: string): RelDef[] {
  try { return JSON.parse(json) || [] } catch { return [] }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 8,
      color: STATUS_COLORS[status] || '#94a3b8',
      background: STATUS_BG[status] || '#1e293b',
      border: `1px solid ${STATUS_COLORS[status] || '#334155'}`,
    }}>{status}</span>
  )
}

function Card({ title, children, style }: { title?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', ...style,
    }}>
      {title && (
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid var(--card-border)',
          fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '.06em',
          textTransform: 'uppercase', flexShrink: 0,
        }}>{title}</div>
      )}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}

function Btn({
  children, onClick, variant = 'default', small, disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  small?: boolean
  disabled?: boolean
}) {
  const map = {
    default: { bg: '#1e293b', color: 'var(--text-secondary)', border: '#334155' },
    primary: { bg: '#1d4ed8', color: '#fff', border: '#2563eb' },
    danger:  { bg: '#7f1d1d', color: '#fca5a5', border: '#991b1b' },
    ghost:   { bg: 'transparent', color: 'var(--text-muted)', border: 'transparent' },
  }
  const s = map[variant]
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? '3px 9px' : '6px 14px',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 5, fontSize: small ? 10 : 12, fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  )
}

function Input({ value, onChange, placeholder, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
        color: 'var(--text-primary)', fontSize: 12, padding: '6px 10px', width: '100%',
        outline: 'none', boxSizing: 'border-box', ...style,
      }} />
  )
}

function Select({ value, onChange, options, style }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
  style?: React.CSSProperties
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
        color: 'var(--text-primary)', fontSize: 12, padding: '6px 10px',
        outline: 'none', ...style,
      }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Textarea({ value, onChange, placeholder, rows = 5 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
      style={{
        background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 5,
        color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px', width: '100%',
        outline: 'none', resize: 'vertical', fontFamily: "'Segoe UI', monospace",
        boxSizing: 'border-box',
      }} />
  )
}

// ── Columns Editor ────────────────────────────────────────────────────────────

function ColumnsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const cols = parseCols(value)

  function addCol() {
    onChange(JSON.stringify([...cols, { col: '', type: 'VARCHAR2', desc: '', is_pk: false, is_fk: false }]))
  }
  function removeCol(i: number) {
    const next = cols.filter((_, idx) => idx !== i)
    onChange(JSON.stringify(next))
  }
  function updateCol(i: number, field: keyof ColDef, val: string | boolean) {
    const next = cols.map((c, idx) => idx === i ? { ...c, [field]: val } : c)
    onChange(JSON.stringify(next))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>COLUMNS ({cols.length})</span>
        <Btn small onClick={addCol}>+ Add Column</Btn>
      </div>
      {cols.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--content-bg)' }}>
                {['Column Name', 'Data Type', 'Description', 'PK', 'FK', ''].map(h => (
                  <th key={h} style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #1e293b' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cols.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '4px 4px' }}>
                    <Input value={c.col} onChange={v => updateCol(i, 'col', v)} placeholder="COLUMN_NAME" />
                  </td>
                  <td style={{ padding: '4px 4px' }}>
                    <Select value={c.type} onChange={v => updateCol(i, 'type', v)} options={[
                      'VARCHAR2','NUMBER','DATE','TIMESTAMP','CHAR','CLOB','BLOB','INTEGER','FLOAT',
                    ].map(t => ({ value: t, label: t }))} />
                  </td>
                  <td style={{ padding: '4px 4px' }}>
                    <Input value={c.desc} onChange={v => updateCol(i, 'desc', v)} placeholder="Description" />
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <input type="checkbox" checked={c.is_pk} onChange={e => updateCol(i, 'is_pk', e.target.checked)}
                      style={{ accentColor: '#38bdf8' }} />
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    <input type="checkbox" checked={c.is_fk} onChange={e => updateCol(i, 'is_fk', e.target.checked)}
                      style={{ accentColor: '#a78bfa' }} />
                  </td>
                  <td style={{ padding: '4px 4px' }}>
                    <Btn small variant="danger" onClick={() => removeCol(i)}>✕</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cols.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>No columns defined. Click "+ Add Column".</div>
      )}
    </div>
  )
}

// ── Relations Editor ──────────────────────────────────────────────────────────

function RelationsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const rels = parseRels(value)

  function addRel() {
    onChange(JSON.stringify([...rels, { table: '', key: '', rel_type: 'INNER JOIN' }]))
  }
  function removeRel(i: number) {
    onChange(JSON.stringify(rels.filter((_, idx) => idx !== i)))
  }
  function updateRel(i: number, field: keyof RelDef, val: string) {
    const next = rels.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
    onChange(JSON.stringify(next))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>RELATIONSHIPS ({rels.length})</span>
        <Btn small onClick={addRel}>+ Add Relation</Btn>
      </div>
      {rels.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <Input value={r.table} onChange={v => updateRel(i, 'table', v)} placeholder="Related Table" style={{ flex: 2 }} />
          <Input value={r.key} onChange={v => updateRel(i, 'key', v)} placeholder="Join Key" style={{ flex: 2 }} />
          <Select value={r.rel_type} onChange={v => updateRel(i, 'rel_type', v)} options={[
            'INNER JOIN','LEFT JOIN','RIGHT JOIN','FULL JOIN','REFERENCE',
          ].map(t => ({ value: t, label: t }))} style={{ flex: 2 }} />
          <Btn small variant="danger" onClick={() => removeRel(i)}>✕</Btn>
        </div>
      ))}
      {rels.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>No relationships. Click "+ Add Relation".</div>
      )}
    </div>
  )
}

// ── Steps Editor ──────────────────────────────────────────────────────────────

function StepsPanel({
  docId, steps, isAdmin, onRefresh,
}: {
  docId: string; steps: SopStep[]; isAdmin: boolean; onRefresh: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [newStep, setNewStep] = useState<Partial<SopStep>>({ step_no: steps.length + 1, title: '', detail: '', responsible: '' })
  const [saving, setSaving] = useState(false)

  async function saveStep() {
    setSaving(true)
    try {
      await http.post(`/sop/documents/${docId}/steps`, {
        step_no: newStep.step_no || steps.length + 1,
        title: newStep.title || '',
        detail: newStep.detail || '',
        responsible: newStep.responsible || '',
      })
      setNewStep({ step_no: steps.length + 2, title: '', detail: '', responsible: '' })
      setAdding(false)
      onRefresh()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function deleteStep(sid: string) {
    if (!confirm('Delete this step?')) return
    await http.delete(`/sop/steps/${sid}`)
    onRefresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>PROCESS STEPS ({steps.length})</span>
        {isAdmin && !adding && <Btn small onClick={() => setAdding(true)}>+ Add Step</Btn>}
      </div>

      {/* Steps list */}
      {steps.map((s, i) => (
        <div key={s.id} style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8,
          padding: 10, background: 'var(--content-bg)', borderRadius: 6, border: '1px solid var(--card-border)',
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{s.step_no}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{s.title}</div>
            {s.detail && <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{s.detail}</div>}
            {s.responsible && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                👤 Responsible: <span style={{ color: '#a78bfa' }}>{s.responsible}</span>
              </div>
            )}
          </div>
          {isAdmin && (
            <Btn small variant="danger" onClick={() => deleteStep(s.id)}>✕</Btn>
          )}
        </div>
      ))}

      {steps.length === 0 && !adding && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0' }}>No steps defined.</div>
      )}

      {/* Add step form */}
      {adding && (
        <div style={{ padding: 10, background: 'var(--content-bg)', borderRadius: 6, border: '1px solid var(--card-border)', marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <Input value={String(newStep.step_no || '')} onChange={v => setNewStep(p => ({ ...p, step_no: parseInt(v) || 1 }))}
              placeholder="Step #" style={{ width: 70, flexShrink: 0 }} />
            <Input value={newStep.title || ''} onChange={v => setNewStep(p => ({ ...p, title: v }))}
              placeholder="Step title *" />
          </div>
          <Textarea value={newStep.detail || ''} onChange={v => setNewStep(p => ({ ...p, detail: v }))}
            placeholder="Step detail / description" rows={3} />
          <div style={{ marginTop: 6 }}>
            <Input value={newStep.responsible || ''} onChange={v => setNewStep(p => ({ ...p, responsible: v }))}
              placeholder="Responsible (role / person)" />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Btn variant="primary" onClick={saveStep} disabled={saving || !newStep.title?.trim()}>
              {saving ? 'Saving…' : '✓ Save Step'}
            </Btn>
            <Btn onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Document Detail Panel ─────────────────────────────────────────────────────

function DocDetail({
  doc, isAdmin, onClose, onSaved, onDeleted,
}: {
  doc: SopDocument
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<SopDocument>>({ ...doc })
  const [fullDoc, setFullDoc] = useState<SopDocument>(doc)
  const [saving, setSaving] = useState(false)

  const f = <K extends keyof SopDocument>(k: K) => (v: SopDocument[K]) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    loadFull()
  }, [doc.id])

  async function loadFull() {
    const res = await http.get(`/sop/documents/${doc.id}`)
    if (res.data.success) { setFullDoc(res.data.data); setForm({ ...res.data.data }) }
  }

  async function save() {
    setSaving(true)
    try {
      await http.put(`/sop/documents/${doc.id}`, form)
      setEditing(false)
      onSaved()
      loadFull()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function del() {
    if (!confirm(`Delete "${doc.title}"? All steps will be removed.`)) return
    await http.delete(`/sop/documents/${doc.id}`)
    onDeleted()
  }

  const cat = CATEGORIES.find(c => c.code === fullDoc.category)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>{cat?.icon || '📄'}</span>
            <span style={{ fontSize: 10, color: cat?.color || '#94a3b8', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase' }}>
              {cat?.label || fullDoc.category}
            </span>
            <Badge status={fullDoc.status} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>v{fullDoc.version}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fullDoc.title}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 10 }}>
          {isAdmin && !editing && <Btn small onClick={() => { setForm({ ...fullDoc }); setEditing(true) }}>✏️ Edit</Btn>}
          {isAdmin && !editing && <Btn small variant="danger" onClick={del}>🗑</Btn>}
          <Btn small variant="ghost" onClick={onClose}>✕</Btn>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!editing ? (
          <>
            {fullDoc.description && (
              <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{fullDoc.description}</div>
            )}
            {fullDoc.tags && (
              <div style={{ marginBottom: 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {fullDoc.tags.split(',').filter(Boolean).map(t => (
                  <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 12, background: 'var(--content-bg)', color: 'var(--text-muted)', border: '1px solid var(--card-border)' }}>
                    {t.trim()}
                  </span>
                ))}
              </div>
            )}
            {fullDoc.content && (
              <div style={{
                marginBottom: 16, padding: 12, background: 'var(--content-bg)', borderRadius: 6,
                border: '1px solid var(--card-border)', fontSize: 12, color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap', lineHeight: 1.7, fontFamily: "'Segoe UI', monospace",
              }}>
                {fullDoc.content}
              </div>
            )}
            <StepsPanel docId={fullDoc.id} steps={fullDoc.steps || []} isAdmin={isAdmin} onRefresh={loadFull} />
            <div style={{ marginTop: 14, fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
              <span>Created: {fmtDate(fullDoc.created_at)} by {fullDoc.created_by}</span>
              {fullDoc.updated_by && <span>Updated: {fmtDate(fullDoc.updated_at)} by {fullDoc.updated_by}</span>}
            </div>
          </>
        ) : (
          /* Edit form */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Category</label>
                <Select value={form.category || 'SOP'} onChange={f('category')}
                  options={CATEGORIES.map(c => ({ value: c.code, label: c.label }))} style={{ width: '100%' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Status</label>
                <Select value={form.status || 'draft'} onChange={f('status')}
                  options={['draft','active','archived'].map(s => ({ value: s, label: s.charAt(0).toUpperCase()+s.slice(1) }))}
                  style={{ width: '100%' }} />
              </div>
              <div style={{ width: 90 }}>
                <label style={S.label}>Version</label>
                <Input value={form.version || '1.0'} onChange={f('version')} placeholder="1.0" />
              </div>
            </div>
            <div>
              <label style={S.label}>Title *</label>
              <Input value={form.title || ''} onChange={f('title')} placeholder="Document title" />
            </div>
            <div>
              <label style={S.label}>Short Description</label>
              <Input value={form.description || ''} onChange={f('description')} placeholder="One-line summary" />
            </div>
            <div>
              <label style={S.label}>Content (Markdown / Plain Text)</label>
              <Textarea value={form.content || ''} onChange={f('content')} placeholder="Write the full document content here…" rows={8} />
            </div>
            <div>
              <label style={S.label}>Tags (comma-separated)</label>
              <Input value={form.tags || ''} onChange={f('tags')} placeholder="oracle, replenishment, SS27" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" onClick={save} disabled={saving || !form.title?.trim()}>
                {saving ? 'Saving…' : '✓ Save Changes'}
              </Btn>
              <Btn onClick={() => setEditing(false)}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── New Document Form ─────────────────────────────────────────────────────────

function NewDocForm({ defaultCategory, onSaved, onCancel }: {
  defaultCategory: string; onSaved: () => void; onCancel: () => void
}) {
  const [form, setForm] = useState<Partial<SopDocument>>(emptyDoc())
  const [saving, setSaving] = useState(false)

  useEffect(() => { setForm(p => ({ ...p, category: defaultCategory })) }, [defaultCategory])

  const f = <K extends keyof SopDocument>(k: K) => (v: SopDocument[K]) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      await http.post('/sop/documents', form)
      onSaved()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>New Document</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Category</label>
          <Select value={form.category || 'SOP'} onChange={f('category')}
            options={CATEGORIES.map(c => ({ value: c.code, label: c.label }))} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Status</label>
          <Select value={form.status || 'draft'} onChange={f('status')}
            options={['draft','active','archived'].map(s => ({ value: s, label: s.charAt(0).toUpperCase()+s.slice(1) }))}
            style={{ width: '100%' }} />
        </div>
        <div style={{ width: 90 }}>
          <label style={S.label}>Version</label>
          <Input value={form.version || '1.0'} onChange={f('version')} placeholder="1.0" />
        </div>
      </div>
      <div>
        <label style={S.label}>Title *</label>
        <Input value={form.title || ''} onChange={f('title')} placeholder="Document title" />
      </div>
      <div>
        <label style={S.label}>Short Description</label>
        <Input value={form.description || ''} onChange={f('description')} placeholder="One-line summary" />
      </div>
      <div>
        <label style={S.label}>Content</label>
        <Textarea value={form.content || ''} onChange={f('content')} placeholder="Write content here…" rows={6} />
      </div>
      <div>
        <label style={S.label}>Tags</label>
        <Input value={form.tags || ''} onChange={f('tags')} placeholder="oracle, replenishment" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" onClick={save} disabled={saving || !form.title?.trim()}>
          {saving ? 'Creating…' : '✓ Create Document'}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Data Table Detail ─────────────────────────────────────────────────────────

function TableDetail({
  table, allTables, isAdmin, onClose, onSaved, onDeleted,
}: {
  table: DataTable; allTables: DataTable[]; isAdmin: boolean
  onClose: () => void; onSaved: () => void; onDeleted: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<DataTable>>({ ...table })
  const [saving, setSaving] = useState(false)

  const f = <K extends keyof DataTable>(k: K) => (v: DataTable[K]) => setForm(p => ({ ...p, [k]: v }))

  const mainTables = allTables.filter(t => t.table_type === 'MAIN' && t.id !== table.id)
  const subTables  = allTables.filter(t => t.parent_id === table.id)
  const cols = parseCols(table.columns_json)
  const rels = parseRels(table.relations_json)

  async function save() {
    setSaving(true)
    try {
      await http.put(`/sop/data-tables/${table.id}`, form)
      setEditing(false)
      onSaved()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function del() {
    if (!confirm(`Delete "${table.table_name}"? Sub-tables will be unlinked.`)) return
    await http.delete(`/sop/data-tables/${table.id}`)
    onDeleted()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
              background: table.table_type === 'MAIN' ? '#1d4ed820' : '#7c3aed20',
              color: table.table_type === 'MAIN' ? '#60a5fa' : '#c4b5fd',
              border: `1px solid ${table.table_type === 'MAIN' ? '#1d4ed8' : '#7c3aed'}`,
            }}>{table.table_type}</span>
            {table.schema_owner && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{table.schema_owner}</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{table.table_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isAdmin && !editing && <Btn small onClick={() => { setForm({ ...table }); setEditing(true) }}>✏️ Edit</Btn>}
          {isAdmin && !editing && <Btn small variant="danger" onClick={del}>🗑</Btn>}
          <Btn small variant="ghost" onClick={onClose}>✕</Btn>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
        {!editing ? (
          <>
            {table.description && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>{table.description}</div>}
            {table.purpose && (
              <div style={{ marginBottom: 14, padding: 10, background: 'var(--content-bg)', borderRadius: 6, border: '1px solid var(--card-border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>PURPOSE</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{table.purpose}</div>
              </div>
            )}
            {table.table_type === 'SUB' && table.parent_id && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Parent Main Table: </span>
                <span style={{ fontSize: 11, color: '#38bdf8', fontFamily: 'monospace' }}>
                  {allTables.find(t => t.id === table.parent_id)?.table_name || '—'}
                </span>
              </div>
            )}

            {/* Columns */}
            {cols.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6 }}>COLUMNS ({cols.length})</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: 'var(--content-bg)' }}>
                        {['Column', 'Type', 'PK', 'FK', 'Description'].map(h => (
                          <th key={h} style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'left', borderBottom: '1px solid #1e293b' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cols.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: c.is_pk ? '#38bdf8' : '#e2e8f0' }}>{c.col}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{c.type}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>{c.is_pk ? '🔑' : ''}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'center' }}>{c.is_fk ? '🔗' : ''}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>{c.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Relationships */}
            {rels.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6 }}>RELATIONSHIPS</div>
                {rels.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--content-bg)', borderRadius: 5, marginBottom: 4, fontSize: 11 }}>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{table.table_name}</span>
                    <span style={{ color: '#f59e0b', fontSize: 10, fontWeight: 700 }}>{r.rel_type}</span>
                    <span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>{r.table}</span>
                    <span style={{ color: 'var(--text-muted)' }}>ON {r.key}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Sub-tables (for MAIN) */}
            {table.table_type === 'MAIN' && subTables.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6 }}>LINKED SUB TABLES ({subTables.length})</div>
                {subTables.map(st => (
                  <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: 'var(--content-bg)', borderRadius: 5, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: '#c4b5fd', fontFamily: 'monospace' }}>↳ {st.table_name}</span>
                    {st.schema_owner && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{st.schema_owner}</span>}
                    {st.description && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>— {st.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* Edit form */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Table Name *</label>
                <Input value={form.table_name || ''} onChange={v => f('table_name')(v.toUpperCase())} placeholder="TABLE_NAME" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Schema / Owner</label>
                <Input value={form.schema_owner || ''} onChange={v => f('schema_owner')(v.toUpperCase())} placeholder="CK_A2166" />
              </div>
              <div>
                <label style={S.label}>Type</label>
                <Select value={form.table_type || 'MAIN'} onChange={f('table_type')}
                  options={['MAIN','SUB'].map(t => ({ value: t, label: t }))} />
              </div>
            </div>

            {form.table_type === 'SUB' && (
              <div>
                <label style={S.label}>Parent Main Table</label>
                <Select value={form.parent_id || ''} onChange={f('parent_id')}
                  options={[{ value: '', label: '— none —' }, ...mainTables.map(t => ({ value: t.id, label: t.table_name }))]}
                  style={{ width: '100%' }} />
              </div>
            )}

            <div>
              <label style={S.label}>Description</label>
              <Input value={form.description || ''} onChange={f('description')} placeholder="Short description" />
            </div>
            <div>
              <label style={S.label}>Purpose</label>
              <Textarea value={form.purpose || ''} onChange={f('purpose')} placeholder="What is this table used for?" rows={3} />
            </div>

            <div style={{ background: 'var(--content-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--card-border)' }}>
              <ColumnsEditor value={form.columns_json || '[]'} onChange={v => f('columns_json')(v)} />
            </div>
            <div style={{ background: 'var(--content-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--card-border)' }}>
              <RelationsEditor value={form.relations_json || '[]'} onChange={v => f('relations_json')(v)} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" onClick={save} disabled={saving || !form.table_name?.trim()}>
                {saving ? 'Saving…' : '✓ Save Changes'}
              </Btn>
              <Btn onClick={() => setEditing(false)}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── New Table Form ────────────────────────────────────────────────────────────

function NewTableForm({ mainTables, onSaved, onCancel }: {
  mainTables: DataTable[]; onSaved: () => void; onCancel: () => void
}) {
  const [form, setForm] = useState<Partial<DataTable>>(emptyTable())
  const [saving, setSaving] = useState(false)

  const f = <K extends keyof DataTable>(k: K) => (v: DataTable[K]) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      await http.post('/sop/data-tables', form)
      onSaved()
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Add Data Table</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Table Name *</label>
          <Input value={form.table_name || ''} onChange={v => f('table_name')(v.toUpperCase())} placeholder="TABLE_NAME" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Schema / Owner</label>
          <Input value={form.schema_owner || ''} onChange={v => f('schema_owner')(v.toUpperCase())} placeholder="CK_A2166" />
        </div>
        <div>
          <label style={S.label}>Type</label>
          <Select value={form.table_type || 'MAIN'} onChange={f('table_type')}
            options={['MAIN','SUB'].map(t => ({ value: t, label: t }))} />
        </div>
      </div>
      {form.table_type === 'SUB' && (
        <div>
          <label style={S.label}>Parent Main Table</label>
          <Select value={form.parent_id || ''} onChange={f('parent_id')}
            options={[{ value: '', label: '— none —' }, ...mainTables.map(t => ({ value: t.id, label: t.table_name }))]}
            style={{ width: '100%' }} />
        </div>
      )}
      <div>
        <label style={S.label}>Description</label>
        <Input value={form.description || ''} onChange={f('description')} placeholder="Short description" />
      </div>
      <div>
        <label style={S.label}>Purpose</label>
        <Textarea value={form.purpose || ''} onChange={f('purpose')} placeholder="What is this table used for?" rows={3} />
      </div>
      <div style={{ background: 'var(--content-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--card-border)' }}>
        <ColumnsEditor value={form.columns_json || '[]'} onChange={v => f('columns_json')(v)} />
      </div>
      <div style={{ background: 'var(--content-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--card-border)' }}>
        <RelationsEditor value={form.relations_json || '[]'} onChange={v => f('relations_json')(v)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" onClick={save} disabled={saving || !form.table_name?.trim()}>
          {saving ? 'Creating…' : '✓ Add Table'}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  label: { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 },
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Procedures() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Tab: 'docs' | 'structure'
  const [tab, setTab] = useState<'docs' | 'structure'>('docs')

  // Docs tab state
  const [docs, setDocs] = useState<SopDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [selectedCat, setSelectedCat] = useState('SOP')
  const [selectedDoc, setSelectedDoc] = useState<SopDocument | null>(null)
  const [newDoc, setNewDoc] = useState(false)

  // Structure tab state
  const [tables, setTables] = useState<DataTable[]>([])
  const [tablesLoading, setTablesLoading] = useState(false)
  const [selectedTable, setSelectedTable] = useState<DataTable | null>(null)
  const [newTable, setNewTable] = useState(false)

  const loadDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const res = await http.get(`/sop/documents?category=${selectedCat}`)
      if (res.data.success) setDocs(res.data.data.documents)
    } catch { /* ignore */ } finally { setDocsLoading(false) }
  }, [selectedCat])

  const loadTables = useCallback(async () => {
    setTablesLoading(true)
    try {
      const res = await http.get('/sop/data-tables')
      if (res.data.success) setTables(res.data.data.tables)
    } catch { /* ignore */ } finally { setTablesLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'docs') loadDocs() }, [tab, loadDocs])
  useEffect(() => { if (tab === 'structure') loadTables() }, [tab, loadTables])

  // Counts per category
  const [catCounts, setCatCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    http.get('/sop/documents').then(res => {
      if (res.data.success) {
        const counts: Record<string, number> = {}
        for (const d of res.data.data.documents) counts[d.category] = (counts[d.category] || 0) + 1
        setCatCounts(counts)
      }
    }).catch(() => null)
  }, [docs, tables])

  const mainTables = tables.filter(t => t.table_type === 'MAIN')

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', gap: 10 }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>📋 Procedures & Data Structure</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>SOPs, Procedures, Road Maps, Logic, Algorithms & Data Table Catalog</p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'docs' && <Btn variant="primary" onClick={() => { setNewDoc(true); setSelectedDoc(null) }}>+ New Document</Btn>}
            {tab === 'structure' && <Btn variant="primary" onClick={() => { setNewTable(true); setSelectedTable(null) }}>+ Add Table</Btn>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--card-border)', flexShrink: 0 }}>
        {[
          { key: 'docs', label: '📄 Documents' },
          { key: 'structure', label: '🏗️ Data Structure' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as 'docs' | 'structure')}
            style={{
              padding: '8px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
              color: tab === t.key ? '#38bdf8' : '#64748b',
              borderBottom: tab === t.key ? '2px solid #38bdf8' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Documents Tab ── */}
      {tab === 'docs' && (
        <div style={{ display: 'flex', gap: 10, flex: '1 1 0', minHeight: 0 }}>

          {/* Category sidebar */}
          <Card style={{ width: 200, flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ padding: 8 }}>
              {CATEGORIES.map(cat => {
                const active = selectedCat === cat.code
                return (
                  <button key={cat.code}
                    onClick={() => { setSelectedCat(cat.code); setSelectedDoc(null); setNewDoc(false) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6,
                      background: active ? '#0f172a' : 'transparent',
                      border: active ? `1px solid ${cat.color}30` : '1px solid transparent',
                      cursor: 'pointer', marginBottom: 2,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                    <span style={{ fontSize: 14 }}>{cat.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? cat.color : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cat.label}
                      </div>
                    </div>
                    {(catCounts[cat.code] || 0) > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--table-row-hover)', color: 'var(--text-muted)', borderRadius: 10, padding: '1px 6px' }}>
                        {catCounts[cat.code]}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Document list */}
          <Card title={`${CATEGORIES.find(c => c.code === selectedCat)?.icon} ${CATEGORIES.find(c => c.code === selectedCat)?.label} Documents`}
            style={{ width: 300, flexShrink: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {docsLoading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
              {!docsLoading && docs.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No documents in this category.{isAdmin && <><br /><span style={{ color: 'var(--text-muted)' }}>Click "+ New Document" to add one.</span></>}
                </div>
              )}
              {docs.map(doc => (
                <button key={doc.id} onClick={() => { setSelectedDoc(doc); setNewDoc(false) }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 10px', borderRadius: 6, marginBottom: 4,
                    background: selectedDoc?.id === doc.id ? '#0f172a' : 'transparent',
                    border: selectedDoc?.id === doc.id ? '1px solid #334155' : '1px solid transparent',
                    cursor: 'pointer',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge status={doc.status} />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>v{doc.version}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {fmtDate(doc.updated_at)}</span>
                  </div>
                  {doc.description && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </Card>

          {/* Detail / Form panel */}
          <Card style={{ flex: 1, minWidth: 0 }}>
            {!selectedDoc && !newDoc && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
                Select a document to view details
              </div>
            )}
            {newDoc && (
              <div style={{ overflowY: 'auto', height: '100%' }}>
                <NewDocForm
                  defaultCategory={selectedCat}
                  onSaved={() => { setNewDoc(false); loadDocs() }}
                  onCancel={() => setNewDoc(false)}
                />
              </div>
            )}
            {selectedDoc && !newDoc && (
              <DocDetail
                doc={selectedDoc}
                isAdmin={isAdmin}
                onClose={() => setSelectedDoc(null)}
                onSaved={() => loadDocs()}
                onDeleted={() => { setSelectedDoc(null); loadDocs() }}
              />
            )}
          </Card>
        </div>
      )}

      {/* ── Data Structure Tab ── */}
      {tab === 'structure' && (
        <div style={{ display: 'flex', gap: 10, flex: '1 1 0', minHeight: 0 }}>

          {/* Table tree */}
          <Card title="🏗️ Table Catalog" style={{ width: 280, flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ padding: 8, flex: 1, overflowY: 'auto' }}>
              {tablesLoading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>}
              {!tablesLoading && tables.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No tables registered yet.{isAdmin && <><br /><span style={{ color: 'var(--text-muted)' }}>Click "+ Add Table".</span></>}
                </div>
              )}

              {/* MAIN tables + their SUB children */}
              {mainTables.map(mt => {
                const subs = tables.filter(t => t.parent_id === mt.id)
                const activeMain = selectedTable?.id === mt.id
                return (
                  <div key={mt.id} style={{ marginBottom: 4 }}>
                    <button onClick={() => { setSelectedTable(mt); setNewTable(false) }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6,
                        background: activeMain ? '#0f172a' : 'transparent',
                        border: activeMain ? '1px solid #1d4ed840' : '1px solid transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', background: '#1d4ed820', padding: '1px 6px', borderRadius: 4 }}>MAIN</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{mt.table_name}</span>
                    </button>
                    {/* Sub-tables */}
                    {subs.map(st => {
                      const activeSub = selectedTable?.id === st.id
                      return (
                        <button key={st.id} onClick={() => { setSelectedTable(st); setNewTable(false) }}
                          style={{
                            width: '100%', textAlign: 'left', padding: '6px 10px 6px 28px', borderRadius: 6,
                            background: activeSub ? '#0f172a' : 'transparent',
                            border: activeSub ? '1px solid #7c3aed40' : '1px solid transparent',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>↳</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', background: '#7c3aed20', padding: '1px 5px', borderRadius: 4 }}>SUB</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.table_name}</span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}

              {/* Standalone SUB tables (no parent) */}
              {tables.filter(t => t.table_type === 'SUB' && !t.parent_id).map(st => {
                const active = selectedTable?.id === st.id
                return (
                  <button key={st.id} onClick={() => { setSelectedTable(st); setNewTable(false) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, marginBottom: 2,
                      background: active ? '#0f172a' : 'transparent',
                      border: active ? '1px solid #7c3aed40' : '1px solid transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', background: '#7c3aed20', padding: '1px 6px', borderRadius: 4 }}>SUB</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{st.table_name}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>(unlinked)</span>
                  </button>
                )
              })}
            </div>

            {/* Stats footer */}
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--card-border)', flexShrink: 0, display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)' }}>
              <span>🔵 {mainTables.length} Main</span>
              <span>🟣 {tables.filter(t => t.table_type === 'SUB').length} Sub</span>
              <span>Total: {tables.length}</span>
            </div>
          </Card>

          {/* Detail / Form panel */}
          <Card style={{ flex: 1, minWidth: 0 }}>
            {!selectedTable && !newTable && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 13 }}>
                Select a table to view its structure
              </div>
            )}
            {newTable && (
              <div style={{ overflowY: 'auto', height: '100%' }}>
                <NewTableForm
                  mainTables={mainTables}
                  onSaved={() => { setNewTable(false); loadTables() }}
                  onCancel={() => setNewTable(false)}
                />
              </div>
            )}
            {selectedTable && !newTable && (
              <TableDetail
                table={selectedTable}
                allTables={tables}
                isAdmin={isAdmin}
                onClose={() => setSelectedTable(null)}
                onSaved={() => loadTables()}
                onDeleted={() => { setSelectedTable(null); loadTables() }}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
