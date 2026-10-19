/**
 * Shared axios instance — all pages must import from here.
 * Automatically attaches Bearer token from localStorage on every request.
 * Redirects to /login on any 401 response.
 */
import axios from 'axios'

const TOKEN_KEY = 'ck_ss27_token'

const http = axios.create({ baseURL: '/api', timeout: 30_000 })

// Attach current token before every request
http.interceptors.request.use(config => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401 — clear session and go to login
http.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      delete axios.defaults.headers.common['Authorization']
      window.location.replace('/login')
    }
    return Promise.reject(err)
  }
)

// ── User-configurable timeout ─────────────────────────────────────────────────
// Key stored in localStorage: 'ck_api_timeout_ms'
// Valid values: 30000, 60000, 120000, 300000 (30s, 1min, 2min, 5min)
const TIMEOUT_KEY = 'ck_api_timeout_ms'
export const TIMEOUT_OPTIONS = [30_000, 60_000, 120_000, 300_000]

export function getUserTimeout(defaultMs = 60_000): number {
  try {
    const v = parseInt(localStorage.getItem(TIMEOUT_KEY) ?? '', 10)
    return TIMEOUT_OPTIONS.includes(v) ? v : defaultMs
  } catch { return defaultMs }
}

export function setUserTimeout(ms: number): void {
  try { localStorage.setItem(TIMEOUT_KEY, String(ms)) } catch {}
}

export default http
