import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ZOOM_STEPS = [0.70, 0.80, 0.90, 1.0, 1.10, 1.20, 1.35, 1.50]
const DEFAULT_IDX = 3  // 100%
const STORAGE_KEY = 'app_zoom_idx'

interface ZoomCtx {
  zoom: number
  zoomIdx: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  canZoomIn: boolean
  canZoomOut: boolean
}

const ZoomContext = createContext<ZoomCtx>({
  zoom: 1, zoomIdx: DEFAULT_IDX,
  zoomIn: () => {}, zoomOut: () => {}, zoomReset: () => {},
  canZoomIn: true, canZoomOut: true,
})

export function ZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoomIdx, setZoomIdx] = useState<number>(() => {
    try { const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? ''); return isNaN(v) ? DEFAULT_IDX : Math.max(0, Math.min(v, ZOOM_STEPS.length - 1)) }
    catch { return DEFAULT_IDX }
  })

  const save = (idx: number) => { try { localStorage.setItem(STORAGE_KEY, String(idx)) } catch {} }

  const zoomIn  = useCallback(() => setZoomIdx(p => { const n = Math.min(p + 1, ZOOM_STEPS.length - 1); save(n); return n }), [])
  const zoomOut = useCallback(() => setZoomIdx(p => { const n = Math.max(p - 1, 0); save(n); return n }), [])
  const zoomReset = useCallback(() => setZoomIdx(() => { save(DEFAULT_IDX); return DEFAULT_IDX }), [])

  // Apply zoom to root element
  useEffect(() => {
    const z = ZOOM_STEPS[zoomIdx]
    ;(document.getElementById('root') as HTMLElement).style.zoom = String(z)
  }, [zoomIdx])

  // Keyboard shortcuts: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn() }
      else if (e.key === '-') { e.preventDefault(); zoomOut() }
      else if (e.key === '0') { e.preventDefault(); zoomReset() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIn, zoomOut, zoomReset])

  return (
    <ZoomContext.Provider value={{
      zoom: ZOOM_STEPS[zoomIdx], zoomIdx,
      zoomIn, zoomOut, zoomReset,
      canZoomIn: zoomIdx < ZOOM_STEPS.length - 1,
      canZoomOut: zoomIdx > 0,
    }}>
      {children}
    </ZoomContext.Provider>
  )
}

export function useZoom() { return useContext(ZoomContext) }
export { ZOOM_STEPS }
