import { useEffect, useState } from 'react'

/** Respects the app_viewMode toggle set by AppLayout (mobile / desktop / auto). */
export function useIsMobile(): boolean {
  const [real, setReal] = useState(window.innerWidth < 768)
  const [mode, setMode] = useState<string>(() => {
    try { return localStorage.getItem('app_viewMode') ?? 'auto' } catch { return 'auto' }
  })

  useEffect(() => {
    const onResize = () => setReal(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      try { setMode(localStorage.getItem('app_viewMode') ?? 'auto') } catch {}
    }, 400)
    return () => clearInterval(id)
  }, [])

  if (mode === 'mobile') return true
  if (mode === 'desktop') return false
  return real
}
