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
        background: '#1e293b',
        border: '1px solid #334155',
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
            color: '#64748b',
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
