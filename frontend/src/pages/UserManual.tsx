import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth, hasRole } from '@/context/AuthContext'

const S: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "'Segoe UI', system-ui, sans-serif", color: 'var(--text-primary)',
    display: 'flex', flexDirection: 'column',
    height: '100%', overflow: 'hidden',
  },
  header: { flexShrink: 0, marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', marginBottom: 4, color: '#f1f5f9' },
  sub: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 0 },
  grid: { display: 'flex', gap: 24, flex: 1, minHeight: 0 },
  sidebar: {
    width: 220, flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 2,
    overflowY: 'auto' as const,
  },
  navBtn: (a: boolean): React.CSSProperties => ({
    textAlign: 'left', padding: '8px 12px', border: 'none', cursor: 'pointer', borderRadius: 6,
    fontSize: 12.5, fontWeight: a ? 600 : 400,
    color: a ? '#38bdf8' : '#64748b',
    background: a ? '#0f172a' : 'transparent',
    borderLeft: a ? '3px solid #38bdf8' : '3px solid transparent',
  }),
  content: {
    flex: 1, overflowY: 'auto' as const,
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
    padding: '28px 32px', lineHeight: 1.7,
  },
  sectionTitle: { fontSize: 17, fontWeight: 800, color: '#f1f5f9', marginBottom: 12, marginTop: 0 },
  p: { fontSize: 13, color: 'var(--text-secondary)', marginTop: 0, marginBottom: 14 },
  tip: {
    background: 'rgba(56,189,248,.07)', border: '1px solid rgba(56,189,248,.2)',
    borderRadius: 6, padding: '10px 14px', fontSize: 12.5, color: '#7dd3fc',
    marginBottom: 14,
  },
  warn: {
    background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.2)',
    borderRadius: 6, padding: '10px 14px', fontSize: 12.5, color: '#fcd34d',
    marginBottom: 14,
  },
  stepList: { paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13 },
  roleRow: {
    display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginBottom: 14,
  },
  roleCard: (color: string): React.CSSProperties => ({
    flex: '1 1 140px', background: color + '12', border: `1px solid ${color}30`,
    borderRadius: 8, padding: '12px 14px',
  }),
  roleTitle: (color: string): React.CSSProperties => ({
    fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
    color, marginBottom: 6,
  }),
  kbd: {
    background: 'var(--content-bg)', border: '1px solid var(--card-border)', borderRadius: 4,
    padding: '2px 7px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
  },
  divider: { borderTop: '1px solid var(--card-border)', margin: '20px 0' },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
    color: 'var(--text-muted)', marginBottom: 6, marginTop: 18,
  },
}

const SECTIONS = [
  { id: 'overview', label: '🗺️  Overview' },
  { id: 'roles', label: '🔑  Roles & Access' },
  { id: 'signup', label: '✍️  Getting Started' },
  { id: 'dashboard', label: '📊  Dashboard' },
  { id: 'calculation', label: '▶️  Running Calculation' },
  { id: 'factors', label: '⚙️  Calc Factors' },
  { id: 'results', label: '📋  Results & Export' },
  { id: 'admin', label: '🛡️  Admin Guide' },
  { id: 'faq', label: '❓  FAQ' },
  { id: 'myactivity', label: '🕐  My Activity' },
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginBottom: 32 }}>
      <h2 style={S.sectionTitle}>{title}</h2>
      {children}
    </div>
  )
}

type ActivityLog = { id: string; action: string; details: string; ip_address: string; created_at: string }

