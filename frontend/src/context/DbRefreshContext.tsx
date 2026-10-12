import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface DbRefreshContextValue {
  downloadsRunning: boolean
  setDownloadsRunning: (v: boolean) => void
  dataStoreRunning: boolean
  setDataStoreRunning: (v: boolean) => void
}

const DbRefreshContext = createContext<DbRefreshContextValue | null>(null)

export function DbRefreshProvider({ children }: { children: ReactNode }) {
  const [downloadsRunning, setDownloadsRunning] = useState(false)
  const [dataStoreRunning, setDataStoreRunning] = useState(false)
  const setDl = useCallback((v: boolean) => setDownloadsRunning(v), [])
  const setDs = useCallback((v: boolean) => setDataStoreRunning(v), [])
  return (
    <DbRefreshContext.Provider value={{ downloadsRunning, setDownloadsRunning: setDl, dataStoreRunning, setDataStoreRunning: setDs }}>
      {children}
    </DbRefreshContext.Provider>
  )
}

export function useDbRefresh() {
  const ctx = useContext(DbRefreshContext)
  if (!ctx) throw new Error('useDbRefresh must be used inside DbRefreshProvider')
  return ctx
}
