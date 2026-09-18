import { useState, useCallback } from 'react'
import { useTheme } from '@/context/ThemeContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccordionSection {
  id: string
  title: string
  star?: boolean
  content: React.ReactNode
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionAccordion({
  section,
  index,
  open,
  onToggle,
  tokens,
}: {
  section: AccordionSection
  index?: number
  open: boolean
  onToggle: () => void
  tokens: ReturnType<typeof useTheme>['tokens']
}) {
  return (
    <div
      style={{
        border: `1px solid ${tokens.cardBorder}`,
        borderRadius: 8,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 16px',
          background: open ? tokens.accentBg : tokens.cardBg,
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          borderBottom: open ? `1px solid ${tokens.cardBorder}` : 'none',
        }}
      >
        <span style={{ fontSize: 13, color: open ? tokens.accent : tokens.textMuted, flexShrink: 0 }}>
          {open ? '▼' : '▶'}
        </span>
        {index !== undefined && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: tokens.accent,
              background: tokens.accentBg,
              border: `1px solid ${tokens.accent}40`,
              borderRadius: 4,
              padding: '1px 7px',
              flexShrink: 0,
            }}
          >
            {index}
          </span>
        )}
        {section.star && (
          <span style={{ fontSize: 13, color: tokens.warning, flexShrink: 0 }}>★</span>
        )}
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: open ? tokens.textPrimary : tokens.textSecondary,
            flex: 1,
          }}
        >
          {section.title}
        </span>
      </button>
      {open && (
        <div style={{ padding: '16px 20px', background: tokens.cardBg }}>
          {section.content}
        </div>
      )}
    </div>
  )
}

