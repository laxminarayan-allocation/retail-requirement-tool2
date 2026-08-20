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

export default http
