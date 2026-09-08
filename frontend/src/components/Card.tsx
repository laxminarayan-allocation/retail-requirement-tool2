import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  style?: CSSProperties
}

export function Card({ title, children, style }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 8,
        padding: 20,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 14,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  )
}
