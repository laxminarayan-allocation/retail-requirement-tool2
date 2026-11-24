export default function KpiCard({ label, value, sub, positive = true }) {
  return (
    <div className="bg-[#0d2b0d] border border-[#1e4d1e] rounded-lg px-4 py-3">
      <p className="text-[11px] text-[#6b7280] mb-1">{label}</p>
      <p className="text-xl font-semibold text-[#e2e8f0] leading-none">{value}</p>
      {sub && (
        <p className={`text-[11px] mt-1 ${positive ? "text-[#22c55e]" : "text-[#6b7280]"}`}>
          {sub}
        </p>
      )}
    </div>
  )
}
