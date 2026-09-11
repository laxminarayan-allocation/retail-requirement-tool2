import { useState, useEffect, useCallback, Fragment } from 'react'
import axios from 'axios'
import { DataGrid } from '@/components/DataGrid'
import { useAuth } from '@/context/AuthContext'

type RoleRequest = {
  id: string; user_email: string; user_name: string;
  requested_role: string; from_role: string; reason: string; status: string;
  reviewed_by: string; reviewed_at: string; created_at: string; temp_days: number | null
}
type User = {
  id: string; email: string; full_name: string; role: string;
  is_active: number; created_at: string; last_login_at: string;
  temp_admin_expires_at: string | null;
  max_desktop_sessions?: number; max_mobile_sessions?: number; session_limit_action?: string
}
type Log = {
  id: string; user_email: string; action: string;
  details: string; ip_address: string; created_at: string
}
type AiChat = {
  id: string; user_email: string; user_name: string; user_role: string;
  question: string; answer: string; created_at: string
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#818cf8', temp_admin: '#c084fc', planner: '#34d399', viewer: '#94a3b8', pending: '#d97706',
}
const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', temp_admin: 'Temp Admin', planner: 'Planner', viewer: 'Viewer', pending: 'Pending',
}
// Duration options — hours stored in temp_days column
const TEMP_OPTS = [{h:1,l:'1h'},{h:3,l:'3h'},{h:24,l:'1d'},{h:72,l:'3d'},{h:168,l:'7d'}]
function fmtTempLabel(hours: number | null): string {
  if (!hours) return ''
  const o = TEMP_OPTS.find(o => o.h === hours)
  return o ? o.l : hours < 24 ? `${hours}h` : `${Math.round(hours/24)}d`
}
function fmtExpiry(iso: string): string {
  const d = new Date(iso)
  const diffH = (d.getTime() - Date.now()) / 3600000
  if (diffH < 48) return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "'Segoe UI', system-ui, sans-serif", color: 'var(--text-primary)', maxWidth: 900 },
  h1: { fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4, color: '#f1f5f9' },
  sub: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 28 },
  tabs: { display: 'flex', gap: 2, borderBottom: '1px solid var(--card-border)', marginBottom: 24 },
  tab: (a: boolean): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 13, fontWeight: a ? 600 : 400,
    color: a ? '#38bdf8' : '#64748b', background: 'none', border: 'none',
    borderBottom: a ? '2px solid #38bdf8' : '2px solid transparent',
    cursor: 'pointer', marginBottom: -1,
  }),
  table: { width: '100%', minWidth: 560, borderCollapse: 'collapse' as const, fontSize: 12 },
  tblWrap: { overflowX: 'auto' as const },
  th: {
    textAlign: 'left' as const, padding: '8px 12px', color: 'var(--text-muted)',
    fontWeight: 600, letterSpacing: '.06em', fontSize: 10, textTransform: 'uppercase' as const,
    borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' as const,
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #0f172a', verticalAlign: 'middle' as const },
  badge: (role: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
    color: ROLE_COLOR[role] || '#94a3b8',
    background: (ROLE_COLOR[role] || '#94a3b8') + '18',
    textTransform: 'uppercase' as const,
  }),
  statusBadge: (s: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
    color: s === 'pending' ? '#fcd34d' : s === 'approved' ? '#34d399' : '#f87171',
    background: (s === 'pending' ? '#fcd34d' : s === 'approved' ? '#34d399' : '#f87171') + '18',
    textTransform: 'uppercase' as const,
  }),
  btnSm: (variant: 'approve' | 'deny' | 'neutral'): React.CSSProperties => ({
    padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none',
    borderRadius: 4, cursor: 'pointer',
    background: variant === 'approve' ? 'rgba(52,211,153,.15)' : variant === 'deny' ? 'rgba(248,113,113,.15)' : '#1e293b',
    color: variant === 'approve' ? '#34d399' : variant === 'deny' ? '#f87171' : '#94a3b8',
    marginRight: 6,
  }),
  select: {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4,
    color: 'var(--text-primary)', fontSize: 11, padding: '3px 6px',
  },
  empty: { padding: '32px 0', textAlign: 'center' as const, color: 'var(--text-muted)', fontSize: 13 },
  pendingDot: {
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: '#fcd34d', marginRight: 6,
  },
  sectionHead: { fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12, marginTop: 0 },
}

