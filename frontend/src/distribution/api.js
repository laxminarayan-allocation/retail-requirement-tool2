// API calls — uses relative /api path (same-host FastAPI backend)
const TOKEN_KEY = 'ck_ss27_token'

const headers = () => {
  const token = localStorage.getItem(TOKEN_KEY) || ''
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
               : { 'Content-Type': 'application/json' }
}

const get  = (url) => fetch(url, { headers: headers() }).then(r => r.json())
const post = (url, body) => fetch(url, {
  method: 'POST', headers: headers(),
  body: JSON.stringify(body),
}).then(r => r.json())
const del  = (url) => fetch(url, { method: 'DELETE', headers: headers() }).then(r => r.json())

// ── Stores ──────────────────────────────────────────────────────────────────
export const getStores        = ()  => get('/api/stores/')
export const getStoreStatus   = ()  => get('/api/stores/status')
export const getStoreFields   = ()  => get('/api/stores/fields')
export const getFieldValues   = (f) => get(`/api/stores/field/${f}`)

// ── Items ────────────────────────────────────────────────────────────────────
export const getItemStatus    = ()  => get('/api/items/status')
export const getDivisions     = ()  => get('/api/items/divisions')

// ── Presets ──────────────────────────────────────────────────────────────────
export const getPresets       = ()             => get('/api/presets/')
export const getPreset        = (name)         => get(`/api/presets/${name}`)
export const savePreset       = (name, body)   => post(`/api/presets/${name}`, body)
export const setDefaultPreset = (name)         => post(`/api/presets/${name}/default`, {})
export const deletePreset     = (name)         => del(`/api/presets/${name}`)
export const unsetDefault     = ()             => del('/api/presets/default')

// ── Result / Dashboard ───────────────────────────────────────────────────────
export const getSummary       = ()  => get('/api/result/summary')
export const getFilterOptions = ()  => get('/api/result/filters')
export const getChartDivision = ()  => get('/api/result/charts/division')
export const getChartReason   = ()  => get('/api/result/charts/reason')
export const getRows          = (p) => {
  const q = new URLSearchParams(p).toString()
  return get(`/api/result/rows?${q}`)
}

// ── Run ──────────────────────────────────────────────────────────────────────
export const startRun  = (config) => post('/api/run/', config)
export const getJob    = (id)     => get(`/api/run/${id}`)
export const listJobs  = ()       => get('/api/run/')

// ── Export ───────────────────────────────────────────────────────────────────
export const getExportUrl = (mode = 'division') => `/api/export/download?mode=${mode}`

// ── WebSocket ────────────────────────────────────────────────────────────────
export const openJobWS = (jobId, onMessage, onClose) => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/api/run/ws/${jobId}`)
  ws.onmessage = (e) => onMessage(JSON.parse(e.data))
  ws.onclose   = onClose
  ws.onerror   = (e) => console.error('WS error', e)
  return ws
}
