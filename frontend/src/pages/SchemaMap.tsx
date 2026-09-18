import { useState } from 'react'
import { useTheme } from '@/context/ThemeContext'

// ── Data ─────────────────────────────────────────────────────────────────────

const RULES_ENGINES = [
  'ST_ART_MSTR', 'ST_MC_MSTR', 'ST_MRP_MSTR', 'ST_SZ_MSTR',
  'V_ALLOCATION', 'V_ALLOCATION_LEVEL', 'V_ART_ALLOCATION', 'V_ART_REQ_APPS',
  'V_BARCODE_REQ_APPS_GRC_V2', 'V_CAT6_LIST', 'V_GRC',
  'V_LAST_4WK_SL_ST_ART', 'V_LAST_4WK_SL_ST_ICODE', 'V_LAST_4WK_SL_ST_MC',
  'V_LAST_4WK_SL_ST_MRP', 'V_MC_ALLOCATION', 'V_MC_REQ_APPS_2', 'V_MDQ_STR',
  'V_MRP_ALLOCATION', 'V_MRP_REQ_APPS', 'V_OPTION_REQ_APPS', 'V_PBS_ART',
  'V_PBS_MC', 'V_PBS_MRP', 'V_PROJ_ART', 'V_PROJ_MC', 'V_PROJ_MRP',
  'V_SL_TGT_ART', 'V_SL_TGT_MC', 'V_SL_TGT_MRP', 'V_SPARKY_PBS_REQ',
  'V_STORE_ICODE_BLOCK_LIST', 'V_ST_STK_ART', 'V_ST_STK_MC', 'V_ST_STK_MRP',
  'V_SZ_REQ_APPS', 'V_WH_STOCK',
]

const DEAD_CODE = ['V_FRESH_STK', 'V_SALE']

type DepInfo = { baseTables: number; views: number }

const TOP_LEVEL_DEPS: Record<string, DepInfo> = {
  V_BARCODE_REQ_APPS_GRC_V2: { baseTables: 21, views: 5 },
  V_GRC:                      { baseTables: 3,  views: 0 },
  V_MC_REQ_APPS_2:            { baseTables: 27, views: 5 },
  V_MRP_REQ_APPS:             { baseTables: 13, views: 3 },
  V_OPTION_REQ_APPS:          { baseTables: 28, views: 1 },
  V_SPARKY_PBS_REQ:           { baseTables: 13, views: 2 },
  V_SZ_REQ_APPS:              { baseTables: 10, views: 2 },
}

type FilterTab = 'inuse' | 'all'
type FilterChip = 'all' | 'inapp' | 'req' | 'leaf' | 'toplevel'

