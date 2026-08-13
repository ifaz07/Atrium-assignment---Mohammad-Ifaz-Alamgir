'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { centreDateString } from '../centre-time';
import FeedbackToast from '../feedback-toast';

type Person = { full_name: string; kind: string; credits: number };
type Session = { id: number; discipline: string; session_type: string; starts_at: string; ends_at: string; room_name: string; seat_fee_credits: number; places_remaining: number };
type Enrolment = { id: number; session_id: number; discipline: string; session_type: string; starts_at: string; ends_at: string; room_name: string; status: string; credits_charged: number; credits_refunded: number };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const centreDateTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [bookings, setBookings] = useState<Enrolment[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showAllBookings, setShowAllBookings] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [actionSessionId, setActionSessionId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [loading, setLoading] = useState(true);

  async function loadDashboard() {
    const from = new Date().toISOString();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 30);
    const [personResponse, sessionsResponse, bookingsResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/sessions/catalogue/available?from=${from}&to=${to.toISOString()}`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/sessions/mine/enrolments`, { credentials: 'include', cache: 'no-store' })
    ]);
    if (!personResponse.ok) { router.replace('/login'); return; }
    const currentPerson = await personResponse.json();
    if (currentPerson.kind !== 'participant') { router.replace(`/${currentPerson.kind}`); return; }
    const [loadedSessions, loadedBookings] = await Promise.all([sessionsResponse.json(), bookingsResponse.json()]);
    if (!sessionsResponse.ok || !bookingsResponse.ok) throw new Error('Could not load all participant dashboard data.');
    setPerson(currentPerson);
    setSessions(Array.isArray(loadedSessions) ? loadedSessions : []);
    setBookings(Array.isArray(loadedBookings) ? loadedBookings : []);
    setLoading(false);
  }

  async function book(session: Session) {
    const confirmed = window.confirm(`Book a place in ${session.discipline} on ${centreDateTime.format(new Date(session.starts_at))}?\n\nThis will deduct ${session.seat_fee_credits} credits from your balance.`);
    if (!confirmed) return;
    const sessionId = session.id;
    setMessage('');
    setActionSessionId(sessionId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments`, { method: 'POST', credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not book this session.');
      setMessageTone('success');
      setMessage('Place booked successfully. Your balance has been updated.');
      await loadDashboard();
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not book this session.');
    } finally {
      setActionSessionId(null);
    }
  }

  async function cancel(sessionId: number) {
    const confirmed = window.confirm('Cancel this booking? Your refund depends on how much notice you give.');
    if (!confirmed) return;
    setMessage('');
    setActionSessionId(sessionId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments/cancel`, { method: 'POST', credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not cancel this booking.');
      setMessageTone('success');
      setMessage(`Booking cancelled. ${body.credits_refunded} credits refunded (${body.refund_percent}%).`);
      await loadDashboard();
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not cancel this booking.');
    } finally {
      setActionSessionId(null);
    }
  }

  useEffect(() => {
    loadDashboard().catch((reason) => {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not load your participant dashboard.');
      setLoading(false);
    });
  }, [router]);

  const activeBookings = useMemo(() => bookings.filter((booking) => booking.status === 'active' && new Date(booking.starts_at) > new Date()), [bookings]);
  const bookingHistory = useMemo(() => bookings.filter((booking) => booking.status !== 'active' || new Date(booking.starts_at) <= new Date()).reverse(), [bookings]);
  const activeSessionIds = useMemo(() => new Set(activeBookings.map((booking) => booking.session_id)), [activeBookings]);
  const filteredSessions = useMemo(() => sessions.filter((session) => {
    if (search && !session.discipline.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && session.session_type !== typeFilter) return false;
    return !dateFilter || centreDateString(new Date(session.starts_at)) === dateFilter;
  }), [sessions, search, typeFilter, dateFilter]);

  if (loading) return <main><p className="notice">Loading your participant dashboard...</p></main>;
  if (!person) return <main><div className="notice notice-error" role="alert">{message || 'Could not load your participant dashboard.'}</div></main>;

  const displayedSessions = showAllSessions ? filteredSessions : filteredSessions.slice(0, 8);
  const displayedBookings = showAllBookings ? activeBookings : activeBookings.slice(0, 5);
  const displayedHistory = showAllHistory ? bookingHistory : bookingHistory.slice(0, 5);

  return <main>
    <section className="page-heading"><div><p className="eyebrow">Participant workspace</p><h1>Welcome, {person.full_name}</h1><p className="muted">Manage your sessions for the next 30 days.</p></div><div className="dashboard-stats"><span><strong>{person.credits}</strong> credits</span><span><strong>{activeBookings.length}</strong> upcoming</span></div></section>
    <FeedbackToast message={message} tone={messageTone} onClose={() => setMessage('')} />

    <nav className="section-nav" aria-label="Participant dashboard sections"><a href="#find-session">Find a session</a><a href="#my-bookings">My bookings</a><a href="#booking-history">History</a></nav>

    <section id="find-session" className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Next 30 days</p><h2>Find a session</h2></div><span className="timezone-badge">America/New_York time</span></div>
      <div className="filters"><label>Discipline<input type="search" placeholder="Search discipline" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Session type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="short">Short</option><option value="standard">Standard</option><option value="intensive">Intensive</option></select></label><label>Date<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><button className="button-secondary filter-reset" type="button" onClick={() => { setSearch(''); setTypeFilter('all'); setDateFilter(''); }}>Clear filters</button></div>
      {displayedSessions.length === 0 ? <div className="empty-state"><h3>No matching sessions</h3><p>Try clearing the filters or choosing another date.</p></div> : <div className="compact-list">{displayedSessions.map((session) => {
        const alreadyBooked = activeSessionIds.has(session.id);
        const isFull = session.places_remaining < 1;
        return <article className="session-card" key={session.id}><div><strong>{session.discipline}</strong><span>{session.session_type}</span><span>{session.room_name}</span><span>{centreDateTime.format(new Date(session.starts_at))}</span><span>{session.seat_fee_credits} credits · {session.places_remaining} places left</span></div><button type="button" disabled={alreadyBooked || isFull || actionSessionId === session.id} onClick={() => book(session)}>{alreadyBooked ? 'Booked' : isFull ? 'Full' : actionSessionId === session.id ? 'Booking...' : 'Book place'}</button></article>;
      })}</div>}
      {filteredSessions.length > 8 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllSessions((value) => !value)}>{showAllSessions ? 'Show fewer' : `Show more (${filteredSessions.length - 8})`}</button> : null}
    </section>

    <section id="my-bookings" className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Your schedule</p><h2>Upcoming bookings</h2></div></div><p className="muted">Cancel 48+ hours ahead for a full refund, 24–48 hours ahead for 50%, or under 24 hours for no refund.</p>
      {displayedBookings.length === 0 ? <div className="empty-state"><h3>No upcoming bookings</h3><p>Find an available session above and reserve your place.</p></div> : <div className="compact-list">{displayedBookings.map((booking) => <article className="session-card" key={booking.id}><div><strong>{booking.discipline}</strong><span>{booking.session_type}</span><span>{booking.room_name}</span><span>{centreDateTime.format(new Date(booking.starts_at))}</span><span>{booking.credits_charged} credits paid</span></div><button className="button-danger" type="button" disabled={actionSessionId === booking.session_id} onClick={() => cancel(booking.session_id)}>{actionSessionId === booking.session_id ? 'Cancelling...' : 'Cancel booking'}</button></article>)}</div>}
      {activeBookings.length > 5 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllBookings((value) => !value)}>{showAllBookings ? 'Show fewer' : `Show more (${activeBookings.length - 5})`}</button> : null}
    </section>

    <section id="booking-history" className="dashboard-section"><p className="eyebrow">Your records</p><h2>Booking history</h2>
      {displayedHistory.length === 0 ? <div className="empty-state"><p>You have no previous or cancelled bookings.</p></div> : <div className="compact-list">{displayedHistory.map((booking) => <article className="session-card" key={booking.id}><div><strong>{booking.discipline}</strong><span>{booking.room_name}</span><span>{centreDateTime.format(new Date(booking.starts_at))}</span><span className="status-label">{booking.status}</span>{booking.credits_refunded > 0 ? <span>{booking.credits_refunded} credits refunded</span> : null}</div></article>)}</div>}
      {bookingHistory.length > 5 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllHistory((value) => !value)}>{showAllHistory ? 'Show fewer' : `Show history (${bookingHistory.length})`}</button> : null}
    </section>
  </main>;
}