function DocTable({
  headers,
  rows,
  tokens,
}: {
  headers: string[]
  rows: (string | React.ReactNode)[][]
  tokens: ReturnType<typeof useTheme>['tokens']
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12.5,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '7px 12px',
                  background: tokens.tableHeaderBg,
                  color: tokens.textMuted,
                  fontWeight: 700,
                  fontSize: 10.5,
                  letterSpacing: '.07em',
                  textTransform: 'uppercase',
                  textAlign: 'left',
                  border: `1px solid ${tokens.tableBorder}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{ background: ri % 2 === 1 ? tokens.tableRowAlt : 'transparent' }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: '6px 12px',
                    border: `1px solid ${tokens.tableBorder}`,
                    color: ci === 0 ? tokens.textPrimary : tokens.textSecondary,
                    fontFamily: ci === 0 ? 'monospace' : undefined,
                    fontWeight: ci === 0 ? 600 : 400,
                    verticalAlign: 'top',
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Mono({ children, tokens }: { children: React.ReactNode; tokens: ReturnType<typeof useTheme>['tokens'] }) {
  return (
    <code
      style={{
        background: tokens.inputBg,
        border: `1px solid ${tokens.inputBorder}`,
        borderRadius: 3,
        padding: '1px 6px',
        fontSize: 11.5,
        fontFamily: 'monospace',
        color: tokens.accent,
      }}
    >
      {children}
    </code>
  )
}

function InfoCard({
  title,
  children,
  tokens,
}: {
  title: string
  children: React.ReactNode
  tokens: ReturnType<typeof useTheme>['tokens']
}) {
  return (
    <div
      style={{
        background: tokens.inputBg,
        border: `1px solid ${tokens.cardBorder}`,
        borderRadius: 7,
        padding: '12px 16px',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.07em',
          textTransform: 'uppercase',
          color: tokens.accent,
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ visible, tokens }: { visible: boolean; tokens: ReturnType<typeof useTheme>['tokens'] }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        right: 28,
        background: tokens.success,
        color: '#0f172a',
        borderRadius: 8,
        padding: '10px 18px',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 4px 24px rgba(0,0,0,.4)',
        transition: 'opacity .25s, transform .25s',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      ✓ Refreshed from latest config
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FlowDocumentation() {
  const { tokens } = useTheme()
  const [openMain, setOpenMain] = useState<Record<string, boolean>>({})
  const [openRules, setOpenRules] = useState<Record<string, boolean>>({})
  const [toastVisible, setToastVisible] = useState(false)

  const toggleMain = useCallback((id: string) => {
    setOpenMain((p) => ({ ...p, [id]: !p[id] }))
  }, [])

  const toggleRules = useCallback((id: string) => {
    setOpenRules((p) => ({ ...p, [id]: !p[id] }))
  }, [])

  const handleRefresh = () => {
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2500)
  }

  // ── Section content definitions ──────────────────────────────────────────

  const fetchRawRows: string[][] = [
    ['GRC_LINES', 'Oracle', 'MISRETAIL.CUBE$PURCHASE', 'grc_lines.csv'],
    ['SITE_MASTER', 'Oracle', 'MISRETAIL.SITE_MASTER', 'site_master.csv'],
    ['ITEM_MASTER', 'Oracle', 'ssrk.ITEM_MV', 'item_master.csv'],
    ['STORE_OPENING', 'Oracle', 'ssrk.T_STORE_OPENING_DATE', 'store_opening.csv'],
    ['AUTO_MC_STR', 'Oracle', 'ssrk.T_AUTO_MC_STR_DEPT', 'auto_mc_str.csv'],
    ['ALLOCATION_LY', 'Oracle', 'ssrk.T_ALLOCATION_LY_SL_Q_NEW', 'allocation_ly.csv'],
    ['T_FOR_ALL_DIV', 'Oracle', 'ssrk.T_ALLOCATION_FOR_ALL_DIVISION', 'for_all_div.csv'],
    ['ORDSTAT', 'Oracle', 'MISRETAIL.CUBE$ORDSTAT', 'ordstat.csv'],
    ['STK_ALLOC', 'Oracle', 'ssrk.T_STK_ALLOC_OPTION', 'stk_alloc.csv'],
    ['CAT6_LIST', 'Oracle', 'CK_A2166.V_CAT6_LIST', 'cat6_list.csv'],
    ['MC_LISTING', 'Oracle', 'CK_A2166.V_MC_ALLOCATION', 'mc_listing.csv'],
    ['CLR_LIST', 'Oracle', 'CK_A2166.V_ALLOCATION', 'clr_list.csv'],
    ['BLOCK_LIST', 'Oracle', 'CK_A2166.V_STORE_ICODE_BLOCK_LIST', 'block_list.csv'],
    ['WH_STOCK', 'Oracle', 'CK_A2166.V_WH_STOCK', 'wh_stock.csv'],
    ['ALLOC_LEVEL', 'Oracle', 'CK_A2166.V_ALLOCATION_LEVEL', 'alloc_level.csv'],
  ]

  const sysFilterRows = [
    ['CAT6', 'BARCODE → BARCODE, SITECODE → SITECODE', 'CAT6_LIST', 'Y', 'N'],
    ['MC Listing', 'BARCODE → BARCODE', 'MC_LISTING', 'Y', 'N'],
    [
      'CLR Concept',
      'BARCODE + SITECODE + DIVISION + ATTRIBUTE1 + DEPARTMENT + DISPLAY_TYPE',
      'CLR_LIST_TAG',
      'YES',
      'NO',
    ],
    ['Block List', '(per-row HOLD_FIELDS)', 'BLOCK_TAG', '—', 'N'],
  ]

  const joinReqRows = [
    ['BAR_REQ', 'BARCODE + SITECODE', 'BAR_REQ', 'V_BARCODE_REQ_APPS_GRC_V2'],
    ['MC_REQ', 'MC_CODE + SITECODE + DIVISION + ATTRIBUTE1', 'MC_REQ', 'V_MC_REQ_APPS_2'],
    ['ARTICLE_REQ', 'BARCODE + SITECODE', 'ARTICLE_REQ', 'V_ART_REQ_APPS'],
    ['MRP_REQ', 'MRP_CODE + SITECODE + DIVISION', 'MRP_REQ', 'V_MRP_REQ_APPS'],
    ['OPTION_REQ', 'ALLOCATION_OPTION + SITECODE', 'OPTION_REQ', 'V_OPTION_REQ_APPS'],
    ['SPARKY_REQ', 'BARCODE + SITECODE + ATTRIBUTE1', 'SPARKY_REQ', 'V_SPARKY_PBS_REQ'],
    ['SZ_REQ', 'SZ_GRP + SITECODE + DEPARTMENT', 'SZ_REQ', 'V_SZ_REQ_APPS'],
    ['TABLE_REQ', 'DEPARTMENT + DISPLAY_TYPE', 'TABLE_NO_REQ', '(lookup table)'],
  ]

  const eligiblePriorityRows = [
    ['1', 'Size REQ', 'DEPARTMENT in [size depts list]', 'SZ_REQ'],
    ['2', 'Sparky REQ', 'CAT2 = SPARKY', 'SPARKY_REQ'],
    ['3', 'Table REQ', 'TABLE_NO is not blank', 'TABLE_REQ'],
    ['4', 'Article REQ', 'ARTICLE_NAME is not blank', 'ARTICLE_REQ'],
    ['(default)', '—', '—', 'OPTION_REQ'],
  ]

  const sortRows = [
    ['1', 'DEPARTMENT', 'ASC'],
    ['2', 'STORE_NAME', 'ASC'],
    ['3', 'ARTICLE_NAME', 'ASC'],
  ]

  const mainSections: AccordionSection[] = [
    {
      id: 'fetch',
      title: 'Fetch raw data',
      content: (
        <DocTable
          headers={['DATASET', 'SOURCE', 'DB TABLE / VIEW', 'CSV FILE']}
          rows={fetchRawRows}
          tokens={tokens}
        />
      ),
    },
    {
      id: 'grid',
      title: 'Build grid + enrichments',
      content: (
        <>
          <InfoCard title="Lifecycle join" tokens={tokens}>
            <div>
              <strong style={{ color: tokens.textPrimary }}>Match keys:</strong>{' '}
              <Mono tokens={tokens}>GRC.BARCODE = ITEM_MASTER.ICODE</Mono>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: tokens.textPrimary }}>Columns added:</strong>{' '}
              CATEGORY, DIVISION, ATTRIBUTE1, DEPARTMENT, DISPLAY_TYPE, SZ_GRP, COLOR,
              DESC1-6, CAT1-6, SEASON, MRP
            </div>
          </InfoCard>
          <InfoCard title="ALLOCATION_OPTION formula" tokens={tokens}>
            <div>
              <strong style={{ color: tokens.textPrimary }}>Source column:</strong>{' '}
              <Mono tokens={tokens}>OPTION_LEVEL</Mono>
            </div>
            <div style={{ marginTop: 4 }}>
              <strong style={{ color: tokens.textPrimary }}>Output:</strong>{' '}
              <Mono tokens={tokens}>ALLOCATION_OPTION</Mono>
            </div>
            <div style={{ marginTop: 4 }}>
              <strong style={{ color: tokens.textPrimary }}>Separator:</strong>{' '}
              <Mono tokens={tokens}>|</Mono>&emsp;
              <strong style={{ color: tokens.textPrimary }}>Aliases:</strong> MC → DEPARTMENT
            </div>
          </InfoCard>
          <InfoCard title="Article grid join" tokens={tokens}>
            <div>
              <strong style={{ color: tokens.textPrimary }}>Match keys:</strong>{' '}
              <Mono tokens={tokens}>GRC.BARCODE = ARTICLE_GRID.ICODE</Mono>,{' '}
              <Mono tokens={tokens}>GRC.SITECODE = ARTICLE_GRID.SITECODE</Mono>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: tokens.textPrimary }}>Columns added:</strong>{' '}
              ARTICLE_GRID columns
            </div>
          </InfoCard>
        </>
      ),
    },
    {
      id: 'sysfilters',
      title: 'System filters',
      content: (
        <DocTable
          headers={['FILTER', 'MATCH COLUMNS', 'OUTPUT COL', 'PASS VALUES', 'DEFAULT']}
          rows={sysFilterRows}
          tokens={tokens}
        />
      ),
    },
    {
      id: 'manualfilters',
      title: 'Manual filters',
      content: (
        <p
          style={{
            fontSize: 13,
            color: tokens.textSecondary,
            lineHeight: 1.75,
            margin: 0,
          }}
        >
          Exclusion rules are configured in the filter builder on the{' '}
          <strong style={{ color: tokens.textPrimary }}>Create Allocation</strong> page. Each row is
          an <strong style={{ color: tokens.textPrimary }}>AND</strong> condition across selected
          columns. Multiple rows are{' '}
          <strong style={{ color: tokens.textPrimary }}>OR'd</strong> together. Matching rows are
          excluded from the allocation output.
        </p>
      ),
    },
    {
      id: 'joinreq',
      title: 'Join requirements',
      content: (
        <DocTable
          headers={['REQ', 'MATCH COLUMNS', 'OUTPUT', 'REF VIEW']}
          rows={joinReqRows}
          tokens={tokens}
        />
      ),
    },
    {
      id: 'eligible',
      title: 'Eligible qty + export',
      content: (
        <>
          <p style={{ fontSize: 12.5, color: tokens.textSecondary, marginBottom: 12, marginTop: 0 }}>
            Priority waterfall — first matching rule wins:
          </p>
          <DocTable
            headers={['#', 'RULE', 'WHEN', 'USES']}
            rows={eligiblePriorityRows}
            tokens={tokens}
          />
        </>
      ),
    },
    {
      id: 'sort',
      title: 'Sort + export',
      content: (
        <DocTable
          headers={['#', 'COLUMN', 'ORDER']}
          rows={sortRows}
          tokens={tokens}
        />
      ),
    },
  ]

  const rulesEngines: AccordionSection[] = [
    {
      id: 're_cat6',
      title: 'CAT6 rules engine',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          37 OR-logic rules mapping CAT1-6 inputs to Y/N output.
        </p>
      ),
    },
    {
      id: 're_sparky',
      title: 'SPARKY_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          PBS-based replenishment for Sparky articles, 4-week lookback.
        </p>
      ),
    },
    {
      id: 're_barcode',
      title: 'BARCODE_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          PBS bucket days by category: sizes = 12, READY = DESC4 × 4, INNER = 72,
          lower-body = 12, default = 48.
        </p>
      ),
    },
    {
      id: 're_mc',
      title: 'MC_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Achievement multiplier with high-fill (PBS_FILL &gt; 0.7) and steady-state branches,
          6-month projection.
        </p>
      ),
    },
    {
      id: 're_option',
      title: 'OPTION_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          PO_PRCT = option PO + GRC ÷ MRP PO + GRC;&ensp;OPTION_PBS = PBS × PO_PRCT;&ensp;
          REQ = max(PBS − stock, 0).
        </p>
      ),
    },
    {
      id: 're_article',
      title: 'ARTICLE_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Article-level PBS requirement direct from V_PBS_ART.
        </p>
      ),
    },
    {
      id: 're_mrp',
      title: 'MRP_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          MRP-level PBS with new-store scaling and MDQ cap.
        </p>
      ),
    },
    {
      id: 're_sz',
      title: 'SZ_REQ',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Size-group PBS from V_SZ_REQ_APPS.
        </p>
      ),
    },
    {
      id: 're_valloc',
      title: 'V_ALLOCATION',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Store-item allocation eligibility flag.
        </p>
      ),
    },
    {
      id: 're_vwh',
      title: 'V_WH_STOCK',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Warehouse stock across GRC/MSA/WMS stockpoints.
        </p>
      ),
    },
    {
      id: 're_v4wk',
      title: 'V_LAST_4WK_SL_ST_ICODE',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Last 4-week sales by store × ICODE.
        </p>
      ),
    },
    {
      id: 're_block',
      title: 'V_STORE_ICODE_BLOCK_LIST',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Manual hold list by store × ICODE.
        </p>
      ),
    },
    {
      id: 're_level',
      title: 'V_ALLOCATION_LEVEL',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Determines allocation at ICODE or MC or MRP level.
        </p>
      ),
    },
    {
      id: 're_artchain',
      title: 'ART chain-2',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          Article-level chain for ST_ART_MSTR, V_PBS_ART, V_PROJ_ART, V_SL_TGT_ART,
          V_ST_STK_ART, V_LAST_4WK_SL_ST_ART.
        </p>
      ),
    },
    {
      id: 're_mcchain',
      title: 'MC chain-2',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          MC-level chain for ST_MC_MSTR etc.
        </p>
      ),
    },
    {
      id: 're_mrpchain',
      title: 'MRP chain-2',
      content: (
        <p style={{ margin: 0, fontSize: 12.5, color: tokens.textSecondary, lineHeight: 1.7 }}>
          MRP-level chain.
        </p>
      ),
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        color: tokens.textPrimary,
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '-.02em',
              color: tokens.textPrimary,
              marginBottom: 3,
            }}
          >
            Flow Documentation
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: tokens.textMuted }}>
            Auto-generated from pipeline config
          </p>
        </div>

        <button
          onClick={handleRefresh}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: tokens.accentBg,
            border: `1px solid ${tokens.accent}40`,
            borderRadius: 7,
            color: tokens.accent,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background .15s',
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = tokens.accent + '30')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = tokens.accentBg)
          }
        >
          <span style={{ fontSize: 15 }}>↻</span>
          Refresh from latest config
        </button>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
        {/* ── Pipeline sections ─────────────────────────────────────────────── */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: tokens.textMuted,
            marginBottom: 8,
          }}
        >
          Pipeline Steps
        </div>

        {mainSections.map((s, i) => (
          <SectionAccordion
            key={s.id}
            section={s}
            index={i + 1}
            open={!!openMain[s.id]}
            onToggle={() => toggleMain(s.id)}
            tokens={tokens}
          />
        ))}

        {/* ── Rules engines ─────────────────────────────────────────────────── */}
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: tokens.textMuted,
            marginTop: 24,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ color: tokens.warning }}>★</span>
          Rules Engines
          <span
            style={{
              background: tokens.warning + '20',
              border: `1px solid ${tokens.warning}40`,
              borderRadius: 10,
              padding: '1px 8px',
              fontSize: 10,
              fontWeight: 700,
              color: tokens.warning,
            }}
          >
            {rulesEngines.length}
          </span>
        </div>

        {rulesEngines.map((s) => (
          <SectionAccordion
            key={s.id}
            section={{ ...s, star: true }}
            open={!!openRules[s.id]}
            onToggle={() => toggleRules(s.id)}
            tokens={tokens}
          />
        ))}

        <div style={{ height: 32 }} />
      </div>

      <Toast visible={toastVisible} tokens={tokens} />
    </div>
  )
}
