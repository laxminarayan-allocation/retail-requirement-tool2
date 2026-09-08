import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type FontFamily = 'system' | 'roboto' | 'mono' | 'serif'

export const FONT_LABELS: Record<FontFamily, string> = {
  system:  'System UI',
  roboto:  'Roboto / Clean',
  mono:    'Monospace',
  serif:   'Serif',
}

const FONT_STACKS: Record<FontFamily, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  roboto: "'Roboto', 'Arial', sans-serif",
  mono:   "'Consolas', 'Cascadia Code', 'Courier New', monospace",
  serif:  "'Georgia', 'Times New Roman', serif",
}

const ZOOM_STEPS = [0.7, 0.8, 0.85, 0.9, 1.0, 1.1, 1.15, 1.2, 1.3, 1.4]
const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18]
const BRIGHTNESS_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5]

interface DisplayState {
  zoom: number
  fontSize: number
  fontFamily: FontFamily
  brightness: number
}

interface DisplayCtx extends DisplayState {
  setZoom: (z: number) => void
  setFontSize: (s: number) => void
  setFontFamily: (f: FontFamily) => void
  setBrightness: (b: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  fontSizeUp: () => void
  fontSizeDown: () => void
  brightnessUp: () => void
  brightnessDown: () => void
  zoomSteps: number[]
  fontSizes: number[]
  brightnessSteps: number[]
}

const Ctx = createContext<DisplayCtx | null>(null)

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback } catch { return fallback }
}
function save<T>(key: string, v: T) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch {}
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoomState]           = useState<number>(() => load('app_zoom', 1.0))
  const [fontSize, setFontSizeState]   = useState<number>(() => load('app_fontSize', 13))
  const [fontFamily, setFontFamilyState] = useState<FontFamily>(() => load('app_fontFamily', 'system'))
  const [brightness, setBrightnessState] = useState<number>(() => load('app_brightness', 1.0))

  const setZoom = (z: number) => { setZoomState(z); save('app_zoom', z) }
  const setFontSize = (s: number) => { setFontSizeState(s); save('app_fontSize', s) }
  const setFontFamily = (f: FontFamily) => { setFontFamilyState(f); save('app_fontFamily', f) }
  const setBrightness = (b: number) => { setBrightnessState(b); save('app_brightness', b) }

  const zoomIn  = () => { const i = ZOOM_STEPS.indexOf(zoom); if (i < ZOOM_STEPS.length - 1) setZoom(ZOOM_STEPS[i + 1]) }
  const zoomOut = () => { const i = ZOOM_STEPS.indexOf(zoom); if (i > 0) setZoom(ZOOM_STEPS[i - 1]) }
  const resetZoom = () => setZoom(1.0)

  const fontSizeUp   = () => { const i = FONT_SIZES.indexOf(fontSize); if (i < FONT_SIZES.length - 1) setFontSize(FONT_SIZES[i + 1]) }
  const fontSizeDown = () => { const i = FONT_SIZES.indexOf(fontSize); if (i > 0) setFontSize(FONT_SIZES[i - 1]) }

  const brightnessUp   = () => { const i = BRIGHTNESS_STEPS.findIndex(s => s >= brightness); const next = i < BRIGHTNESS_STEPS.length - 1 ? i + 1 : i; setBrightness(BRIGHTNESS_STEPS[next]) }
  const brightnessDown = () => { const i = BRIGHTNESS_STEPS.findIndex(s => s >= brightness); const prev = i > 0 ? i - 1 : 0; setBrightness(BRIGHTNESS_STEPS[prev]) }

  // Apply to DOM
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`
    document.body.style.fontFamily = FONT_STACKS[fontFamily]
    document.documentElement.style.setProperty('--app-zoom', String(zoom))
    const root = document.getElementById('root')
    if (root) (root as HTMLElement).style.zoom = String(zoom)
  }, [zoom, fontSize, fontFamily])

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) (root as HTMLElement).style.filter = brightness !== 1.0 ? `brightness(${brightness})` : ''
  }, [brightness])

  return (
    <Ctx.Provider value={{ zoom, fontSize, fontFamily, brightness, setZoom, setFontSize, setFontFamily, setBrightness, zoomIn, zoomOut, resetZoom, fontSizeUp, fontSizeDown, brightnessUp, brightnessDown, zoomSteps: ZOOM_STEPS, fontSizes: FONT_SIZES, brightnessSteps: BRIGHTNESS_STEPS }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDisplay() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDisplay must be inside DisplayProvider')
  return ctx
}

export { FONT_STACKS }
