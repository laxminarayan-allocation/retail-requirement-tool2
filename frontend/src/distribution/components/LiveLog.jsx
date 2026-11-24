import { useEffect, useRef } from "react"

export default function LiveLog({ lines = [] }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div ref={ref}
      className="bg-black/40 border border-[#1e4d1e] rounded font-mono text-[11px] text-[#86efac] h-48 overflow-y-auto p-2 space-y-0.5">
      {lines.length === 0
        ? <span className="text-[#6b7280]">Log will appear here...</span>
        : lines.map((l, i) => <div key={i}>{l}</div>)
      }
    </div>
  )
}
