import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemeName = 'dark' | 'light' | 'citykart'

export interface ThemeTokens {
  // Shell
  shellBg: string
  sidebarBg: string
  sidebarBorder: string
  topbarBg: string
  topbarBorder: string
  contentBg: string
  // Sidebar text
  logoColor: string
  logoSubColor: string
  navActiveColor: string
  navActiveBg: string
  navActiveBar: string
  navInactiveColor: string
  // Cards & surfaces
  cardBg: string
  cardBorder: string
  inputBg: string
  inputBorder: string
  inputColor: string
  // Text
  textPrimary: string
  textSecondary: string
  textMuted: string
  // Accent
  accent: string
  accentBg: string
  // Status
  success: string
  warning: string
  danger: string
  // Table
  tableHeaderBg: string
  tableRowHover: string
  tableRowAlt: string
  tableBorder: string
}

const DARK: ThemeTokens = {
  shellBg: '#0f172a',
  sidebarBg: '#1e293b',
  sidebarBorder: '#334155',
  topbarBg: '#1e293b',
  topbarBorder: '#334155',
  contentBg: '#0f172a',
  logoColor: '#38bdf8',
  logoSubColor: '#64748b',
  navActiveColor: '#38bdf8',
  navActiveBg: '#0f172a',
  navActiveBar: '#38bdf8',
  navInactiveColor: '#94a3b8',
  cardBg: '#1e293b',
  cardBorder: '#334155',
  inputBg: '#0f172a',
  inputBorder: '#334155',
  inputColor: '#e2e8f0',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
  accent: '#38bdf8',
  accentBg: '#38bdf818',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  tableHeaderBg: '#0f172a',
  tableRowHover: '#334155',
  tableRowAlt: '#1a2540',
  tableBorder: '#334155',
}

const LIGHT: ThemeTokens = {
  shellBg: '#f1f5f9',
  sidebarBg: '#ffffff',
  sidebarBorder: '#e2e8f0',
  topbarBg: '#ffffff',
  topbarBorder: '#e2e8f0',
  contentBg: '#f1f5f9',
  logoColor: '#0ea5e9',
  logoSubColor: '#94a3b8',
  navActiveColor: '#0ea5e9',
  navActiveBg: '#f0f9ff',
  navActiveBar: '#0ea5e9',
  navInactiveColor: '#475569',
  cardBg: '#ffffff',
  cardBorder: '#e2e8f0',
  inputBg: '#f8fafc',
  inputBorder: '#cbd5e1',
  inputColor: '#1e293b',
  textPrimary: '#1e293b',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  accent: '#0ea5e9',
  accentBg: '#0ea5e918',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  tableHeaderBg: '#f8fafc',
  tableRowHover: '#f0f9ff',
  tableRowAlt: '#f8fafc',
  tableBorder: '#e2e8f0',
}

const CITYKART: ThemeTokens = {
  shellBg: '#0d2b1a',
  sidebarBg: '#14391f',
  sidebarBorder: '#1f5230',
  topbarBg: '#14391f',
  topbarBorder: '#1f5230',
  contentBg: '#0d2b1a',
  logoColor: '#f5c842',
  logoSubColor: '#6db87a',
  navActiveColor: '#f5c842',
  navActiveBg: '#0d2b1a',
  navActiveBar: '#f5c842',
  navInactiveColor: '#86c995',
  cardBg: '#14391f',
  cardBorder: '#1f5230',
  inputBg: '#0d2b1a',
  inputBorder: '#1f5230',
  inputColor: '#e6f4ea',
  textPrimary: '#e6f4ea',
  textSecondary: '#86c995',
  textMuted: '#4a7c59',
  accent: '#f5c842',
  accentBg: '#f5c84218',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  tableHeaderBg: '#0d2b1a',
  tableRowHover: '#1f5230',
  tableRowAlt: '#112217',
  tableBorder: '#1f5230',
}

export const THEMES: Record<ThemeName, ThemeTokens> = { dark: DARK, light: LIGHT, citykart: CITYKART }

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: '🌙 Dark',
  light: '☀️ Light',
  citykart: '🛒 Citykart',
}

interface ThemeCtx {
  theme: ThemeName
  tokens: ThemeTokens
  setTheme: (t: ThemeName) => void
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', tokens: DARK, setTheme: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    try { return (localStorage.getItem('app_theme') as ThemeName) || 'dark' } catch { return 'dark' }
  })

  const setTheme = (t: ThemeName) => {
    setThemeState(t)
    try { localStorage.setItem('app_theme', t) } catch {}
  }

  // Apply CSS vars to :root for any component that uses var(--token)
  useEffect(() => {
    const tokens = THEMES[theme]
    const root = document.documentElement
    Object.entries(tokens).forEach(([k, v]) => {
      root.style.setProperty(`--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`, v)
    })
    root.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <Ctx.Provider value={{ theme, tokens: THEMES[theme], setTheme }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTheme() { return useContext(Ctx) }
