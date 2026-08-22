import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth, hasRole, type Role } from '@/context/AuthContext'
import axios from 'axios'
import PendingPage from '@/pages/PendingPage'
import AssistantWidget from '@/components/AssistantWidget'
import NotificationBell from '@/components/NotificationBell'

function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768)
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return mobile
}

const NAV_ITEMS: { to: string; label: string; icon: string; minRole: Role }[] = [
  { to: '/',            label: 'Dashboard',       icon: '📊', minRole: 'viewer'  },
  { to: '/database',   label: 'Database Explorer',icon: '🗄️', minRole: 'planner' },
  { to: '/master-data',label: 'Master Data',      icon: '📂', minRole: 'viewer'  },
  { to: '/factors',    label: 'Calc Factors',     icon: '⚙️', minRole: 'planner' },
  { to: '/calculation',label: 'Calculation',      icon: '▶️', minRole: 'planner' },
  { to: '/results',    label: 'Results',          icon: '📋', minRole: 'viewer'  },
  { to: '/history',    label: 'History',          icon: '🕑', minRole: 'viewer'  },
  { to: '/nso',        label: 'NSO Dashboard',    icon: '🏪', minRole: 'viewer'  },
  { to: '/sale',       label: 'Sale Dashboard',   icon: '📊', minRole: 'viewer'  },
  { to: '/settings',   label: 'Settings',         icon: '🔧', minRole: 'planner' },
  { to: '/admin',      label: 'Admin Panel',      icon: '🛡️', minRole: 'admin'   },
  { to: '/procedures',label: 'Procedures',        icon: '📋', minRole: 'admin'   },
  { to: '/manual',    label: 'User Manual',      icon: '📖', minRole: 'viewer'  },
]

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', temp_admin: 'Temp Admin', planner: 'Planner', viewer: 'Viewer', pending: 'Pending',
}
const ROLE_COLOR: Record<string, string> = {
  admin: '#818cf8', temp_admin: '#c084fc', planner: '#34d399', viewer: '#94a3b8', pending: '#d97706',
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f172a' },
  sidebar: {
    width: 220, background: '#1e293b', borderRight: '1px solid #334155',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    height: '100vh',
  },
  logo: {
    padding: '20px 16px', borderBottom: '1px solid #334155',
    fontSize: 13, fontWeight: 700, color: '#38bdf8', letterSpacing: 0.5,
  },
  logoSub: { fontSize: 10, color: '#64748b', marginTop: 2, fontWeight: 400 },
  nav: { flex: 1, padding: '12px 0', overflowY: 'auto' },
  userStrip: {
    borderTop: '1px solid #334155', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  signoutBtn: {
    background: 'none', border: '1px solid #334155', borderRadius: 4,
    color: '#64748b', fontSize: 11, padding: '4px 8px', cursor: 'pointer',
    textAlign: 'left', width: '100%',
  },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  topbar: {
    background: '#1e293b', borderBottom: '1px solid #334155', padding: '10px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 13, color: '#94a3b8', gap: 8,
  },
  content: { flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 16px', fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? '#38bdf8' : '#94a3b8',
        background: isActive ? '#0f172a' : 'transparent',
        borderLeft: isActive ? '3px solid #38bdf8' : '3px solid transparent',
        textDecoration: 'none', transition: 'all 0.15s',
      })}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

