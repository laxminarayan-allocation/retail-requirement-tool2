import { useState, useEffect } from 'react'
import http from '@/api/http'

const STALE_KEY = 'ck_last_cache_clear'

function isDataStale(): boolean {
  const now = new Date()
  const today6am = new Date()
  today6am.setHours(6, 0, 0, 0)
  if (now < today6am) return false          // abhi 6am nahi hua, data fresh hai
  const last = localStorage.getItem(STALE_KEY)
  if (!last) return true                    // kabhi clear nahi kiya
  return new Date(last) < today6am          // aaj 6am se pehle clear kiya tha
}

export function markCacheCleared() {
  localStorage.setItem(STALE_KEY, new Date().toISOString())
}

export default function StaleBanner() {
  const [visible, setVisible]       = useState(false)
  const [clearing, setClearing]     = useState(false)
  const [done, setDone]             = useState(false)

  useEffect(() => { setVisible(isDataStale()) }, [])

  if (!visible) return null

  async function handleClear() {
    setClearing(true)
    try {
      await http.post('/system/cache/invalidate')
      markCacheCleared()
      setDone(true)
      setTimeout(() => setVisible(false), 2500)
    } catch {
      setClearing(false)
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#1c1200', border: '1px solid #78350f',
      borderRadius: 8, padding: '9px 14px', marginBottom: 16,
      fontSize: 12, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 15 }}>⏰</span>
      {done ? (
        <span style={{ color: '#4ade80', fontWeight: 600 }}>Cache cleared — next load pe fresh Oracle data aayega.</span>
      ) : (
        <>
          <span style={{ color: '#fbbf24', fontWeight: 500, flex: 1 }}>
            Oracle views aaj 06:00 AM pe refresh hue — purana cache ho sakta hai.
          </span>
          <button
            onClick={handleClear}
            disabled={clearing}
            style={{
              background: '#78350f', color: '#fef3c7', border: 'none',
              borderRadius: 5, padding: '4px 12px', fontSize: 11,
              fontWeight: 600, cursor: clearing ? 'not-allowed' : 'pointer',
              opacity: clearing ? 0.7 : 1, flexShrink: 0,
            }}
          >{clearing ? 'Clearing…' : '🗑 Clear Cache Now'}</button>
          <button
            onClick={() => setVisible(false)}
            style={{
              background: 'transparent', border: 'none', color: '#78350f',
              cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px',
              flexShrink: 0,
            }}
            title="Dismiss"
          >×</button>
        </>
      )}
    </div>
  )
}
