import { useState } from "react"
import Dashboard from "./Dashboard"
import RunPanel from "./RunPanel"
import StoreMaster from "./StoreMaster"

const TABS = [
  { id: "dashboard",    label: "Dashboard"    },
  { id: "run",          label: "Run"          },
  { id: "store-master", label: "Store Master" },
]

export default function Distribution() {
  const [tab, setTab] = useState("dashboard")

  return (
    <div className="min-h-screen bg-[#061a06] text-[#e2e8f0] font-sans">
      {/* Header */}
      <div className="border-b border-[#1e4d1e] px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
          <span className="text-sm font-semibold text-[#22c55e] tracking-wide">
            CityKart Distribution
          </span>
        </div>
        <div className="flex gap-1 ml-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded text-sm transition-colors
                ${tab === t.id
                  ? "bg-[#22c55e] text-[#061a06] font-semibold"
                  : "text-[#6b7280] hover:text-[#e2e8f0] hover:bg-[#0d2b0d]"
                }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {tab === "dashboard"    && <Dashboard />}
        {tab === "run"          && <RunPanel />}
        {tab === "store-master" && <StoreMaster />}
      </div>
    </div>
  )
}
