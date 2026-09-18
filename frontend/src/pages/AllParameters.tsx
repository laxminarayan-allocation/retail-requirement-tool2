import { useState } from 'react'
import { useTheme } from '@/context/ThemeContext'

// ── Types & Data ──────────────────────────────────────────────────────────────

interface CommonParam {
  key: string
  name: string
  views: number
  defaultVal: number
  description: string
  usedBy: string[]
  affects: string
}

interface EngineParam {
  key: string
  name: string
  defaultVal: number
  description?: string
}

interface EngineSection {
  key: string
  label: string
  params: EngineParam[]
}

const COMMON_PARAMS: CommonParam[] = [
  {
    key: 'high_fill_threshold',
    name: 'High-fill threshold',
    views: 2, defaultVal: 0.7,
    description: 'PBS_FILL > threshold → high-fill branch in MC_REQ and SPARKY_REQ',
    usedBy: ['MC_REQ', 'SPARKY_REQ'],
    affects: 'achievement multiplier selection',
  },
  {
    key: 'high_fill_achv_floor',
    name: 'High-fill achv floor',
    views: 2, defaultVal: 0.7,
    description: 'Minimum achievement multiplier in high-fill branch',
    usedBy: ['MC_REQ', 'SPARKY_REQ'],
    affects: 'final REQ quantity',
  },
  {
    key: 'steady_state_achv_floor',
    name: 'Steady-state achv floor',
    views: 2, defaultVal: 1,
    description: 'Minimum achievement in steady-state (normal) branch',
    usedBy: ['MC_REQ', 'MRP_REQ'],
    affects: 'final REQ quantity',
  },
  {
    key: 'aa_grade_ceiling',
    name: 'A/A+ grade ceiling',
    views: 3, defaultVal: 1.3,
    description: 'Maximum achievement cap for grade A and A+ stores',
    usedBy: ['MC_REQ', 'MRP_REQ', 'ARTICLE_REQ'],
    affects: 'REQ cap',
  },
  {
    key: 'other_grade_ceiling',
    name: 'Other grade ceiling',
    views: 3, defaultVal: 1.5,
    description: 'Maximum achievement cap for B+, B, C grade stores',
    usedBy: ['MC_REQ', 'MRP_REQ', 'ARTICLE_REQ'],
    affects: 'REQ cap',
  },
  {
    key: 'nso_window_months',
    name: 'NSO window months',
    views: 2, defaultVal: 2,
    description: "Store is considered 'new' for this many months after opening date",
    usedBy: ['MC_REQ', 'MRP_REQ'],
    affects: 'NSO projection logic',
  },
  {
    key: 'proj_month_days',
    name: 'Projection month days',
    views: 3, defaultVal: 30,
    description: 'Number of days per projection month for PROJ_1..6 calculation',
    usedBy: ['MC_REQ', 'MRP_REQ', 'ARTICLE_REQ'],
    affects: 'projected sales quantity',
  },
]

