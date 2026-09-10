import { useState, useRef, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '@/context/AuthContext'

const ALLOWED = ['citykart.org', 'citykartstores.com']
function domainOk(email: string) {
  return ALLOWED.includes(email.split('@')[1]?.toLowerCase())
}

const S: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh', background: 'var(--content-bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
    padding: '40px 36px', width: '100%', maxWidth: 420,
    boxShadow: '0 8px 32px rgba(0,0,0,.4)',
  },
  cardWide: {
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
    padding: '36px 36px', width: '100%', maxWidth: 680,
    boxShadow: '0 8px 32px rgba(0,0,0,.4)',
  },
  brand: { fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#38bdf8', marginBottom: 6 },
  title: { fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4, letterSpacing: '-.02em' },
  sub: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 28 },
  tabs: { display: 'flex', gap: 0, background: 'var(--content-bg)', borderRadius: 6, padding: 3, marginBottom: 24 },
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1, textAlign: 'center', padding: '7px 0', fontSize: 13,
    fontWeight: active ? 700 : 400, color: active ? '#e2e8f0' : '#64748b',
    background: active ? '#1e293b' : 'transparent',
    border: 'none', borderRadius: 4, cursor: 'pointer', transition: 'all .15s',
  }),
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
    letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 6,
  },
  input: {
    width: '100%', background: 'var(--content-bg)', border: '1px solid var(--card-border)',
    borderRadius: 6, padding: '10px 12px', fontSize: 13, color: 'var(--text-primary)',
    outline: 'none', marginBottom: 16, boxSizing: 'border-box' as const, transition: 'border-color .15s',
  },
  btn: {
    width: '100%', background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 6, padding: '11px 0', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', marginTop: 4, transition: 'background .15s',
  },
  btnDisabled: { opacity: 0.55, cursor: 'not-allowed' as const },
  err: {
    background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
    borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#fca5a5', marginBottom: 16,
  },
  warn: {
    background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)',
    borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#fcd34d', marginBottom: 16, lineHeight: 1.6,
  },
  success: {
    background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.3)',
    borderRadius: 6, padding: '12px 14px', fontSize: 12, color: '#34d399', marginBottom: 16, lineHeight: 1.7,
  },
  note: { marginTop: 20, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' as const, lineHeight: 1.6 },
  link: { color: '#38bdf8', cursor: 'pointer', textDecoration: 'underline', background: 'none', border: 'none', fontSize: 12, padding: 0 },
  tempPw: {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 6,
    padding: '8px 12px', fontFamily: 'monospace', fontSize: 16, fontWeight: 700,
    color: '#fbbf24', letterSpacing: 2, textAlign: 'center' as const, margin: '8px 0',
  },
}

type Mode = 'signin' | 'signup' | 'forgot'

