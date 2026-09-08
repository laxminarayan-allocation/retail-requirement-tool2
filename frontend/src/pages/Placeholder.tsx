interface Props {
  title: string
  phase: string
  description: string
}

export default function Placeholder({ title, phase, description }: Props) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>{title}</h2>
      <div
        style={{
          display: 'inline-block',
          padding: '3px 12px',
          background: '#1e3a5f',
          color: '#93c5fd',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 16,
        }}
      >
        {phase}
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto' }}>{description}</p>
    </div>
  )
}