const ENGINE_SECTIONS: EngineSection[] = [
  {
    key: 'sparky',
    label: 'SPARKY_REQ RULES',
    params: [
      { key: 'lookback_weeks',    name: 'Lookback weeks',    defaultVal: 4,  description: 'Sales lookback window for PBS calculation' },
      { key: 'pbs_multiplier',    name: 'PBS multiplier',    defaultVal: 45, description: 'PBS = avg_weekly_sales × multiplier' },
      { key: 'sales_window_days', name: 'Sales window days', defaultVal: 30, description: 'Recent sales window for rate calculation' },
    ],
  },
  {
    key: 'barcode',
    label: 'BARCODE_REQ RULES',
    params: [
      { key: 'size_cat4_bucket_days',     name: 'Size CAT4 bucket days',     defaultVal: 12 },
      { key: 'ready_bucket_multiplier',   name: 'READY bucket multiplier',   defaultVal: 4,  description: 'READY stores get DESC4 × multiplier days' },
      { key: 'inner_section_bucket_days', name: 'INNER section bucket days', defaultVal: 72 },
      { key: 'lower_body_bucket_days',    name: 'Lower-body bucket days',    defaultVal: 12 },
      { key: 'default_bucket_days',       name: 'Default bucket days',       defaultVal: 48 },
      { key: 'sales_rate_multiplier',     name: 'Sales-rate multiplier',     defaultVal: 30 },
      { key: 'ready_max_grid_fixed',      name: 'READY MAX_GRID fixed',      defaultVal: 4 },
      { key: 'aa_summer_multiplier',      name: 'A/A+ SUMMER multiplier',    defaultVal: 3 },
      { key: 'aa_regular_multiplier',     name: 'A/A+ REGULAR multiplier',   defaultVal: 2 },
      { key: 'b_plus_addend',             name: 'B+ addend',                 defaultVal: 3 },
      { key: 'non_winter_addend',         name: 'Non-winter addend',         defaultVal: 2 },
    ],
  },
  {
    key: 'mc',
    label: 'MC_REQ RULES',
    params: [
      { key: 'nso_threshold_days',  name: 'New-store threshold days', defaultVal: 60, description: 'Store is NSO for this many days after opening' },
      { key: 'mdq_cap_multiplier',  name: 'MDQ cap multiplier',       defaultVal: 2,  description: 'MDQ cap = avg_weekly_sales × multiplier' },
    ],
  },
  {
    key: 'mrp',
    label: 'MRP_REQ RULES',
    params: [
      { key: 'sales_lookback_cap_days',      name: 'Sales lookback cap days',      defaultVal: 7 },
      { key: 'nso_proj_scale',               name: 'New-store projection scale',   defaultVal: 60 },
      { key: 'steady_state_proj_scale',      name: 'Steady-state projection scale', defaultVal: 90 },
    ],
  },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function CommonParamCard({
  param, value, onChange, tokens,
}: {
  param: CommonParam
  value: number
  onChange: (val: number) => void
  tokens: ReturnType<typeof useTheme>['tokens']
}) {
  const [expanded, setExpanded] = useState(false)
  const dirty = value !== param.defaultVal

  return (
    <div style={{
      background: tokens.cardBg, border: `1px solid ${dirty ? tokens.accent : tokens.cardBorder}`,
      borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: tokens.textPrimary }}>{param.name}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
          background: tokens.accentBg, color: tokens.accent, letterSpacing: 0.5,
        }}>{param.views} VIEWS</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
          background: tokens.tableHeaderBg, color: tokens.textMuted, letterSpacing: 0.5,
        }}>DEFAULT {param.defaultVal}</span>
        {dirty && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            background: tokens.warning + '22', color: tokens.warning,
          }}>MODIFIED</span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: tokens.textSecondary }}>{param.description}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 12, color: tokens.textMuted, fontWeight: 600 }}>VALUE</label>
        <input
          type="number"
          value={value}
          step={param.defaultVal < 2 ? 0.05 : 1}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: 90, padding: '5px 10px', borderRadius: 6,
            border: `1px solid ${dirty ? tokens.accent : tokens.inputBorder}`,
            background: tokens.inputBg, color: tokens.inputColor, fontSize: 13,
          }}
        />
        {dirty && (
          <button
            onClick={() => onChange(param.defaultVal)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none',
              background: tokens.tableHeaderBg, color: tokens.textMuted, cursor: 'pointer',
            }}
          >Reset</button>
        )}
      </div>

      <div>
        <button
          onClick={() => setExpanded(x => !x)}
          style={{
            fontSize: 11, fontWeight: 600, color: tokens.accent,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          {expanded ? '▾' : '▸'} USED BY ({param.usedBy.join(', ')})
        </button>
        {expanded && (
          <div style={{ marginTop: 6, paddingLeft: 12 }}>
            {param.usedBy.map(e => (
              <div key={e} style={{ fontSize: 12, color: tokens.textSecondary, fontFamily: 'monospace' }}>• {e}</div>
            ))}
            <div style={{ marginTop: 4, fontSize: 11, color: tokens.textMuted }}>
              AFFECTS: {param.affects}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EngineParamRow({
  param, value, onChange, tokens,
}: {
  param: EngineParam
  value: number
  onChange: (val: number) => void
  tokens: ReturnType<typeof useTheme>['tokens']
}) {
  const dirty = value !== param.defaultVal
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '10px 14px', borderBottom: `1px solid ${tokens.cardBorder}`,
      background: dirty ? tokens.accentBg : 'transparent',
    }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.textPrimary }}>{param.name}</div>
        {param.description && (
          <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 2 }}>{param.description}</div>
        )}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
        background: tokens.tableHeaderBg, color: tokens.textMuted,
      }}>DEFAULT {param.defaultVal}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 80, padding: '4px 8px', borderRadius: 6,
          border: `1px solid ${dirty ? tokens.accent : tokens.inputBorder}`,
          background: tokens.inputBg, color: tokens.inputColor, fontSize: 13,
        }}
      />
      {dirty && (
        <button
          onClick={() => onChange(param.defaultVal)}
          style={{
            fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none',
            background: tokens.tableHeaderBg, color: tokens.textMuted, cursor: 'pointer',
          }}
        >↺</button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AllParameters() {
  const { tokens } = useTheme()

  // Common param values
  const [commonVals, setCommonVals] = useState<Record<string, number>>(
    Object.fromEntries(COMMON_PARAMS.map(p => [p.key, p.defaultVal]))
  )

  // Engine param values
  const [engineVals, setEngineVals] = useState<Record<string, number>>(
    Object.fromEntries(
      ENGINE_SECTIONS.flatMap(s => s.params.map(p => [`${s.key}__${p.key}`, p.defaultVal]))
    )
  )

  // Collapsed state per engine section
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const totalDirty =
    COMMON_PARAMS.filter(p => commonVals[p.key] !== p.defaultVal).length +
    ENGINE_SECTIONS.flatMap(s => s.params).filter(p => {
      const sKey = ENGINE_SECTIONS.find(s => s.params.includes(p))!.key
      return engineVals[`${sKey}__${p.key}`] !== p.defaultVal
    }).length

  function handleSave() {
    alert(`Saved ${totalDirty} modified parameter(s).`)
  }

  const s: Record<string, React.CSSProperties> = {
    page: {
      display: 'flex', flexDirection: 'column', gap: 24,
      padding: 24, minHeight: '100vh',
      background: tokens.contentBg, color: tokens.textPrimary,
      fontFamily: 'system-ui, sans-serif',
    },
    topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    heading: { margin: 0, fontSize: 22, fontWeight: 700, color: tokens.textPrimary },
    saveBtn: {
      padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
      background: tokens.accent, color: '#fff', fontWeight: 700, fontSize: 14,
      position: 'relative' as const,
    },
    section: {
      background: tokens.cardBg, border: `1px solid ${tokens.cardBorder}`,
      borderRadius: 10, overflow: 'hidden',
    },
    sectionHeader: {
      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: `1px solid ${tokens.cardBorder}`,
      background: tokens.tableHeaderBg,
    },
    sectionTitle: { fontSize: 13, fontWeight: 700, color: tokens.textPrimary, flex: 1 },
    count: {
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: tokens.accentBg, color: tokens.accent,
    },
    paramGrid: {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
      gap: 12, padding: 16,
    },
    collapseBtn: {
      background: 'none', border: 'none', cursor: 'pointer',
      color: tokens.textMuted, fontSize: 14, padding: '0 4px',
    },
    engineSectionHeader: {
      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', userSelect: 'none' as const,
      borderBottom: `1px solid ${tokens.cardBorder}`,
    },
  }

  return (
    <div style={s.page}>
      {/* Top bar */}
      <div style={s.topBar}>
        <h1 style={s.heading}>All Parameters</h1>
        <button style={s.saveBtn} onClick={handleSave}>
          💾 Save all changes{totalDirty > 0 ? ` (${totalDirty})` : ''}
        </button>
      </div>

      {/* Section 1: Common params */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <span style={{ fontSize: 16 }}>🔗</span>
          <span style={s.sectionTitle}>Common parameters</span>
          <span style={s.count}>{COMMON_PARAMS.length} params</span>
        </div>
        <div style={s.paramGrid}>
          {COMMON_PARAMS.map(p => (
            <CommonParamCard
              key={p.key}
              param={p}
              value={commonVals[p.key]}
              onChange={val => setCommonVals(prev => ({ ...prev, [p.key]: val }))}
              tokens={tokens}
            />
          ))}
        </div>
      </div>

      {/* Section 2: Engine params */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚙</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: tokens.textPrimary }}>Other parameters</span>
          <span style={{ fontSize: 12, color: tokens.textMuted }}>(grouped by engine)</span>
        </div>

        {ENGINE_SECTIONS.map(section => {
          const isCollapsed = collapsed[section.key]
          const dirtyCount = section.params.filter(
            p => engineVals[`${section.key}__${p.key}`] !== p.defaultVal
          ).length

          return (
            <div key={section.key} style={s.section}>
              <div
                style={s.engineSectionHeader}
                onClick={() => setCollapsed(prev => ({ ...prev, [section.key]: !isCollapsed }))}
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: tokens.textPrimary, flex: 1 }}>
                  {section.label}
                </span>
                {dirtyCount > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: tokens.warning + '22', color: tokens.warning }}>
                    {dirtyCount} MODIFIED
                  </span>
                )}
                <span style={s.collapseBtn}>{isCollapsed ? '▸' : '▾'}</span>
              </div>
              {!isCollapsed && section.params.map(p => (
                <EngineParamRow
                  key={p.key}
                  param={p}
                  value={engineVals[`${section.key}__${p.key}`]}
                  onChange={val => setEngineVals(prev => ({ ...prev, [`${section.key}__${p.key}`]: val }))}
                  tokens={tokens}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
