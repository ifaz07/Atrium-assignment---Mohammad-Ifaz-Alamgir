'use client';

import { FormEvent, useState } from 'react';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
export default function SetupPasswordPage() {
  const [password, setPassword] = useState(''); const [notice, setNotice] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); const token = new URLSearchParams(window.location.search).get('token'); const response = await fetch(`${apiBaseUrl}/api/account/setup-password`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})}); const body=await response.json(); setNotice(response.ok ? 'Password set. You can now log in.' : body.error || 'Could not set password.'); }
  return <main><section className="page-heading"><div><p className="eyebrow">Account setup</p><h1>Create your password</h1><p>Choose a password with at least 12 characters.</p></div></section><form onSubmit={submit}><label><span>New password</span><input type="password" minLength={12} required value={password} onChange={event=>setPassword(event.target.value)} /></label><button type="submit">Set password</button>{notice ? <p className="notice">{notice}</p> : null}</form></main>;
}
