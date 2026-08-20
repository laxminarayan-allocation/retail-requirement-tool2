import { useState, useCallback } from 'react'
import type { APIResponse } from '@/types/api'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>() {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  })

  const call = useCallback(async (apiFn: () => Promise<APIResponse<T>>) => {
    setState({ data: null, loading: true, error: null })
    try {
      const response = await apiFn()
      if (response.success) {
        setState({ data: response.data, loading: false, error: null })
      } else {
        setState({ data: null, loading: false, error: response.message ?? 'Request failed' })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error'
      setState({ data: null, loading: false, error: msg })
    }
  }, [])

  return { ...state, call }
}
