import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useAuth, hasRole, type Role } from '@/context/AuthContext'
import { useTheme, type ThemeName, THEME_LABELS } from '@/context/ThemeContext'
import { useDisplay, FONT_LABELS, type FontFamily } from '@/context/DisplayContext'
import axios from 'axios'
import PendingPage from '@/pages/PendingPage'
import AssistantWidget from '@/components/AssistantWidget'
import NotificationBell from '@/components/NotificationBell'
import { useOracleRefresh } from '@/context/OracleRefreshContext'

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
  { to: '/oracle-refresh', label: 'Oracle Refresh', icon: '🔄', minRole: 'planner' },
  { to: '/master-data',label: 'Master Data',      icon: '📂', minRole: 'planner' },
  { to: '/factors',    label: 'Calc Factors',     icon: '⚙️', minRole: 'planner' },
  { to: '/calculation',label: 'Calculation',      icon: '▶️', minRole: 'planner' },
  { to: '/req',          label: 'Requirements',      icon: '📝', minRole: 'planner' },
  { to: '/distribution', label: 'Distribution',      icon: '🔀', minRole: 'planner' },
  { to: '/option-listing', label: 'Option Listing', icon: '📋', minRole: 'planner' },
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

// styles are now computed dynamically via theme tokens — see mkStyles() below

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  const { tokens } = useTheme()
  return (
    <NavLink
      to={to}
      end={to === '/'}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 16px', fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? tokens.navActiveColor : tokens.navInactiveColor,
        background: isActive ? tokens.navActiveBg : 'transparent',
        borderLeft: isActive ? `3px solid ${tokens.navActiveBar}` : '3px solid transparent',
        textDecoration: 'none', transition: 'all 0.15s',
      })}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  )
}

