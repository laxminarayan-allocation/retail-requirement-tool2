import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '@/context/AuthContext'

const TOKEN_KEY = 'ck_ss27_token'

function authHeader() {
  const t = localStorage.getItem(TOKEN_KEY)
  return t ? { Authorization: `Bearer ${t}` } : {}
}

interface ProfileData {
  email: string
  full_name: string
  display_name?: string
  designation?: string
  department?: string
  dob?: string
  contact_no?: string
  whatsapp_no?: string
  role?: string
  created_at?: string
}

const FIELD_LABELS: [keyof ProfileData, string][] = [
  ['full_name', 'Full Name'],
  ['display_name', 'Display Name'],
  ['designation', 'Designation'],
  ['department', 'Department'],
  ['dob', 'Date of Birth (YYYY-MM-DD)'],
  ['contact_no', 'Contact No'],
  ['whatsapp_no', 'WhatsApp No'],
]

const READONLY_FIELDS: [keyof ProfileData, string][] = [
  ['email', 'Email'],
  ['role', 'Role'],
  ['created_at', 'Member Since'],
]

export default function MyProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [form, setForm] = useState<Partial<ProfileData>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [edited, setEdited] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    setLoading(true)
    try {
      const res = await axios.get<{ success: boolean; data: ProfileData }>(
        '/api/auth/me/profile',
        { headers: authHeader() }
      )
      if (res.data.success) {
        setProfile(res.data.data)
        setForm({
          full_name: res.data.data.full_name ?? '',
          display_name: res.data.data.display_name ?? '',
          designation: res.data.data.designation ?? '',
          department: res.data.data.department ?? '',
          dob: res.data.data.dob ?? '',
          contact_no: res.data.data.contact_no ?? '',
          whatsapp_no: res.data.data.whatsapp_no ?? '',
        })
      }
    } catch {
      setMsg('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const res = await axios.patch<{ success: boolean; message: string }>(
        '/api/auth/me/profile', form,
        { headers: authHeader() }
      )
      if (res.data.success) {
        setMsg('✓ Profile saved!')
        setEdited(false)
        loadProfile()
      } else {
        setMsg('✗ ' + res.data.message)
      }
    } catch { setMsg('✗ Error saving profile') }
    finally { setSaving(false) }
  }

  const S = {
    page: {
      maxWidth: 560,
      margin: '32px auto',
      padding: '0 16px 40px',
      fontFamily: 'system-ui, sans-serif',
    } as React.CSSProperties,
    card: {
      background: 'var(--card-bg, #0f172a)',
      border: '1px solid var(--card-border, #1e293b)',
      borderRadius: 12,
      padding: 28,
    } as React.CSSProperties,
    header: {
      display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24,
    } as React.CSSProperties,
    avatar: {
      width: 52, height: 52, borderRadius: '50%',
      background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 22, fontWeight: 700, color: '#fff', flexShrink: 0,
    } as React.CSSProperties,
    name: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #f1f5f9)' } as React.CSSProperties,
    meta: { fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 } as React.CSSProperties,
    section: { marginBottom: 6 } as React.CSSProperties,
    label: { fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 3, letterSpacing: '.04em' } as React.CSSProperties,
    input: {
      width: '100%', fontSize: 13,
      background: 'var(--input-bg, #1e293b)', border: '1px solid #334155',
      color: 'var(--text-primary, #f1f5f9)', borderRadius: 6,
      padding: '8px 10px', boxSizing: 'border-box' as const,
      outline: 'none', fontFamily: 'inherit', transition: 'border-color .15s',
    } as React.CSSProperties,
    readonlyVal: {
      fontSize: 13, color: '#94a3b8', padding: '8px 10px',
      background: '#0f172a', border: '1px solid #1e293b',
      borderRadius: 6, fontFamily: 'inherit',
    } as React.CSSProperties,
    divider: { borderTop: '1px solid #1e293b', margin: '20px 0' } as React.CSSProperties,
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' } as React.CSSProperties,
    msgBox: (ok: boolean) => ({
      fontSize: 12, padding: '8px 12px', borderRadius: 6, marginTop: 14,
      color: ok ? '#34d399' : '#f87171',
      background: ok ? 'rgba(52,211,153,.08)' : 'rgba(248,113,113,.08)',
      border: `1px solid ${ok ? 'rgba(52,211,153,.3)' : 'rgba(248,113,113,.3)'}`,
    }) as React.CSSProperties,
  }

  if (loading) return <div style={{ ...S.page, color: '#64748b', paddingTop: 60, textAlign: 'center' }}>Loading profile…</div>
  if (!profile) return <div style={{ ...S.page, color: '#f87171', paddingTop: 60, textAlign: 'center' }}>Could not load profile.</div>

  const initials = (profile.full_name || user?.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.header}>
          <div style={S.avatar}>{initials}</div>
          <div>
            <div style={S.name}>{profile.full_name}</div>
            <div style={S.meta}>{profile.email} · {profile.role}</div>
            {profile.created_at && (
              <div style={{ ...S.meta, marginTop: 1 }}>
                Member since {profile.created_at.slice(0, 10)}
              </div>
            )}
          </div>
        </div>

        <div style={S.divider} />

        <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 16, letterSpacing: '.05em', textTransform: 'uppercase' as const }}>
          Edit Profile
        </div>

        <div style={S.grid}>
          {FIELD_LABELS.map(([key, label]) => (
            <div key={key} style={key === 'full_name' || key === 'display_name' ? { gridColumn: '1 / -1' } : {}}>
              <div style={S.label}>{label}</div>
              <input
                type={key === 'dob' ? 'date' : 'text'}
                value={(form as any)[key] ?? ''}
                onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setEdited(true) }}
                style={S.input}
              />
            </div>
          ))}
        </div>

        {msg && (
          <div style={S.msgBox(msg.startsWith('✓'))}>{msg}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, gap: 8 }}>
          {edited && (
            <button
              onClick={() => { loadProfile(); setEdited(false); setMsg('') }}
              style={{ fontSize: 12, padding: '8px 16px', background: 'none', color: '#64748b', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' }}
            >
              Reset
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || !edited}
            style={{ fontSize: 13, padding: '8px 20px', background: edited ? '#0ea5e9' : '#1e293b', color: edited ? '#fff' : '#475569', border: 'none', borderRadius: 6, cursor: edited ? 'pointer' : 'default', fontWeight: 600, transition: 'all .15s' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
