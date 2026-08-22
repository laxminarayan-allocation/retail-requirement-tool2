import { useCallback, useEffect, useRef, useState } from 'react'
import http from '@/api/http'

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

// ── Types ─────────────────────────────────────────────────────────────────────

// ─── Barcode vars ──────────────────────────────────────────────────────────────
interface BCVars {
  // Store grade override
  east_zone_districts: string
  east_zone_grade: string
  include_upcoming_stores: boolean
  // MAX_GRID multipliers
  ready_max_grid: number
  a_grade_summer_mult: number
  a_grade_regular_mult: number
  b_plus_adder_not_winter: number
  b_plus_adder_winter: number
  other_adder_not_winter: number
  // PBS caps
  pbs_cap_sized_items: number
  pbs_cap_innerwear: number
  pbs_cap_bottoms: number
  pbs_cap_default: number
  pbs_cap_ready_multiplier: number
  // Sales projection
  sl_window_days: number
  sl_projection_days: number
}

const BC_VARS_DEFAULT: BCVars = {
  east_zone_districts: 'BIHAR-PUJA,EAST,NORTH EAST',
  east_zone_grade: 'A',
  include_upcoming_stores: true,
  ready_max_grid: 4,
  a_grade_summer_mult: 3.0,
  a_grade_regular_mult: 2.0,
  b_plus_adder_not_winter: 3,
  b_plus_adder_winter: 3,
  other_adder_not_winter: 2,
  pbs_cap_sized_items: 12,
  pbs_cap_innerwear: 72,
  pbs_cap_bottoms: 12,
  pbs_cap_default: 48,
  pbs_cap_ready_multiplier: 4,
  sl_window_days: 7,
  sl_projection_days: 30,
}

interface MCVars {
  // Achievement logic
  pbs_fill_threshold: number
  achv_min_high_fill: number
  achv_min_low_fill: number
  achv_cap_a_grade: number
  achv_cap_standard: number
  nso_months: number
  nso_days_old: number
  // Degrow weights
  degrow_thresh_severe: number
  degrow_thresh_mid: number
  aw25_weight_severe: number
  aw25_weight_mid: number
  aw25_weight_mild: number
  ss25_weight_severe: number
  ss25_weight_mid: number
  ss25_weight_mild: number
  ss25_weight_above: number
  older_weight: number
  // PBS
  pbs_period_days: number
  // Fill rate buckets
  fill_bucket_low: number
  fill_bucket_mid_low: number
  fill_bucket_mid: number
  fill_bucket_high: number
}

const MC_VARS_DEFAULT: MCVars = {
  pbs_fill_threshold: 0.85,
  achv_min_high_fill: 0.70,
  achv_min_low_fill: 1.00,
  achv_cap_a_grade: 1.25,
  achv_cap_standard: 1.50,
  nso_months: 2,
  nso_days_old: 60,
  degrow_thresh_severe: -0.50,
  degrow_thresh_mid: -0.30,
  aw25_weight_severe: 0.00,
  aw25_weight_mid: 0.50,
  aw25_weight_mild: 1.00,
  ss25_weight_severe: 0.00,
  ss25_weight_mid: 0.30,
  ss25_weight_mild: 0.50,
  ss25_weight_above: 1.00,
  older_weight: 0.00,
  pbs_period_days: 30,
  fill_bucket_low: 0.50,
  fill_bucket_mid_low: 0.70,
  fill_bucket_mid: 0.80,
  fill_bucket_high: 1.00,
}

interface FactorConfig {
  safety_days: number
  fill_rate_target: number
  min_alloc_qty: number
  max_alloc_factor: number
  use_grade_pbs: boolean
  mc_vars?: MCVars
  bc_vars?: BCVars
}

interface GradeFactor {
  grade: string
  pbs_multiplier: number
  safety_days_override: number | null
}

interface DivisionFactor {
  division: string
  excluded: boolean
  safety_days_override: number | null
}

interface FactorSet {
  id: string
  name: string
  attribute1: string | null
  season: string | null
  created_at: string
  updated_at: string
  is_active: boolean
  notes: string | null
  config: FactorConfig | null
  grade_factors: GradeFactor[]
  division_factors: DivisionFactor[]
}

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch<T>(method: string, url: string, data?: unknown): Promise<T> {
  const res = await http.request<{ success: boolean; data: T; message: string | null }>({
    method, url, data,
  })
  if (!res.data.success) throw new Error(res.data.message ?? 'API error')
  return res.data.data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Design tokens (inline styles) ─────────────────────────────────────────────

const C = {
  bg:       '#070d1a',
  surf1:    '#0f1c2e',
  surf2:    '#162540',
  surf3:    '#1e3052',
  border:   '#253761',
  border2:  '#1a2d4a',
  blue:     '#38bdf8',
  blueDim:  'rgba(56,189,248,.12)',
  green:    '#4ade80',
  greenDim: 'rgba(74,222,128,.12)',
  red:      '#f87171',
  redDim:   'rgba(248,113,113,.1)',
  purple:   '#a78bfa',
  lime:     '#a3e635',
  amber:    '#fbbf24',
  text1:    '#e2e8f0',
  text2:    '#94a3b8',
  text3:    '#64748b',
  text4:    '#475569',
}

// ── Shared small components ───────────────────────────────────────────────────

function Btn({ children, onClick, variant = 'ghost', disabled, style }: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'green' | 'danger'
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    padding: '4px 10px', whiteSpace: 'nowrap', transition: 'opacity .1s',
  }
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: C.blue, color: '#fff' },
    ghost:   { background: C.surf3, border: `1px solid ${C.border}`, color: C.text2 },
    green:   { background: '#15803d', color: '#fff' },
    danger:  { background: 'transparent', border: `1px solid rgba(248,113,113,.4)`, color: C.red },
  }
  return (
    <button style={{ ...base, ...variants[variant], ...style }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function Tag({ children, color }: { children: React.ReactNode; color: 'blue' | 'purple' | 'dim' }) {
  const styles: Record<string, React.CSSProperties> = {
    blue:   { color: C.blue,   background: C.blueDim,              border: `1px solid rgba(56,189,248,.25)` },
    purple: { color: C.purple, background: 'rgba(167,139,250,.12)', border: `1px solid rgba(167,139,250,.25)` },
    dim:    { color: C.text3,  background: C.surf2,                border: `1px solid ${C.border}` },
  }
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, ...styles[color] }}>
      {children}
    </span>
  )
}

function ActiveBadge() {
  return (
    <span style={{
      background: C.greenDim, border: `1px solid rgba(74,222,128,.35)`,
      color: C.green, fontSize: 9, fontWeight: 700, letterSpacing: '.05em',
      padding: '2px 7px', borderRadius: 20, textTransform: 'uppercase',
    }}>Active</span>
  )
}

