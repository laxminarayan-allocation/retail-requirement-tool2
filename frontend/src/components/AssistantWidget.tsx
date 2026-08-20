import { useState, useRef, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const s: Record<string, React.CSSProperties> = {
  fab: {
    position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
    width: 48, height: 48, borderRadius: '50%',
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    border: 'none', cursor: 'pointer', color: '#fff',
    fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(14,165,233,.45)',
    transition: 'transform .15s, box-shadow .15s',
  },
  panel: {
    position: 'fixed', bottom: 84, right: 24, zIndex: 999,
    width: 360, height: 520,
    background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 40px rgba(0,0,0,.5)',
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(135deg, #0369a1, #4338ca)',
    padding: '12px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 8 },
  closeBtn: {
    background: 'none', border: 'none', color: '#93c5fd',
    fontSize: 18, cursor: 'pointer', padding: 2, lineHeight: 1,
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 10,
    scrollBehavior: 'smooth',
  },
  bubble: (role: 'user' | 'assistant'): React.CSSProperties => ({
    maxWidth: '88%',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    background: role === 'user' ? '#1d4ed8' : '#0f172a',
    border: role === 'assistant' ? '1px solid #334155' : 'none',
    borderRadius: role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
    padding: '9px 12px',
    fontSize: 12.5,
    lineHeight: 1.55,
    color: role === 'user' ? '#e0f2fe' : '#cbd5e1',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  }),
  cursor: {
    display: 'inline-block', width: 7, height: 13, background: '#38bdf8',
    marginLeft: 2, verticalAlign: 'text-bottom',
    animation: 'blink .7s step-end infinite',
  },
  inputRow: {
    borderTop: '1px solid #334155', padding: '10px 12px',
    display: 'flex', gap: 8, alignItems: 'flex-end',
  },
  textarea: {
    flex: 1, background: '#0f172a', border: '1px solid #334155',
    borderRadius: 8, color: '#e2e8f0', fontSize: 12.5,
    padding: '8px 10px', resize: 'none', outline: 'none',
    lineHeight: 1.5, maxHeight: 100, overflowY: 'auto',
    fontFamily: 'inherit',
  },
  sendBtn: {
    background: '#0ea5e9', border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 14, padding: '8px 12px', cursor: 'pointer',
    flexShrink: 0, alignSelf: 'flex-end',
  },
  welcome: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: 24, textAlign: 'center',
  },
}

const WELCOME_SUGGESTIONS = [
  'How do I run a calculation?',
  'What is fill rate target?',
  'How do I approve a role request?',
  'What pages can a Viewer see?',
]

export default function AssistantWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // Don't show widget for pending users
  if (!user || user.role === 'pending') return null

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return

    const userMsg: Message = { role: 'user', content: trimmed }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '', streaming: true }])
    setInput('')
    setStreaming(true)

    const apiMessages = history.map(m => ({ role: m.role, content: m.content }))

    try {
      const token = localStorage.getItem('ck_ss27_token')
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        const detail = err.detail || err.message
        const friendlyMsg = res.status === 503
          ? '⚙️ The AI assistant is not configured yet. An admin needs to set the ANTHROPIC_API_KEY in the server .env file to enable this feature.'
          : res.status === 401
          ? '🔒 Session expired. Please sign in again.'
          : detail || 'Something went wrong. Please try again.'
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: friendlyMsg }
          return next
        })
        setStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let done = false
      let accumulated = ''

      abortRef.current = () => { reader.cancel() }

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6)
            if (payload === '[DONE]') { done = true; break }
            try {
              const parsed = JSON.parse(payload)
              if (parsed.error) {
                const raw = parsed.error as string
                accumulated = raw.includes('credit') || raw.includes('balance')
                  ? '💳 Anthropic account has no credits. An admin needs to add credits at console.anthropic.com → Plans & Billing.'
                  : raw.includes('invalid_api_key') || raw.includes('authentication')
                  ? '🔑 Invalid API key. An admin should check ANTHROPIC_API_KEY in backend/.env.'
                  : `⚠️ API error: ${raw}`
              } else if (parsed.text) {
                accumulated += parsed.text
              }
            } catch { /* ignore malformed SSE */ }
          }
        }
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: accumulated, streaming: !done }
          return next
        })
      }
    } catch (err) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: 'Network error. Please try again.' }
        return next
      })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [messages, streaming])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const handleClose = () => {
    abortRef.current?.()
    setOpen(false)
  }

  return (
    <>
      {/* Floating action button */}
      <button
        style={s.fab}
        onClick={() => setOpen(o => !o)}
        title="Ask the SS27 Assistant"
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={s.panel}>
          {/* Header */}
          <div style={s.header}>
            <div style={s.headerTitle}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e0f2fe' }}>SS27 Assistant</div>
                <div style={{ fontSize: 10, color: '#93c5fd' }}>Ask anything about this app</div>
              </div>
            </div>
            <button style={s.closeBtn} onClick={handleClose}>✕</button>
          </div>

          {/* Messages */}
          <div style={s.messages}>
            {messages.length === 0 ? (
              <div style={s.welcome}>
                <span style={{ fontSize: 32 }}>💬</span>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>
                  How can I help you?
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>
                  I know everything about the SS27 Retail Replenishment Tool.
                </div>
                {WELCOME_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      background: '#0f172a', border: '1px solid #334155',
                      borderRadius: 8, color: '#94a3b8', fontSize: 11,
                      padding: '7px 12px', cursor: 'pointer', textAlign: 'left',
                      width: '100%', transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#38bdf8')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#334155')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} style={s.bubble(msg.role)}>
                  {msg.content || (msg.streaming ? '' : '…')}
                  {msg.streaming && msg.content === '' && (
                    <span style={{ color: '#64748b', fontSize: 11 }}>Thinking…</span>
                  )}
                  {msg.streaming && msg.content !== '' && (
                    <span style={s.cursor} />
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={s.inputRow}>
            <textarea
              ref={textareaRef}
              style={s.textarea}
              placeholder="Ask about this application…"
              value={input}
              onChange={e => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming}
            />
            <button
              style={{
                ...s.sendBtn,
                opacity: streaming || !input.trim() ? 0.45 : 1,
                cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
              }}
              onClick={() => send(input)}
              disabled={streaming || !input.trim()}
            >
              ➤
            </button>
          </div>

          <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
        </div>
      )}
    </>
  )
}
