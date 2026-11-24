import { useState, useEffect } from "react"
import {
  getStoreStatus, getStoreFields, getFieldValues,
  getPresets, savePreset, setDefaultPreset, deletePreset, unsetDefault
} from "./api"

export default function StoreMaster() {
  const [status, setStatus]       = useState(null)
  const [fields, setFields]       = useState([])
  const [fieldVals, setFieldVals] = useState({})
  const [filters, setFilters]     = useState({})
  const [openField, setOpenField] = useState(null)
  const [presets, setPresets]     = useState({})
  const [defaultPreset, setDefault] = useState("")
  const [newName, setNewName]     = useState("")
  const [msg, setMsg]             = useState("")

  useEffect(() => {
    getStoreStatus().then(d => setStatus(d)).catch(() => {})
    getStoreFields().then(d => setFields(d?.fields || [])).catch(() => {})
    loadPresets()
  }, [])

  const loadPresets = () => {
    getPresets().then(d => {
      const { __default__, ...rest } = d
      setDefault(__default__ || "")
      setPresets(rest)
    }).catch(() => {})
  }

  const fetchFieldVals = async (f) => {
    if (fieldVals[f]) return
    const data = await getFieldValues(f).catch(() => ({ values: [] }))
    setFieldVals(prev => ({ ...prev, [f]: data.values || [] }))
  }

  const handleFieldOpen = async (f) => {
    if (openField === f) { setOpenField(null); return }
    await fetchFieldVals(f)
    setOpenField(f)
  }

  const toggleVal = (field, val) => {
    setFilters(prev => {
      const cur = new Set(prev[field] || [])
      cur.has(val) ? cur.delete(val) : cur.add(val)
      return { ...prev, [field]: cur }
    })
  }

  const selectAll = (field, all) => {
    setFilters(prev => ({
      ...prev,
      [field]: all ? new Set(fieldVals[field] || []) : new Set(),
    }))
  }

  const handleSave = async () => {
    if (!newName.trim()) { setMsg("Enter a preset name"); return }
    const payload = {
      field_filters: Object.fromEntries(
        Object.entries(filters).map(([k, v]) => [k, [...v]])
      ),
    }
    await savePreset(newName.trim(), payload).catch(() => {})
    setMsg(`Saved: ${newName.trim()}`)
    loadPresets()
    setNewName("")
    setTimeout(() => setMsg(""), 2500)
  }

  const handleLoad = (name) => {
    const p = presets[name]
    if (!p) return
    const ff = p.field_filters || {}
    const newFilters = {}
    Object.entries(ff).forEach(([k, v]) => { newFilters[k] = new Set(v) })
    setFilters(newFilters)
    setMsg(`Loaded: ${name}`)
    setTimeout(() => setMsg(""), 2000)
  }

  const handleSetDefault = async (name) => {
    if (defaultPreset === name) {
      await unsetDefault().catch(() => {})
    } else {
      await setDefaultPreset(name).catch(() => {})
    }
    loadPresets()
  }

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete preset "${name}"?`)) return
    await deletePreset(name).catch(() => {})
    loadPresets()
  }

  const activeFilterCount = Object.values(filters).filter(s => s.size > 0).length

  return (
    <div className="space-y-4">
      {status && (
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg px-4 py-2 flex gap-6 flex-wrap text-xs">
          <span className="text-[#6b7280]">Stores: <span className="text-[#22c55e] font-semibold">{status.total_stores?.toLocaleString()}</span></span>
          <span className="text-[#6b7280]">Last refreshed: <span className="text-[#e2e8f0]">{status.last_modified || "—"}</span></span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Field filters */}
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-[#e2e8f0]">Field Filters</p>
            {activeFilterCount > 0 && (
              <button onClick={() => setFilters({})}
                className="text-[11px] text-red-400 hover:text-red-300">
                Clear all ({activeFilterCount})
              </button>
            )}
          </div>

          {fields.map(f => {
            const sel = filters[f]
            const selCount = sel?.size || 0
            const totalVals = fieldVals[f]?.length || 0
            const isOpen = openField === f

            return (
              <div key={f} className="border border-[#1e4d1e] rounded">
                <button onClick={() => handleFieldOpen(f)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-[#061a06]">
                  <span className="text-[#e2e8f0] font-medium">{f}</span>
                  <span className={`${selCount ? "text-[#22c55e]" : "text-[#6b7280]"}`}>
                    {selCount ? `${selCount}/${totalVals}` : "All"} {isOpen ? "▴" : "▾"}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-[#1e4d1e] px-3 py-2 space-y-1">
                    <div className="flex gap-2 mb-1">
                      <button onClick={() => selectAll(f, true)}
                        className="text-[10px] text-[#22c55e] hover:underline">All</button>
                      <button onClick={() => selectAll(f, false)}
                        className="text-[10px] text-[#6b7280] hover:underline">None</button>
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-0.5">
                      {(fieldVals[f] || []).map(v => (
                        <label key={v} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox"
                            checked={sel?.has(v) || false}
                            onChange={() => toggleVal(f, v)}
                            className="accent-[#22c55e]" />
                          <span className="text-xs text-[#e2e8f0]">{v}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Presets */}
        <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-[#e2e8f0]">Presets</p>

          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Preset name…"
              className="flex-1 bg-[#061a06] border border-[#1e4d1e] text-[#e2e8f0] text-xs rounded px-2 py-1.5" />
            <button onClick={handleSave}
              className="bg-[#22c55e] text-[#061a06] text-xs font-semibold px-3 rounded hover:bg-[#16a34a]">
              Save
            </button>
          </div>

          {msg && <p className="text-xs text-[#22c55e]">{msg}</p>}

          {Object.keys(presets).length === 0
            ? <p className="text-xs text-[#6b7280]">No presets saved yet.</p>
            : Object.keys(presets).map(name => (
              <div key={name}
                className="flex items-center justify-between border border-[#1e4d1e] rounded px-3 py-2">
                <div className="flex items-center gap-2">
                  {defaultPreset === name && (
                    <span className="text-yellow-400 text-xs">★</span>
                  )}
                  <span className="text-xs text-[#e2e8f0]">{name}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleLoad(name)}
                    className="text-[11px] text-[#22c55e] hover:underline px-1">Load</button>
                  <button onClick={() => handleSetDefault(name)}
                    className={`text-[11px] px-1 ${defaultPreset === name ? "text-yellow-400" : "text-[#6b7280] hover:text-yellow-400"}`}>
                    {defaultPreset === name ? "★ Default" : "Set Default"}
                  </button>
                  <button onClick={() => handleDelete(name)}
                    className="text-[11px] text-red-500 hover:text-red-400 px-1">✕</button>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}
