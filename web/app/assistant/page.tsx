'use client';

import { FormEvent, useState } from 'react';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
type Entry = { from: 'You' | 'Atrium assistant'; text: string };

export default function AssistantPage() {
  const [entries, setEntries] = useState<Entry[]>([{ from: 'Atrium assistant', text: 'Ask about available sessions, prices, remaining places, or booking. If you are signed in, I can also help with your account.' }]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = message.trim(); if (!text || sending) return;
    setEntries(current => [...current, { from: 'You', text }]); setMessage(''); setSending(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/assistant/chat`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const body = await response.json();
      setEntries(current => [...current, { from: 'Atrium assistant', text: response.ok ? body.message : body.error || 'I could not complete that request.' }]);
    } catch { setEntries(current => [...current, { from: 'Atrium assistant', text: 'The assistant is unavailable right now. Please try again.' }]); }
    finally { setSending(false); }
  }

  return <main><section className="page-heading assistant-heading"><div><p className="eyebrow">One assistant</p><h1>Atrium assistant</h1><p>Ask about sessions, prices, availability, or booking. Signed-in users can also ask about their own account.</p></div><span className="assistant-status"><span aria-hidden="true" />Ready to help</span></section><section className="assistant-workspace"><section className="chat-panel" aria-label="Atrium assistant conversation" aria-live="polite"><header className="conversation-header"><span className="assistant-avatar" aria-hidden="true">A</span><div><strong>Atrium assistant</strong><p>Answers based on your current access</p></div></header>{entries.map((entry, index) => <article className={entry.from === 'You' ? 'chat-message chat-user' : 'chat-message'} key={index}><strong>{entry.from}</strong><p>{entry.text}</p></article>)}{sending ? <p className="chat-thinking"><span aria-hidden="true" />Thinking…</p> : null}</section><form onSubmit={send} className="chat-form"><label><span>Message</span><input value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} placeholder="For example: What sessions are available?" /></label><button disabled={sending} type="submit">{sending ? 'Sending…' : 'Send'}</button></form></section></main>;
}
