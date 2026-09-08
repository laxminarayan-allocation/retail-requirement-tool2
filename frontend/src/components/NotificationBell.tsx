import { useState, useEffect, useRef } from 'react'
import http from '@/api/http'

interface Notification {
  id: string
  from_name: string
  from_email: string
  subject: string
  message: string
  is_read: number
  created_at: string
}

export default function NotificationBell() {
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchNotifs = async () => {
    try {
      const res = await http.get('/notifications/mine')
      setNotifs(res.data.data?.notifications || [])
      setUnread(res.data.data?.unread || 0)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchNotifs()
    const iv = setInterval(fetchNotifs, 30_000) // poll every 30s
    return () => clearInterval(iv)
  }, [])

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markRead = async (id: string) => {
    await http.patch(`/notifications/${id}/read`)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  const markAllRead = async () => {
    await http.patch('/notifications/read-all')
    setNotifs(prev => prev.map(n => ({ ...n, is_read: 1 })))
    setUnread(0)
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: '4px 6px', borderRadius: 6,
          color: unread > 0 ? '#fbbf24' : '#64748b',
          fontSize: 18, lineHeight: 1,
          transition: 'color .15s',
        }}
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 800,
            borderRadius: '50%', minWidth: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 2000,
          width: 340, maxHeight: 440,
          background: 'var(--card-bg)', border: '1px solid var(--card-border)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--card-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
              Notifications {unread > 0 && <span style={{ color: '#fbbf24' }}>({unread} new)</span>}
            </span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#38bdf8',
              }}>Mark all read</button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No notifications yet
              </div>
            ) : notifs.map(n => (
              <div
                key={n.id}
                onClick={() => !n.is_read && markRead(n.id)}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid #0f172a',
                  background: n.is_read ? 'transparent' : 'rgba(56,189,248,.05)',
                  cursor: n.is_read ? 'default' : 'pointer',
                  transition: 'background .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  {!n.is_read && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{n.subject}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {n.created_at?.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {n.message}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  — {n.from_name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
