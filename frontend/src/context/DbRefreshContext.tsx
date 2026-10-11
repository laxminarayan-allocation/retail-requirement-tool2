import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface DbRefreshContextValue {
  downloadsRunning: boolean
  setDownloadsRunning: (v: boolean) => void
}

const DbRefreshContext = createContext<DbRefreshContextValue | null>(null)

export function DbRefreshProvider({ children }: { children: ReactNode }) {
  const [downloadsRunning, setDownloadsRunning] = useState(false)
  const set = useCallback((v: boolean) => setDownloadsRunning(v), [])
  return (
    <DbRefreshContext.Provider value={{ downloadsRunning, setDownloadsRunning: set }}>
      {children}
    </DbRefreshContext.Provider>
  )
}

export function useDbRefresh() {
  const ctx = useContext(DbRefreshContext)
  if (!ctx) throw new Error('useDbRefresh must be used inside DbRefreshProvider')
  return ctx
}
