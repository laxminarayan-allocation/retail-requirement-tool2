const palette: Record<string, { bg: string; color: string }> = {
  ok: { bg: '#14532d', color: '#4ade80' },
  connected: { bg: '#14532d', color: '#4ade80' },
  error: { bg: '#7f1d1d', color: '#fca5a5' },
  not_configured: { bg: '#422006', color: '#fdba74' },
  loading: { bg: '#1e3a5f', color: '#93c5fd' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = palette[status] ?? { bg: '#334155', color: 'var(--text-secondary)' }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  )
}
