'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Person = { full_name: string; kind: string; credits: number };
type Session = { id: number; discipline: string; session_type: string; starts_at: string; ends_at: string; room_name: string; seat_fee_credits: number; places_remaining: number };
type Enrolment = { id: number; session_id: number; discipline: string; starts_at: string; room_name: string; status: string; credits_charged: number; credits_refunded: number };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bookings, setBookings] = useState<Enrolment[]>([]);
  const [message, setMessage] = useState('');

  async function loadDashboard() {
    const [personResponse, sessionsResponse, bookingsResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions?from=${new Date().toISOString()}`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions/mine/enrolments`, { credentials: 'include' })
    ]);
    if (!personResponse.ok) { router.replace('/login'); return; }
    const currentPerson = await personResponse.json();
    if (currentPerson.kind !== 'participant') { router.replace(`/${currentPerson.kind}`); return; }
    setPerson(currentPerson);
    const loadedSessions = await sessionsResponse.json(); const loadedBookings = await bookingsResponse.json();
    setSessions(Array.isArray(loadedSessions) ? loadedSessions : []);
    setBookings(Array.isArray(loadedBookings) ? loadedBookings : []);
  }

  async function book(sessionId: number) {
    setMessage(''); const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments`, { method: 'POST', credentials: 'include' }); const body = await response.json(); setMessage(response.ok ? 'Place booked successfully.' : body.error || 'Could not book this session.'); if (response.ok) await loadDashboard();
  }

  async function cancel(sessionId: number) {
    setMessage(''); const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments/cancel`, { method: 'POST', credentials: 'include' }); const body = await response.json(); setMessage(response.ok ? `Booking cancelled. ${body.credits_refunded} credits refunded.` : body.error || 'Could not cancel this booking.'); if (response.ok) await loadDashboard();
  }

  useEffect(() => {
    loadDashboard().catch(() => setMessage('Could not load your participant dashboard.'));
  }, [router]);

  if (!person) return <main><p>Loading your dashboard...</p></main>;

  return <main>
    <h1>Participant dashboard</h1><p>Welcome, {person.full_name}.</p><p>Credit balance: {person.credits}</p>
    {message ? <p role="status">{message}</p> : null}
    <h2>Available sessions</h2>
    {sessions.length === 0 ? <p>No upcoming sessions.</p> : <ul>{sessions.map((session) => <li key={session.id}>{session.discipline} — {session.room_name} — {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.starts_at))} — {session.seat_fee_credits} credits — {session.places_remaining} places <button type="button" disabled={session.places_remaining < 1} onClick={() => book(session.id)}>Book place</button></li>)}</ul>}
    <h2>Your bookings</h2>
    {bookings.length === 0 ? <p>You have no bookings.</p> : <ul>{bookings.map((booking) => <li key={booking.id}>{booking.discipline} — {booking.room_name} — {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.starts_at))} — {booking.status}{booking.status === 'active' ? <button type="button" onClick={() => cancel(booking.session_id)}>Cancel booking</button> : null}</li>)}</ul>}
  </main>;
}