export default function LoginPage() {
  const { signin } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')

  // Shared fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')

  // Signup extra fields
  const [confirmPw, setConfirmPw]     = useState('')
  const [displayName, setDisplayName] = useState('')
  const [designation, setDesignation] = useState('')
  const [department, setDepartment]   = useState('')
  const [dob, setDob]                 = useState('')
  const [contactNo, setContactNo]     = useState('')
  const [whatsappNo, setWhatsappNo]   = useState('')

  // UI state
  const [error, setError] = useState('')
  const [warnMsg, setWarnMsg] = useState('')   // duplicate email hint
  const [loading, setLoading] = useState(false)
  const [conflictSessions, setConflictSessions] = useState<{ip: string; device_name: string; browser: string; os: string; since: number}[] | null>(null)

  // Forgot password result
  const [tempPw, setTempPw] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)

  // Ref to capture credentials at the moment conflict dialog appears.
  // Needed because browser autofill may not update React state via onChange.
  const conflictCreds = useRef({ email: '', password: '' })

  const emailErr = email.length > 3 && !domainOk(email)

  function switchMode(m: Mode) {
    setMode(m); setError(''); setWarnMsg(''); setTempPw(null); setForgotSent(false)
  }

  // ── Sign In ──────────────────────────────────────────────────────────────────
  async function handleSignin(e: FormEvent) {
    e.preventDefault()
    // Read from DOM directly in case browser autofill didn't fire onChange
    const emailVal = email || (e.currentTarget.querySelector('input[type="email"]') as HTMLInputElement)?.value || ''
    const pwVal = password || (e.currentTarget.querySelector('input[type="password"]') as HTMLInputElement)?.value || ''
    if (!emailVal || !pwVal) return
    if (emailVal !== email) setEmail(emailVal)
    if (pwVal !== password) setPassword(pwVal)
    setError(''); setConflictSessions(null); setLoading(true)
    try {
      const res = await axios.post('/api/auth/signin', { email: emailVal, password: pwVal })
      if (!res.data.success) {
        setError(res.data.message || 'An error occurred.')
        if (res.data.data?.conflict_sessions) {
          // Save credentials in ref so force-login always has them
          conflictCreds.current = { email: emailVal, password: pwVal }
          setConflictSessions(res.data.data.conflict_sessions)
        }
        return
      }
      if (res.data.data.session_id) {
        try { localStorage.setItem('ck_session_id', res.data.data.session_id) } catch {}
      }
      await signin(res.data.data.token)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred.')
    } finally { setLoading(false) }
  }

  async function handleForceLogin() {
    setLoading(true); setError('')
    // Use saved ref credentials (autofill-safe) or fall back to state
    const creds = conflictCreds.current.email
      ? conflictCreds.current
      : { email, password }
    try {
      const res = await axios.post('/api/auth/force-login', creds)
      if (!res.data.success) { setError(res.data.message || 'Force login failed.'); return }
      setConflictSessions(null)
      if (res.data.data.session_id) {
        try { localStorage.setItem('ck_session_id', res.data.data.session_id) } catch {}
      }
      await signin(res.data.data.token)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred.')
    } finally { setLoading(false) }
  }

  // ── Sign Up ──────────────────────────────────────────────────────────────────
  async function handleSignup(e: FormEvent) {
    e.preventDefault()
    if (emailErr || !email || !password || !fullName.trim()) return
    if (password !== confirmPw) { setError('Passwords do not match.'); return }
    setError(''); setWarnMsg(''); setLoading(true)
    try {
      const res = await axios.post('/api/auth/signup', {
        email, full_name: fullName, password,
        display_name: displayName || null,
        designation:  designation  || null,
        department:   department   || null,
        dob:          dob          || null,
        contact_no:   contactNo    || null,
        whatsapp_no:  whatsappNo   || null,
      })
      if (!res.data.success) {
        if (res.data.data?.duplicate_email) {
          setWarnMsg(res.data.message)
        } else {
          setError(res.data.message || 'An error occurred.')
        }
        return
      }
      await signin(res.data.data.token)
      navigate('/', { replace: true })
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.detail?.[0]?.msg || 'An error occurred.'
      setError(msg)
    } finally { setLoading(false) }
  }

  // ── Forgot Password ──────────────────────────────────────────────────────────
  async function handleForgot(e: FormEvent) {
    e.preventDefault()
    if (!email || emailErr) return
    setError(''); setLoading(true)
    try {
      const res = await axios.post('/api/auth/forgot-password', { email })
      if (res.data.data?.temp_password) {
        setTempPw(res.data.data.temp_password)
        setForgotSent(false)
      } else {
        setForgotSent(true)
        setTempPw(null)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred.')
    } finally { setLoading(false) }
  }

  return (
    <div style={S.shell}>
      <div style={mode === 'signup' ? S.cardWide : S.card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 13, background: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61h9.72a2 2 0 001.99-1.73L23 6H6"/>
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>
            CityKart <span style={{ color: '#4ade80' }}>Alloc</span>
          </div>
          <div style={{ fontSize: 8, color: '#86efac', letterSpacing: '2px', textTransform: 'uppercase' }}>Allocation Tool</div>
        </div>
        <div style={S.sub}>Sign in to access allocation planning</div>

        {/* Tabs — Sign In / Sign Up only; Forgot is inline */}
        {mode !== 'forgot' && (
          <div style={S.tabs}>
            <button style={S.tab(mode === 'signin')} onClick={() => switchMode('signin')}>Sign In</button>
            <button style={S.tab(mode === 'signup')} onClick={() => switchMode('signup')}>Sign Up</button>
          </div>
        )}

        {/* ── SIGN IN ── */}
        {mode === 'signin' && (
          <>
            {error && <div style={S.err}>{error}</div>}
            {conflictSessions && conflictSessions.length > 0 && (
              <div style={{ background: '#1e1a2e', border: '1px solid #7c3aed', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd', marginBottom: 8 }}>
                  ⚠️ Max login limit reached — active session(s):
                </div>
                {conflictSessions.map((s, i) => (
                  <div key={i} style={{ fontSize: 11, color: '#a78bfa', marginBottom: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span>🖥️ {s.device_name || 'Unknown device'}</span>
                    <span>·</span>
                    <span>{s.browser} / {s.os}</span>
                    <span>·</span>
                    <span>IP: {s.ip || '—'}</span>
                  </div>
                ))}
                {error && <div style={{ ...S.err, marginTop: 8, marginBottom: 0 }}>{error}</div>}
                <button
                  type="button"
                  onClick={handleForceLogin}
                  disabled={loading}
                  style={{ marginTop: 10, width: '100%', padding: '8px 0', background: '#7c3aed',
                    color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                  {loading ? 'Signing in…' : '⚡ Sign out from all devices & Login here'}
                </button>
              </div>
            )}
            <form onSubmit={handleSignin}>
              <label style={S.label}>Email</label>
              <input style={{ ...S.input, ...(emailErr ? { borderColor: '#ef4444' } : {}) }}
                type="email" placeholder="you@citykart.org" value={email}
                onChange={e => setEmail(e.target.value)} required autoComplete="email" />

              <label style={S.label}>Password</label>
              <input style={S.input} type="password" placeholder="Your password"
                value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="current-password" />

              <button type="submit" style={{ ...S.btn, ...(loading ? S.btnDisabled : {}) }} disabled={loading}>
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {/* Forgot password link */}
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button style={S.link} onClick={() => switchMode('forgot')}>
                Forgot password?
              </button>
            </div>
          </>
        )}

        {/* ── SIGN UP ── */}
        {mode === 'signup' && (
          <>
            {error && <div style={S.err}>{error}</div>}

            {/* Duplicate email warning — points to Forgot Password */}
            {warnMsg && (
              <div style={S.warn}>
                ⚠️ {warnMsg}
                <br />
                <button style={{ ...S.link, color: '#fbbf24', fontSize: 11, marginTop: 4 }}
                  onClick={() => { switchMode('forgot'); setEmail(email) }}>
                  → Go to Forgot Password now
                </button>
              </div>
            )}

            <form onSubmit={handleSignup}>
              {/* 2-column grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>

                {/* Row 1: Full Name | Email */}
                <div>
                  <label style={S.label}>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <input style={S.input} type="text" placeholder="e.g. Suresh Kumar"
                    value={fullName} onChange={e => setFullName(e.target.value)}
                    required autoComplete="name" />
                </div>
                <div>
                  <label style={S.label}>Email <span style={{ color: '#ef4444' }}>*</span></label>
                  <input style={{ ...S.input, ...(emailErr ? { borderColor: '#ef4444' } : {}) }}
                    type="email" placeholder="you@citykart.org" value={email}
                    onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                </div>

                {/* Domain error — span both cols */}
                {emailErr && (
                  <div style={{ ...S.err, gridColumn: '1 / -1', marginTop: -10, marginBottom: 4 }}>
                    Only @citykart.org or @citykartstores.com addresses are allowed.
                  </div>
                )}

                {/* Row 2: Password | Confirm Password */}
                <div>
                  <label style={S.label}>Password <span style={{ color: '#ef4444' }}>*</span></label>
                  <input style={S.input} type="password" placeholder="Min 6 chars"
                    value={password} onChange={e => setPassword(e.target.value)}
                    required autoComplete="new-password" />
                </div>
                <div>
                  <label style={S.label}>Confirm Password <span style={{ color: '#ef4444' }}>*</span></label>
                  <input style={{ ...S.input, ...(confirmPw && confirmPw !== password ? { borderColor: '#ef4444' } : {}) }}
                    type="password" placeholder="Repeat"
                    value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    required autoComplete="new-password" />
                </div>

                {/* Row 3: Display Name | Designation */}
                <div>
                  <label style={S.label}>Username / Display Name</label>
                  <input style={S.input} type="text" placeholder="Short name"
                    value={displayName} onChange={e => setDisplayName(e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Designation</label>
                  <input style={S.input} type="text" placeholder="e.g. Technician"
                    value={designation} onChange={e => setDesignation(e.target.value)} />
                </div>

                {/* Row 4: Department | Date of Birth */}
                <div>
                  <label style={S.label}>Department</label>
                  <input style={S.input} type="text" placeholder="e.g. Production"
                    value={department} onChange={e => setDepartment(e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>Date of Birth</label>
                  <input style={S.input} type="date"
                    value={dob} onChange={e => setDob(e.target.value)} />
                </div>

                {/* Row 5: Contact No | WhatsApp No */}
                <div>
                  <label style={S.label}>Contact No.</label>
                  <input style={S.input} type="tel" placeholder="9876543210"
                    value={contactNo} onChange={e => setContactNo(e.target.value)} />
                </div>
                <div>
                  <label style={S.label}>WhatsApp No. (with country code)</label>
                  <input style={S.input} type="tel" placeholder="919876543210"
                    value={whatsappNo} onChange={e => setWhatsappNo(e.target.value)} />
                </div>
              </div>

              <button type="submit"
                style={{ ...S.btn, ...(loading || (confirmPw && confirmPw !== password) ? S.btnDisabled : {}) }}
                disabled={loading || !!(confirmPw && confirmPw !== password)}>
                {loading ? 'Creating account…' : 'Create Account →'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button type="button" style={S.link} onClick={() => switchMode('signin')}>← Back to Login</button>
              </div>
            </form>
          </>
        )}

        {/* ── FORGOT PASSWORD ── */}
        {mode === 'forgot' && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Reset Password</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Enter your registered email. A temporary password will be generated for you.
              </div>
            </div>

            {error && <div style={S.err}>{error}</div>}

            {/* Temp password shown on screen (when SMTP not configured) */}
            {tempPw && (
              <div style={S.success}>
                ✅ Temporary password generated for <strong>{email}</strong>:
                <div style={S.tempPw}>{tempPw}</div>
                <div style={{ fontSize: 11, color: '#6ee7b7', marginTop: 4 }}>
                  Copy this password → Sign In → change it immediately.
                </div>
                <button style={{ ...S.btn, marginTop: 12, background: 'var(--content-bg)', border: '1px solid var(--card-border)', fontSize: 12 }}
                  onClick={() => { switchMode('signin'); setPassword('') }}>
                  → Go to Sign In
                </button>
              </div>
            )}

            {/* Emailed confirmation */}
            {forgotSent && (
              <div style={S.success}>
                📧 If <strong>{email}</strong> is registered, a temporary password has been sent to your email.
                <button style={{ ...S.btn, marginTop: 12, background: 'var(--content-bg)', border: '1px solid var(--card-border)', fontSize: 12 }}
                  onClick={() => switchMode('signin')}>
                  → Back to Sign In
                </button>
              </div>
            )}

            {!tempPw && !forgotSent && (
              <form onSubmit={handleForgot}>
                <label style={S.label}>Registered Email</label>
                <input style={{ ...S.input, ...(emailErr ? { borderColor: '#ef4444' } : {}) }}
                  type="email" placeholder="you@citykart.org" value={email}
                  onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                {emailErr && (
                  <div style={{ ...S.err, marginTop: -10, marginBottom: 12 }}>
                    Only @citykart.org or @citykartstores.com addresses are allowed.
                  </div>
                )}
                <button type="submit" style={{ ...S.btn, ...(loading ? S.btnDisabled : {}) }} disabled={loading}>
                  {loading ? 'Generating…' : 'Get Temporary Password'}
                </button>
              </form>
            )}

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button style={S.link} onClick={() => switchMode('signin')}>← Back to Sign In</button>
            </div>
          </>
        )}

        <div style={S.note}>
          Access restricted to CityKart employees.<br />
          Use your @citykart.org or @citykartstores.com email.
        </div>
      </div>
    </div>
  )
}
