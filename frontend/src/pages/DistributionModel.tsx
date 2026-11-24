/**
 * Distribution Model — wrapper with V1 (Classic) / V2 (New) toggle.
 */
import React, { useState } from 'react'
import DistributionModelV1 from './DistributionModelV1'
import DistributionModelV2 from './DistributionModelV2'

const STORAGE_KEY = 'dist_model_version'

export default function DistributionModel() {
  const [version, setVersion] = useState<'v1' | 'v2'>(() => {
    try { return (localStorage.getItem(STORAGE_KEY) as 'v1' | 'v2') || 'v1' } catch { return 'v1' }
  })

  const toggle = (v: 'v1' | 'v2') => {
    setVersion(v)
    try { localStorage.setItem(STORAGE_KEY, v) } catch {}
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Version toggle — fixed top-right */}
      <div style={{
        position: 'fixed', top: 12, right: 72, zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 2,
        background: '#1a1a2e', border: '1px solid #2d2d44',
        borderRadius: 20, padding: '3px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}>
        <button onClick={() => toggle('v1')} style={{
          padding: '3px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          background: version === 'v1' ? '#6366f1' : 'transparent',
          color: version === 'v1' ? '#fff' : '#9ca3af',
          transition: 'all 0.15s',
        }}>Classic</button>
        <button onClick={() => toggle('v2')} style={{
          padding: '3px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
          background: version === 'v2' ? '#6366f1' : 'transparent',
          color: version === 'v2' ? '#fff' : '#9ca3af',
          transition: 'all 0.15s',
        }}>New ✨</button>
      </div>

      {version === 'v1' ? <DistributionModelV1 /> : <DistributionModelV2 />}
    </div>
  )
}