function ThemePicker() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const themes: ThemeName[] = ['dark', 'light', 'citykart']

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Change theme"
        style={{ background: 'none', border: '1px solid currentColor', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '3px 8px', opacity: 0.7, color: 'inherit' }}
      >
        {THEME_LABELS[theme]}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 200,
          background: 'var(--card-bg, #1e293b)', border: '1px solid var(--card-border, #334155)',
          borderRadius: 6, padding: 4, minWidth: 130, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          {themes.map(t => (
            <button key={t} onClick={() => { setTheme(t); setOpen(false) }} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
              background: theme === t ? 'var(--accent-bg, #38bdf818)' : 'none',
              color: theme === t ? 'var(--accent, #38bdf8)' : 'var(--text-secondary, #94a3b8)',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              fontWeight: theme === t ? 700 : 400,
            }}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DisplayPicker() {
  const { zoom, fontSize, fontFamily, brightness, zoomIn, zoomOut, resetZoom, fontSizeUp, fontSizeDown, brightnessUp, brightnessDown, setBrightness, setFontFamily, setZoom, zoomSteps } = useDisplay()
  const { tokens } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pct = Math.round(zoom * 100)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const panelStyle: React.CSSProperties = {
    position: 'absolute', right: 0, top: '110%', zIndex: 200,
    background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
    borderRadius: 8, padding: '10px 12px', width: 230,
    boxShadow: '0 4px 20px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', gap: 10,
  }
  const labelStyle: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: tokens.textMuted, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 3 }
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5 }
  const adjBtn = (color?: string): React.CSSProperties => ({
    padding: '3px 9px', fontSize: 12, fontWeight: 700, borderRadius: 4,
    border: `1px solid ${tokens.cardBorder}`, background: 'transparent',
    color: color ?? tokens.textSecondary, cursor: 'pointer',
  })
  const valLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: tokens.textPrimary, minWidth: 38, textAlign: 'center' }

  const fontFamilies: FontFamily[] = ['system', 'roboto', 'mono', 'serif']

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Display settings — zoom, font size, font style"
        style={{ background: 'none', border: `1px solid ${tokens.cardBorder}`, borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '3px 8px', opacity: 0.7, color: 'inherit' }}
      >
        𝐀{pct !== 100 ? ` ${pct}%` : ''}
      </button>
      {open && (
        <div style={panelStyle}>

          {/* Zoom */}
          <div>
            <div style={labelStyle}>Page Zoom</div>
            <div style={rowStyle}>
              <button style={adjBtn()} onClick={zoomOut} disabled={zoom <= zoomSteps[0]}>−</button>
              <span style={valLabel}>{pct}%</span>
              <button style={adjBtn()} onClick={zoomIn} disabled={zoom >= zoomSteps[zoomSteps.length - 1]}>+</button>
              <button onClick={resetZoom} style={{ ...adjBtn(tokens.accent), marginLeft: 2, fontSize: 10, padding: '3px 7px' }}>Auto</button>
            </div>
            {/* Preset chips */}
            <div style={{ display: 'flex', gap: 3, marginTop: 5, flexWrap: 'wrap' }}>
              {[0.8, 0.9, 1.0, 1.1, 1.2].map(z => (
                <button key={z} onClick={() => setZoom(z)}
                  style={{ padding: '2px 7px', fontSize: 9, fontWeight: 600, borderRadius: 8,
                    border: `1px solid ${zoom === z ? tokens.accent : tokens.cardBorder}`,
                    background: zoom === z ? tokens.accentBg : 'transparent',
                    color: zoom === z ? tokens.accent : tokens.textMuted, cursor: 'pointer' }}>
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: tokens.cardBorder }} />

          {/* Font size */}
          <div>
            <div style={labelStyle}>Font Size</div>
            <div style={rowStyle}>
              <button style={adjBtn()} onClick={fontSizeDown}>A−</button>
              <span style={valLabel}>{fontSize}px</span>
              <button style={adjBtn()} onClick={fontSizeUp}>A+</button>
            </div>
          </div>

          <div style={{ height: 1, background: tokens.cardBorder }} />

          {/* Font family */}
          <div>
            <div style={labelStyle}>Font Style</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {fontFamilies.map(f => (
                <button key={f} onClick={() => setFontFamily(f)}
                  style={{ textAlign: 'left', padding: '5px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: 'pointer',
                    background: fontFamily === f ? tokens.accentBg : 'transparent',
                    color: fontFamily === f ? tokens.accent : tokens.textSecondary,
                    fontWeight: fontFamily === f ? 700 : 400 }}>
                  {FONT_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 1, background: tokens.cardBorder }} />

          {/* Brightness */}
          <div>
            <div style={labelStyle}>☀ Brightness</div>
            <div style={rowStyle}>
              <button style={adjBtn()} onClick={brightnessDown} disabled={brightness <= 0.4}>−</button>
              <span style={valLabel}>{Math.round(brightness * 100)}%</span>
              <button style={adjBtn()} onClick={brightnessUp} disabled={brightness >= 1.5}>+</button>
              <button onClick={() => setBrightness(1.0)} style={{ ...adjBtn(tokens.accent), marginLeft: 2, fontSize: 10, padding: '3px 7px' }}>Reset</button>
            </div>
            <input
              type="range" min={40} max={150} step={10}
              value={Math.round(brightness * 100)}
              onChange={e => setBrightness(Number(e.target.value) / 100)}
              style={{ width: '100%', marginTop: 6, accentColor: tokens.accent }}
            />
          </div>

        </div>
      )}
    </div>
  )
}

type ViewMode = 'auto' | 'mobile' | 'desktop'

function loadViewMode(): ViewMode {
  try { return (localStorage.getItem('app_viewMode') as ViewMode) || 'auto' } catch { return 'auto' }
}

export default function AppLayout() {
  const { user, token, loading, signout, pageAccess } = useAuth()
  const { tokens, theme } = useTheme()
  const { isRunning: oracleRunning } = useOracleRefresh()
  const realIsMobile = useIsMobile()
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)

  const [sessionTime, setSessionTime] = useState(() =>
    new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  )
  useEffect(() => {
    const t = setInterval(() => {
      setSessionTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }))
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // Multi-device session tracking via backend API (cross-origin capable)
  const sessionIdRef = useRef<string | null>((() => { try { return localStorage.getItem('ck_session_id') } catch { return null } })())
  const [deviceCounts, setDeviceCounts] = useState({ desktop: 0, mobile: 0 })
  const [sessionDetail, setSessionDetail] = useState<{device_type: string; ip: string; last_seen: number; browser?: string; os?: string; device_name?: string}[]>([])
  const [sessionPopup, setSessionPopup] = useState(false)
  const sessionBadgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionPopup) return
    const handler = (e: MouseEvent) => {
      if (sessionBadgeRef.current && !sessionBadgeRef.current.contains(e.target as Node)) setSessionPopup(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sessionPopup])

  const [deviceName, setDeviceNameState] = useState<string>(() => {
    try { return localStorage.getItem('ck_device_name') ?? '' } catch { return '' }
  })
  const [deviceNamePrompt, setDeviceNamePrompt] = useState(false)
  const [deviceNameInput, setDeviceNameInput] = useState('')

  function saveDeviceName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    try { localStorage.setItem('ck_device_name', trimmed) } catch {}
    setDeviceNameState(trimmed)
    setDeviceNamePrompt(false)
  }

  // Try WebRTC to get local hostname, fall back to stored device name
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const pc = new RTCPeerConnection({ iceServers: [] })
      pc.createDataChannel('')
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {})
      pc.onicecandidate = e => {
        if (!e.candidate) return
        const match = e.candidate.candidate.match(/([a-zA-Z0-9_-]+\.local)/i)
        if (match) {
          const host = match[1].replace('.local', '')
          if (!localStorage.getItem('ck_device_name')) {
            try { localStorage.setItem('ck_device_name', host) } catch {}
            setDeviceNameState(host)
          }
        }
        pc.close()
      }
      setTimeout(() => { try { pc.close() } catch {} }, 3000)
    } catch {}
  }, [])

  useEffect(() => {
    if (!token) return
    const deviceType = realIsMobile ? 'mobile' : 'desktop'

    async function heartbeat() {
      try {
        const storedName = (() => { try { return localStorage.getItem('ck_device_name') ?? '' } catch { return '' } })()
        await axios.post('/api/auth/session/heartbeat', {
          session_id: sessionIdRef.current,
          device_type: deviceType,
          device_name: storedName,
        })
        const res = await axios.get('/api/auth/active-sessions')
        const d = res.data?.data ?? {}
        setDeviceCounts({ desktop: d.desktop ?? 0, mobile: d.mobile ?? 0 })
        setSessionDetail(d.sessions ?? [])
      } catch {}
    }

    heartbeat()
    const t = setInterval(heartbeat, 60000)
    return () => clearInterval(t)
  }, [token, realIsMobile]) // eslint-disable-line react-hooks/exhaustive-deps
  const isMobile = viewMode === 'auto' ? realIsMobile : viewMode === 'mobile'

  function cycleViewMode() {
    setViewModeState(prev => {
      const next: ViewMode = prev === 'auto' ? (realIsMobile ? 'desktop' : 'mobile')
        : prev === 'mobile' ? 'desktop'
        : 'auto'
      try { localStorage.setItem('app_viewMode', next) } catch {}
      return next
    })
  }

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('app_sidebarCollapsed') === '1' } catch { return false }
  })

  function toggleSidebar() {
    setSidebarCollapsed(v => {
      const next = !v
      try { localStorage.setItem('app_sidebarCollapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

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

  const visibleNav = NAV_ITEMS.filter(item => {
    // Explicit admin override takes priority over role-based check
    if (item.to in pageAccess) return pageAccess[item.to]
    return hasRole(user, item.minRole)
  })

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: tokens.shellBg, ...(isMobile ? { height: 'auto', overflow: 'visible' } : {}) }}>
      <style>{`@keyframes oracleSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <AssistantWidget />
      {/* Device name prompt modal */}
      {deviceNamePrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 12, padding: 24, width: 340, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: tokens.textPrimary, marginBottom: 4 }}>Set Device Name</div>
            <div style={{ fontSize: 12, color: tokens.textMuted, marginBottom: 14 }}>
              Give this device a recognizable name (e.g. "Office PC", "Home Laptop", "iPhone").
              This helps identify sessions in the active sessions list.
            </div>
            <input
              autoFocus
              value={deviceNameInput}
              onChange={e => setDeviceNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDeviceName(deviceNameInput) }}
              placeholder='e.g. Office PC'
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, borderRadius: 6, border: `1px solid ${tokens.inputBorder}`, background: tokens.inputBg, color: tokens.inputColor, marginBottom: 12, outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => saveDeviceName(deviceNameInput)} style={{ flex: 1, padding: '8px', background: tokens.accent, border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setDeviceNamePrompt(false)} style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${tokens.cardBorder}`, borderRadius: 6, color: tokens.textMuted, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1099,
        }} />
      )}

      <aside style={{
        width: sidebarCollapsed && !isMobile ? 0 : 220,
        minWidth: sidebarCollapsed && !isMobile ? 0 : 220,
        background: tokens.sidebarBg, borderRight: `1px solid ${tokens.sidebarBorder}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0, height: '100vh',
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease, background 0.2s, border-color 0.2s',
        ...(isMobile ? {
          width: 220, minWidth: 220,
          position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 1100,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        } : {}),
      }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${tokens.sidebarBorder}`, display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.73L23 6H6"/>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '-0.2px' }}>
              CityKart <span style={{ color: '#4ade80' }}>Alloc</span>
            </span>
            <span style={{ fontSize: 7, color: '#86efac', letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 2 }}>Allocation Tool</span>
          </div>
        </div>
        <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
          {visibleNav.map(item => (
            <NavItem key={item.to} to={item.to} label={item.label} icon={item.icon} />
          ))}
        </nav>
        <div style={{ borderTop: `1px solid ${tokens.sidebarBorder}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: tokens.accent, color: tokens.shellBg, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ fontSize: 11, color: tokens.textPrimary, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name}
              </div>
              <div style={{ fontSize: 10, color: tokens.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
              color: ROLE_COLOR[user.role] || tokens.textSecondary,
              background: (ROLE_COLOR[user.role] || tokens.textSecondary) + '18',
              padding: '2px 7px', borderRadius: 8,
            }}>
              {ROLE_LABEL[user.role] || user.role}
            </span>
            <button style={{ background: 'none', border: `1px solid ${tokens.sidebarBorder}`, borderRadius: 4, color: tokens.textSecondary, fontSize: 11, padding: '4px 8px', cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={handleSignout}>Sign out</button>
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
                <div style={{ background: 'var(--content-bg)', borderRadius: 6, padding: 8, border: '1px solid var(--card-border)', marginTop: 2 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>
                    Request: {upgradeTarget === 'temp_admin' ? 'Temp Admin access' : 'Planner role'}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Reason (optional)…"
                    value={roleReason}
                    onChange={e => setRoleReason(e.target.value)}
                    style={{ width: '100%', fontSize: 10, background: 'var(--card-bg)', border: '1px solid var(--card-border)', color: 'var(--text-primary)', borderRadius: 4, padding: 4, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
                  />
                  {upgradeTarget === 'temp_admin' && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' as const }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Duration:</span>
                      {([{h:1,l:'1h'},{h:3,l:'3h'},{h:24,l:'1d'},{h:72,l:'3d'},{h:168,l:'7d'}]).map(o => (
                        <button key={o.h} onClick={() => setTempDays(o.h)} style={{ fontSize: 9, padding: '2px 6px', background: tempDays === o.h ? '#1d4ed8' : '#1e293b', color: tempDays === o.h ? '#fff' : '#64748b', border: '1px solid var(--card-border)', borderRadius: 3, cursor: 'pointer' }}>
                          {o.l}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <button onClick={submitRoleRequest} disabled={submitting} style={{ fontSize: 10, padding: '3px 10px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
                      {submitting ? '…' : 'Submit'}
                    </button>
                    <button onClick={() => setRoleRequestOpen(false)} style={{ fontSize: 10, padding: '3px 8px', background: 'none', color: 'var(--text-muted)', border: '1px solid var(--card-border)', borderRadius: 3, cursor: 'pointer' }}>
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

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...(isMobile ? { overflowY: 'visible', overflowX: 'hidden' } : {}) }}>
        <div style={{ background: tokens.topbarBg, borderBottom: `1px solid ${tokens.topbarBorder}`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, color: tokens.textSecondary, gap: 8, transition: 'background 0.2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isMobile ? (
              <button onClick={() => setSidebarOpen(o => !o)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: tokens.textSecondary, fontSize: 20, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
              }}>☰</button>
            ) : (
              <button onClick={toggleSidebar} title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: tokens.textSecondary, fontSize: 16, lineHeight: 1, padding: '2px 6px', flexShrink: 0,
                opacity: 0.7,
              }}>
                {sidebarCollapsed ? '▶' : '◀'}
              </button>
            )}
            <span style={{ fontSize: isMobile ? 11 : 13 }}>CityKart Replenishment</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {oracleRunning && (
              <NavLink to="/oracle-refresh" style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
                  background: tokens.accentBg, color: tokens.accent, borderRadius: 20,
                  padding: '3px 10px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                  <span style={{ display: 'inline-block', animation: 'oracleSpin 1s linear infinite' }}>⟳</span>
                  Oracle Refresh
                </div>
              </NavLink>
            )}
            <div ref={sessionBadgeRef} style={{ position: 'relative', flexShrink: 0 }}>
              <span
                onClick={() => setSessionPopup(p => !p)}
                title="Click to see active sessions"
                style={{ display: 'flex', alignItems: 'center', gap: 5, color: tokens.textMuted, fontSize: isMobile ? 9 : 10, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 4, padding: isMobile ? '2px 6px' : '2px 8px', letterSpacing: '0.3px', cursor: 'pointer', userSelect: 'none' }}
              >
                <span style={{ color: '#4ade80', fontSize: 8 }}>●</span>
                <span>Active : {sessionTime}</span>
                <span style={{ color: tokens.cardBorder }}>·</span>
                {deviceCounts.desktop > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span>{deviceCounts.desktop}</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  </span>
                )}
                {deviceCounts.mobile > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span>{deviceCounts.mobile}</span>
                    <svg width="9" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                    </svg>
                  </span>
                )}
              </span>
              {sessionPopup && (
                <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 300, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`, borderRadius: 8, padding: 12, minWidth: 260, boxShadow: '0 4px 20px rgba(0,0,0,0.35)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: tokens.textMuted, letterSpacing: '.08em', textTransform: 'uppercase' }}>Active Sessions</div>
                    <button onClick={() => { setDeviceNameInput(deviceName); setDeviceNamePrompt(true); setSessionPopup(false) }}
                      style={{ fontSize: 9, padding: '2px 7px', background: 'transparent', border: `1px solid ${tokens.cardBorder}`, borderRadius: 3, color: tokens.textMuted, cursor: 'pointer' }}>
                      ✏ Set my device name
                    </button>
                  </div>
                  {sessionDetail.length === 0 && <div style={{ fontSize: 11, color: tokens.textMuted }}>No session data yet</div>}
                  {sessionDetail.map((s, i) => {
                    const ago = Math.round((Date.now() / 1000 - s.last_seen) / 60)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < sessionDetail.length - 1 ? `1px solid ${tokens.cardBorder}` : 'none' }}>
                        <span style={{ fontSize: 14, marginTop: 1 }}>{s.device_type === 'mobile' ? '📱' : '🖥️'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: tokens.textPrimary, marginBottom: 1 }}>
                            {s.device_type === 'mobile' ? 'Mobile' : 'Desktop'}{s.device_name ? ` · ${s.device_name}` : ''}
                          </div>
                          <div style={{ fontSize: 11, color: tokens.textSecondary, fontFamily: 'monospace' }}>{s.ip || '—'}</div>
                          <div style={{ fontSize: 10, color: tokens.textMuted, marginTop: 1 }}>
                            {[s.browser, s.os].filter(Boolean).join(' · ')}
                            {(s.browser || s.os) ? ' · ' : ''}{ago <= 1 ? 'just now' : `${ago}m ago`}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <button
              onClick={cycleViewMode}
              title={viewMode === 'auto' ? 'View: Auto (click to switch)' : viewMode === 'mobile' ? 'View: Mobile (click for Desktop)' : 'View: Desktop (click for Auto)'}
              style={{ background: viewMode !== 'auto' ? tokens.accentBg : 'none', border: `1px solid ${viewMode !== 'auto' ? tokens.accent : tokens.cardBorder}`, borderRadius: 4, cursor: 'pointer', fontSize: 13, padding: '2px 7px', color: viewMode !== 'auto' ? tokens.accent : 'inherit', opacity: viewMode === 'auto' ? 0.6 : 1 }}
            >
              {viewMode === 'mobile' ? '📱' : viewMode === 'desktop' ? '🖥️' : realIsMobile ? '📱' : '🖥️'}
            </button>
            <ThemePicker />
            <DisplayPicker />
            <NotificationBell />
          </div>
        </div>
        <div style={{
          flex: 1, padding: isMobile ? 12 : 16, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0,
          background: tokens.contentBg, transition: 'background 0.2s',
          ...(isMobile ? { overflowY: 'visible', overflowX: 'hidden', flex: 'unset' } : {}),
        }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