function matchesChip(view: string, chip: FilterChip): boolean {
  if (chip === 'all') return true
  if (chip === 'inapp') return RULES_ENGINES.includes(view)
  if (chip === 'req') return view.includes('_REQ')
  if (chip === 'leaf') return !TOP_LEVEL_DEPS[view]
  if (chip === 'toplevel') return !!TOP_LEVEL_DEPS[view]
  return true
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SchemaMap() {
  const { tokens } = useTheme()
  const [tab, setTab] = useState<FilterTab>('inuse')
  const [chip, setChip] = useState<FilterChip>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const allViews = tab === 'inuse' ? RULES_ENGINES : [...RULES_ENGINES, ...DEAD_CODE]
  const filteredRules = RULES_ENGINES.filter(v => matchesChip(v, chip))
  const filteredDead  = tab === 'all' ? DEAD_CODE.filter(v => matchesChip(v, chip)) : []

  const isDeadCode = selected ? DEAD_CODE.includes(selected) : false
  const depInfo    = selected ? TOP_LEVEL_DEPS[selected] : undefined

  const STAT_CARDS = [
    { value: '39', label: 'IN USE' },
    { value: '37', label: 'RULES ENGINES' },
    { value: '2',  label: 'NOT NEEDED (VERIFIED)' },
    { value: '128', label: 'BASE TABLES USED' },
  ]

  const CHIPS: { key: FilterChip; label: string }[] = [
    { key: 'all',      label: 'All' },
    { key: 'inapp',    label: 'In app' },
    { key: 'req',      label: '*_REQ*' },
    { key: 'leaf',     label: 'Leaf' },
    { key: 'toplevel', label: 'Top-level' },
  ]

  const s: Record<string, React.CSSProperties> = {
    page: {
      display: 'flex', flexDirection: 'column', gap: 20,
      padding: 24, minHeight: '100vh',
      background: tokens.contentBg, color: tokens.textPrimary,
      fontFamily: 'system-ui, sans-serif',
    },
    heading: { margin: 0, fontSize: 22, fontWeight: 700, color: tokens.textPrimary },
    statsRow: { display: 'flex', gap: 12 },
    statCard: {
      flex: 1, background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
      borderRadius: 10, padding: '14px 18px',
    },
    statVal: { fontSize: 28, fontWeight: 800, color: tokens.accent },
    statLabel: { fontSize: 11, fontWeight: 600, color: tokens.textMuted, letterSpacing: 1, marginTop: 2 },
    tabRow: { display: 'flex', gap: 4 },
    tab: (active: boolean): React.CSSProperties => ({
      padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
      fontWeight: 600, fontSize: 13,
      background: active ? tokens.accent : tokens.cardBg,
      color: active ? '#fff' : tokens.textSecondary,
    }),
    chipRow: { display: 'flex', gap: 6 },
    chip: (active: boolean): React.CSSProperties => ({
      padding: '4px 12px', borderRadius: 20, border: `1px solid ${active ? tokens.accent : tokens.cardBorder}`,
      cursor: 'pointer', fontSize: 12, fontWeight: 600,
      background: active ? tokens.accentBg : 'transparent',
      color: active ? tokens.accent : tokens.textSecondary,
    }),
    split: { display: 'flex', gap: 16, flex: 1 },
    leftPanel: {
      width: 280, flexShrink: 0, background: tokens.cardBg,
      border: `1px solid ${tokens.cardBorder}`, borderRadius: 10,
      overflow: 'auto', maxHeight: 'calc(100vh - 260px)',
    },
    groupHeader: {
      padding: '10px 14px', fontSize: 10, fontWeight: 700,
      letterSpacing: 1, color: tokens.textMuted,
      background: tokens.tableHeaderBg, borderBottom: `1px solid ${tokens.cardBorder}`,
      position: 'sticky' as const, top: 0,
    },
    viewItem: (active: boolean): React.CSSProperties => ({
      padding: '7px 14px', fontSize: 12, cursor: 'pointer',
      borderBottom: `1px solid ${tokens.cardBorder}`,
      background: active ? tokens.accentBg : 'transparent',
      color: active ? tokens.accent : tokens.textPrimary,
      fontWeight: active ? 600 : 400,
      fontFamily: 'monospace',
    }),
    rightPanel: {
      flex: 1, background: tokens.cardBg,
      border: `1px solid ${tokens.cardBorder}`, borderRadius: 10,
      padding: 24, overflow: 'auto', maxHeight: 'calc(100vh - 260px)',
    },
    empty: { color: tokens.textMuted, fontSize: 14, marginTop: 40, textAlign: 'center' as const },
    viewName: { margin: '0 0 12px', fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: tokens.textPrimary },
    badge: (color: string, bg: string): React.CSSProperties => ({
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      color, background: bg, marginBottom: 16,
    }),
    sectionTitle: {
      fontSize: 11, fontWeight: 700, letterSpacing: 1,
      color: tokens.textMuted, textTransform: 'uppercase' as const,
      marginTop: 20, marginBottom: 8,
    },
    depBox: {
      background: tokens.inputBg, border: `1px solid ${tokens.cardBorder}`,
      borderRadius: 8, padding: '12px 16px', fontSize: 13,
    },
    depRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
    depDot: (color: string): React.CSSProperties => ({
      width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0,
    }),
    sqlBox: {
      background: tokens.inputBg, border: `1px solid ${tokens.cardBorder}`,
      borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: 12,
      color: tokens.textMuted, whiteSpace: 'pre' as const,
    },
  }

  return (
    <div style={s.page}>
      <h1 style={s.heading}>Schema Map</h1>

      {/* Stats row */}
      <div style={s.statsRow}>
        {STAT_CARDS.map(c => (
          <div key={c.label} style={s.statCard}>
            <div style={s.statVal}>{c.value}</div>
            <div style={s.statLabel}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={s.tabRow}>
        <button style={s.tab(tab === 'inuse')} onClick={() => setTab('inuse')}>In use (39)</button>
        <button style={s.tab(tab === 'all')}   onClick={() => setTab('all')}>All (112)</button>
      </div>

      {/* Filter chips */}
      <div style={s.chipRow}>
        {CHIPS.map(c => (
          <button key={c.key} style={s.chip(chip === c.key)} onClick={() => setChip(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Two-panel split */}
      <div style={s.split}>
        {/* Left panel */}
        <div style={s.leftPanel}>
          {filteredRules.length > 0 && (
            <>
              <div style={s.groupHeader}>RULES ENGINES IN THE APP ({filteredRules.length})</div>
              {filteredRules.map(v => (
                <div key={v} style={s.viewItem(selected === v)} onClick={() => setSelected(v)}>{v}</div>
              ))}
            </>
          )}
          {filteredDead.length > 0 && (
            <>
              <div style={s.groupHeader}>NOT NEEDED — BYPASSED / DEAD CODE ({filteredDead.length})</div>
              {filteredDead.map(v => (
                <div key={v} style={s.viewItem(selected === v)} onClick={() => setSelected(v)}>{v}</div>
              ))}
            </>
          )}
        </div>

        {/* Right panel */}
        <div style={s.rightPanel}>
          {!selected ? (
            <div style={s.empty}>Select a view from the left panel to see details.</div>
          ) : (
            <>
              <h2 style={s.viewName}>{selected}</h2>
              {isDeadCode ? (
                <span style={s.badge(tokens.danger, tokens.danger + '22')}>DEAD CODE</span>
              ) : (
                <span style={s.badge(tokens.success, tokens.success + '22')}>IN USE</span>
              )}

              <div style={s.sectionTitle}>Dependency Tree</div>
              <div style={s.depBox}>
                {depInfo ? (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 10, color: tokens.textPrimary }}>
                      {selected} (top-level view)
                    </div>
                    <div style={s.depRow}>
                      <div style={s.depDot(tokens.accent)} />
                      <span style={{ color: tokens.textSecondary }}>
                        <strong style={{ color: tokens.textPrimary }}>{depInfo.baseTables}</strong> base tables
                      </span>
                    </div>
                    <div style={s.depRow}>
                      <div style={s.depDot(tokens.warning)} />
                      <span style={{ color: tokens.textSecondary }}>
                        <strong style={{ color: tokens.textPrimary }}>{depInfo.views}</strong> dependent views
                      </span>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: tokens.textMuted }}>
                      Total depth: {depInfo.views > 0 ? '2+ levels' : '1 level (direct to base tables)'}
                    </div>
                  </>
                ) : (
                  <span style={{ color: tokens.textMuted, fontStyle: 'italic' }}>
                    Leaf view — no sub-dependencies
                  </span>
                )}
              </div>

              <div style={s.sectionTitle}>Reference SQL</div>
              <div style={s.sqlBox}>
                {`-- SQL for ${selected} from CK_A2166 schema\n-- Source: Oracle Data Dictionary (ALL_VIEWS)\n\nSELECT text\nFROM all_views\nWHERE owner = 'CK_A2166'\n  AND view_name = '${selected}';`}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
