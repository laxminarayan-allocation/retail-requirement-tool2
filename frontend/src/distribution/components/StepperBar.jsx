const STEPS = [
  { n: 1,  label: "Download"       },
  { n: 2,  label: "Stock Select"   },
  { n: 3,  label: "Unique Barcode" },
  { n: 4,  label: "Store Join"     },
  { n: 5,  label: "REQ Calc"       },
  { n: 6,  label: "Priority"       },
  { n: 7,  label: "Hold"           },
  { n: 8,  label: "Run"            },
  { n: 9,  label: "Final Output"   },
  { n: 10, label: "Export Excel"   },
  { n: 11, label: "Summary"        },
]

const STATUS_STYLE = {
  pending: "bg-[#1e4d1e] border border-[#1e4d1e] text-[#6b7280]",
  running: "bg-[#0d2b0d] border-2 border-yellow-400 text-yellow-400 animate-pulse",
  done:    "bg-[#22c55e] border border-[#22c55e] text-[#061a06]",
  error:   "bg-red-700 border border-red-500 text-white",
}

export default function StepperBar({ steps = {} }) {
  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-2">
      {STEPS.map(({ n, label }, i) => {
        const status = steps[n] || "pending"
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center min-w-[72px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${STATUS_STYLE[status]}`}>
                {status === "done" ? "✓" : n}
              </div>
              <span className="text-[9px] text-center mt-1 text-[#6b7280] leading-tight w-16">
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-[2px] w-6 -mt-4 ${status === "done" ? "bg-[#22c55e]" : "bg-[#1e4d1e]"}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
