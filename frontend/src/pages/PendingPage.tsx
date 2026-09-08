import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '@/context/AuthContext'

type ReqStatus = { requested_role: string; status: string; created_at: string } | null

const S: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    background: 'var(--content-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 10,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 8px 32px rgba(0,0,0,.4)',
  },
  icon: {
    width: 48, height: 48, borderRadius: '50%',
    background: 'rgba(234,179,8,.1)',
    border: '1px solid rgba(234,179,8,.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '-.02em' },
  sub: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 28 },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
    letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 6,
  },
  select: {
    width: '100%', background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6,
    padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', outline: 'none',
    marginBottom: 16, boxSizing: 'border-box' as const,
  },
  textarea: {
    width: '100%', background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6,
    padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)', outline: 'none',
    marginBottom: 16, boxSizing: 'border-box' as const, resize: 'vertical' as const,
    minHeight: 80, fontFamily: 'inherit',
  },
  btn: {
    width: '100%', background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 6, padding: '11px 0', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', transition: 'background .15s',
  },
  success: {
    background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)',
    borderRadius: 8, padding: '16px 20px', marginBottom: 20,
  },
  successTitle: { fontSize: 14, fontWeight: 700, color: '#34d399', marginBottom: 4 },
  successSub: { fontSize: 12, color: '#6ee7b7', lineHeight: 1.55 },
  divider: { borderTop: '1px solid #1e3a5f', margin: '24px 0' },
  signoutBtn: {
    background: 'none', border: '1px solid var(--card-border)', borderRadius: 5,
    color: 'var(--text-muted)', fontSize: 12, padding: '7px 14px', cursor: 'pointer', marginTop: 8,
  },
  roleDesc: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 },
}

export default function PendingPage() {
  const { user, signout, refreshMe } = useAuth()
  const [requestedRole, setRequestedRole] = useState('planner')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [existingReq, setExistingReq] = useState<ReqStatus>(null)
  const [error, setError] = useState('')

  // Check if user already has a pending request
  useEffect(() => {
    axios.get('/api/auth/me').then(r => {
      if (r.data.success) setExistingReq(r.data.data.pending_request)
    }).catch(() => {})
  }, [])

  // Poll for role approval
  useEffect(() => {
    const id = setInterval(() => refreshMe(), 10_000)
    return () => clearInterval(id)
  }, [refreshMe])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await axios.post('/api/auth/request-role', {
        requested_role: requestedRole,
        reason: reason.trim() || undefined,
      })
      if (res.data.success) {
        setExistingReq(res.data.data.request)
      } else {
        setError(res.data.message)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <div style={S.icon}>⏳</div>
        <div style={S.title}>Access Pending</div>
        <div style={S.sub}>
          Welcome, <strong style={{ color: 'var(--text-secondary)' }}>{user?.name}</strong>.<br />
          Your account needs approval before you can use the tool. Request a role below — the admin will be notified.
        </div>

        {existingReq && existingReq.status === 'pending' ? (
          <div style={S.success}>
            <div style={S.successTitle}>Request submitted</div>
            <div style={S.successSub}>
              You've requested <strong>{existingReq.requested_role}</strong> access.
              Waiting for admin approval. This page will update automatically.
            </div>
          </div>
        ) : existingReq && existingReq.status === 'denied' ? (
          <>
            <div style={{ ...S.success, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', marginBottom: 20 }}>
              <div style={{ ...S.successTitle, color: '#fca5a5' }}>Request denied</div>
              <div style={{ ...S.successSub, color: '#fca5a5', opacity: .8 }}>
                Your previous request was denied. You can submit a new one below.
              </div>
            </div>
            <RoleRequestForm {...{ requestedRole, setRequestedRole, reason, setReason, submitting, error, submit }} />
          </>
        ) : (
          <RoleRequestForm {...{ requestedRole, setRequestedRole, reason, setReason, submitting, error, submit }} />
        )}

        <div style={S.divider} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          Signed in as <strong style={{ color: 'var(--text-muted)' }}>{user?.email}</strong>
        </div>
        <button style={S.signoutBtn} onClick={signout}>Sign out</button>
      </div>
    </div>
  )
}

function RoleRequestForm({ requestedRole, setRequestedRole, reason, setReason, submitting, error, submit }: any) {
  return (
    <form onSubmit={submit}>
      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#fca5a5', marginBottom: 16 }}>
          {error}
        </div>
      )}
      <label style={S.label}>Role needed</label>
      <select style={S.select} value={requestedRole} onChange={e => setRequestedRole(e.target.value)}>
        <option value="viewer">Viewer — read-only access to results & history</option>
        <option value="planner">Planner — run calculations, manage factors, download Excel</option>
      </select>
      <div style={S.roleDesc}>
        {requestedRole === 'planner'
          ? 'Planners can run replenishment calculations, create/edit factor sets, and download Excel exports.'
          : 'Viewers can browse existing results, history, and master data but cannot trigger calculations.'}
      </div>
      <label style={S.label}>Reason (optional)</label>
      <textarea
        style={S.textarea}
        placeholder="Briefly describe why you need this access…"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <button type="submit" style={{ ...S.btn, opacity: submitting ? .55 : 1 }} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Request Access'}
      </button>
    </form>
  )
}
