import { useState } from 'react'
import { useTheme } from '@/context/ThemeContext'
import DataStore from './DataStore'
import MasterData from './MasterData'
import DatabaseExplorer from './DatabaseExplorer'

type Tab = 'hub' | 'database'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'hub',      icon: '💾', label: 'Data Hub'          },
  { key: 'database', icon: '🗄️', label: 'Database Explorer' },
]

export default function DataHub() {
  const { tokens: T } = useTheme()
  const [tab, setTab] = useState<Tab>('hub')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '10px 20px 0',
        borderBottom: `1px solid ${T.cardBorder}`,
        background: T.bg, flexShrink: 0,
      }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px',
                borderRadius: '6px 6px 0 0',
                border: `1px solid ${active ? T.cardBorder : 'transparent'}`,
                borderBottom: active ? `1px solid ${T.bg}` : 'none',
                background: active ? T.cardBg : 'transparent',
                color: active ? T.accent : T.textMuted,
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'color 0.12s, background 0.12s',
                marginBottom: active ? -1 : 0,
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Database Explorer — unmount when not active */}
        {tab === 'database' && <DatabaseExplorer />}

        {/* Data Hub — Parquet Store (top) + Master Data (bottom) on one page */}
        {tab === 'hub' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Parquet Store — fixed portion at top */}
            <div style={{
              flex: '0 0 42%', overflow: 'hidden',
              borderBottom: `2px solid ${T.cardBorder}`,
            }}>
              <DataStore />
            </div>
            {/* Master Data — fills remaining space */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <MasterData />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
