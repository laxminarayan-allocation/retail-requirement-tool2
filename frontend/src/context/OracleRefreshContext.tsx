import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import http from '@/api/http'

export type JobStatus = 'idle' | 'running' | 'done' | 'error'

interface Job {
  job_id: string
  status: JobStatus
  started_at: string
  finished_at: string | null
  files: string[]
  log: string[]
  error: string | null
}

interface OracleRefreshContextValue {
  job: Job | null
  isRunning: boolean
  startRefresh: (files?: string[]) => Promise<void>
  cancelRefresh: () => Promise<void>
  clearJob: () => void
}

const OracleRefreshContext = createContext<OracleRefreshContextValue | null>(null)

export function OracleRefreshProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollJob = useCallback((jobId: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await http.get<{ success: boolean; data: Job }>(`/oracle-refresh/status/${jobId}`)
        const j = res.data.data
        setJob(j)
        if (j.status !== 'running') stopPolling()
      } catch {
        stopPolling()
      }
    }, 2000)
  }, [stopPolling])

  const startRefresh = useCallback(async (files?: string[]) => {
    try {
      const res = await http.post<{ success: boolean; data: { job_id: string } }>(
        '/oracle-refresh/run',
        { files: files ?? null }
      )
      const jobId = res.data.data.job_id
      const initial: Job = {
        job_id:      jobId,
        status:      'running',
        started_at:  new Date().toISOString(),
        finished_at: null,
        files:       files ?? [],
        log:         ['Job started...'],
        error:       null,
      }
      setJob(initial)
      pollJob(jobId)
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Failed to start refresh'
      setJob(prev => prev
        ? { ...prev, status: 'error', error: msg, finished_at: new Date().toISOString() }
        : { job_id: '', status: 'error', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), files: [], log: [], error: msg }
      )
    }
  }, [pollJob])

  const cancelRefresh = useCallback(async () => {
    if (!job?.job_id || job.status !== 'running') return
    try {
      await http.post(`/oracle-refresh/cancel/${job.job_id}`, {})
    } catch { /* ignore */ }
  }, [job])

  const clearJob = useCallback(() => {
    stopPolling()
    setJob(null)
  }, [stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const isRunning = job?.status === 'running'

  return (
    <OracleRefreshContext.Provider value={{ job, isRunning, startRefresh, cancelRefresh, clearJob }}>
      {children}
    </OracleRefreshContext.Provider>
  )
}

export function useOracleRefresh() {
  const ctx = useContext(OracleRefreshContext)
  if (!ctx) throw new Error('useOracleRefresh must be inside OracleRefreshProvider')
  return ctx
}