export default function UserManual() {
  const { user } = useAuth()
  const [active, setActive] = useState('overview')
  const [myLogs, setMyLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  useEffect(() => {
    if (active === 'myactivity') {
      setLogsLoading(true)
      axios.get('/api/auth/my-logs?limit=50')
        .then(r => setMyLogs(r.data.data?.logs || []))
        .finally(() => setLogsLoading(false))
    }
  }, [active])

  const isAdmin = user && hasRole(user, 'admin')
  const isPlanner = user && hasRole(user, 'planner')

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.h1}>User Manual</h1>
        <p style={S.sub}>Complete guide to the CityKart SS27 Retail Requirement &amp; Replenishment Tool</p>
      </div>

      <div style={S.grid}>
        {/* Sidebar nav */}
        <div style={S.sidebar}>
          {SECTIONS.filter(s => s.id !== 'admin' || isAdmin).map(sec => (
            <button
              key={sec.id}
              style={S.navBtn(active === sec.id)}
              onClick={() => {
                setActive(sec.id)
                document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              {sec.label}
            </button>
          ))}
          <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--content-bg)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Need help?</div>
            <div style={{ fontSize: 11, color: '#38bdf8' }}>Use the 💬 chat button</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>bottom-right corner</div>
          </div>
        </div>

        {/* Content */}
        <div style={S.content}>

          <Section id="overview" title="Overview">
            <p style={S.p}>
              The SS27 Retail Requirement &amp; Replenishment Tool (RRT) automates store-level stock replenishment
              calculations for CityKart's 200+ stores. It reads master data from Oracle (read-only), applies
              configurable planning factors, and produces store-SKU allocation quantities ready for use by the
              buying and logistics teams.
            </p>
            <div style={S.tip}>
              💡 This tool covers the <strong>SS27 / AW26 Pre-Winter</strong> season. For each calculation run,
              you select a season, division, and department, then the engine computes replenishment quantities
              against planned buy (PBS) and current stock positions.
            </div>
            <p style={S.p}><strong style={{ color: 'var(--text-secondary)' }}>Key capabilities:</strong></p>
            <ul style={S.stepList}>
              <li>Automated store-level replenishment vs PBS targets</li>
              <li>Grade-based PBS multipliers (A/B/C/D store grading)</li>
              <li>Safety stock buffer (configurable in days)</li>
              <li>Transit, pack-pending, and transfer-out stock inclusions</li>
              <li>Exception flagging (over-allocation, zero-requirement)</li>
              <li>Excel export with store-level detail</li>
            </ul>
          </Section>

          <div style={S.divider} />

          <Section id="roles" title="Roles & Access">
            <div style={S.roleRow}>
              {[
                { role: 'Viewer', color: 'var(--text-secondary)', perms: ['Dashboard', 'Results', 'History'] },
                { role: 'Planner', color: '#34d399', perms: ['+ Master Data', '+ Database Explorer', '+ Calc Factors', '+ Calculation', '+ Settings'] },
                { role: 'Admin', color: '#818cf8', perms: ['+ Admin Panel', '+ User management', '+ All planner pages'] },
              ].map(r => (
                <div key={r.role} style={S.roleCard(r.color)}>
                  <div style={S.roleTitle(r.color)}>{r.role}</div>
                  {r.perms.map(p => (
                    <div key={p} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>{p}</div>
                  ))}
                </div>
              ))}
            </div>
            <div style={S.warn}>
              ⚠️ New users start as <strong>Pending</strong>. You must submit a role request and wait for
              admin approval before accessing any data.
            </div>
          </Section>

          <div style={S.divider} />

          <Section id="signup" title="Getting Started">
            <div style={S.sectionLabel}>Step-by-step signup</div>
            <ol style={S.stepList}>
              <li style={{ marginBottom: 8 }}>
                Click <strong>Sign Up</strong> on the login page. Use your <strong>@citykart.org</strong> or
                <strong> @citykartstores.com</strong> work email — personal addresses are not allowed.
              </li>
              <li style={{ marginBottom: 8 }}>
                Enter your full name and a password (min. 8 characters). Click <strong>Create Account</strong>.
              </li>
              <li style={{ marginBottom: 8 }}>
                Your account starts as <strong>Pending</strong>. On the waiting screen, click
                <strong> Request Access</strong>, choose Viewer or Planner, and optionally add a reason.
              </li>
              <li style={{ marginBottom: 8 }}>
                Once the admin approves your request, your role updates automatically within 30 seconds.
                No need to sign out and back in.
              </li>
            </ol>
            <div style={S.tip}>
              💡 Role changes take effect automatically — the app polls for updates every 30 seconds.
            </div>
          </Section>

          <div style={S.divider} />

          <Section id="dashboard" title="Dashboard">
            <p style={S.p}>
              The Dashboard shows a live summary of the system's state. Use it to get a quick read of
              recent calculation health before diving into details.
            </p>
            <ul style={S.stepList}>
              <li><strong>Total Stores / Departments</strong> — active store and dept count from Oracle</li>
              <li><strong>Last Run Fill Rate</strong> — fill rate achieved vs target in the most recent successful run</li>
              <li><strong>Pending Exceptions</strong> — errors or warnings from the last run that need review</li>
              <li><strong>Last Run card</strong> — click to jump directly to that run's results</li>
            </ul>
          </Section>

          <div style={S.divider} />

          {isPlanner && (
            <>
              <Section id="calculation" title="Running a Calculation">
                <ol style={S.stepList}>
                  <li style={{ marginBottom: 8 }}>
                    Go to <strong>Calc Factors</strong> and make sure a factor set is <em>active</em>.
                    An active factor set has a green "Active" badge. Only one can be active at a time.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Go to <strong>Calculation</strong>. Select the <strong>Attribute1</strong>, <strong>Season</strong>,
                    <strong> Division</strong>, and <strong>Department</strong> you want to plan.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Toggle stock inclusions: <em>Transit</em>, <em>Pack Pending</em>, and <em>Transfer Out</em>.
                    When included, these quantities reduce the replenishment requirement.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Click <strong>Run Calculation</strong>. The run executes asynchronously. You can watch
                    progress steps update in real time.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    When complete, click <strong>View Results</strong> to go to the Results page for this run.
                  </li>
                </ol>
                <div style={S.tip}>
                  💡 Large departments (many stores × many SKUs) can take 30–90 seconds. The run
                  status shows in History even if you navigate away.
                </div>
                <div style={S.warn}>
                  ⚠️ Only one calculation can run at a time. Starting a new run while one is in progress
                  will queue behind the current run.
                </div>
              </Section>

              <div style={S.divider} />

              <Section id="factors" title="Calculation Factors">
                <p style={S.p}>
                  Factor Sets are named configuration profiles for the calculation engine. Create multiple
                  sets to compare scenarios (e.g., conservative vs aggressive fill rate targets).
                </p>
                <ul style={S.stepList}>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Safety Days</strong> — buffer stock in days of sales. Higher = more conservative allocation.
                    Default: 14 days.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Fill Rate Target</strong> — target percentage of stores receiving their full PBS.
                    Default: 85%.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Min Alloc Qty</strong> — minimum units to allocate per store (prevents 0-unit allocations).
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Max Alloc Factor</strong> — caps allocation at N × PBS. Default: 2× PBS.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Grade PBS Multipliers</strong> — scale PBS by store grade. A-grade stores might get 1.2×,
                    D-grade stores 0.7×.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Division Overrides</strong> — exclude specific divisions from the run or override safety days per division.
                  </li>
                </ul>
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--content-bg)', borderRadius: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>To activate a set: </span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    open the factor set → click <strong>Activate</strong>. Only the active set is used in calculations.
                  </span>
                </div>
              </Section>

              <div style={S.divider} />
            </>
          )}

          <Section id="results" title="Results & Export">
            <p style={S.p}>
              The Results page shows the full store × SKU replenishment output from the most recent
              (or any selected) calculation run.
            </p>
            <ul style={S.stepList}>
              <li>Filter by <strong>Store</strong>, <strong>Grade</strong>, <strong>Division</strong>, or <strong>Department</strong></li>
              <li>Columns: Store, Grade, Division, Dept, SKU, Stock on Hand, PBS, Safety Stock, Replenishment Qty</li>
              <li>Rows highlighted in amber = exceptions (capped allocation or zero requirement)</li>
              <li>Click <strong>Download Excel</strong> to export the current filtered view</li>
            </ul>
            <div style={S.tip}>
              💡 Use <strong>History</strong> to go back to any previous run's results — select the run
              and click View Results.
            </div>
          </Section>

          <div style={S.divider} />

          {isAdmin && (
            <Section id="admin" title="Admin Guide">
              <div style={S.sectionLabel}>Approving role requests</div>
              <ol style={S.stepList}>
                <li style={{ marginBottom: 6 }}>Go to <strong>Admin Panel → Role Requests</strong></li>
                <li style={{ marginBottom: 6 }}>Pending requests show at the top with a yellow dot</li>
                <li style={{ marginBottom: 6 }}>Click <strong>Approve</strong> or <strong>Deny</strong></li>
                <li style={{ marginBottom: 6 }}>The user's role updates instantly; they see it within 30 seconds</li>
              </ol>
              <div style={S.divider} />
              <div style={S.sectionLabel}>Changing a user's role directly</div>
              <p style={S.p}>
                In <strong>Admin Panel → Users</strong>, find the user and use the role dropdown to change
                their role immediately without going through the request flow. Useful for quick escalations
                or demotions.
              </p>
              <div style={S.divider} />
              <div style={S.sectionLabel}>Activity Logs</div>
              <p style={S.p}>
                <strong>Admin Panel → Activity Logs</strong> shows all user actions: signups, signins,
                role requests, approvals, and calculation runs — with timestamps and IP addresses.
                Use this for auditing and troubleshooting.
              </p>
              <div style={S.warn}>
                ⚠️ The primary admin account (<strong>laxmi.narayan@citykart.org</strong>) cannot be
                deactivated or downgraded from Admin to protect system access.
              </div>
            </Section>
          )}

          <Section id="faq" title="Frequently Asked Questions">
            {[
              {
                q: "Why can't I see the Calculation page?",
                a: "You need Planner role or higher. Submit a role request from the waiting screen, and ask your admin to approve it.",
              },
              {
                q: "My role changed but the app still shows Pending?",
                a: "Wait up to 30 seconds — the app auto-polls for role changes. If it persists, sign out and sign back in.",
              },
              {
                q: "What happens if I run a calculation on the wrong department?",
                a: "Just run again with the correct selection. Previous runs remain in History and do not overwrite each other.",
              },
              {
                q: "Can I have multiple factor sets?",
                a: "Yes. Create as many as you need for scenario comparison. Only the Active set is used in calculations.",
              },
              {
                q: "The calculation seems stuck — what do I do?",
                a: "Check History. If the run shows 'running' for more than 5 minutes, refresh the page. If it shows 'failed', check the error details in the run's step log.",
              },
              {
                q: "Can I undo a calculation run?",
                a: "Calculation results are stored in History and do not affect Oracle data — the tool is read-only from Oracle. You can always ignore a run's output and run again.",
              },
            ].map(({ q, a }) => (
              <div key={q} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Q: {q}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>A: {a}</div>
              </div>
            ))}
          </Section>

          <Section id="myactivity" title="My Recent Activity">
            <p style={S.p}>Your last 50 actions in this application.</p>
            {logsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
            ) : myLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No activity recorded yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Action', 'Details', 'IP', 'Time'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #1e293b' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myLogs.map(l => (
                    <tr key={l.id}>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a' }}>
                        <code style={{ fontSize: 11, color: '#7dd3fc', background: 'var(--content-bg)', padding: '2px 6px', borderRadius: 3 }}>{l.action}</code>
                      </td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', color: 'var(--text-muted)', fontSize: 11 }}>{l.details || '—'}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>{l.ip_address || '—'}</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', color: 'var(--text-muted)', fontSize: 11 }}>{l.created_at?.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

        </div>
      </div>
    </div>
  )
}
