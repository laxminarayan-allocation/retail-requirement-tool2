import { useState, useEffect, useRef } from "react"
import {
  getStockStatus, uploadStock, deleteStock,
  getReqStatus, uploadReq, deleteReq,
  getPriorityStatus, uploadPriority, deletePriority,
  getItemMasterStatus, downloadItemMaster,
} from "./api"

const G = "#22c55e"
const BG = "#0d2b0d"
const BORDER = "#1e4d1e"

const REQ_TYPES = [
  { key: "mc",      label: "MC REQ" },
  { key: "art",     label: "ART REQ" },
  { key: "mrp",     label: "MRP REQ" },
  { key: "size",    label: "SIZE REQ" },
  { key: "barcode", label: "Barcode × Store REQ" },
]

const PRIORITY_TYPES = [
  { key: "store",   label: "Store Priority" },
  { key: "barcode", label: "Barcode Priority" },
]

function StatusDot({ active }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${active ? "bg-[#22c55e]" : "bg-[#4b5563]"}`} />
  )
}

function UploadRow({ label, status, onUpload, onDelete, uploading, msg }) {
  const ref = useRef(null)
  const [save, setSave] = useState(true)

  const handleFile = (e) => {
    const f = e.target.files[0]
    if (f) onUpload(f, save)
    e.target.value = ""
  }

  return (
    <div className={`border ${BORDER} rounded-lg p-3 space-y-2`} style={{ background: BG }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <StatusDot active={!!status?.active} />
          <span className="text-sm font-medium text-[#e2e8f0]">{label}</span>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1 text-[11px] text-[#6b7280] cursor-pointer">
            <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} className="accent-[#22c55e]" />
            Save
          </label>
          <button onClick={() => ref.current?.click()} disabled={uploading}
            className="bg-[#22c55e] text-[#061a06] text-xs font-semibold px-3 py-1 rounded hover:bg-[#16a34a] disabled:opacity-40">
            {uploading ? "Uploading…" : "Upload"}
          </button>
          {status?.active && (
            <button onClick={() => onDelete(save)}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-800 rounded">
              Clear
            </button>
          )}
        </div>
      </div>
      <input ref={ref} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      {status?.active && (
        <p className="text-[11px] text-[#6b7280]">
          {status.filename} — {status.rows?.toLocaleString()} rows
          {status.qty_col && ` · ${status.qty_col}`}
          {status.saved && " · 💾 auto-load on restart"}
        </p>
      )}
      {msg && <p className={`text-[11px] ${msg.startsWith("✓") ? "text-[#22c55e]" : "text-red-400"}`}>{msg}</p>}
    </div>
  )
}

export default function Setup() {
  const [stockStatus, setStockStatus]       = useState(null)
  const [stockUploading, setStockUploading] = useState(false)
  const [stockMsg, setStockMsg]             = useState("")

  const [reqStatus, setReqStatus]           = useState({})
  const [reqUploading, setReqUploading]     = useState({})
  const [reqMsg, setReqMsg]                 = useState({})

  const [priStatus, setPriStatus]           = useState({})
  const [priUploading, setPriUploading]     = useState({})
  const [priMsg, setPriMsg]                 = useState({})

  const [imStatus, setImStatus]             = useState(null)
  const [imLoading, setImLoading]           = useState(false)
  const [imMsg, setImMsg]                   = useState("")

  const flash = (setter, key, msg, ms = 3000) => {
    if (key !== undefined) setter(p => ({ ...p, [key]: msg }))
    else setter(msg)
    setTimeout(() => {
      if (key !== undefined) setter(p => ({ ...p, [key]: "" }))
      else setter("")
    }, ms)
  }

  useEffect(() => {
    getStockStatus().then(d => d?.active && setStockStatus(d)).catch(() => {})
    getReqStatus().then(d => setReqStatus(d?.slots || {})).catch(() => {})
    getPriorityStatus().then(d => setPriStatus(d?.slots || {})).catch(() => {})
    getItemMasterStatus().then(setImStatus).catch(() => {})
  }, [])

  // Stock
  const handleStockUpload = async (file, save) => {
    setStockUploading(true)
    try {
      const r = await uploadStock(file, save)
      if (r.success) { setStockStatus(r.data); flash(setStockMsg, undefined, `✓ ${r.message}`) }
      else flash(setStockMsg, undefined, r.message || "Upload failed")
    } catch { flash(setStockMsg, undefined, "Upload error") }
    setStockUploading(false)
  }
  const handleStockDelete = async (removeSaved) => {
    await deleteStock(removeSaved).catch(() => {})
    setStockStatus(null)
  }

  // REQ
  const handleReqUpload = async (key, file, save) => {
    setReqUploading(p => ({ ...p, [key]: true }))
    try {
      const r = await uploadReq(key, file, save)
      if (r.success) { setReqStatus(p => ({ ...p, [key]: r.data })); flash(setReqMsg, key, `✓ ${r.message}`) }
      else flash(setReqMsg, key, r.message || "Upload failed")
    } catch { flash(setReqMsg, key, "Upload error") }
    setReqUploading(p => ({ ...p, [key]: false }))
  }
  const handleReqDelete = async (key, removeSaved) => {
    await deleteReq(key, removeSaved).catch(() => {})
    setReqStatus(p => { const n = { ...p }; delete n[key]; return n })
  }

  // Priority
  const handlePriUpload = async (key, file, save) => {
    setPriUploading(p => ({ ...p, [key]: true }))
    try {
      const r = await uploadPriority(key, file, save)
      if (r.success) { setPriStatus(p => ({ ...p, [key]: r.data })); flash(setPriMsg, key, `✓ ${r.message}`) }
      else flash(setPriMsg, key, r.message || "Upload failed")
    } catch { flash(setPriMsg, key, "Upload error") }
    setPriUploading(p => ({ ...p, [key]: false }))
  }
  const handlePriDelete = async (key, removeSaved) => {
    await deletePriority(key, removeSaved).catch(() => {})
    setPriStatus(p => { const n = { ...p }; delete n[key]; return n })
  }

  // Item Master
  const handleImDownload = async () => {
    setImLoading(true)
    try {
      await downloadItemMaster()
      const s = await getItemMasterStatus()
      setImStatus(s)
      flash(setImMsg, undefined, "✓ Item master downloaded")
    } catch (e) { flash(setImMsg, undefined, e.message || "Error") }
    setImLoading(false)
  }

  const activeCount = [
    stockStatus?.active,
    ...Object.values(reqStatus).map(s => s?.active),
    ...Object.values(priStatus).map(s => s?.active),
  ].filter(Boolean).length

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex gap-4 flex-wrap text-xs">
        <span className="text-[#6b7280]">Active uploads: <span className="text-[#22c55e] font-semibold">{activeCount}</span></span>
        {imStatus && <span className="text-[#6b7280]">Item Master: <span className={imStatus.ready ? "text-[#22c55e] font-semibold" : "text-yellow-400"}>{imStatus.ready ? `${imStatus.rows?.toLocaleString()} rows` : "Not cached"}</span></span>}
      </div>

      {/* Stock CSV */}
      <section>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest mb-2">Stock CSV</p>
        <UploadRow
          label="Warehouse Stock (GRC / WMS / ASN / MSA)"
          status={stockStatus}
          onUpload={handleStockUpload}
          onDelete={handleStockDelete}
          uploading={stockUploading}
          msg={stockMsg}
        />
      </section>

      {/* REQ CSVs */}
      <section>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest mb-2">REQ CSVs</p>
        <div className="space-y-2">
          {REQ_TYPES.map(({ key, label }) => (
            <UploadRow key={key}
              label={label}
              status={reqStatus[key] ? { active: true, ...reqStatus[key] } : null}
              onUpload={(f, s) => handleReqUpload(key, f, s)}
              onDelete={(rs) => handleReqDelete(key, rs)}
              uploading={!!reqUploading[key]}
              msg={reqMsg[key] || ""}
            />
          ))}
        </div>
      </section>

      {/* Store Priority */}
      <section>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest mb-2">Store Priority</p>
        <div className="space-y-2">
          {PRIORITY_TYPES.map(({ key, label }) => (
            <UploadRow key={key}
              label={label}
              status={priStatus[key] ? { active: true, ...priStatus[key] } : null}
              onUpload={(f, s) => handlePriUpload(key, f, s)}
              onDelete={(rs) => handlePriDelete(key, rs)}
              uploading={!!priUploading[key]}
              msg={priMsg[key] || ""}
            />
          ))}
        </div>
      </section>

      {/* Item Master */}
      <section>
        <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-widest mb-2">Item Master</p>
        <div className={`border ${BORDER} rounded-lg p-3 flex items-center justify-between`} style={{ background: BG }}>
          <div>
            <StatusDot active={!!imStatus?.ready} />
            <span className="text-sm text-[#e2e8f0]">Oracle Item Master Cache</span>
            {imStatus?.ready && <span className="text-[11px] text-[#6b7280] ml-2">{imStatus.rows?.toLocaleString()} rows</span>}
          </div>
          <div className="flex items-center gap-2">
            {imMsg && <span className="text-[11px] text-[#22c55e]">{imMsg}</span>}
            <button onClick={handleImDownload} disabled={imLoading}
              className="bg-[#0d2b0d] border border-[#1e4d1e] text-[#22c55e] text-xs px-3 py-1 rounded hover:border-[#22c55e] disabled:opacity-40">
              {imLoading ? "Downloading…" : "Refresh from Oracle"}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