export default function AppLayout() {
  const { user, token, loading, signout } = useAuth()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const [roleRequestOpen, setRoleRequestOpen] = useState(false)

  // Close sidebar on route change on mobile
  useEffect(() => { if (isMobile) setSidebarOpen(false) }, [location.pathname, isMobile])
  const [pendingRequest, setPendingRequest] = useState<any>(null)
  const [roleReason, setRoleReason] = useState('')
  const [tempDays, setTempDays] = useState(24)
  const [submitting, setSubmitting] = useState(false)
  const [submitDone, setSubmitDone] = useState(false)

  // Determine what the user can upgrade to
  const upgradeTarget = user?.role === 'viewer' ? 'planner'
    : user?.role === 'planner' ? 'temp_admin' : null

  // Load pending request on mount / role change
  useEffect(() => {
    if (!user || !upgradeTarget) return
    axios.get('/api/auth/me').then(r => {
      setPendingRequest(r.data.data?.pending_request || null)
    }).catch(() => {})
  }, [user?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null
  if (!user || !token) return <Navigate to="/login" replace />

  // Pending users see a dedicated waiting screen instead of the app
  if (user.role === 'pending') return <PendingPage />

  async function handleSignout() {
    try { await axios.post('/api/auth/signout') } catch { /* ignore */ }
    signout()
  }

  async function submitRoleRequest() {
    if (!upgradeTarget) return
    setSubmitting(true)
    try {
      const body: any = { requested_role: upgradeTarget, reason: roleReason }
      if (upgradeTarget === 'temp_admin') body.temp_days = tempDays
      const res = await axios.post('/api/auth/request-role', body)
      setPendingRequest(res.data.data?.request)
      setSubmitDone(true)
      setRoleRequestOpen(false)
      setRoleReason('')
    } catch {
      // ignore — will show error state
    } finally {
      setSubmitting(false)
    }
  }

  const initials = user.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase()

  const visibleNav = NAV_ITEMS.filter(item => hasRole(user, item.minRole))

  return (
    <div style={{ ...styles.shell, ...(isMobile ? { height: 'auto', overflow: 'visible' } : {}) }}>
      <AssistantWidget />

      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1099,
        }} />
      )}

      <aside style={{
        ...styles.sidebar,
        ...(isMobile ? {
          position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 1100,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        } : {}),
      }}>
        <div style={styles.logo}>
          RETAIL REQ TOOL
          <div style={styles.logoSub}>v1.0 · AW26</div>
        </div>
        <nav style={styles.nav}>
          {visibleNav.map(item => (
            <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
          ))}
        </nav>
        <div style={styles.userStrip}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#1d4ed8', color: '#fff', fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name}
              </div>
              <div style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
              color: ROLE_COLOR[user.role] || '#94a3b8',
              background: (ROLE_COLOR[user.role] || '#94a3b8') + '18',
              padding: '2px 7px', borderRadius: 8,
            }}>
              {ROLE_LABEL[user.role] || user.role}
            </span>
            <button style={styles.signoutBtn} onClick={handleSignout}>Sign out</button>
          </div>
          {/* Role upgrade request — visible for viewer and planner */}
          {upgradeTarget && (
            <div>
              {submitDone && !pendingRequest ? (
                <div style={{ fontSize: 9, color: '#34d399' }}>✓ Request submitted</div>
              ) : pendingRequest ? (
                <div style={{ fontSize: 9, color: '#fcd34d', lineHeight: 1.4 }}>
                  ⏳ {pendingRequest.requested_role === 'temp_admin' ? 'Temp Admin' : 'Planner'} request pending…
                </div>
              ) : roleRequestOpen ? (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8, border: '1px solid #334155', marginTop: 2 }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>
                    Request: {upgradeTarget === 'temp_admin' ? 'Temp Admin access' : 'Planner role'}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Reason (optional)…"
                    value={roleReason}
                    onChange={e => setRoleReason(e.target.value)}
                    style={{ width: '100%', fontSize: 10, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 4, padding: 4, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
                  />
                  {upgradeTarget === 'temp_admin' && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' as const }}>
                      <span style={{ fontSize: 9, color: '#64748b' }}>Duration:</span>
                      {([{h:1,l:'1h'},{h:3,l:'3h'},{h:24,l:'1d'},{h:72,l:'3d'},{h:168,l:'7d'}]).map(o => (
                        <button key={o.h} onClick={() => setTempDays(o.h)} style={{ fontSize: 9, padding: '2px 6px', background: tempDays === o.h ? '#1d4ed8' : '#1e293b', color: tempDays === o.h ? '#fff' : '#64748b', border: '1px solid #334155', borderRadius: 3, cursor: 'pointer' }}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <button onClick={submitRoleRequest} disabled={submitting} style={{ fontSize: 10, padding: '3px 10px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
                      {submitting ? '…' : 'Submit'}
                    </button>
                    <button onClick={() => setRoleRequestOpen(false)} style={{ fontSize: 10, padding: '3px 8px', background: 'none', color: '#64748b', border: '1px solid #334155', borderRadius: 3, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setRoleRequestOpen(true)} style={{ fontSize: 9, color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' as const }}>
                  ↑ Request role upgrade
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      <main style={{ ...styles.main, ...(isMobile ? { overflow: 'visible' } : {}) }}>
        <div style={styles.topbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(o => !o)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
              }}>☰</button>
            )}
            <span style={{ fontSize: isMobile ? 11 : 13 }}>Retail Requirement &amp; Replenishment System</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isMobile && <span style={{ color: '#475569', fontSize: 11 }}>SS27 · PREWINTER AW26</span>}
            <NotificationBell />
          </div>
        </div>
        <div style={{
          ...styles.content,
          padding: isMobile ? 12 : 24,
          ...(isMobile ? { overflowY: 'visible', flex: 'unset' } : {}),
        }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