function InclBadge({ excluded }: { excluded: boolean }) {
  return excluded
    ? <span style={{ color: C.red,   background: C.redDim,   border: `1px solid rgba(248,113,113,.3)`,  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>Excluded</span>
    : <span style={{ color: C.green, background: C.greenDim, border: `1px solid rgba(74,222,128,.25)`,   fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>Included</span>
}

// ── Create form (sidebar) ─────────────────────────────────────────────────────

function CreateForm({ onCreated, onCancel }: { onCreated: (fs: FactorSet) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [attribute1, setAttribute1] = useState('PREWINTER')
  const [season, setSeason] = useState('AW26')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const inp: React.CSSProperties = {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text1, fontSize: 12, padding: '6px 9px', width: '100%', outline: 'none', fontFamily: 'inherit',
  }
  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }

  async function handleCreate() {
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr(null)
    try {
      const fs = await apiFetch<FactorSet>('POST', '/factors', {
        name: name.trim(),
        attribute1: attribute1 || null,
        season: season || null,
        notes: notes || null,
        config: { safety_days: 14, fill_rate_target: 0.85, min_alloc_qty: 1, max_alloc_factor: 2.0, use_grade_pbs: true },
        grade_factors: [],
        division_factors: [],
      })
      onCreated(fs)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ margin: '8px 10px', background: C.surf2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text1, marginBottom: 12 }}>New Factor Set</div>
      {err && <div style={{ color: C.red, fontSize: 11, marginBottom: 8 }}>{err}</div>}
      <div style={{ marginBottom: 8 }}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={name} placeholder="e.g. AW27 Standard v1" onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={lbl}>Attribute1</label>
          <input style={inp} value={attribute1} onChange={e => setAttribute1(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Season</label>
          <input style={inp} value={season} onChange={e => setSeason(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Notes</label>
        <input style={inp} value={notes} placeholder="Optional" onChange={e => setNotes(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn variant="primary" onClick={handleCreate} disabled={saving} style={{ fontSize: 12, padding: '5px 14px' }}>
          {saving ? 'Creating…' : 'Create'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  )
}

// ── Config panel ──────────────────────────────────────────────────────────────

function ConfigPanel({ setId, config, onRefresh }: { setId: string; config: FactorConfig; onRefresh: () => void }) {
  const [form, setForm] = useState({ ...config })
  const [saving, setSaving] = useState(false)

  const fieldCard = (key: keyof FactorConfig, label: string, unit: string, desc: string) => (
    <div key={key} style={{
      background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{label}</div>
      <input
        type="number" step="any"
        style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 20, fontWeight: 700, color: C.blue, width: '100%', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }}
        value={String(form[key])}
        onChange={e => setForm(prev => ({ ...prev, [key]: key === 'use_grade_pbs' ? prev.use_grade_pbs : Number(e.target.value) }))}
      />
      <div style={{ fontSize: 9, color: C.text4, marginTop: 3 }}>{unit} — {desc}</div>
    </div>
  )

  async function save() {
    setSaving(true)
    try { await apiFetch('PUT', `/factors/${setId}/config`, form); onRefresh() }
    catch (e) { alert('Save failed: ' + e) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: '18px 20px' }}>
      <SectionTitle>Replenishment parameters</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {fieldCard('safety_days',      'Safety Days',      'days',  'Days of buffer stock')}
        {fieldCard('fill_rate_target', 'Fill Rate Target', 'ratio', 'e.g. 0.85 = 85% service level')}
        {fieldCard('min_alloc_qty',    'Min Alloc Qty',    'units', 'Minimum units per allocation')}
        {fieldCard('max_alloc_factor', 'Max Alloc Factor', '× PBS', 'Upper ceiling = PBS × this')}
      </div>

      <SectionTitle>Grade PBS multipliers</SectionTitle>
      <div style={{ background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: C.text2 }}>Apply grade PBS multipliers</div>
          <div style={{ fontSize: 10, color: C.text4, marginTop: 2 }}>Scale PBS by each grade's multiplier before allocation</div>
        </div>
        <div style={{ display: 'flex', background: C.surf3, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          <button
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', border: 'none', cursor: 'pointer', background: form.use_grade_pbs ? C.greenDim : 'transparent', color: form.use_grade_pbs ? C.green : C.text3 }}
            onClick={() => setForm(p => ({ ...p, use_grade_pbs: true }))}>Yes</button>
          <button
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 14px', border: 'none', cursor: 'pointer', background: !form.use_grade_pbs ? C.redDim : 'transparent', color: !form.use_grade_pbs ? C.red : C.text3 }}
            onClick={() => setForm(p => ({ ...p, use_grade_pbs: false }))}>No</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Btn variant="primary" onClick={save} disabled={saving} style={{ fontSize: 12, padding: '6px 18px' }}>
          {saving ? 'Saving…' : 'Save Config'}
        </Btn>
        <span style={{ fontSize: 11, color: C.text4 }}>Changes apply to next allocation run</span>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, color: C.text4, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: C.border2 }} />
    </div>
  )
}

// ── Grade table ───────────────────────────────────────────────────────────────

function GradeTable({ setId, grades, onRefresh }: { setId: string; grades: GradeFactor[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Record<string, { mult: string; days: string }>>({})
  const [adding, setAdding] = useState(false)
  const [newGrade, setNewGrade] = useState({ grade: '', mult: '1.00', days: '' })
  const [addErr, setAddErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const TH: React.CSSProperties = { background: C.surf1, color: C.text3, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '7px 14px', textAlign: 'left', borderBottom: `1px solid ${C.border}` }
  const TD: React.CSSProperties = { padding: '8px 14px', color: C.text2, borderBottom: `1px solid ${C.border2}` }
  const numInp: React.CSSProperties = { background: C.surf1, border: `1px solid ${C.blue}`, borderRadius: 5, color: C.blue, fontSize: 12, fontWeight: 600, padding: '3px 8px', width: 80, textAlign: 'right', outline: 'none', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }

  async function saveGrade(grade: string) {
    const e = editing[grade]; if (!e) return
    setSaving(true)
    try {
      await apiFetch('PUT', `/factors/${setId}/grades/${grade}`, {
        pbs_multiplier: parseFloat(e.mult) || 1.0,
        safety_days_override: e.days.trim() !== '' ? parseInt(e.days, 10) : null,
      })
      setEditing(prev => { const n = { ...prev }; delete n[grade]; return n })
      onRefresh()
    } catch (err) { alert('Save failed: ' + err) }
    finally { setSaving(false) }
  }

  async function addGrade() {
    const g = newGrade.grade.trim().toUpperCase()
    if (!g) { setAddErr('Grade label is required'); return }
    if (grades.find(r => r.grade === g)) { setAddErr(`Grade "${g}" already exists`); return }
    setSaving(true); setAddErr(null)
    try {
      await apiFetch('PUT', `/factors/${setId}/grades/${g}`, {
        pbs_multiplier: parseFloat(newGrade.mult) || 1.0,
        safety_days_override: newGrade.days.trim() !== '' ? parseInt(newGrade.days, 10) : null,
      })
      setAdding(false); setNewGrade({ grade: '', mult: '1.00', days: '' }); onRefresh()
    } catch (err) { setAddErr('Add failed: ' + err) }
    finally { setSaving(false) }
  }

  const addInp: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text1, fontSize: 12, padding: '5px 9px', outline: 'none', fontFamily: 'inherit' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px 6px', borderBottom: `1px solid ${C.border2}` }}>
        <Btn variant="primary" style={{ fontSize: 11 }} onClick={() => { setAdding(a => !a); setAddErr(null) }}>
          {adding ? '✕ Cancel' : '＋ Add Grade'}
        </Btn>
      </div>

      {adding && (
        <div style={{ padding: '12px 14px', background: C.surf2, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Grade *</div>
              <input style={{ ...addInp, width: '100%', textTransform: 'uppercase' }} maxLength={4} value={newGrade.grade}
                onChange={e => setNewGrade(p => ({ ...p, grade: e.target.value }))} placeholder="A" />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>PBS Multiplier</div>
              <input style={{ ...addInp, width: '100%' }} type="number" step="0.01" value={newGrade.mult}
                onChange={e => setNewGrade(p => ({ ...p, mult: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Safety Days Override</div>
              <input style={{ ...addInp, width: '100%' }} type="number" value={newGrade.days} placeholder="— (optional)"
                onChange={e => setNewGrade(p => ({ ...p, days: e.target.value }))} />
            </div>
            <div style={{ paddingBottom: 2 }}>
              <Btn variant="green" onClick={addGrade} disabled={saving}>Add</Btn>
            </div>
          </div>
          {addErr && <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{addErr}</div>}
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={TH}>Grade</th>
            <th style={{ ...TH, textAlign: 'right' }}>PBS Multiplier</th>
            <th style={{ ...TH, textAlign: 'right' }}>Safety Days Override</th>
            <th style={TH} />
          </tr>
        </thead>
        <tbody>
          {grades.length === 0 && (
            <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: C.text4, padding: '24px 14px' }}>No grades yet. Use "Add Grade" to create one.</td></tr>
          )}
          {grades.map(g => {
            const isEditing = !!editing[g.grade]
            const e = editing[g.grade]
            return (
              <tr key={g.grade}>
                <td style={TD}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 22, background: 'rgba(163,230,53,.1)', border: '1px solid rgba(163,230,53,.25)', borderRadius: 5, color: C.lime, fontSize: 11, fontWeight: 700 }}>
                    {g.grade}
                  </span>
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {isEditing
                    ? <input style={numInp} value={e.mult} onChange={ev => setEditing(p => ({ ...p, [g.grade]: { ...p[g.grade], mult: ev.target.value } }))} />
                    : <span style={{ color: C.blue, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{g.pbs_multiplier.toFixed(2)}</span>}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {isEditing
                    ? <input style={numInp} value={e.days} placeholder="—" onChange={ev => setEditing(p => ({ ...p, [g.grade]: { ...p[g.grade], days: ev.target.value } }))} />
                    : <span style={{ color: g.safety_days_override != null ? C.blue : C.text4, fontVariantNumeric: 'tabular-nums' }}>
                        {g.safety_days_override != null ? g.safety_days_override : '—'}
                      </span>}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {isEditing
                    ? <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn variant="green" onClick={() => saveGrade(g.grade)} disabled={saving}>Save</Btn>
                        <Btn variant="ghost" onClick={() => setEditing(p => { const n = { ...p }; delete n[g.grade]; return n })}>Cancel</Btn>
                      </span>
                    : <Btn variant="ghost" onClick={() => setEditing(prev => ({ ...prev, [g.grade]: { mult: String(g.pbs_multiplier), days: g.safety_days_override != null ? String(g.safety_days_override) : '' } }))}>Edit</Btn>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Division table ────────────────────────────────────────────────────────────

function DivisionTable({ setId, divisions, onRefresh }: { setId: string; divisions: DivisionFactor[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Record<string, { excluded: boolean; days: string }>>({})
  const [adding, setAdding] = useState(false)
  const [newDiv, setNewDiv] = useState({ division: '', excluded: false, days: '' })
  const [addErr, setAddErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const TH: React.CSSProperties = { background: C.surf1, color: C.text3, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '7px 14px', textAlign: 'left', borderBottom: `1px solid ${C.border}` }
  const TD: React.CSSProperties = { padding: '8px 14px', color: C.text2, borderBottom: `1px solid ${C.border2}` }
  const numInp: React.CSSProperties = { background: C.surf1, border: `1px solid ${C.blue}`, borderRadius: 5, color: C.blue, fontSize: 12, fontWeight: 600, padding: '3px 8px', width: 80, textAlign: 'right', outline: 'none', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' }
  const sel: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text1, fontSize: 11, padding: '3px 7px', outline: 'none' }
  const addInp: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text1, fontSize: 12, padding: '5px 9px', outline: 'none', fontFamily: 'inherit' }

  async function saveDivision(division: string) {
    const e = editing[division]; if (!e) return
    setSaving(true)
    try {
      await apiFetch('PUT', `/factors/${setId}/divisions/${encodeURIComponent(division)}`, {
        excluded: e.excluded,
        safety_days_override: e.days.trim() !== '' ? parseInt(e.days, 10) : null,
      })
      setEditing(prev => { const n = { ...prev }; delete n[division]; return n })
      onRefresh()
    } catch (err) { alert('Save failed: ' + err) }
    finally { setSaving(false) }
  }

  async function addDivision() {
    const d = newDiv.division.trim().toUpperCase()
    if (!d) { setAddErr('Division name is required'); return }
    if (divisions.find(r => r.division === d)) { setAddErr(`Division "${d}" already exists`); return }
    setSaving(true); setAddErr(null)
    try {
      await apiFetch('PUT', `/factors/${setId}/divisions/${encodeURIComponent(d)}`, {
        excluded: newDiv.excluded,
        safety_days_override: newDiv.days.trim() !== '' ? parseInt(newDiv.days, 10) : null,
      })
      setAdding(false); setNewDiv({ division: '', excluded: false, days: '' }); onRefresh()
    } catch (err) { setAddErr('Add failed: ' + err) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px 6px', borderBottom: `1px solid ${C.border2}` }}>
        <Btn variant="primary" style={{ fontSize: 11 }} onClick={() => { setAdding(a => !a); setAddErr(null) }}>
          {adding ? '✕ Cancel' : '＋ Add Division'}
        </Btn>
      </div>

      {adding && (
        <div style={{ padding: '12px 14px', background: C.surf2, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Division Name *</div>
              <input style={{ ...addInp, width: '100%' }} value={newDiv.division} placeholder="e.g. TOPS & SHIRTS"
                onChange={e => setNewDiv(p => ({ ...p, division: e.target.value }))} />
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Status</div>
              <select style={{ ...sel, width: '100%' }} value={newDiv.excluded ? 'excluded' : 'included'}
                onChange={e => setNewDiv(p => ({ ...p, excluded: e.target.value === 'excluded' }))}>
                <option value="included">Included</option>
                <option value="excluded">Excluded</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Safety Days Override</div>
              <input style={{ ...addInp, width: '100%' }} type="number" value={newDiv.days} placeholder="— (optional)"
                onChange={e => setNewDiv(p => ({ ...p, days: e.target.value }))} />
            </div>
            <div style={{ paddingBottom: 2 }}>
              <Btn variant="green" onClick={addDivision} disabled={saving}>Add</Btn>
            </div>
          </div>
          {addErr && <div style={{ color: C.red, fontSize: 11, marginTop: 8 }}>{addErr}</div>}
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={TH}>Division</th>
            <th style={TH}>Status</th>
            <th style={{ ...TH, textAlign: 'right' }}>Safety Days Override</th>
            <th style={TH} />
          </tr>
        </thead>
        <tbody>
          {divisions.length === 0 && (
            <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: C.text4, padding: '24px 14px' }}>No divisions yet. Use "Add Division" to create one.</td></tr>
          )}
          {divisions.map(d => {
            const isEditing = !!editing[d.division]
            const e = editing[d.division]
            return (
              <tr key={d.division}>
                <td style={{ ...TD, fontWeight: 500, color: C.text1 }}>{d.division}</td>
                <td style={TD}>
                  {isEditing
                    ? <select style={sel} value={e.excluded ? 'excluded' : 'included'}
                        onChange={ev => setEditing(p => ({ ...p, [d.division]: { ...p[d.division], excluded: ev.target.value === 'excluded' } }))}>
                        <option value="included">Included</option>
                        <option value="excluded">Excluded</option>
                      </select>
                    : <InclBadge excluded={d.excluded} />}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {isEditing
                    ? <input style={numInp} value={e.days} placeholder="—" onChange={ev => setEditing(p => ({ ...p, [d.division]: { ...p[d.division], days: ev.target.value } }))} />
                    : <span style={{ color: d.safety_days_override != null ? C.blue : C.text4, fontVariantNumeric: 'tabular-nums' }}>
                        {d.safety_days_override != null ? d.safety_days_override : '—'}
                      </span>}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  {isEditing
                    ? <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn variant="green" onClick={() => saveDivision(d.division)} disabled={saving}>Save</Btn>
                        <Btn variant="ghost" onClick={() => setEditing(p => { const n = { ...p }; delete n[d.division]; return n })}>Cancel</Btn>
                      </span>
                    : <Btn variant="ghost" onClick={() => setEditing(prev => ({ ...prev, [d.division]: { excluded: d.excluded, days: d.safety_days_override != null ? String(d.safety_days_override) : '' } }))}>Edit</Btn>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── View Deep Dive ─────────────────────────────────────────────────────────────

interface ViewNode {
  name: string; owner: string; type: string
  ddl: string | null
  columns: { name: string; type: string }[]
  children: ViewNode[]
  ref_type?: string
}

interface Formula { alias: string; expression: string }

const TRACKED_VIEWS = [
  { owner: 'CK_A2166', name: 'V_MC_REQ_APPS_2',          label: 'MC Requirement (V2)',   color: '#38bdf8' },
  { owner: 'CK_A2166', name: 'V_BARCODE_REQ_APPS_WMS_V2', label: 'BC Requirement (WMS)',  color: '#a78bfa' },
  { owner: 'CK_A2166', name: 'V_MC_REQ_APPS',             label: 'MC Requirement',        color: '#818cf8' },
  { owner: 'CK_A2166', name: 'V_MDQ_STR',                 label: 'MDQ / Capacity',        color: '#c084fc' },
  { owner: 'CK_A2166', name: 'V_PBS_MC',                  label: 'PBS Targets',           color: '#4ade80' },
  { owner: 'CK_A2166', name: 'V_ST_STK_MC',               label: 'Stock Position',        color: '#fb923c' },
  { owner: 'CK_A2166', name: 'V_LAST_4WK_SL_ST_MC',       label: 'L4W Sales (MC)',        color: '#f59e0b' },
  { owner: 'CK_A2166', name: 'V_MC_SL_SUM',               label: 'Sales Summary',         color: '#f87171' },
  { owner: 'CK_A2166', name: 'V_MC_STK_SUM',              label: 'Stock Summary',         color: '#34d399' },
]

function TreeNode({ node, depth = 0 }: { node: ViewNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const [showDdl, setShowDdl] = useState(false)
  const isView = node.type === 'VIEW' || node.type === 'MATERIALIZED VIEW'
  const color = isView ? '#38bdf8' : '#a78bfa'
  const typeLabel = node.type === 'TABLE' ? '⬛ TABLE' : node.type === 'VIEW' ? '◈ VIEW' : node.type

  return (
    <div style={{ marginLeft: depth * 18, borderLeft: depth > 0 ? `1px solid #1e293b` : 'none', paddingLeft: depth > 0 ? 12 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: node.children.length > 0 ? 'pointer' : 'default' }}
        onClick={() => node.children.length > 0 && setOpen(o => !o)}>
        {node.children.length > 0 && (
          <span style={{ color: '#475569', fontSize: 10, width: 10 }}>{open ? '▼' : '▶'}</span>
        )}
        {node.children.length === 0 && <span style={{ width: 10 }} />}
        <span style={{ fontSize: 10, color: '#334155', background: '#0f172a', border: `1px solid #253761`, borderRadius: 3, padding: '1px 5px' }}>{typeLabel}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color, fontFamily: 'monospace' }}>{node.owner}.{node.name}</span>
        <span style={{ fontSize: 10, color: '#334155' }}>{node.columns.length} cols</span>
        {isView && node.ddl && (
          <button onClick={e => { e.stopPropagation(); setShowDdl(d => !d) }}
            style={{ fontSize: 9, background: 'transparent', border: '1px solid #253761', borderRadius: 3, color: '#475569', cursor: 'pointer', padding: '1px 6px' }}>
            {showDdl ? 'Hide SQL' : 'SQL'}
          </button>
        )}
      </div>

      {/* DDL */}
      {showDdl && node.ddl && (
        <pre style={{ margin: '4px 0 8px 18px', padding: '10px 14px', background: '#070d1a', border: '1px solid #1e3052', borderRadius: 6, fontSize: 10, color: '#94a3b8', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto' }}>
          {node.ddl}
        </pre>
      )}

      {/* Children */}
      {open && node.children.map((child, i) => (
        <TreeNode key={`${child.owner}.${child.name}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function FormulaTable({ formulas }: { formulas: Formula[] }) {
  const [filter, setFilter] = useState('')
  const filtered = filter ? formulas.filter(f => f.alias.toLowerCase().includes(filter.toLowerCase()) || f.expression.toLowerCase().includes(filter.toLowerCase())) : formulas
  const TH: React.CSSProperties = { padding: '5px 10px', fontSize: 9, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left', borderBottom: '1px solid #1e293b', background: '#070d1a', position: 'sticky', top: 0 }
  const TD: React.CSSProperties = { padding: '4px 10px', borderBottom: '1px solid #0f172a', fontFamily: 'monospace', verticalAlign: 'top' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter columns…"
        style={{ background: '#070d1a', border: '1px solid #253761', borderRadius: 5, color: '#94a3b8', fontSize: 11, padding: '4px 9px', outline: 'none', width: 240 }} />
      <div style={{ overflowX: 'auto', border: '1px solid #1e293b', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead><tr><th style={TH}>Column</th><th style={TH}>Expression / Formula</th></tr></thead>
          <tbody>
            {filtered.map(f => (
              <tr key={f.alias} style={{ background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#0f172a')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ ...TD, color: '#38bdf8', whiteSpace: 'nowrap', fontWeight: 700 }}>{f.alias}</td>
                <td style={{ ...TD, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.expression}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={2} style={{ ...TD, color: '#334155', textAlign: 'center', padding: 16 }}>No match</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: '#334155' }}>{filtered.length} of {formulas.length} columns</div>
    </div>
  )
}

function ViewDeepDive() {
  const [selected, setSelected] = useState(TRACKED_VIEWS[0])
  const [mode, setMode] = useState<'formulas' | 'tree'>('formulas')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [tree, setTree] = useState<ViewNode | null>(null)
  const [ddl, setDdl] = useState('')

  async function fetchDdl() {
    setLoading(true); setErr(''); setFormulas([]); setDdl('')
    try {
      const res = await http.get('/database/view-ddl', { params: { owner: selected.owner, view_name: selected.name }, timeout: 30_000 })
      if (res.data.success) {
        setFormulas(res.data.data.formulas ?? [])
        setDdl(res.data.data.ddl ?? '')
      } else setErr(res.data.message || 'Error')
    } catch (e: unknown) { setErr((e as { message?: string })?.message || 'Request failed') }
    finally { setLoading(false) }
  }

  async function fetchTree() {
    setLoading(true); setErr(''); setTree(null)
    try {
      const res = await http.get('/database/view-tree', { params: { owner: selected.owner, view_name: selected.name, max_depth: 5 }, timeout: 60_000 })
      if (res.data.success) setTree(res.data.data.tree)
      else setErr(res.data.message || 'Error')
    } catch (e: unknown) { setErr((e as { message?: string })?.message || 'Request failed') }
    finally { setLoading(false) }
  }

  function load() { mode === 'formulas' ? fetchDdl() : fetchTree() }

  useEffect(() => {
    setFormulas([]); setTree(null); setDdl(''); setErr('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mode])

  const inp: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text1, fontSize: 11, padding: '4px 9px', outline: 'none' }

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>Oracle View — Logic Explorer</SectionTitle>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em' }}>View</span>
          <select value={`${selected.owner}.${selected.name}`}
            onChange={e => {
              const found = TRACKED_VIEWS.find(v => `${v.owner}.${v.name}` === e.target.value)
              if (found) setSelected(found)
            }}
            style={inp}>
            {TRACKED_VIEWS.map(v => (
              <option key={`${v.owner}.${v.name}`} value={`${v.owner}.${v.name}`}>{v.label} — {v.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '.05em' }}>Mode</span>
          <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 5, overflow: 'hidden' }}>
            {(['formulas', 'tree'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                style={{ padding: '4px 14px', fontSize: 11, fontWeight: mode === m ? 700 : 400, background: mode === m ? C.surf3 : 'transparent', color: mode === m ? C.blue : C.text3, border: 'none', cursor: 'pointer' }}>
                {m === 'formulas' ? 'Column Formulas' : 'Dependency Tree'}
              </button>
            ))}
          </div>
        </div>

        <Btn variant="primary" onClick={load} disabled={loading} style={{ alignSelf: 'flex-end', fontSize: 11, padding: '5px 16px' }}>
          {loading ? 'Loading…' : '🔬 Explore'}
        </Btn>
      </div>

      {err && <div style={{ color: C.red, fontSize: 12, background: C.redDim, border: `1px solid rgba(248,113,113,.3)`, borderRadius: 6, padding: '8px 12px' }}>{err}</div>}

      {/* Results */}
      {mode === 'formulas' && formulas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: selected.color, fontFamily: 'monospace' }}>{selected.owner}.{selected.name}</span>
            <span style={{ fontSize: 10, color: C.text4 }}>{formulas.length} columns extracted</span>
            {ddl && (
              <button onClick={() => { const w = window.open('', '_blank'); w?.document.write(`<pre style="font:12px monospace;padding:20px;background:#070d1a;color:#94a3b8">${ddl.replace(/</g,'&lt;')}</pre>`) }}
                style={{ fontSize: 10, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4, color: C.text3, cursor: 'pointer', padding: '2px 8px' }}>
                Open Full DDL ↗
              </button>
            )}
          </div>
          <FormulaTable formulas={formulas} />
        </div>
      )}

      {mode === 'tree' && tree && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: C.text3 }}>
            Click a node to expand. Click <strong style={{ color: C.text2 }}>SQL</strong> to view DDL inline.
          </div>
          <div style={{ background: C.surf1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', overflowX: 'auto' }}>
            <TreeNode node={tree} depth={0} />
          </div>
        </div>
      )}

      {!loading && mode === 'formulas' && formulas.length === 0 && !err && (
        <div style={{ color: C.text4, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>
          Select a view and click 🔬 Explore to read its column formulas from Oracle.
        </div>
      )}
      {!loading && mode === 'tree' && !tree && !err && (
        <div style={{ color: C.text4, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>
          Select a view and click 🔬 Explore to recursively resolve its dependency tree.
        </div>
      )}
    </div>
  )
}

// ── MC Variables Panel ────────────────────────────────────────────────────────

type MCVarsGroup = {
  title: string
  subtitle: string
  color: string
  fields: {
    key: keyof MCVars
    label: string
    unit: string
    formula: string
    desc: string
    step?: number
  }[]
}

const MC_VARS_GROUPS: MCVarsGroup[] = [
  {
    title: 'Achievement Logic', subtitle: 'USE_ACH / PBS_ACHV in T_MC_BASE & T_BASE_3',
    color: '#38bdf8',
    fields: [
      { key: 'pbs_fill_threshold', label: 'PBS Fill Threshold', unit: 'ratio', step: 0.01,
        formula: 'CASE WHEN PBS_FILL > 0.85 THEN …',
        desc: 'If current fill (ADJ_STK/PBS) is above this, apply "well-stocked" achievement floor' },
      { key: 'achv_min_high_fill', label: 'Achv Min (High Fill)', unit: 'ratio', step: 0.01,
        formula: 'GREATEST(ACHV_PER, 0.70)',
        desc: 'Minimum achievement multiplier when store is well-stocked (PBS_FILL > threshold)' },
      { key: 'achv_min_low_fill', label: 'Achv Min (Low Fill)', unit: 'ratio', step: 0.01,
        formula: 'GREATEST(ACHV_PER, 1.00)',
        desc: 'Minimum achievement multiplier when store is under-stocked' },
      { key: 'achv_cap_a_grade', label: 'Achv Cap — A/A+ Grade', unit: 'ratio', step: 0.05,
        formula: 'CASE WHEN STORE_GRADE IN (\'A\',\'A+\') THEN 1.25',
        desc: 'Maximum achievement cap for A and A+ stores (and NSO within nso_months)' },
      { key: 'achv_cap_standard', label: 'Achv Cap — Standard', unit: 'ratio', step: 0.05,
        formula: 'ELSE 1.50',
        desc: 'Maximum achievement cap for all other store grades' },
      { key: 'nso_months', label: 'NSO Grace Months', unit: 'months', step: 1,
        formula: 'OPENING_DATE >= ADD_MONTHS(TRUNC(SYSDATE,\'MM\'), -2)',
        desc: 'Store opened within this many months → treated as A-grade for achievement cap' },
      { key: 'nso_days_old', label: 'NSO Simple Formula Days', unit: 'days', step: 1,
        formula: 'TRUNC(SYSDATE) - TRUNC(OPENING_DATE) < 60',
        desc: 'Store younger than this uses simpler FNL_PBS formula (no MDQ×2 cap)' },
    ],
  },
  {
    title: 'Season Stock Degrow Weights', subtitle: 'AW25/SS25 weights in T_BASE_1 & T_BASE_2',
    color: '#a78bfa',
    fields: [
      { key: 'degrow_thresh_severe', label: 'Degrow Threshold — Severe', unit: 'ratio', step: 0.05,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.50',
        desc: 'Below this degrow rate → ">-50%" bucket (worst weighting)' },
      { key: 'degrow_thresh_mid', label: 'Degrow Threshold — Mid', unit: 'ratio', step: 0.05,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.30',
        desc: 'Between severe and this → "-30% to -50%" bucket' },
      { key: 'aw25_weight_severe', label: 'AW25 Weight — Severe Bucket', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.50 THEN 0',
        desc: 'AW25 stock weight when fresh stock declined >50% vs LY' },
      { key: 'aw25_weight_mid', label: 'AW25 Weight — Mid Bucket', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.30 THEN 0.50',
        desc: 'AW25 stock weight when fresh stock declined 30–50% vs LY' },
      { key: 'aw25_weight_mild', label: 'AW25 Weight — Mild / Above', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= 0 THEN 1.00 ELSE 1.00',
        desc: 'AW25 stock weight when fresh stock declined <30% or grew' },
      { key: 'ss25_weight_severe', label: 'SS25 Weight — Severe Bucket', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.50 THEN 0',
        desc: 'SS25 stock weight when fresh stock declined >50% vs LY' },
      { key: 'ss25_weight_mid', label: 'SS25 Weight — Mid Bucket', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= -0.30 THEN 0.30',
        desc: 'SS25 stock weight when fresh stock declined 30–50% vs LY' },
      { key: 'ss25_weight_mild', label: 'SS25 Weight — Mild Bucket', unit: 'weight', step: 0.1,
        formula: 'WHEN FRESH_STOCK_DEGROW <= 0 THEN 0.50',
        desc: 'SS25 stock weight when fresh stock declined <30% vs LY' },
      { key: 'ss25_weight_above', label: 'SS25 Weight — Growth Bucket', unit: 'weight', step: 0.1,
        formula: 'ELSE 1.00',
        desc: 'SS25 stock weight when fresh stock grew vs LY' },
      { key: 'older_weight', label: 'Older Stock Weight', unit: 'weight', step: 0.1,
        formula: '0 AS OLDER_WEIGHT',
        desc: 'Weight applied to old stock (pre-SS25). Currently 0 — old stock excluded' },
    ],
  },
  {
    title: 'PBS Projection', subtitle: 'Weighted PBS across 6 × period days in PBS_ACHV',
    color: '#4ade80',
    fields: [
      { key: 'pbs_period_days', label: 'PBS Period Days', unit: 'days', step: 1,
        formula: 'LEAST(GREATEST(MC_STR - 0, 0), 30) — each period is 30 days',
        desc: 'Days in each projection period. MC_STR (days of cover) is split into 30-day bands × 6 PROJs' },
    ],
  },
  {
    title: 'Fill Rate Buckets', subtitle: 'Thresholds in T_BASE_6 FILL_RATE_BUCKET',
    color: '#fb923c',
    fields: [
      { key: 'fill_bucket_low', label: 'Fill Bucket — Low Threshold', unit: 'ratio', step: 0.05,
        formula: 'WHEN FILL_RATE < 0.50 THEN \'1.<50%\'',
        desc: 'Below this fill rate → bucket "1.<50%"' },
      { key: 'fill_bucket_mid_low', label: 'Fill Bucket — Mid-Low Threshold', unit: 'ratio', step: 0.05,
        formula: 'WHEN FILL_RATE < 0.70 THEN \'2.50%-70%\'',
        desc: 'Below this fill rate → bucket "2.50%-70%"' },
      { key: 'fill_bucket_mid', label: 'Fill Bucket — Mid Threshold', unit: 'ratio', step: 0.05,
        formula: 'WHEN FILL_RATE < 0.80 THEN \'3.70%-80%\'',
        desc: 'Below this fill rate → bucket "3.70%-80%"' },
      { key: 'fill_bucket_high', label: 'Fill Bucket — High Threshold', unit: 'ratio', step: 0.05,
        formula: 'WHEN FILL_RATE < 1.00 THEN \'4.80%-100%\' ELSE \'5.>=100%\'',
        desc: 'Below this fill rate → bucket "4.80%-100%", at or above → "5.>=100%"' },
    ],
  },
]

function MCVarsPanel({ setId, config, onRefresh }: { setId: string; config: FactorConfig; onRefresh: () => void }) {
  const merged: MCVars = { ...MC_VARS_DEFAULT, ...(config.mc_vars ?? {}) }
  const [form, setForm] = useState<MCVars>({ ...merged })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const changed = (k: keyof MCVars) => form[k] !== merged[k]
  const anyChanged = (Object.keys(form) as (keyof MCVars)[]).some(changed)

  function reset() { setForm({ ...merged }) }

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await apiFetch('PUT', `/factors/${setId}/config`, { ...config, mc_vars: form })
      onRefresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) { alert('Save failed: ' + e) }
    finally { setSaving(false) }
  }

  const numInp = (k: keyof MCVars): React.CSSProperties => ({
    background: 'transparent', border: `1px solid ${changed(k) ? C.amber : C.border}`,
    borderRadius: 5, color: changed(k) ? C.amber : C.blue,
    fontSize: 16, fontWeight: 700, padding: '4px 8px', width: '100%',
    outline: 'none', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
    textAlign: 'right' as const,
  })

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Origin banner */}
      <div style={{ background: 'rgba(56,189,248,.07)', border: `1px solid rgba(56,189,248,.2)`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>🔍</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 2 }}>
            Variables extracted from <span style={{ fontFamily: 'monospace' }}>CK_A2166.V_MC_REQ_APPS_2</span>
          </div>
          <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.5 }}>
            Each value below is a hardcoded constant in the Oracle view DDL. Overriding here updates the Python
            replication engine. The Oracle view itself is unchanged — it remains the default until the Python engine is fully validated.
          </div>
        </div>
      </div>

      {/* Groups */}
      {MC_VARS_GROUPS.map(group => (
        <div key={group.title}>
          <SectionTitle>
            <span style={{ color: group.color }}>{group.title}</span>
            <span style={{ fontSize: 9, color: C.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{group.subtitle}</span>
          </SectionTitle>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
            {group.fields.map(f => (
              <div key={f.key} style={{
                background: C.surf1, border: `1px solid ${changed(f.key) ? C.amber : C.border}`,
                borderRadius: 8, padding: '10px 12px',
                boxShadow: changed(f.key) ? `0 0 0 1px rgba(251,191,36,.15)` : 'none',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                  {f.label}
                  {changed(f.key) && <span style={{ color: C.amber, marginLeft: 6 }}>● modified</span>}
                </div>

                <input
                  type="number" step={f.step ?? 0.01}
                  style={numInp(f.key)}
                  value={String(form[f.key])}
                  onChange={e => setForm(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                />

                <div style={{ fontSize: 9, color: C.text4, marginTop: 4 }}>{f.unit}</div>

                <div style={{ fontSize: 9, color: C.text3, marginTop: 6, lineHeight: 1.5 }}>{f.desc}</div>

                <div style={{
                  marginTop: 8, padding: '4px 8px', background: C.bg, borderRadius: 4,
                  border: `1px solid ${C.border2}`, fontFamily: 'monospace', fontSize: 9,
                  color: '#475569', wordBreak: 'break-word' as const,
                }}>
                  {f.formula}
                </div>

                {changed(f.key) && (
                  <div style={{ marginTop: 6, fontSize: 9, color: C.text4 }}>
                    Oracle default: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{merged[f.key]}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: `1px solid ${C.border2}` }}>
        <Btn variant="primary" onClick={save} disabled={saving || !anyChanged} style={{ fontSize: 12, padding: '6px 18px' }}>
          {saving ? 'Saving…' : 'Save MC Variables'}
        </Btn>
        {anyChanged && <Btn variant="ghost" onClick={reset} disabled={saving}>Reset to Oracle defaults</Btn>}
        {saved && <span style={{ fontSize: 11, color: C.green }}>✓ Saved</span>}
        {!anyChanged && !saved && <span style={{ fontSize: 11, color: C.text4 }}>No changes</span>}
      </div>
    </div>
  )
}

// ── BC Variables Panel ────────────────────────────────────────────────────────

function BCVarsPanel({ setId, config, onRefresh }: { setId: string; config: FactorConfig; onRefresh: () => void }) {
  const merged: BCVars = { ...BC_VARS_DEFAULT, ...(config.bc_vars ?? {}) }
  const [form, setForm] = useState<BCVars>({ ...merged })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function changedNum(k: keyof BCVars) { return form[k] !== merged[k] }
  const anyChanged = (Object.keys(form) as (keyof BCVars)[]).some(k => form[k] !== merged[k])
  function reset() { setForm({ ...merged }) }

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await apiFetch('PUT', `/factors/${setId}/config`, { ...config, bc_vars: form })
      onRefresh(); setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { alert('Save failed: ' + e) }
    finally { setSaving(false) }
  }

  const numStyle = (k: keyof BCVars): React.CSSProperties => ({
    background: 'transparent', border: `1px solid ${changedNum(k) ? C.amber : C.border}`,
    borderRadius: 5, color: changedNum(k) ? C.amber : C.blue,
    fontSize: 16, fontWeight: 700, padding: '4px 8px', width: '100%',
    outline: 'none', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', textAlign: 'right' as const,
  })
  const strStyle = (k: keyof BCVars): React.CSSProperties => ({
    background: C.surf1, border: `1px solid ${changedNum(k) ? C.amber : C.border}`,
    borderRadius: 5, color: changedNum(k) ? C.amber : C.text1,
    fontSize: 12, padding: '5px 9px', width: '100%', outline: 'none', fontFamily: 'monospace',
  })

  function Field({ k, label, unit, formula, desc, type = 'number', step = 1 }: {
    k: keyof BCVars; label: string; unit: string; formula: string; desc: string
    type?: 'number' | 'text' | 'toggle'; step?: number
  }) {
    const isChanged = changedNum(k)
    return (
      <div style={{
        background: C.surf1, border: `1px solid ${isChanged ? C.amber : C.border}`,
        borderRadius: 8, padding: '10px 12px',
        boxShadow: isChanged ? `0 0 0 1px rgba(251,191,36,.15)` : 'none',
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
          {label}{isChanged && <span style={{ color: C.amber, marginLeft: 6 }}>● modified</span>}
        </div>
        {type === 'toggle' ? (
          <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 5, overflow: 'hidden', marginBottom: 4 }}>
            {[true, false].map(v => (
              <button key={String(v)} onClick={() => setForm(p => ({ ...p, [k]: v }))}
                style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
                  background: form[k] === v ? (v ? 'rgba(74,222,128,.15)' : 'rgba(248,113,113,.1)') : 'transparent',
                  color: form[k] === v ? (v ? C.green : C.red) : C.text4 }}>
                {v ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        ) : type === 'text' ? (
          <input style={strStyle(k)} value={String(form[k])}
            onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} />
        ) : (
          <input type="number" step={step} style={numStyle(k)} value={String(form[k])}
            onChange={e => setForm(p => ({ ...p, [k]: Number(e.target.value) }))} />
        )}
        <div style={{ fontSize: 9, color: C.text4, marginTop: 3 }}>{unit}</div>
        <div style={{ fontSize: 9, color: C.text3, marginTop: 5, lineHeight: 1.5 }}>{desc}</div>
        <div style={{ marginTop: 7, padding: '3px 8px', background: C.bg, borderRadius: 4, border: `1px solid ${C.border2}`, fontFamily: 'monospace', fontSize: 9, color: '#475569', wordBreak: 'break-word' as const }}>{formula}</div>
        {isChanged && <div style={{ marginTop: 5, fontSize: 9, color: C.text4 }}>Oracle default: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{String(merged[k])}</span></div>}
      </div>
    )
  }

  return (
    <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Origin banner */}
      <div style={{ background: 'rgba(167,139,250,.07)', border: `1px solid rgba(167,139,250,.2)`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>📦</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 2 }}>
            Variables extracted from <span style={{ fontFamily: 'monospace' }}>CK_A2166.V_BARCODE_REQ_APPS_WMS_V2</span>
          </div>
          <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.5 }}>
            Barcode-level WMS allocation: CROSS JOIN of warehouse stock × stores, filtered by listing rules,
            PBS computed per SKU using article grid × store grade multipliers and size-based caps.
          </div>
        </div>
      </div>

      {/* Group 1: Store Scope */}
      <div>
        <SectionTitle>
          <span style={{ color: '#38bdf8' }}>Store Scope</span>
          <span style={{ fontSize: 9, color: C.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            T_STORE — grade override &amp; status filter
          </span>
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
          <Field k="east_zone_districts" type="text" label="East Zone Districts" unit="comma-separated"
            formula="CASE WHEN DISTRICT IN ('BIHAR-PUJA','EAST','NORTH EAST') THEN 'A'"
            desc="Districts whose stores are treated as Grade A for PBS purposes regardless of actual grade" />
          <Field k="east_zone_grade" type="text" label="East Zone Grade Override" unit="grade label"
            formula="ELSE STORE_GRADE END AS STORE_GRADE"
            desc="The grade assigned to stores in east zone districts" />
          <Field k="include_upcoming_stores" type="toggle" label="Include Upcoming Stores" unit="boolean"
            formula="WHERE STORE_STATUS IN ('ACTIVE','UPCOMING_STORE')"
            desc="When Yes, UPCOMING_STORE stores participate in the allocation cross join" />
        </div>
      </div>

      {/* Group 2: MAX_GRID Multipliers */}
      <div>
        <SectionTitle>
          <span style={{ color: '#a78bfa' }}>MAX_GRID Multipliers</span>
          <span style={{ fontSize: 9, color: C.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            T_MAIN — PBS ceiling = LEAST(cap, GREATEST(MAX_GRID × DESC4, SL_PBS))
          </span>
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
          <Field k="ready_max_grid" type="number" step={1} label="READY Article MAX_GRID" unit="units"
            formula="WHEN DESC6 = 'READY' THEN 4"
            desc="Flat MAX_GRID for READY-tagged articles, ignoring grade and season" />
          <Field k="a_grade_summer_mult" type="number" step={0.5} label="A+/A Grade — Summer Multiplier" unit="× ART_GRID"
            formula="WHEN STORE_GRADE IN ('A+','A') AND ATTRIBUTE1 = 'SUMMER' THEN ART_GRID * 3"
            desc="MAX_GRID = article base grid × this for A/A+ stores in Summer season" />
          <Field k="a_grade_regular_mult" type="number" step={0.5} label="A+/A Grade — Regular Multiplier" unit="× ART_GRID"
            formula="WHEN STORE_GRADE IN ('A+','A') AND ATTRIBUTE1 = 'REGULAR' THEN ART_GRID * 2"
            desc="MAX_GRID = article base grid × this for A/A+ stores in Regular season" />
          <Field k="b_plus_adder_not_winter" type="number" step={1} label="B+ Grade — Non-Winter Adder" unit="+ ART_GRID"
            formula="WHEN STORE_GRADE IN ('B+') AND ATTRIBUTE1 NOT LIKE '%WINTER%' THEN ART_GRID + 3"
            desc="MAX_GRID = article base grid + this for B+ stores outside winter" />
          <Field k="b_plus_adder_winter" type="number" step={1} label="B+ Grade — Winter Adder" unit="+ ART_GRID"
            formula="WHEN STORE_GRADE IN ('B+') THEN ART_GRID + 3"
            desc="MAX_GRID = article base grid + this for B+ stores in winter" />
          <Field k="other_adder_not_winter" type="number" step={1} label="Other Grades — Non-Winter Adder" unit="+ ART_GRID"
            formula="WHEN ATTRIBUTE1 NOT LIKE '%WINTER%' THEN ART_GRID + 2"
            desc="MAX_GRID = article base grid + this for B/C grade stores outside winter" />
        </div>
      </div>

      {/* Group 3: PBS Caps */}
      <div>
        <SectionTitle>
          <span style={{ color: '#4ade80' }}>PBS Caps by SKU Type</span>
          <span style={{ fontSize: 9, color: C.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            T_BARCODE_PBS — PBS = LEAST(cap, GREATEST(MAX_GRID × DESC4, SL_PBS))
          </span>
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
          <Field k="pbs_cap_sized_items" type="number" step={1} label="PBS Cap — Sized Items" unit="units"
            formula="WHEN CAT4 IN ('26','28',...,'XL','XXL') THEN 12"
            desc="Cap for numeric waist sizes (26–42) and letter sizes (S/M/L/XL/XXL/2XL–5XL)" />
          <Field k="pbs_cap_ready_multiplier" type="number" step={1} label="PBS Cap — READY (× DESC4)" unit="× DESC4"
            formula="WHEN DESC6 = 'READY' THEN DESC4 * 4"
            desc="For READY articles: cap = DESC4 (pack size) × this multiplier" />
          <Field k="pbs_cap_innerwear" type="number" step={1} label="PBS Cap — Innerwear" unit="units"
            formula="WHEN SECTION LIKE '%INNER%' THEN 72"
            desc="Higher cap for innerwear sections due to fast replenishment cycles" />
          <Field k="pbs_cap_bottoms" type="number" step={1} label="PBS Cap — Bottoms / Jeans" unit="units"
            formula="WHEN SECTION LIKE 'M_LOWER' OR DEPARTMENT IN ('LW_L_JEANS','LW_L_TROUSER') THEN 12"
            desc="Low cap for men's lower and women's jeans/trousers (slow-turn, full-price)" />
          <Field k="pbs_cap_default" type="number" step={1} label="PBS Cap — Default" unit="units"
            formula="ELSE 48"
            desc="Default cap applied to all other SKU types not covered above" />
        </div>
      </div>

      {/* Group 4: Sales Projection */}
      <div>
        <SectionTitle>
          <span style={{ color: '#fb923c' }}>Sales Projection</span>
          <span style={{ fontSize: 9, color: C.text4, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            SL_PBS = LAST_WK_SL / sl_window_days × sl_projection_days
          </span>
        </SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
          <Field k="sl_window_days" type="number" step={1} label="Sales Window (days)" unit="days"
            formula="ROUND(LAST_WK_SL / 7 * 30, 0) AS SL_PBS"
            desc="Denominator: the period over which LAST_WK_SL was accumulated (default 7 = 1 week)" />
          <Field k="sl_projection_days" type="number" step={1} label="Projection Period (days)" unit="days"
            formula="LAST_WK_SL / 7 * 30"
            desc="Numerator: the forward period we project sales into (default 30 = ~1 month)" />
        </div>
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: `1px solid ${C.border2}` }}>
        <Btn variant="primary" onClick={save} disabled={saving || !anyChanged} style={{ fontSize: 12, padding: '6px 18px' }}>
          {saving ? 'Saving…' : 'Save BC Variables'}
        </Btn>
        {anyChanged && <Btn variant="ghost" onClick={reset} disabled={saving}>Reset to Oracle defaults</Btn>}
        {saved && <span style={{ fontSize: 11, color: C.green }}>✓ Saved</span>}
        {!anyChanged && !saved && <span style={{ fontSize: 11, color: C.text4 }}>No changes</span>}
      </div>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

type DetailTab = 'config' | 'grades' | 'divisions' | 'mcvars' | 'bcvars' | 'deepdive'

function DetailPanel({ fs, onRefresh, onDelete }: { fs: FactorSet; onRefresh: () => void; onDelete: () => void }) {
  const [tab, setTab] = useState<DetailTab>('config')
  const [activating, setActivating] = useState(false)
  const [cloning, setCloning] = useState(false)

  async function activate() {
    setActivating(true)
    try { await apiFetch('PATCH', `/factors/${fs.id}`, { is_active: true }); onRefresh() }
    catch (e) { alert('Failed: ' + e) }
    finally { setActivating(false) }
  }

  async function handleClone() {
    const name = prompt('New factor set name:', `${fs.name} (copy)`)
    if (!name) return
    setCloning(true)
    try { await apiFetch('POST', `/factors/${fs.id}/clone?new_name=${encodeURIComponent(name)}`); onRefresh() }
    catch (e) { alert('Clone failed: ' + e) }
    finally { setCloning(false) }
  }

  async function handleDelete() {
    if (fs.is_active) { alert('Cannot delete the active factor set.'); return }
    if (!confirm(`Delete "${fs.name}"? This cannot be undone.`)) return
    try { await apiFetch('DELETE', `/factors/${fs.id}`); onDelete(); onRefresh() }
    catch (e) { alert('Delete failed: ' + e) }
  }

  const cfg = fs.config

  const tabStyle = (t: DetailTab): React.CSSProperties => ({
    background: 'transparent', border: 'none',
    borderBottom: `2px solid ${tab === t ? C.blue : 'transparent'}`,
    padding: '9px 14px', fontSize: 12, fontWeight: tab === t ? 600 : 500,
    color: tab === t ? C.blue : C.text3, cursor: 'pointer', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center', gap: 5,
  })
  const countBadge = (n: number) => (
    <span style={{ background: C.surf3, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 9, fontWeight: 700, color: C.text3, padding: '0 5px', lineHeight: '14px' }}>
      {n}
    </span>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: C.bg, minHeight: 0 }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 0', borderBottom: `1px solid ${C.border2}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text1, letterSpacing: '-.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
              {fs.name}
              {fs.is_active && <ActiveBadge />}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
              {fs.attribute1 && <Tag color="blue">{fs.attribute1}</Tag>}
              {fs.season    && <Tag color="purple">{fs.season}</Tag>}
              <Tag color="dim">Updated {fmtDate(fs.updated_at)}</Tag>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {!fs.is_active && (
              <Btn variant="green" onClick={activate} disabled={activating} style={{ fontSize: 11, padding: '4px 12px' }}>
                {activating ? '…' : 'Set Active'}
              </Btn>
            )}
            <Btn variant="ghost" onClick={handleClone} disabled={cloning}>Clone</Btn>
            <Btn variant="ghost" onClick={() => window.open(`/api/factors/${fs.id}/export`, '_blank')}>Export ↓</Btn>
            <Btn variant="danger" onClick={handleDelete}>Delete</Btn>
          </div>
        </div>

        {/* Summary bar */}
        <div style={{ display: 'flex', gap: 1 }}>
          {[
            { val: cfg?.safety_days ?? '—',                   lbl: 'Safety Days' },
            { val: cfg ? `${(cfg.fill_rate_target * 100).toFixed(0)}%` : '—', lbl: 'Fill Rate' },
            { val: cfg?.min_alloc_qty ?? '—',                 lbl: 'Min Alloc' },
            { val: cfg ? `${cfg.max_alloc_factor}×` : '—',   lbl: 'Max Factor' },
            { val: fs.grade_factors.length,                   lbl: 'Grades' },
            { val: fs.division_factors.length,                lbl: 'Divisions' },
          ].map((s, i, arr) => (
            <div key={s.lbl} style={{
              flex: 1, background: C.surf2, padding: '6px 8px', textAlign: 'center',
              borderRadius: i === 0 ? '7px 0 0 0' : i === arr.length - 1 ? '0 7px 0 0' : 0,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.blue, fontVariantNumeric: 'tabular-nums' }}>{s.val}</div>
              <div style={{ fontSize: 9, color: C.text3, marginTop: 1, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '0 20px', background: C.surf1, borderBottom: `1px solid ${C.border2}` }}>
        <button style={tabStyle('config')} onClick={() => setTab('config')}>⚙ Global Config</button>
        <button style={tabStyle('grades')} onClick={() => setTab('grades')}>
          Grade Factors {countBadge(fs.grade_factors.length)}
        </button>
        <button style={tabStyle('divisions')} onClick={() => setTab('divisions')}>
          Division Factors {countBadge(fs.division_factors.length)}
        </button>
        <button style={tabStyle('mcvars')} onClick={() => setTab('mcvars')}>
          📐 MC Variables
        </button>
        <button style={tabStyle('bcvars')} onClick={() => setTab('bcvars')}>
          📦 BC Variables
        </button>
        <button style={tabStyle('deepdive')} onClick={() => setTab('deepdive')}>
          🔬 View Logic
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'config' && cfg && <ConfigPanel setId={fs.id} config={cfg} onRefresh={onRefresh} />}
        {tab === 'config' && !cfg && <div style={{ padding: 32, color: C.text3, fontSize: 13, textAlign: 'center' }}>No config set</div>}
        {tab === 'grades'    && <GradeTable    setId={fs.id} grades={fs.grade_factors}     onRefresh={onRefresh} />}
        {tab === 'divisions' && <DivisionTable setId={fs.id} divisions={fs.division_factors} onRefresh={onRefresh} />}
        {tab === 'mcvars'    && cfg && <MCVarsPanel setId={fs.id} config={cfg} onRefresh={onRefresh} />}
        {tab === 'mcvars'    && !cfg && <div style={{ padding: 32, color: C.text3, fontSize: 13, textAlign: 'center' }}>No config set</div>}
        {tab === 'bcvars'    && cfg && <BCVarsPanel setId={fs.id} config={cfg} onRefresh={onRefresh} />}
        {tab === 'bcvars'    && !cfg && <div style={{ padding: 32, color: C.text3, fontSize: 13, textAlign: 'center' }}>No config set</div>}
        {tab === 'deepdive'  && <ViewDeepDive />}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Factors() {
  const isMobile = useIsMobile()
  const [sets, setSets] = useState<FactorSet[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<FactorSet | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [mobileShowDetail, setMobileShowDetail] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const loadSets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ factor_sets: FactorSet[] }>('GET', '/factors')
      setSets(data.factor_sets)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  const loadSelected = useCallback(async (id: string) => {
    try { setSelected(await apiFetch<FactorSet>('GET', `/factors/${id}`)) }
    catch (e) { console.error(e) }
  }, [])

  useEffect(() => { loadSets() }, [loadSets])
  useEffect(() => {
    if (selectedId) loadSelected(selectedId)
    else setSelected(null)
  }, [selectedId, loadSelected])

  function handleRefresh() { loadSets(); if (selectedId) loadSelected(selectedId) }
  function handleCreated(fs: FactorSet) { setShowCreate(false); loadSets(); setSelectedId(fs.id) }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await http.post<{ success: boolean; data: FactorSet; message: string }>('/api/factors/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data.success) { loadSets(); setSelectedId(res.data.data.id) }
      else alert('Import failed: ' + res.data.message)
    } catch (err) { alert('Import error: ' + err) }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const totalSets  = sets.length
  const activeSets = sets.filter(s => s.is_active).length
  const draftSets  = totalSets - activeSets

  const miniChip = (label: string, color: string, bg: string, borderColor: string) => (
    <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 4, border: `1px solid ${borderColor}`, color, background: bg }}>
      {label}
    </span>
  )

  return (
    <div style={{ display: 'flex', gap: 0, height: isMobile ? 'calc(100dvh - 80px)' : 'calc(100vh - 100px)', minHeight: 0, flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Mobile: back button when detail is showing */}
      {isMobile && mobileShowDetail && (
        <button onClick={() => setMobileShowDetail(false)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          background: 'none', border: 'none', borderBottom: '1px solid #334155',
          color: '#38bdf8', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
        }}>← Back to factor sets</button>
      )}

      {/* Sidebar — hidden on mobile when detail is showing */}
      <div style={{ width: isMobile ? '100%' : 260, flexShrink: 0, display: isMobile && mobileShowDetail ? 'none' : 'flex', flexDirection: 'column', background: C.surf1, borderRight: isMobile ? 'none' : `1px solid ${C.border2}`, borderRadius: isMobile ? 8 : '8px 0 0 8px', overflow: 'hidden' }}>

        {/* Brand + stats */}
        <div style={{ padding: '18px 14px 12px', borderBottom: `1px solid ${C.border2}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text1, letterSpacing: '-.2px' }}>Calc Factors</div>
          <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>Replenishment business rules</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {[
              { val: totalSets,  lbl: 'Total',  col: C.text1 },
              { val: activeSets, lbl: 'Active',  col: C.green },
              { val: draftSets,  lbl: 'Draft',   col: C.text3 },
            ].map(s => (
              <div key={s.lbl} style={{ flex: 1, background: C.surf2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: s.col, fontVariantNumeric: 'tabular-nums' }}>{s.val}</div>
                <div style={{ fontSize: 9, color: C.text3, marginTop: 1, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: '8px 10px', display: 'flex', gap: 5, borderBottom: `1px solid ${C.border2}` }}>
          <button
            style={{ flex: 1, background: C.blue, border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 10px', cursor: 'pointer' }}
            onClick={() => { setShowCreate(s => !s); setSelectedId(null) }}>
            {showCreate ? '✕ Cancel' : '＋ New Set'}
          </button>
          <Btn variant="ghost" style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => window.open('/api/factors/template/download', '_blank')}>Template</Btn>
          <Btn variant="ghost" style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? '…' : 'Import'}
          </Btn>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImport} />
        </div>

        {showCreate && <CreateForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />}

        {/* Factor set list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '24px 14px', textAlign: 'center', color: C.text3, fontSize: 12 }}>Loading…</div>}
          {!loading && !sets.length && (
            <div style={{ padding: '24px 14px', textAlign: 'center', color: C.text3, fontSize: 12 }}>
              No factor sets yet.<br />Create one or import Excel.
            </div>
          )}
          {sets.map(fs => (
            <div
              key={fs.id}
              style={{
                padding: '10px 12px', borderBottom: `1px solid ${C.border2}`, cursor: 'pointer',
                borderLeft: `3px solid ${selectedId === fs.id ? C.blue : 'transparent'}`,
                background: selectedId === fs.id ? C.blueDim : 'transparent',
              }}
              onClick={() => { setShowCreate(false); setSelectedId(fs.id); if (isMobile) setMobileShowDetail(true) }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {fs.name}
                {fs.is_active && <ActiveBadge />}
              </div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>
                {[fs.attribute1, fs.season].filter(Boolean).join(' · ')}
                {(fs.attribute1 || fs.season) ? ' · ' : ''}
                {fmtDate(fs.created_at)}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                {miniChip(`${fs.grade_factors?.length ?? 0} grades`, C.lime, 'rgba(163,230,53,.08)', 'rgba(163,230,53,.25)')}
                {miniChip(`${fs.division_factors?.length ?? 0} divisions`, C.blue, 'rgba(56,189,248,.08)', 'rgba(56,189,248,.25)')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main — hidden on mobile when list is showing */}
      <div style={{ flex: 1, display: isMobile && !mobileShowDetail ? 'none' : 'flex', flexDirection: 'column', minWidth: 0, background: C.bg, border: `1px solid ${C.border2}`, borderLeft: isMobile ? undefined : 'none', borderRadius: isMobile ? 8 : '0 8px 8px 0', overflow: 'hidden' }}>
        {!selected && !showCreate && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 60 }}>
            <div style={{ fontSize: 40, opacity: .2 }}>⚙</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text2 }}>Select a factor set</div>
            <div style={{ fontSize: 12, color: C.text3, textAlign: 'center', maxWidth: 240 }}>
              Create a new set or import from Excel to get started.
            </div>
          </div>
        )}
        {selected && (
          <DetailPanel
            fs={selected}
            onRefresh={handleRefresh}
            onDelete={() => { setSelectedId(null); setSelected(null) }}
          />
        )}
      </div>
    </div>
  )
}
