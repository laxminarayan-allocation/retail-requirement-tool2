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
  { id: 'changelog', label: '🔖  Changelog' },
  { id: 'overview', label: '🗺️  Overview' },
  { id: 'roles', label: '🔑  Roles & Access' },
  { id: 'signup', label: '✍️  Getting Started' },
  { id: 'dashboard', label: '📊  Dashboard' },
  { id: 'calculation', label: '▶️  Running Calculation' },
  { id: 'factors', label: '⚙️  Calc Factors' },
  { id: 'distribution', label: '📦  Distribution Model' },
  { id: 'option_listing', label: '🏷️  Option Listing Filter' },
  { id: 'pipeline', label: '⚙️  Pipeline & Scheduler' },
  { id: 'data_store', label: '💾  Data Store' },
  { id: 'store_status', label: '🏪  Store Status' },
  { id: 'results', label: '📋  Results & Export' },
  { id: 'settings_guide', label: '⚙️  Settings & Server' },
  { id: 'login_guide', label: '🔐  Login & Sessions' },
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
type VersionEntry = { id: string; version: string; date: string; type: string; title: string; desc: string; released: boolean }

export default function UserManual() {
  const { user } = useAuth()
  const [active, setActive] = useState('overview')
  const [myLogs, setMyLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  useEffect(() => {
    if (active === 'myactivity') {
      setLogsLoading(true)
      axios.get('/api/auth/my-logs?limit=50')
        .then(r => setMyLogs(r.data.data?.logs || []))
        .finally(() => setLogsLoading(false))
    }
    if (active === 'changelog') {
      setVersionsLoading(true)
      axios.get('/api/versions')
        .then(r => setVersions((r.data.data?.versions || []).filter((v: VersionEntry) => v.released)))
        .finally(() => setVersionsLoading(false))
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

          <Section id="changelog" title="📋 Changelog — Version History">
            <p style={S.p}>
              Sare releases aur updates ki complete list — newest first.
            </p>
            {versionsLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
            {!versionsLoading && versions.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No entries found.</div>
            )}
            {versions.map(entry => {
              const typeMeta: Record<string, { label: string; bg: string; color: string }> = {
                feature:     { label: '✦ NEW',         bg: 'rgba(56,189,248,.12)',  color: '#38bdf8' },
                fix:         { label: '✓ FIX',         bg: 'rgba(74,222,128,.10)', color: '#4ade80' },
                improvement: { label: '↑ IMPROVEMENT', bg: 'rgba(251,191,36,.10)', color: '#fbbf24' },
                breaking:    { label: '⚠ BREAKING',    bg: 'rgba(248,113,113,.10)', color: '#f87171' },
              }
              const tm = typeMeta[entry.type] || typeMeta['feature']
              return (
                <div key={entry.id} style={{ display: 'flex', gap: 10, marginBottom: 10, padding: '10px 12px', background: 'var(--content-bg)', borderRadius: 6, border: '1px solid var(--card-border)' }}>
                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: tm.bg, color: tm.color, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {tm.label}
                    </span>
                    <span style={{ fontSize: 10, color: tm.color, fontWeight: 700 }}>v{entry.version}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entry.date}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{entry.title}</div>
                    {entry.desc && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{entry.desc}</div>}
                  </div>
                </div>
              )
            })}
          </Section>

          <div style={S.divider} />

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

          {isPlanner && (
            <>
              <Section id="distribution" title="Distribution Model">
                <p style={S.p}>
                  Distribution Model tab allocation quantities ko store-level pe distribute karta hai
                  — PBS ke against warehouse stock ko stores mein bhejta hai.
                </p>
                <div style={S.sectionLabel}>Distribution Run Karne Ka Procedure</div>
                <ol style={S.stepList}>
                  <li style={{ marginBottom: 8 }}>
                    Pehle <strong>Calculation</strong> run karo aur complete ho jaane do.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Distribution Model</strong> tab open karo. Run ID dropdown mein latest run select karo.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>WH Column</strong> select karo (default: <code>wh_q</code> — warehouse quantity).
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Max Rounds</strong> set karo (default: 10 — kitne distribution iterations chalenge).
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Optional: <strong>Hold Rules</strong> add karo — specific stores ya attribute1 values ko hold karne ke liye.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Option Listing Filter</strong> toggle karo agar PREWINTER / LT WINTER attribute1 ke liye
                    option listing hold apply karna ho (details neeche).
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Run Distribution</strong> button click karo.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Output table mein columns dikhenge: Store, Grade, Icode, Attribute1, Concept New,
                    List Tag, Req Qty, Allocated Qty, Reason Not Allocated, etc.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Download CSV</strong> ya <strong>Download Excel</strong> se export karo.
                  </li>
                </ol>
                <div style={S.tip}>
                  💡 Agar browser hard refresh (Ctrl+Shift+R) kiya toh run values automatically restore ho jaayenge
                  (localStorage mein save hote hain).
                </div>
                <div style={S.warn}>
                  ⚠️ Distribution run ke baad CSV mein attribute1, concept_new, aur list_tag columns automatically aate hain.
                  Preview mein dikhne wale columns CSV mein bhi honge.
                </div>
              </Section>

              <div style={S.divider} />

              <Section id="option_listing" title="Option Listing Filter">
                <p style={S.p}>
                  Option Listing Filter ek special hold rule hai jo <strong>PREWINTER</strong> aur <strong>LT WINTER</strong> attribute1
                  wale SKUs ke liye Oracle table <code>T_CLR_CONCEPT_AW26_V1</code> se list_tag check karta hai.
                </p>
                <div style={S.sectionLabel}>Kaise Kaam Karta Hai</div>
                <ul style={S.stepList}>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Store × Concept New</strong> join hota hai Oracle table ke saath.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Agar <code>LIST_TAG = YES</code> hai us store+concept_new ke liye → allocate hoga.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Agar <code>LIST_TAG = NO</code> ya missing hai → allocation 0 ho jaata hai aur
                    remark <strong>"HOLD FOR OPTION_LISTING NO"</strong> lagta hai.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    Yeh rule sirf PREWINTER / LT WINTER attribute1 par apply hota hai — baaki attributes unaffected.
                  </li>
                </ul>
                <div style={S.sectionLabel}>Enable Karne Ka Procedure</div>
                <ol style={S.stepList}>
                  <li style={{ marginBottom: 6 }}>Distribution Model page kholo.</li>
                  <li style={{ marginBottom: 6 }}>
                    <strong>"Option Listing Filter"</strong> section mein checkbox toggle karo — ON karo.
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    Status badge check karo — Oracle table se data load hai ya nahi confirm hoga.
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    Distribution run karo — output mein <strong>list_tag</strong> column dikhega aur held rows mein reason show hoga.
                  </li>
                </ol>
                <div style={S.tip}>
                  💡 Summary stats mein "OL Held" count dikhta hai — kitne rows option listing hold se affected hue.
                </div>
              </Section>

              <div style={S.divider} />

              <Section id="pipeline" title="⚙️ Pipeline & Scheduler (Option Listing)">
                <p style={S.p}>
                  Option Listing page ke andar <strong>⏰ Scheduler</strong> tab hai — pipeline ka 3rd tab.
                  Yeh tab pipeline steps ka automated daily run manage karta hai aur manual "Run Now" bhi provide karta hai.
                </p>

                <div style={S.sectionLabel}>Pipeline Steps (9 Total)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 14 }}>
                  {[
                    { step: 'MC', desc: 'Load from Oracle — New MC Search (REPORT.T_GRID × V_ITEM_MASTER)' },
                    { step: '00', desc: 'Master data download' },
                    { step: '02', desc: 'GRC Processing' },
                    { step: '03', desc: 'REQ Processing' },
                    { step: '07', desc: 'PBS / Sparky REQ' },
                    { step: '08', desc: 'Warehouse Stock' },
                    { step: '04', desc: 'Color Distribution' },
                    { step: '05', desc: 'Summary Excel' },
                    { step: '06', desc: 'Audit' },
                  ].map(s => (
                    <div key={s.step} style={{ background: 'rgba(56,189,248,.08)', border: '1px solid rgba(56,189,248,.2)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: '#38bdf8' }}>{s.step}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{s.desc}</span>
                    </div>
                  ))}
                </div>

                <div style={S.sectionLabel}>Step MC — Load from Oracle</div>
                <p style={S.p}>
                  Pipeline ka pehla step (MC) Oracle se live data fetch karta hai — <code>REPORT.T_GRID × REPORT.V_ITEM_MASTER</code> join karke
                  PREWINTER / LT WINTER articles load karta hai. Yeh step inline run hota hai, koi script nahi.
                  Agar yeh fail hoga to pipeline rok deta hai.
                </p>

                <div style={S.sectionLabel}>Scheduler Tab — Features</div>
                <ul style={S.stepList}>
                  <li style={{ marginBottom: 6 }}><strong>Enable / Disable toggle</strong> — scheduler on/off karo.</li>
                  <li style={{ marginBottom: 6 }}><strong>▶ Run Now</strong> — abhi pipeline start karo, schedule ka wait nahi.</li>
                  <li style={{ marginBottom: 6 }}><strong>Time config</strong> — hour + minute set karo (default: 9:00 AM IST). Presets: 6:00–10:00.</li>
                  <li style={{ marginBottom: 6 }}><strong>Run Days</strong> — Every day | <strong>Mon–Sat (default)</strong> | Mon–Fri. Sunday skip hoti hai by default.</li>
                  <li style={{ marginBottom: 6 }}><strong>Next Scheduled</strong> — agla run kab hoga, IST mein dikhata hai.</li>
                  <li style={{ marginBottom: 6 }}><strong>Live Log</strong> — pipeline steps ka real-time log, 4 second refresh. Scroll down hota rahtai hai.</li>
                  <li style={{ marginBottom: 6 }}><strong>Step badges</strong> — MC, 00, 02, 03, 07, 08, 04, 05, 06 — live status dikhate hain.</li>
                </ul>

                <div style={S.tip}>
                  💡 Pipeline scheduler daemon thread pe chalta hai — backend restart ke baad automatically resume ho jaata hai.
                  "Run Now" instant trigger hai, sleep ka wait nahi karta.
                </div>
                <div style={S.warn}>
                  ⚠️ Pipeline step MC fail ho jaaye to baaki steps nahi chalenge. Pehle Oracle connection check karo.
                </div>
              </Section>

              <div style={S.divider} />

              <Section id="data_store" title="💾 Data Store — Parquet Cache">
                <p style={S.p}>
                  Data Store page Oracle se data ko <strong>local Parquet files</strong> mein download karta hai —
                  ek baar download, phir sare reports us local cache se padh sakte hain. Isse Oracle pe live load kam hoti hai
                  aur reports fast hote hain.
                </p>

                <div style={S.sectionLabel}>Architecture</div>
                <div style={{ background: 'rgba(56,189,248,.06)', border: '1px solid rgba(56,189,248,.15)', borderRadius: 8, padding: '12px 16px', marginBottom: 14, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  <strong style={{ color: '#38bdf8' }}>Oracle</strong>
                  {' → '}
                  <strong style={{ color: '#fbbf24' }}>Download (background thread)</strong>
                  {' → '}
                  <strong style={{ color: '#4ade80' }}>Parquet Files (D:\…\DataStore\)</strong>
                  {' → '}
                  <strong style={{ color: '#a78bfa' }}>Reports read from local cache</strong>
                  <br />
                  Sab data <strong>T−1</strong> hai (kal ka Oracle data). Scheduler daily 9 AM IST pe auto-refresh karta hai.
                </div>

                <div style={S.sectionLabel}>12 Registered Sources</div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 14 }}>
                  {[
                    { key: 'store_master', label: 'Store Master', schedule: 'weekly' },
                    { key: 'item_master', label: 'Item Master', schedule: 'daily' },
                    { key: 'grc_raw', label: 'GRC Raw', schedule: 'daily' },
                    { key: 'sale_raw', label: 'SALE Raw', schedule: 'daily' },
                    { key: 'req_raw', label: 'REQ Raw (MRP Req)', schedule: 'daily' },
                    { key: 'art_grid', label: 'Article Grid', schedule: 'daily' },
                    { key: 'prepack_avg', label: 'Prepack Avg', schedule: 'daily' },
                    { key: 'prev_allocation', label: 'Prev Allocation (Option Listing)', schedule: 'daily' },
                    { key: 'mc_req_apps', label: 'MC REQ Apps', schedule: 'daily' },
                    { key: 'color_family', label: 'Color Family', schedule: 'daily' },
                    { key: 'pbs_req', label: 'PBS / Sparky REQ', schedule: 'daily' },
                    { key: 'wh_stock', label: 'Warehouse Stock', schedule: 'daily' },
                  ].map(s => (
                    <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--content-bg)', borderRadius: 5, padding: '5px 10px', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                      <span style={{ color: s.schedule === 'weekly' ? '#fbbf24' : '#38bdf8', fontWeight: 600 }}>{s.schedule}</span>
                    </div>
                  ))}
                </div>

                <div style={S.sectionLabel}>Status Indicators</div>
                <ul style={S.stepList}>
                  <li style={{ marginBottom: 6 }}><strong style={{ color: '#22c55e' }}>✅ Fresh</strong> — last 26 hours mein download hua. Reports ready hain.</li>
                  <li style={{ marginBottom: 6 }}><strong style={{ color: '#f59e0b' }}>⚠️ Stale</strong> — 26+ hours purana. Refresh karna chahiye.</li>
                  <li style={{ marginBottom: 6 }}><strong style={{ color: '#ef4444' }}>❌ Missing</strong> — abhi tak download nahi hua. Pehli baar "Download All" karo.</li>
                </ul>

                <div style={S.sectionLabel}>Usage</div>
                <ol style={S.stepList}>
                  <li style={{ marginBottom: 6 }}>Nav mein <strong>💾 Data Store</strong> click karo.</li>
                  <li style={{ marginBottom: 6 }}>Pehli baar: <strong>⬇ Download All</strong> button click karo — sab 12 sources sequentially download honge.</li>
                  <li style={{ marginBottom: 6 }}>Individual source refresh karna ho: us row ka <strong>⬇ Refresh</strong> button click karo.</li>
                  <li style={{ marginBottom: 6 }}>Status 3 seconds mein auto-update hoti hai — downloading progress live dikhta hai.</li>
                </ol>

                <div style={S.tip}>
                  💡 Scheduler daily 9 AM IST pe pipeline run karta hai — Data Store bhi us time refresh ho jaata hai automatically.
                  Manual refresh ki zaroorat sirf tab hai jab urgent fresh data chahiye.
                </div>
              </Section>

              <div style={S.divider} />
            </>
          )}

          <Section id="store_status" title="Store Status">
            <p style={S.p}>
              Store Status page har store ka <strong>division × attribute1 × department</strong> level pe hold status dikhata hai.
              Stores ko allocation se bahar rakhne ke liye yahan configure karo.
            </p>
            <ul style={S.stepList}>
              <li style={{ marginBottom: 8 }}>
                <strong>Granular Hold</strong> — ek store ko sirf ek specific division ya dept ke liye hold karo,
                poore store ko nahi.
              </li>
              <li style={{ marginBottom: 8 }}>
                Hold rules distribution model ke <strong>Hold Rules</strong> section mein automatically reflect honge.
              </li>
            </ul>
          </Section>

          <div style={S.divider} />

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

          <div style={S.divider} />

          {isPlanner && (
            <Section id="settings_guide" title="Settings & Server Control">
              <p style={S.p}>
                Settings page system health, cache management, aur server control provide karta hai.
              </p>
              <div style={S.sectionLabel}>Data Cache Management</div>
              <ul style={S.stepList}>
                <li style={{ marginBottom: 6 }}>
                  <strong>Warm Up Cache</strong> — Oracle se item master aur store master preload karo.
                  Pehle calculation slow hoti hai agar cache cold ho — warmup se speed milti hai.
                </li>
                <li style={{ marginBottom: 6 }}>
                  <strong>Invalidate Cache</strong> — Oracle data refresh karna ho toh cache clear karo.
                  Next calculation run fresh Oracle data use karega.
                </li>
              </ul>
              <div style={S.sectionLabel}>Server Control</div>
              <ul style={S.stepList}>
                <li style={{ marginBottom: 6 }}>
                  <strong>↺ Restart Backend</strong> — uvicorn Python server restart ho jaata hai.
                  5–10 seconds ke liye app disconnect hoga, phir auto reconnect hoga.
                  Naya code deploy karne ke baad use karo.
                </li>
                <li style={{ marginBottom: 6 }}>
                  <strong>⚙ Build Frontend (Mobile Update)</strong> — <code>npm run build</code> chalta hai.
                  Mobile app pe naya UI dikhane ke liye use karo — build ke baad mobile browser refresh karo.
                </li>
              </ul>
              <div style={S.sectionLabel}>Browser Cache</div>
              <ul style={S.stepList}>
                <li style={{ marginBottom: 6 }}>
                  <strong>Clear Data Cache</strong> — browser localStorage mein stored dashboard pins,
                  view preferences clear ho jaate hain. Auth token safe rehta hai.
                </li>
              </ul>
              <div style={S.warn}>
                ⚠️ Backend restart karne se all in-memory session data clear ho jaata hai.
                Active users ko dobara login karna padega.
              </div>
            </Section>
          )}

          <div style={S.divider} />

          <Section id="login_guide" title="Login & Sessions">
            <div style={S.sectionLabel}>Normal Login</div>
            <ol style={S.stepList}>
              <li style={{ marginBottom: 6 }}>Login page pe email aur password dalo.</li>
              <li style={{ marginBottom: 6 }}><strong>Sign In</strong> click karo.</li>
            </ol>
            <div style={S.sectionLabel}>Max Login Limit Reach Hone Par</div>
            <p style={S.p}>
              Agar same account se already max sessions active hain (usually 1 desktop session),
              ek conflict dialog dikhega:
            </p>
            <ul style={S.stepList}>
              <li style={{ marginBottom: 6 }}>
                Dialog mein active sessions ki details dikhegi — device name, browser, IP.
              </li>
              <li style={{ marginBottom: 6 }}>
                <strong>"⚡ Sign out from all devices & Login here"</strong> button click karo.
              </li>
              <li style={{ marginBottom: 6 }}>
                Yeh <strong>sabhi</strong> existing sessions (sabhi devices) logout kar deta hai
                aur is device pe fresh login ho jaata hai.
              </li>
            </ul>
            <div style={S.sectionLabel}>Forgot Password</div>
            <ol style={S.stepList}>
              <li style={{ marginBottom: 6 }}>Login page pe <strong>Forgot password?</strong> click karo.</li>
              <li style={{ marginBottom: 6 }}>Registered email daalo aur submit karo.</li>
              <li style={{ marginBottom: 6 }}>Screen pe temporary password dikhega — use copy karo.</li>
              <li style={{ marginBottom: 6 }}>
                <strong>Sign In</strong> pe jaao, temporary password use karo, phir password change karo.
              </li>
            </ol>
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
