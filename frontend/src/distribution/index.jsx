import { useState } from "react"
import Setup from "./Setup"
import RunPanel from "./RunPanel"
import Results from "./Results"
import StoreMaster from "./StoreMaster"

const TABS = [
  { id: "setup",   label: "Setup",        icon: "📁" },
  { id: "run",     label: "Run",          icon: "▶" },
  { id: "results", label: "Results",      icon: "📊" },
  { id: "stores",  label: "Store Master", icon: "🏪" },
]

const STORAGE_KEY = "dist_v2_tab"

export default function Distribution() {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || "setup" } catch { return "setup" }
  })
  const [resultsKey, setResultsKey] = useState(0)

  const switchTab = (id) => {
    setTab(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
  }

  const handleRunComplete = () => {
    setResultsKey(k => k + 1)
    switchTab("results")
  }

  return (
    <div className="min-h-screen bg-[#061a06] text-[#e2e8f0] font-sans">
      {/* Header */}
      <div className="border-b border-[#1e4d1e] px-4 py-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 mr-3">
          <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
          <span className="text-sm font-semibold text-[#22c55e] tracking-wide">CityKart Distribution</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <button key={t.id} onClick={() => switchTab(t.id)}
              className={`px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-1.5
                ${tab === t.id
                  ? "bg-[#22c55e] text-[#061a06] font-semibold"
                  : "text-[#6b7280] hover:text-[#e2e8f0] hover:bg-[#0d2b0d]"
                }`}>
              <span className="text-xs">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-w-6xl">
        {tab === "setup"   && <Setup />}
        {tab === "run"     && <RunPanel onRunComplete={handleRunComplete} />}
        {tab === "results" && <Results refreshKey={resultsKey} />}
        {tab === "stores"  && <StoreMaster />}
      </div>
    </div>
  )
}