function SessionLimitCell({ user, onSave }: { user: User; onSave: (md: number, mm: number, act: string) => void }) {
  const [open, setOpen] = useState(false)
  const [desktop, setDesktop] = useState(user.max_desktop_sessions ?? 1)
  const [mobile, setMobile] = useState(user.max_mobile_sessions ?? 1)
  const [action, setAction] = useState(user.session_limit_action ?? 'block')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try { await onSave(desktop, mobile, action); setOpen(false) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        🖥️{user.max_desktop_sessions ?? 1} 📱{user.max_mobile_sessions ?? 1}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 400, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 12, width: 220, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>Session Limits</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#64748b', width: 70 }}>🖥️ Desktop</span>
            <button onClick={() => setDesktop(d => Math.max(0, d - 1))} style={{ padding: '1px 7px', background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: 3, cursor: 'pointer' }}>−</button>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', minWidth: 20, textAlign: 'center' }}>{desktop}</span>
            <button onClick={() => setDesktop(d => d + 1)} style={{ padding: '1px 7px', background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: 3, cursor: 'pointer' }}>+</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#64748b', width: 70 }}>📱 Mobile</span>
            <button onClick={() => setMobile(m => Math.max(0, m - 1))} style={{ padding: '1px 7px', background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: 3, cursor: 'pointer' }}>−</button>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', minWidth: 20, textAlign: 'center' }}>{mobile}</span>
            <button onClick={() => setMobile(m => m + 1)} style={{ padding: '1px 7px', background: '#0f172a', border: '1px solid #334155', color: '#94a3b8', borderRadius: 3, cursor: 'pointer' }}>+</button>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>When limit exceeded:</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setAction('block')} style={{ flex: 1, fontSize: 10, padding: '4px', borderRadius: 4, border: `1px solid ${action === 'block' ? '#f59e0b' : '#334155'}`, background: action === 'block' ? '#78350f' : '#0f172a', color: action === 'block' ? '#fcd34d' : '#64748b', cursor: 'pointer', fontWeight: action === 'block' ? 700 : 400 }}>
                🚫 Block login
              </button>
              <button onClick={() => setAction('kick')} style={{ flex: 1, fontSize: 10, padding: '4px', borderRadius: 4, border: `1px solid ${action === 'kick' ? '#ef4444' : '#334155'}`, background: action === 'kick' ? '#7f1d1d' : '#0f172a', color: action === 'kick' ? '#fca5a5' : '#64748b', cursor: 'pointer', fontWeight: action === 'kick' ? 700 : 400 }}>
                ⚡ Kick oldest
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={save} disabled={saving} style={{ flex: 1, fontSize: 11, padding: '5px', background: '#0ea5e9', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setOpen(false)} style={{ fontSize: 11, padding: '5px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#64748b', cursor: 'pointer' }}>✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminPanel() {
  const { previewRole, setPreviewRole } = useAuth()
  const [tab, setTab] = useState<'requests' | 'users' | 'logs' | 'aichats' | 'access' | 'live'>('requests')
  const [requests, setRequests] = useState<RoleRequest[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [aiChats, setAiChats] = useState<AiChat[]>([])
  const [expandedChat, setExpandedChat] = useState<string | null>(null)
  const [notifyingChat, setNotifyingChat] = useState<string | null>(null)
  const [notifMsg, setNotifMsg] = useState('')
  const [notifSending, setNotifSending] = useState(false)
  const [notifSent, setNotifSent] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  // Temp admin duration picker (Users tab direct set)
  const [tempDaysPicker, setTempDaysPicker] = useState<{ userId: string; days: number } | null>(null)
  // Temp admin duration picker for approving a role request
  const [approveWithDays, setApproveWithDays] = useState<{ reqId: string; days: number } | null>(null)
  // Per-user page access
  const [expandedPageUser, setExpandedPageUser] = useState<string | null>(null)
  const [userPageAccess, setUserPageAccess] = useState<Record<string, Record<string, boolean>>>({})
  const [pageAccessSaving, setPageAccessSaving] = useState(false)
  // Live sessions (admin)
  const [liveSessions, setLiveSessions] = useState<any[]>([])
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveLastRefresh, setLiveLastRefresh] = useState<Date | null>(null)
  // Password reset modal
  const [resetModal, setResetModal] = useState<{ userId: string; email: string; name: string } | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [resetSaving, setResetSaving] = useState(false)

  const ALL_PAGES = [
    { path: '/', label: 'Dashboard', minRole: 'viewer' },
    { path: '/results', label: 'Results', minRole: 'viewer' },
    { path: '/history', label: 'History', minRole: 'viewer' },
    { path: '/nso', label: 'NSO Dashboard', minRole: 'viewer' },
    { path: '/sale', label: 'Sale Dashboard', minRole: 'viewer' },
    { path: '/manual', label: 'User Manual', minRole: 'viewer' },
    { path: '/database', label: 'Database Explorer', minRole: 'planner' },
    { path: '/master-data', label: 'Master Data', minRole: 'planner' },
    { path: '/factors', label: 'Calc Factors', minRole: 'planner' },
    { path: '/calculation', label: 'Calculation', minRole: 'planner' },
    { path: '/req', label: 'Requirements', minRole: 'planner' },
    { path: '/distribution', label: 'Distribution', minRole: 'planner' },
    { path: '/simulation', label: 'Simulation', minRole: 'planner' },
    { path: '/settings', label: 'Settings', minRole: 'planner' },
    { path: '/warehouse', label: 'Warehouse Inventory', minRole: 'planner' },
  ] as const

  // Tab-level access keys — override per-user tab visibility (default = role-based)
  const ALL_TABS = [
    { path: 'dashboard#store-network', label: 'Dashboard → Store Network', page: 'Dashboard', roleDefault: 'viewer' },
    { path: 'dashboard#allocation',    label: 'Dashboard → Allocation Report', page: 'Dashboard', roleDefault: 'planner' },
    { path: 'nso#store',               label: 'NSO Dashboard → Store View', page: 'NSO', roleDefault: 'viewer' },
    { path: 'nso#article',             label: 'NSO Dashboard → Article View', page: 'NSO', roleDefault: 'planner' },
    { path: 'warehouse#pivot',         label: 'Warehouse → Pivot Analysis', page: 'Warehouse', roleDefault: 'viewer' },
    { path: 'warehouse#data',          label: 'Warehouse → Data Table', page: 'Warehouse', roleDefault: 'planner' },
  ]

  useEffect(() => {
    axios.get('/api/assistant/status').then(r => {
      if (!r.data.data?.configured) {
        setWarnings(w => [...w, 'AI Assistant is not configured — set ANTHROPIC_API_KEY in backend/.env to enable the 💬 chat widget for all users.'])
      }
    }).catch(() => {})
  }, [])

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const [all, pending] = await Promise.all([
        axios.get('/api/auth/role-requests'),
        axios.get('/api/auth/role-requests?status=pending'),
      ])
      setRequests(all.data.data?.requests || [])
      setPendingCount(pending.data.data?.total || 0)
    } finally { setLoading(false) }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/auth/users')
      setUsers(res.data.data?.users || [])
    } finally { setLoading(false) }
  }, [])

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/auth/logs?limit=200')
      setLogs(res.data.data?.logs || [])
    } finally { setLoading(false) }
  }, [])

  const loadAiChats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/assistant/logs?limit=200')
      setAiChats(res.data.data?.logs || [])
    } finally { setLoading(false) }
  }, [])

  const loadLiveSessions = useCallback(async () => {
    setLiveLoading(true)
    try {
      const res = await axios.get('/api/auth/admin-sessions')
      setLiveSessions(res.data.data?.sessions || [])
      setLiveLastRefresh(new Date())
    } finally { setLiveLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'requests') loadRequests()
    else if (tab === 'users') loadUsers()
    else if (tab === 'logs') loadLogs()
    else if (tab === 'live') loadLiveSessions()
    else loadAiChats()
  }, [tab, loadRequests, loadUsers, loadLogs, loadLiveSessions])

  async function sendNotification(chat: AiChat) {
    if (!notifMsg.trim()) return
    setNotifSending(true)
    try {
      await axios.post('/api/notifications/send', {
        to_email: chat.user_email,
        subject: 'Re: Your question has been addressed',
        message: notifMsg.trim(),
        chat_log_id: chat.id,
      })
      setNotifSent(chat.id)
      setNotifyingChat(null)
      setNotifMsg('')
      setTimeout(() => setNotifSent(null), 3000)
    } finally { setNotifSending(false) }
  }

  async function reviewRequest(id: string, action: 'approved' | 'denied', temp_days?: number) {
    await axios.patch(`/api/auth/role-requests/${id}`, { action, temp_days })
    setApproveWithDays(null)
    await loadRequests()
    await loadUsers()
  }

  async function changeUserRole(userId: string, role: string, temp_days?: number) {
    await axios.patch(`/api/auth/users/${userId}/role`, { role, temp_days })
    setTempDaysPicker(null)
    await loadUsers()
  }

  async function toggleUserActive(userId: string, isActive: boolean) {
    await axios.patch(`/api/auth/users/${userId}/active?is_active=${isActive}`)
    await loadUsers()
  }

  async function saveSessionLimits(userId: string, maxDesktop: number, maxMobile: number, action: string) {
    await axios.patch(`/api/auth/users/${userId}/session-limits`, {
      max_desktop_sessions: maxDesktop,
      max_mobile_sessions: maxMobile,
      session_limit_action: action,
    })
    await loadUsers()
  }

  async function loadUserPageAccess(userId: string) {
    const res = await axios.get(`/api/auth/users/${userId}/page-access`)
    setUserPageAccess(prev => ({ ...prev, [userId]: res.data.data?.page_access ?? {} }))
  }

  async function toggleExpandPageAccess(userId: string) {
    if (expandedPageUser === userId) {
      setExpandedPageUser(null)
    } else {
      setExpandedPageUser(userId)
      if (!userPageAccess[userId]) await loadUserPageAccess(userId)
    }
  }

  async function setPageAccess(userId: string, pagePath: string, allowed: boolean | null) {
    setPageAccessSaving(true)
    try {
      await axios.post(`/api/auth/users/${userId}/page-access`, { page_path: pagePath, allowed })
      await loadUserPageAccess(userId)
    } finally {
      setPageAccessSaving(false)
    }
  }

  async function resetPassword() {
    if (!resetModal) return
    if (resetPw.length < 6) { setResetMsg({ ok: false, text: 'Password must be at least 6 characters.' }); return }
    setResetSaving(true); setResetMsg(null)
    try {
      const res = await axios.post('/api/auth/forgot-password', { email: resetModal.email, new_password: resetPw })
      const msg = res.data?.message || 'Password reset successfully.'
      setResetMsg({ ok: true, text: msg })
      setResetPw('')
      setTimeout(() => { setResetModal(null); setResetMsg(null) }, 2000)
    } catch (e: any) {
      setResetMsg({ ok: false, text: e?.response?.data?.message || 'Reset failed.' })
    } finally { setResetSaving(false) }
  }

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Admin Panel</h1>
      <p style={S.sub}>Manage user access, approve role requests, and review activity logs.</p>

      {warnings.map((w, i) => (
        <div key={i} style={{
          background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12.5, color: '#fcd34d', fontWeight: 600, marginBottom: 2 }}>Configuration Required</div>
            <div style={{ fontSize: 12, color: '#a16207', lineHeight: 1.5 }}>{w}</div>
          </div>
          <button onClick={() => setWarnings(ws => ws.filter((_, j) => j !== i))}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>
      ))}

      <div style={S.tabs}>
        <button style={S.tab(tab === 'requests')} onClick={() => setTab('requests')}>
          Role Requests
          {pendingCount > 0 && (
            <span style={{ marginLeft: 6, background: '#fcd34d', color: '#0f172a', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8 }}>
              {pendingCount}
            </span>
          )}
        </button>
        <button style={S.tab(tab === 'users')} onClick={() => setTab('users')}>Users</button>
        <button style={S.tab(tab === 'logs')} onClick={() => setTab('logs')}>Activity Logs</button>
        <button style={S.tab(tab === 'aichats')} onClick={() => setTab('aichats')}>
          💬 AI Chats
          {aiChats.length > 0 && (
            <span style={{ marginLeft: 6, background: '#6366f1', color: '#fff', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8 }}>
              {aiChats.length}
            </span>
          )}
        </button>
        <button style={S.tab(tab === 'access')} onClick={() => setTab('access')}>🛡️ Access Matrix</button>
        <button style={S.tab(tab === 'live')} onClick={() => setTab('live')}>
          🟢 Live
          {liveSessions.length > 0 && (
            <span style={{ marginLeft: 6, background: '#22c55e', color: '#0f172a', fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8 }}>
              {liveSessions.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Role Requests ── */}
      {tab === 'requests' && (
        <>
          {requests.filter(r => r.status === 'pending').length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <p style={S.sectionHead}>
                <span style={S.pendingDot} />Pending ({requests.filter(r => r.status === 'pending').length})
              </p>
              <div style={S.tblWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>User</th>
                    <th style={S.th}>Requested</th>
                    <th style={S.th}>Reason</th>
                    <th style={S.th}>Submitted</th>
                    <th style={S.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.filter(r => r.status === 'pending').map(r => (
                    <tr key={r.id}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{r.user_name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.user_email}</div>
                      </td>
                      <td style={S.td}>
                        {r.from_role && <><span style={S.badge(r.from_role)}>{ROLE_LABEL[r.from_role] || r.from_role}</span><span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span></>}
                        <span style={S.badge(r.requested_role)}>{ROLE_LABEL[r.requested_role] || r.requested_role}</span>
                        {r.requested_role === 'temp_admin' && r.temp_days && (
                          <span style={{ fontSize: 10, color: '#a78bfa', marginLeft: 4 }}>({fmtTempLabel(r.temp_days)})</span>
                        )}
                      </td>
                      <td style={S.td}><span style={{ color: 'var(--text-secondary)' }}>{r.reason || '—'}</span></td>
                      <td style={S.td}><span style={{ color: 'var(--text-muted)' }}>{r.created_at?.slice(0, 16).replace('T', ' ')}</span></td>
                      <td style={S.td}>
                        {r.requested_role === 'temp_admin' && approveWithDays?.reqId === r.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' as const }}>
                              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Duration:</span>
                              {TEMP_OPTS.map(o => (
                                <button key={o.h} onClick={() => setApproveWithDays(a => a ? { ...a, days: o.h } : null)}
                                  style={{ fontSize: 9, padding: '2px 5px', background: approveWithDays.days === o.h ? '#7c3aed' : '#1e293b', color: approveWithDays.days === o.h ? '#fff' : '#64748b', border: '1px solid var(--card-border)', borderRadius: 3, cursor: 'pointer' }}>
                                  {o.l}
                                </button>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button style={S.btnSm('approve')} onClick={() => reviewRequest(r.id, 'approved', approveWithDays.days)}>
                                Approve {fmtTempLabel(approveWithDays.days)}
                              </button>
                              <button style={S.btnSm('deny')} onClick={() => setApproveWithDays(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button style={S.btnSm('approve')} onClick={() => {
                              if (r.requested_role === 'temp_admin') {
                                setApproveWithDays({ reqId: r.id, days: r.temp_days || 24 })
                              } else {
                                reviewRequest(r.id, 'approved')
                              }
                            }}>Approve</button>
                            <button style={S.btnSm('deny')} onClick={() => reviewRequest(r.id, 'denied')}>Deny</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
          <p style={{ ...S.sectionHead, marginTop: 8 }}>All requests</p>
          {requests.length === 0
            ? <div style={S.empty}>{loading ? 'Loading…' : 'No requests yet.'}</div>
            : (
              <div style={S.tblWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>User</th>
                    <th style={S.th}>Role</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Reviewed by</th>
                    <th style={S.th}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id}>
                      <td style={S.td}>
                        <div style={{ color: 'var(--text-secondary)' }}>{r.user_name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.user_email}</div>
                      </td>
                      <td style={S.td}><span style={S.badge(r.requested_role)}>{r.requested_role}</span></td>
                      <td style={S.td}><span style={S.statusBadge(r.status)}>{r.status}</span></td>
                      <td style={S.td}><span style={{ color: 'var(--text-muted)' }}>{r.reviewed_by || '—'}</span></td>
                      <td style={S.td}><span style={{ color: 'var(--text-muted)' }}>{(r.reviewed_at || r.created_at)?.slice(0, 16).replace('T', ' ')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )
          }
        </>
      )}

      {/* ── Users ── */}
      {tab === 'users' && (
        users.length === 0
          ? <div style={S.empty}>{loading ? 'Loading…' : 'No users.'}</div>
          : (
            <div style={S.tblWrap}>
            <table style={{ ...S.table, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={S.th}>User</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Last login</th>
                  <th style={S.th}>Change role</th>
                  <th style={S.th}>Active</th>
                  <th style={S.th}>Sessions</th>
                  <th style={S.th}>Page Access</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const pa = userPageAccess[u.id] ?? null
                  const isExpanded = expandedPageUser === u.id
                  const overrideCount = pa ? Object.keys(pa).length : 0
                  return (
                    <Fragment key={u.id}>
                      <tr>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{u.full_name}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{u.email}</div>
                          {(['viewer', 'planner'] as const).includes(u.role as any) && (
                            <button
                              onClick={() => setPreviewRole(previewRole === u.role as any ? null : u.role as any)}
                              style={{ marginTop: 4, fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, border: '1px solid', background: previewRole === u.role ? '#d97706' : 'transparent', color: previewRole === u.role ? '#fff' : '#d97706', borderColor: '#d97706' }}
                            >
                              {previewRole === u.role ? '👁 Previewing' : '👁 View As'}
                            </button>
                          )}
                        </td>
                        <td style={S.td}>
                          <span style={S.badge(u.role)}>{ROLE_LABEL[u.role] || u.role}</span>
                          {u.role === 'temp_admin' && u.temp_admin_expires_at && (
                            <div style={{ fontSize: 9, color: '#a78bfa', marginTop: 2 }}>
                              Until {fmtExpiry(u.temp_admin_expires_at)}
                            </div>
                          )}
                        </td>
                        <td style={S.td}>
                          <span style={{ color: u.is_active ? '#34d399' : '#f87171', fontSize: 11 }}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={S.td}>
                          <span style={{ color: 'var(--text-muted)' }}>
                            {u.last_login_at ? u.last_login_at.slice(0, 16).replace('T', ' ') : 'Never'}
                          </span>
                        </td>
                        <td style={S.td}>
                          {tempDaysPicker?.userId === u.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' as const }}>
                                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Duration:</span>
                                {TEMP_OPTS.map(o => (
                                  <button key={o.h} onClick={() => setTempDaysPicker(p => p ? { ...p, days: o.h } : null)}
                                    style={{ fontSize: 9, padding: '2px 5px', background: tempDaysPicker.days === o.h ? '#7c3aed' : '#1e293b', color: tempDaysPicker.days === o.h ? '#fff' : '#64748b', border: '1px solid var(--card-border)', borderRadius: 3, cursor: 'pointer' }}>
                                    {o.l}
                                  </button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button style={S.btnSm('approve')} onClick={() => changeUserRole(u.id, 'temp_admin', tempDaysPicker.days)}>
                                  Set {fmtTempLabel(tempDaysPicker.days)}
                                </button>
                                <button style={S.btnSm('neutral')} onClick={() => setTempDaysPicker(null)}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <select
                              style={S.select}
                              value={u.role}
                              onChange={e => {
                                if (e.target.value === 'temp_admin') {
                                  setTempDaysPicker({ userId: u.id, days: 24 })
                                } else {
                                  changeUserRole(u.id, e.target.value)
                                }
                              }}
                            >
                              <option value="pending">Pending</option>
                              <option value="viewer">Viewer</option>
                              <option value="planner">Planner</option>
                              <option value="temp_admin">Temp Admin</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button
                              style={S.btnSm(u.is_active ? 'deny' : 'approve')}
                              onClick={() => toggleUserActive(u.id, !u.is_active)}
                            >
                              {u.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              style={{ ...S.btnSm('neutral'), color: '#fbbf24', border: '1px solid #78350f' }}
                              onClick={() => { setResetModal({ userId: u.id, email: u.email, name: u.full_name }); setResetPw(''); setResetMsg(null) }}
                            >
                              🔑 Reset PW
                            </button>
                          </div>
                        </td>
                        <td style={S.td}>
                          <SessionLimitCell
                            user={u}
                            onSave={(md, mm, act) => saveSessionLimits(u.id, md, mm, act)}
                          />
                        </td>
                        <td style={S.td}>
                          <button
                            style={{ ...S.btnSm('neutral'), background: isExpanded ? '#1e3a5f' : '#1e293b', color: isExpanded ? '#38bdf8' : '#94a3b8', border: '1px solid ' + (isExpanded ? '#38bdf8' : '#334155') }}
                            onClick={() => toggleExpandPageAccess(u.id)}
                          >
                            {isExpanded ? '▲ Pages' : '▼ Pages'}
                            {overrideCount > 0 && (
                              <span style={{ marginLeft: 5, background: '#6366f1', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 8 }}>
                                {overrideCount}
                              </span>
                            )}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0 0 4px 0', background: '#070f1a' }}>
                            <div style={{ padding: '12px 16px', borderTop: '1px solid #1e293b' }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600 }}>
                                Page Access for <span style={{ color: 'var(--text-secondary)' }}>{u.full_name}</span>
                                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                                  (no override = role-based default)
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {ALL_PAGES.map(page => {
                                  const override = pa?.[page.path]
                                  const isAllowed = override === true
                                  const isDenied = override === false
                                  const isDefault = override === undefined
                                  return (
                                    <div key={page.path} style={{
                                      background: isDenied ? 'rgba(248,113,113,.08)' : isAllowed ? 'rgba(52,211,153,.08)' : '#0f172a',
                                      border: '1px solid ' + (isDenied ? '#991b1b' : isAllowed ? '#065f46' : '#1e293b'),
                                      borderRadius: 6, padding: '6px 10px', minWidth: 160,
                                    }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: isDenied ? '#f87171' : isAllowed ? '#34d399' : '#94a3b8', marginBottom: 5 }}>
                                        {page.label}
                                        <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--text-muted)' }}>[{page.minRole}]</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 4 }}>
                                        <button
                                          disabled={pageAccessSaving}
                                          onClick={() => setPageAccess(u.id, page.path, isAllowed ? null : true)}
                                          style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: isAllowed ? '#065f46' : '#1e293b', color: isAllowed ? '#34d399' : '#475569', fontWeight: isAllowed ? 700 : 400 }}
                                        >
                                          ✓ Allow
                                        </button>
                                        <button
                                          disabled={pageAccessSaving}
                                          onClick={() => setPageAccess(u.id, page.path, isDenied ? null : false)}
                                          style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: isDenied ? '#7f1d1d' : '#1e293b', color: isDenied ? '#f87171' : '#475569', fontWeight: isDenied ? 700 : 400 }}
                                        >
                                          ✕ Deny
                                        </button>
                                        {!isDefault && (
                                          <button
                                            disabled={pageAccessSaving}
                                            onClick={() => setPageAccess(u.id, page.path, null)}
                                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: 'var(--card-bg)', color: 'var(--text-muted)' }}
                                            title="Remove override — revert to role-based"
                                          >
                                            ↺ Default
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>

                              {/* ── Tab-level access ── */}
                              <div style={{ marginTop: 14, borderTop: '1px solid #1e293b', paddingTop: 12 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                                  Tab / Section Access <span style={{ fontWeight: 400, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>(override role default per user)</span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {ALL_TABS.map(t => {
                                    const override = pa?.[t.path]
                                    const isAllowed = override === true
                                    const isDenied = override === false
                                    const isDefault = override === undefined
                                    return (
                                      <div key={t.path} style={{
                                        background: isDenied ? 'rgba(248,113,113,.08)' : isAllowed ? 'rgba(99,102,241,.1)' : '#0a0f1e',
                                        border: '1px solid ' + (isDenied ? '#991b1b' : isAllowed ? '#4338ca' : '#1e2d3d'),
                                        borderRadius: 6, padding: '6px 10px', minWidth: 200,
                                      }}>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: isDenied ? '#f87171' : isAllowed ? '#818cf8' : '#64748b', marginBottom: 5 }}>
                                          {t.label}
                                          <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--text-muted)' }}>[default: {t.roleDefault}+]</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button disabled={pageAccessSaving} onClick={() => setPageAccess(u.id, t.path, isAllowed ? null : true)}
                                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: isAllowed ? '#312e81' : '#1e293b', color: isAllowed ? '#818cf8' : '#475569', fontWeight: isAllowed ? 700 : 400 }}>
                                            ✓ Allow
                                          </button>
                                          <button disabled={pageAccessSaving} onClick={() => setPageAccess(u.id, t.path, isDenied ? null : false)}
                                            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: isDenied ? '#7f1d1d' : '#1e293b', color: isDenied ? '#f87171' : '#475569', fontWeight: isDenied ? 700 : 400 }}>
                                            ✕ Deny
                                          </button>
                                          {!isDefault && (
                                            <button disabled={pageAccessSaving} onClick={() => setPageAccess(u.id, t.path, null)}
                                              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', opacity: pageAccessSaving ? 0.5 : 1, background: 'var(--card-bg)', color: 'var(--text-muted)' }}
                                              title="Remove override — revert to role-based default">
                                              ↺ Default
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
          )
      )}

      {/* ── AI Chats ── */}
      {tab === 'aichats' && (
        aiChats.length === 0
          ? <div style={S.empty}>{loading ? 'Loading…' : 'No AI assistant conversations yet.'}</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ ...S.sectionHead, marginTop: 0 }}>
                User questions to the AI assistant — review to improve the app or documentation.
              </p>
              {aiChats.map(c => (
                <div key={c.id} style={{
                  background: 'var(--content-bg)', border: '1px solid var(--card-border)',
                  borderRadius: 8, overflow: 'hidden',
                }}>
                  {/* Header row */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: expandedChat === c.id ? '1px solid #1e293b' : 'none',
                    }}
                    onClick={() => setExpandedChat(expandedChat === c.id ? null : c.id)}
                  >
                    <span style={S.badge(c.user_role)}>{c.user_role}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12 }}>{c.user_name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{c.user_email}</span>
                    <span style={{ marginLeft: 'auto', color: '#38bdf8', fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Q: {c.question}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{expandedChat === c.id ? '▲' : '▼'}</span>
                  </div>
                  {/* Expanded Q&A */}
                  {expandedChat === c.id && (
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ background: 'var(--card-bg)', borderRadius: 6, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.06em', marginBottom: 4 }}>USER ASKED</div>
                        <div style={{ fontSize: 12.5, color: '#e0f2fe', lineHeight: 1.6 }}>{c.question}</div>
                      </div>
                      <div style={{ background: '#0c1628', borderRadius: 6, padding: '10px 12px', border: '1px solid #1e3a5f' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.06em', marginBottom: 4 }}>ASSISTANT REPLIED</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{c.answer}</div>
                      </div>

                      {/* Notify user section */}
                      {notifSent === c.id ? (
                        <div style={{ background: 'rgba(52,211,153,.1)', border: '1px solid rgba(52,211,153,.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#34d399' }}>
                          ✓ Notification sent to {c.user_name}
                        </div>
                      ) : notifyingChat === c.id ? (
                        <div style={{ background: 'var(--content-bg)', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--card-border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                            Send notification to <strong style={{ color: 'var(--text-secondary)' }}>{c.user_name}</strong>:
                          </div>
                          <textarea
                            rows={3}
                            value={notifMsg}
                            onChange={e => setNotifMsg(e.target.value)}
                            placeholder="e.g. We've addressed your question — the fill rate feature has been updated..."
                            style={{
                              width: '100%', background: 'var(--card-bg)', border: '1px solid var(--card-border)',
                              borderRadius: 6, color: 'var(--text-primary)', fontSize: 12, padding: '8px 10px',
                              resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button
                              onClick={() => sendNotification(c)}
                              disabled={notifSending || !notifMsg.trim()}
                              style={{
                                background: '#1d4ed8', border: 'none', borderRadius: 5,
                                color: '#fff', fontSize: 11, fontWeight: 600, padding: '6px 14px',
                                cursor: notifSending ? 'wait' : 'pointer', opacity: !notifMsg.trim() ? 0.5 : 1,
                              }}
                            >
                              {notifSending ? 'Sending…' : '📤 Send Notification'}
                            </button>
                            <button
                              onClick={() => { setNotifyingChat(null); setNotifMsg('') }}
                              style={{ background: 'none', border: '1px solid var(--card-border)', borderRadius: 5, color: 'var(--text-muted)', fontSize: 11, padding: '6px 12px', cursor: 'pointer' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setNotifyingChat(c.id); setExpandedChat(c.id) }}
                          style={{
                            alignSelf: 'flex-start', background: 'rgba(99,102,241,.15)',
                            border: '1px solid rgba(99,102,241,.4)', borderRadius: 6,
                            color: '#818cf8', fontSize: 11, fontWeight: 600,
                            padding: '6px 14px', cursor: 'pointer',
                          }}
                        >
                          🔔 Notify User — Problem Addressed
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
      )}

      {/* ── Logs ── */}
      {tab === 'logs' && (
        logs.length === 0
          ? <div style={S.empty}>{loading ? 'Loading…' : 'No activity yet.'}</div>
          : (
            <div style={{ height: 520, border: '1px solid var(--card-border)', borderRadius: 8, overflow: 'hidden' }}>
              <DataGrid
                records={logs.map(l => ({ user: l.user_email, action: l.action, details: l.details || '', ip: l.ip_address || '', time: l.created_at?.slice(0, 16).replace('T', ' ') || '' }))}
                columns={['user', 'action', 'details', 'ip', 'time']}
                loading={loading}
              />
            </div>
          )
      )}

      {/* ── Live Sessions ── */}
      {tab === 'live' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {liveLastRefresh ? `Refreshed at ${liveLastRefresh.toLocaleTimeString('en-IN')}` : ''}
            </span>
            <button onClick={loadLiveSessions} disabled={liveLoading} style={{ fontSize: 11, padding: '4px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}>
              {liveLoading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
          {liveSessions.length === 0 ? (
            <div style={S.empty}>{liveLoading ? 'Loading…' : 'No active sessions.'}</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Total Online', value: liveSessions.length, color: '#22c55e' },
                  { label: 'Desktop', value: liveSessions.filter(s => s.device_type === 'desktop').length, color: '#38bdf8' },
                  { label: 'Mobile', value: liveSessions.filter(s => s.device_type === 'mobile').length, color: '#c084fc' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>{m.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={S.tblWrap}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>User</th>
                    <th style={S.th}>Role</th>
                    <th style={S.th}>Device</th>
                    <th style={S.th}>Browser / OS</th>
                    <th style={S.th}>IP</th>
                    <th style={S.th}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {liveSessions.map((s, i) => {
                    const secsAgo = Math.round((Date.now() / 1000) - s.last_seen)
                    const lastSeen = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.round(secsAgo / 60)}m ago`
                    return (
                      <tr key={i}>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: 12 }}>{s.full_name}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{s.email}</div>
                        </td>
                        <td style={S.td}><span style={S.badge(s.role)}>{ROLE_LABEL[s.role] || s.role}</span></td>
                        <td style={S.td}>
                          <span style={{ fontSize: 12, color: s.device_type === 'mobile' ? '#c084fc' : '#38bdf8' }}>
                            {s.device_type === 'mobile' ? '📱' : '🖥️'} {s.device_name || s.device_type}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.browser}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>{s.os}</div>
                        </td>
                        <td style={S.td}><span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{s.ip}</span></td>
                        <td style={S.td}>
                          <span style={{ fontSize: 11, color: secsAgo < 60 ? '#22c55e' : secsAgo < 180 ? '#84cc16' : '#94a3b8' }}>{lastSeen}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Access Matrix ── */}
      {tab === 'access' && <AccessMatrix />}

      {/* Password Reset Modal */}
      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setResetModal(null); setResetMsg(null) } }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'relative', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 24, width: 360, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>🔑 Reset Password</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              Setting new password for <strong style={{ color: '#94a3b8' }}>{resetModal.name}</strong>
              <span style={{ display: 'block', fontSize: 11, color: '#475569', marginTop: 2 }}>{resetModal.email}</span>
            </div>
            <input
              type="password"
              placeholder="New password (min 6 chars)"
              value={resetPw}
              onChange={e => setResetPw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') resetPassword() }}
              style={{ width: '100%', fontSize: 13, background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, padding: '8px 10px', boxSizing: 'border-box' as const, outline: 'none', marginBottom: 12, fontFamily: 'inherit' }}
            />
            {resetMsg && (
              <div style={{ fontSize: 12, color: resetMsg.ok ? '#34d399' : '#f87171', marginBottom: 10, padding: '6px 10px', background: resetMsg.ok ? 'rgba(52,211,153,.08)' : 'rgba(248,113,113,.08)', borderRadius: 5, border: `1px solid ${resetMsg.ok ? 'rgba(52,211,153,.3)' : 'rgba(248,113,113,.3)'}` }}>
                {resetMsg.ok ? '✓ ' : '✕ '}{resetMsg.text}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setResetModal(null); setResetMsg(null) }} style={{ fontSize: 12, padding: '6px 14px', background: 'none', color: '#64748b', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={resetPassword} disabled={resetSaving} style={{ fontSize: 12, padding: '6px 16px', background: '#b45309', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, opacity: resetSaving ? 0.6 : 1 }}>
                {resetSaving ? 'Resetting…' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Role-Permission Matrix ──────────────────────────────────────────────────
type RoleKey = 'viewer' | 'planner' | 'temp_admin' | 'admin'
type ViewDef = { name: string; minRole: RoleKey }
type PageDef = { icon: string; name: string; path: string; minRole: RoleKey; views: ViewDef[]; adminOnly?: true }
type GroupDef = { group: string }

const MATRIX_PAGES: (PageDef | GroupDef)[] = [
  { group: 'Dashboards' },
  { icon: '📊', name: 'Dashboard',         path: '/',            minRole: 'viewer',  views: [
    { name: 'Store Network',           minRole: 'viewer' },
    { name: 'Allocation Summary',      minRole: 'viewer' },
    { name: 'All · Store · Div-Dept',  minRole: 'viewer' },
  ]},
  { icon: '🏪', name: 'NSO Dashboard',     path: '/nso',         minRole: 'viewer',  views: [
    { name: 'Store View',              minRole: 'viewer' },
    { name: 'Article Detail',          minRole: 'planner' },
  ]},
  { icon: '📊', name: 'Sale Dashboard',    path: '/sale',        minRole: 'viewer',  views: [
    { name: 'Store Summary',           minRole: 'viewer' },
    { name: 'Daily Trend',             minRole: 'viewer' },
  ]},
  { group: 'Planning & Results' },
  { icon: '📝', name: 'Requirements',      path: '/req',         minRole: 'planner', views: [
    { name: 'Views',    minRole: 'planner' },
    { name: 'Sparky',   minRole: 'planner' },
    { name: 'Size',     minRole: 'planner' },
    { name: 'MRP',      minRole: 'planner' },
    { name: 'Article',  minRole: 'planner' },
    { name: 'MC',       minRole: 'planner' },
    { name: 'Barcode',  minRole: 'planner' },
    { name: 'Option',   minRole: 'planner' },
    { name: 'List',     minRole: 'planner' },
  ]},
  { icon: '📋', name: 'Results',           path: '/results',     minRole: 'viewer',  views: [
    { name: 'Grid',      minRole: 'viewer' },
    { name: 'Aggregate', minRole: 'viewer' },
  ]},
  { icon: '🔀', name: 'Distribution',      path: '/distribution', minRole: 'planner', views: [
    { name: 'Build Base',     minRole: 'planner' },
    { name: 'Run Loop',       minRole: 'planner' },
    { name: 'Download Excel', minRole: 'planner' },
  ]},
  { icon: '🕑', name: 'History',           path: '/history',     minRole: 'viewer',  views: [
    { name: 'Run history', minRole: 'viewer' },
  ]},
  { icon: '📋', name: 'Option Listing',     path: '/option-listing',  minRole: 'planner', views: [{ name: 'Option listing view', minRole: 'planner' }] },
  { icon: '🔄', name: 'Oracle Refresh',    path: '/oracle-refresh',  minRole: 'planner', views: [
    { name: 'File config',  minRole: 'planner' },
    { name: 'Run refresh',  minRole: 'planner' },
  ]},
  { group: 'Data & Config' },
  { icon: '🗄️', name: 'Database Explorer', path: '/database',    minRole: 'planner', views: [{ name: 'Table browser',     minRole: 'planner' }] },
  { icon: '📂', name: 'Master Data',       path: '/master-data', minRole: 'planner', views: [{ name: 'Master data tables', minRole: 'planner' }] },
  { icon: '⚙️', name: 'Calc Factors',      path: '/factors',     minRole: 'planner', views: [{ name: 'Factor config',     minRole: 'planner' }] },
  { icon: '▶️', name: 'Calculation',       path: '/calculation', minRole: 'planner', views: [{ name: 'Run calculation',   minRole: 'planner' }] },
  { icon: '🔧', name: 'Settings',          path: '/settings',    minRole: 'planner', views: [{ name: 'User settings',     minRole: 'planner' }] },
  { icon: '🏭', name: 'Warehouse Inventory', path: '/warehouse', minRole: 'planner', views: [
    { name: 'Data Table', minRole: 'planner' },
    { name: 'Pivot',      minRole: 'planner' },
  ]},
  { group: 'General' },
  { icon: '📖', name: 'User Manual',       path: '/manual',      minRole: 'viewer',  views: [{ name: 'Documentation',     minRole: 'viewer' }] },
  { group: 'Admin Only' },
  { icon: '🛡️', name: 'Admin Panel',       path: '/admin',       minRole: 'admin',   adminOnly: true, views: [
    { name: 'Role Requests',  minRole: 'admin' },
    { name: 'Users',          minRole: 'admin' },
    { name: 'Activity Logs',  minRole: 'admin' },
    { name: 'AI Chats',       minRole: 'admin' },
    { name: 'Access Matrix',  minRole: 'admin' },
  ]},
]

const ROLE_LEVEL_MAP: Record<RoleKey, number> = { viewer: 1, planner: 2, temp_admin: 3, admin: 4 }
const ROLES_DISPLAY: { key: RoleKey; label: string; color: string; pillBg: string; pillBorder: string }[] = [
  { key: 'viewer',     label: 'Viewer',     color: 'var(--text-secondary)', pillBg: '#1c2535', pillBorder: '#334155' },
  { key: 'planner',    label: 'Planner',    color: '#34d399', pillBg: '#052e16', pillBorder: '#166534' },
  { key: 'temp_admin', label: 'Temp Admin', color: '#c084fc', pillBg: '#2d1b4e', pillBorder: '#6b21a8' },
  { key: 'admin',      label: 'Admin',      color: '#818cf8', pillBg: '#1e1b4b', pillBorder: '#3730a3' },
]

function hasAccess(minRole: RoleKey, role: RoleKey): boolean {
  return ROLE_LEVEL_MAP[role] >= ROLE_LEVEL_MAP[minRole]
}

// Build initial access state: { "path::viewName": Set<RoleKey> }
const LS_KEY = 'ck_access_matrix_v1'

function buildInitialAccess(): Record<string, Set<RoleKey>> {
  const acc: Record<string, Set<RoleKey>> = {}
  for (const p of MATRIX_PAGES) {
    if ('group' in p) continue
    for (const v of p.views) {
      const key = `${p.path}::${v.name}`
      const allowed = new Set<RoleKey>()
      for (const r of ROLES_DISPLAY) {
        if (p.adminOnly ? r.key === 'admin' : hasAccess(v.minRole, r.key)) {
          allowed.add(r.key)
        }
      }
      acc[key] = allowed
    }
  }
  return acc
}

function loadAccess(): Record<string, Set<RoleKey>> {
  const defaults = buildInitialAccess()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaults
    const parsed: Record<string, string[]> = JSON.parse(raw)
    const result: Record<string, Set<RoleKey>> = { ...defaults }
    for (const key of Object.keys(defaults)) {
      if (parsed[key]) result[key] = new Set(parsed[key] as RoleKey[])
    }
    // add any new sections not in saved data (keeps defaults for new pages)
    return result
  } catch { return defaults }
}

function saveAccess(access: Record<string, Set<RoleKey>>) {
  try {
    const serializable: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(access)) serializable[k] = Array.from(v)
    localStorage.setItem(LS_KEY, JSON.stringify(serializable))
  } catch { /* storage full or blocked */ }
}

const CHECK_SVG = (
  <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
    <polyline points="2,6 5,9 10,3" />
  </svg>
)

function AccessMatrix() {
  const [access, setAccess] = useState<Record<string, Set<RoleKey>>>(() => loadAccess())
  const [saved, setSaved] = useState(false)

  function toggle(sectionKey: string, role: RoleKey) {
    setAccess(prev => {
      const next = { ...prev }
      const set = new Set(prev[sectionKey] || [])
      if (set.has(role)) set.delete(role)
      else set.add(role)
      next[sectionKey] = set
      saveAccess(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
      return next
    })
  }

  function handleReset() {
    const def = buildInitialAccess()
    setAccess(def)
    saveAccess(def)
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  const MS = {
    wrap:    { overflowX: 'auto' as const, border: '1px solid var(--card-border)', borderRadius: 8, background: 'var(--content-bg)' },
    table:   { width: '100%', borderCollapse: 'collapse' as const, minWidth: 560, fontSize: 12 },
    thead:   { background: '#0a0f1e', position: 'sticky' as const, top: 0, zIndex: 2 },
    thName:  { padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.08em', textAlign: 'left' as const, borderBottom: '1px solid #1e293b', width: 160 },
    thView:  { padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.08em', textAlign: 'left' as const, borderBottom: '1px solid #1e293b', width: 160, borderLeft: '1px solid #1e2d3d' },
    thRole:  { padding: '10px 14px', textAlign: 'center' as const, borderBottom: '1px solid #1e293b', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const },
    group:   { background: '#0a0f1e', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', padding: '7px 12px', borderBottom: '1px solid #1e2d3d' },
    pageTd:  { padding: '0 12px', borderBottom: '1px solid transparent', verticalAlign: 'top' as const, paddingTop: 10 },
    viewTd:  { padding: '7px 12px', borderBottom: '1px solid #1e2d3d', verticalAlign: 'middle' as const, borderLeft: '1px solid #1e2d3d' },
    cell:    { textAlign: 'center' as const, padding: '7px 10px', borderBottom: '1px solid #1e2d3d', verticalAlign: 'middle' as const },
    lastCell:{ textAlign: 'center' as const, padding: '7px 10px', borderBottom: '2px solid #1e3a5f', verticalAlign: 'middle' as const },
  }

  // flatten to rows: [{type:'group',...} | {type:'page', page, firstView, totalViews} | {type:'view', page, view, isLast}]
  type RowGroup = { type: 'group'; label: string }
  type RowPage  = { type: 'page';  page: PageDef; rowspan: number }
  type RowView  = { type: 'view';  page: PageDef; view: ViewDef; isLast: boolean }
  type Row = RowGroup | RowPage | RowView

  const rows: Row[] = []
  for (const p of MATRIX_PAGES) {
    if ('group' in p) { rows.push({ type: 'group', label: p.group }); continue }
    rows.push({ type: 'page', page: p, rowspan: p.views.length })
    for (let vi = 0; vi < p.views.length; vi++) {
      rows.push({ type: 'view', page: p, view: p.views[vi], isLast: vi === p.views.length - 1 })
    }
  }

  // summary: sections per role
  const sectionCounts = ROLES_DISPLAY.map(r => {
    let count = 0
    for (const key of Object.keys(access)) {
      if (access[key].has(r.key)) count++
    }
    return count
  })

  let pageRowCursor: string | null = null

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
        <span style={{ background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4, padding: '3px 8px', color: '#38bdf8', fontSize: 10, fontWeight: 700 }}>ADMIN ONLY</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Click toggles to change section access. Saved in browser automatically.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && (
            <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.5} width={11} height={11}><polyline points="2,6 5,9 10,3" /></svg>
              Saved
            </span>
          )}
          <button onClick={handleReset} style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--card-border)',
            background: 'var(--content-bg)', color: 'var(--text-muted)', cursor: 'pointer',
          }}>Reset to defaults</button>
        </div>
      </div>
      <div style={MS.wrap}>
        <table style={MS.table}>
          <thead style={MS.thead}>
            <tr>
              <th style={MS.thName}>Page</th>
              <th style={MS.thView}>Section / View</th>
              {ROLES_DISPLAY.map(r => (
                <th key={r.key} style={{ ...MS.thRole, color: r.color }}>
                  <span style={{ background: r.pillBg, border: `1px solid ${r.pillBorder}`, borderRadius: 4, padding: '3px 8px', display: 'inline-block', fontFamily: 'monospace' }}>
                    {r.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              if (row.type === 'group') {
                pageRowCursor = null
                return <tr key={ri}><td colSpan={6} style={MS.group}>{row.label}</td></tr>
              }
              if (row.type === 'page') {
                pageRowCursor = row.page.path
                return null // page cell is rendered inline in 'view' rows via rowspan
              }
              // view row
              const { page, view, isLast } = row
              const sKey = `${page.path}::${view.name}`
              const isFirstView = pageRowCursor === page.path && rows[ri - 1]?.type === 'page'
              const cellStyle = isLast ? MS.lastCell : MS.cell
              return (
                <tr key={sKey} style={{ background: isLast ? 'transparent' : '#ffffff02' }}>
                  {isFirstView && (
                    <td rowSpan={page.views.length} style={MS.pageTd}>
                      <div>
                        <span style={{ marginRight: 6 }}>{page.icon}</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{page.name}</span>
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{page.path}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>{page.views.length} section{page.views.length > 1 ? 's' : ''}</div>
                    </td>
                  )}
                  <td style={{ ...MS.viewTd, borderBottom: isLast ? '2px solid #1e3a5f' : '1px solid #1e2d3d' }}>
                    <span style={{
                      fontSize: 10, background: '#0a0f1e', border: '1px solid #1e3a5f',
                      borderRadius: 3, padding: '2px 8px', color: '#7dd3fc',
                      fontFamily: 'monospace', whiteSpace: 'nowrap' as const,
                    }}>{view.name}</span>
                  </td>
                  {ROLES_DISPLAY.map(r => {
                    const on = access[sKey]?.has(r.key) ?? false
                    const locked = r.key === 'admin' || page.adminOnly
                    return (
                      <td key={r.key} style={{ ...cellStyle, background: on && locked ? '#0f1f38' : 'transparent' }}>
                        <button
                          onClick={() => !locked && toggle(sKey, r.key)}
                          title={locked ? `${r.label} — locked` : on ? `Remove ${r.label} access` : `Grant ${r.label} access`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: 5, border: 'none',
                            cursor: locked ? 'not-allowed' : 'pointer',
                            background: on ? (locked ? '#1e3a5f' : r.pillBg) : '#1e293b',
                            borderWidth: 1.5, borderStyle: 'solid',
                            borderColor: on ? r.color : '#334155',
                            color: on ? r.color : '#334155',
                            opacity: locked && !on ? 0.4 : 1,
                            transition: 'all 0.15s',
                          }}
                        >
                          {on ? CHECK_SVG : <span style={{ fontSize: 10, lineHeight: 1 }}>—</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
        {ROLES_DISPLAY.map((r, i) => (
          <div key={r.key} style={{ background: 'var(--content-bg)', border: `1px solid ${r.pillBorder}`, borderRadius: 8, padding: '10px 16px', minWidth: 110 }}>
            <div style={{ fontSize: 10, color: r.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'monospace' }}>{r.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: r.color, fontVariantNumeric: 'tabular-nums' }}>{sectionCounts[i]}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>sections</div>
          </div>
        ))}
      </div>
    </div>
  )
}
