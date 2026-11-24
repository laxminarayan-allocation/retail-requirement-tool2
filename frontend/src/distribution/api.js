// Distribution V2 API — all calls to local FastAPI backend
const TOKEN_KEY = 'ck_ss27_token'

const authHeaders = () => {
  const t = localStorage.getItem(TOKEN_KEY) || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() })

const get  = (url) => fetch(url, { headers: authHeaders() }).then(r => r.json())
const post = (url, body) => fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }).then(r => r.json())
const del  = (url) => fetch(url, { method: 'DELETE', headers: authHeaders() }).then(r => r.json())
const put  = (url, body) => fetch(url, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(body) }).then(r => r.json())

// Unwrap APIResponse envelope
const unwrap = async (promise) => {
  const r = await promise
  if (r && r.success === false) throw new Error(r.message || 'API error')
  return r?.data !== undefined ? r.data : r
}

// File upload (multipart)
const upload = (url, file, extraParams = {}) => {
  const form = new FormData()
  form.append('file', file)
  const q = new URLSearchParams(extraParams).toString()
  return fetch(`${url}${q ? '?' + q : ''}`, { method: 'POST', headers: authHeaders(), body: form }).then(r => r.json())
}

// ── Stock CSV ──────────────────────────────────────────────────────────────────
export const getStockStatus    = ()            => unwrap(get('/api/distribution/upload-stock-csv/status'))
export const uploadStock       = (file, save)  => upload('/api/distribution/upload-stock-csv', file, { save })
export const deleteStock       = (removeSaved) => del(`/api/distribution/upload-stock-csv?remove_saved=${removeSaved}`)

// ── REQ CSV ───────────────────────────────────────────────────────────────────
export const getReqStatus      = ()            => unwrap(get('/api/distribution/upload-req-csv/status'))
export const uploadReq         = (type, file, save) => upload(`/api/distribution/upload-req-csv/${type}`, file, { save })
export const deleteReq         = (type, removeSaved) => del(`/api/distribution/upload-req-csv/${type}?remove_saved=${removeSaved}`)

// ── Store Priority ─────────────────────────────────────────────────────────────
export const getPriorityStatus = ()            => unwrap(get('/api/distribution/upload-store-priority/status'))
export const uploadPriority    = (type, file, save) => upload(`/api/distribution/upload-store-priority/${type}`, file, { save })
export const deletePriority    = (type, removeSaved) => del(`/api/distribution/upload-store-priority/${type}?remove_saved=${removeSaved}`)

// ── Item Master ───────────────────────────────────────────────────────────────
export const getItemMasterStatus = () => unwrap(get('/api/distribution/item-master/status'))
export const downloadItemMaster  = () => unwrap(post('/api/distribution/item-master/download', {}))

// ── Filters / Meta ────────────────────────────────────────────────────────────
export const getStoreFilterMeta = () => unwrap(get('/api/distribution/store-filter-meta'))
export const getItemFilterMeta  = () => unwrap(get('/api/distribution/item-filter-meta'))
export const getStoreList       = () => unwrap(get('/api/distribution/store-list'))

// ── Hold Rules ────────────────────────────────────────────────────────────────
export const getHoldRules  = () => get('/api/distribution/hold-rules').then(r => r?.data ?? [])
export const saveHoldRules = (rules) => put('/api/distribution/hold-rules', rules)

// ── Base ──────────────────────────────────────────────────────────────────────
export const getBaseStatus = () => get('/api/distribution/base/status')
export const buildBase = (params) => {
  const q = new URLSearchParams(params).toString()
  return fetch(`/api/distribution/build-base?${q}`, { method: 'POST', headers: authHeaders() }).then(r => r.json())
}

// ── Distribute ────────────────────────────────────────────────────────────────
export const distribute = (body) => {
  const q = new URLSearchParams({ min_qty: body.min_qty ?? 0 }).toString()
  return fetch(`/api/distribution/distribute?${q}`, {
    method: 'POST', headers: jsonHeaders(),
    body: JSON.stringify({ wh_col: 'wh_q', max_round: 10, hold_rules: body.hold_rules || [], apply_option_listing: false })
  }).then(r => r.json())
}

// ── Results ───────────────────────────────────────────────────────────────────
export const getDivisionSummary = () => get('/api/distribution/division-summary')
export const getExportPreview   = () => unwrap(get('/api/distribution/export-preview'))

// ── Export (download) ─────────────────────────────────────────────────────────
export const exportExcel = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return fetch(`/api/distribution/export?${q}`, { method: 'POST', headers: authHeaders() })
}
export const exportCsv = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return fetch(`/api/distribution/export-csv?${q}`, { method: 'POST', headers: authHeaders() })
}

// ── Store Presets ─────────────────────────────────────────────────────────────
export const getStorePresets   = () => unwrap(get('/api/distribution/store-presets'))
export const saveStorePreset   = (name, stores) => unwrap(post('/api/distribution/store-presets', { name, stores }))
export const deleteStorePreset = (name) => unwrap(del(`/api/distribution/store-presets/${encodeURIComponent(name)}`))

// ── Barcode preview ───────────────────────────────────────────────────────────
export const getBarcodePreview = (params) => {
  const q = new URLSearchParams(params).toString()
  return unwrap(get(`/api/distribution/barcode-preview?${q}`))
}
