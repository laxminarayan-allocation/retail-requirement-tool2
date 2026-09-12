export default function SaleDashboard() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60vh', gap: 16, textAlign: 'center',
      padding: '2rem',
    }}>
      <div style={{ fontSize: 64 }}>🚧</div>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Under Construction</h2>
      <p style={{ margin: 0, color: 'var(--text-muted, #888)', maxWidth: 420 }}>
        Sale Dashboard is being restructured. It will be available once the new
        design is ready.
      </p>
    </div>
  )
}
