'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { centreDateString, centreLocalToIso } from '../centre-time';
import FeedbackToast from '../feedback-toast';

type Person = { full_name: string; kind: string; credits: number };
type Room = { id: number; name: string; capacity: number };
type Session = { id: number; discipline?: string; session_type?: string; starts_at: string; ends_at: string; room_name?: string; room_capacity?: number; enrolled_count?: number; seat_fee_credits?: number; places_remaining?: number; busy?: boolean };
type Enrolment = { id: number; session_id: number; discipline: string; session_type: string; starts_at: string; ends_at: string; room_name: string; status: string; credits_charged: number };
type Attendee = { id: number; full_name: string; email: string; status: string };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const centreDateTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const centreTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

function timeSlotsFor(sessionType: string | undefined) {
  const duration = sessionType === 'short' ? 45 : sessionType === 'intensive' ? 210 : 60;
  const latestStartMinute = 21 * 60 - duration;
  return Array.from({ length: (latestStartMinute - 7 * 60) / 15 + 1 }, (_, index) => {
    const minutes = 7 * 60 + index * 15;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  });
}

export default function CoachDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [schedule, setSchedule] = useState<Session[]>([]);
  const [catalogue, setCatalogue] = useState<Session[]>([]);
  const [bookings, setBookings] = useState<Enrolment[]>([]);
  const [attendees, setAttendees] = useState<Record<number, Attendee[]>>({});
  const [expandedAttendees, setExpandedAttendees] = useState<Set<number>>(() => new Set());
  const [loadingAttendeesId, setLoadingAttendeesId] = useState<number | null>(null);
  const [roomId, setRoomId] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [sessionType, setSessionType] = useState('standard');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [showAllCatalogue, setShowAllCatalogue] = useState(false);
  const [showAllTeaching, setShowAllTeaching] = useState(false);
  const [showAllBusy, setShowAllBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingSessionId, setCancellingSessionId] = useState<number | null>(null);
  const [reschedulingSession, setReschedulingSession] = useState<Session | null>(null);
  const [rescheduleRoomId, setRescheduleRoomId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [reschedulingSessionId, setReschedulingSessionId] = useState<number | null>(null);

  async function loadDashboard() {
    const from = new Date().toISOString();
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() + 30);
    const responses = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/sessions?from=${from}&to=${toDate.toISOString()}`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/sessions/catalogue/available?from=${from}&to=${toDate.toISOString()}`, { credentials: 'include', cache: 'no-store' }),
      fetch(`${apiBaseUrl}/api/sessions/mine/enrolments`, { credentials: 'include', cache: 'no-store' })
    ]);
    if (!responses[0].ok) { router.replace('/login'); return; }
    const currentPerson = await responses[0].json();
    if (currentPerson.kind !== 'coach') { router.replace(`/${currentPerson.kind}`); return; }
    const [loadedRooms, loadedSchedule, loadedCatalogue, loadedBookings] = await Promise.all(responses.slice(1).map((response) => response.json()));
    if (responses.slice(1).some((response) => !response.ok)) throw new Error('Could not load all coach dashboard data.');
    setPerson(currentPerson);
    setRooms(Array.isArray(loadedRooms) ? loadedRooms : []);
    setSchedule(Array.isArray(loadedSchedule) ? loadedSchedule : []);
    setCatalogue(Array.isArray(loadedCatalogue) ? loadedCatalogue : []);
    setBookings(Array.isArray(loadedBookings) ? loadedBookings : []);
    setLoading(false);
  }

  async function toggleAttendees(sessionId: number) {
    if (expandedAttendees.has(sessionId)) {
      setExpandedAttendees((current) => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      return;
    }

    if (attendees[sessionId]) {
      setExpandedAttendees((current) => new Set(current).add(sessionId));
      return;
    }

    setMessage('');
    setLoadingAttendeesId(sessionId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load attendees.');
      setAttendees((current) => ({ ...current, [sessionId]: Array.isArray(body.attendees) ? body.attendees : [] }));
      setExpandedAttendees((current) => new Set(current).add(sessionId));
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not load attendees.');
    } finally {
      setLoadingAttendeesId(null);
    }
  }

  async function submitRoomBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedRoom = rooms.find((room) => room.id === Number(roomId));
    const roomFee = sessionType === 'short' ? 30 : sessionType === 'intensive' ? 120 : 40;
    const confirmed = window.confirm(`Book ${selectedRoom?.name || 'this room'} for ${discipline} on ${startDate} at ${startTime}?\n\n${sessionType} session · ${roomFee} credits will be deducted.`);
    if (!confirmed) return;
    setMessage('');
    setSubmitting(true);
    try {
      const duration = sessionType === 'short' ? 45 : sessionType === 'intensive' ? 210 : 60;
      const startsAt = centreLocalToIso(startDate, startTime);
      const endsAt = new Date(new Date(startsAt).getTime() + duration * 60 * 1000).toISOString();
      const response = await fetch(`${apiBaseUrl}/api/sessions`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: Number(roomId), discipline, session_type: sessionType, starts_at: startsAt, ends_at: endsAt })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not book the room.');
      setMessageTone('success');
      setMessage('Room booked successfully.');
      setDiscipline(''); setStartDate(''); setStartTime('');
      await loadDashboard();
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not book the room.');
    } finally {
      setSubmitting(false);
    }
  }

  async function bookPlace(session: Session) {
    const confirmed = window.confirm(`Book a place in ${session.discipline} on ${centreDateTime.format(new Date(session.starts_at))}?\n\nThis will deduct ${session.seat_fee_credits} credits from your balance.`);
    if (!confirmed) return;
    const sessionId = session.id;
    setMessage('');
    const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments`, { method: 'POST', credentials: 'include' });
    const body = await response.json();
    setMessageTone(response.ok ? 'success' : 'error');
    setMessage(response.ok ? 'Your place is booked.' : body.error || 'Could not book this session.');
    if (response.ok) await loadDashboard();
  }

  async function cancelPlace(sessionId: number) {
    setMessage('');
    const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/enrolments/cancel`, { method: 'POST', credentials: 'include' });
    const body = await response.json();
    setMessageTone(response.ok ? 'success' : 'error');
    setMessage(response.ok ? `Attendance cancelled. ${body.credits_refunded} credits refunded.` : body.error || 'Could not cancel this attendance.');
    if (response.ok) await loadDashboard();
  }

  async function cancelTeachingSession(sessionId: number) {
    const confirmed = window.confirm('Cancel this session? The room will be released and every attendee will receive a full refund.');
    if (!confirmed) return;

    setMessage('');
    setCancellingSessionId(sessionId);
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/cancel`, { method: 'POST', credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not cancel this session.');
      setMessageTone('success');
      setMessage(`Session cancelled. ${body.room_fee_refunded} room credits refunded. ${body.enrolments_cancelled} attendee booking(s) cancelled with full refunds.`);
      setAttendees((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      await loadDashboard();
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not cancel this session.');
    } finally {
      setCancellingSessionId(null);
    }
  }

  function openReschedule(session: Session) {
    setReschedulingSession(session);
    setRescheduleRoomId(String(rooms.find((room) => room.name === session.room_name)?.id ?? ''));
    setRescheduleDate(centreDateString(new Date(session.starts_at)));
    setRescheduleTime(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(session.starts_at)));
  }

  async function submitReschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reschedulingSession) return;
    const nextRoom = rooms.find((room) => room.id === Number(rescheduleRoomId));
    const confirmed = window.confirm(`Move Session #${reschedulingSession.id} to ${nextRoom?.name || 'the selected room'} on ${rescheduleDate} at ${rescheduleTime}?\n\nAll active attendees move together and will receive an email notification.`);
    if (!confirmed) return;
    setReschedulingSessionId(reschedulingSession.id);
    setMessage('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/sessions/${reschedulingSession.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: Number(rescheduleRoomId), starts_at: centreLocalToIso(rescheduleDate, rescheduleTime) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not reschedule this session.');
      setMessageTone('success');
      setMessage(`Session rescheduled. ${body.participants_moved} active attendee booking(s) moved and were notified.`);
      setReschedulingSession(null);
      await loadDashboard();
    } catch (reason) {
      setMessageTone('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not reschedule this session.');
    } finally {
      setReschedulingSessionId(null);
    }
  }

  useEffect(() => {
    loadDashboard().catch((reason) => { setMessageTone('error'); setMessage(reason instanceof Error ? reason.message : 'Could not load your coach dashboard.'); setLoading(false); });
  }, [router]);

  const activeBookings = useMemo(() => bookings.filter((booking) => booking.status === 'active' && new Date(booking.starts_at) > new Date()), [bookings]);
  const attendingIds = useMemo(() => new Set(activeBookings.map((booking) => booking.session_id)), [activeBookings]);
  const ownSessions = useMemo(() => schedule.filter((session) => !session.busy), [schedule]);
  const busySessions = useMemo(() => schedule.filter((session) => session.busy && !attendingIds.has(session.id)), [schedule, attendingIds]);
  const filteredCatalogue = useMemo(() => catalogue.filter((session) => {
    if (attendingIds.has(session.id)) return false;
    if (search && !session.discipline?.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && session.session_type !== typeFilter) return false;
    return !dateFilter || centreDateString(new Date(session.starts_at)) === dateFilter;
  }), [catalogue, attendingIds, search, typeFilter, dateFilter]);

  if (loading) return <main><p className="notice">Loading your coach dashboard...</p></main>;
  if (!person) return <main><div className="notice notice-error" role="alert">{message || 'Could not load your coach dashboard.'}</div></main>;

  const timeSlots = timeSlotsFor(sessionType);
  const displayedCatalogue = showAllCatalogue ? filteredCatalogue : filteredCatalogue.slice(0, 8);
  const displayedTeaching = showAllTeaching ? ownSessions : ownSessions.slice(0, 6);
  const displayedBusy = showAllBusy ? busySessions : busySessions.slice(0, 8);

  return <main>
    <section className="page-heading"><div><p className="eyebrow">Coach workspace</p><h1>Welcome, {person.full_name}</h1><p>Balance: <strong>{person.credits} credits</strong></p><p className="muted">Dashboard overview: next 30 days</p></div><div className="dashboard-stats"><span><strong>{ownSessions.length}</strong> teaching</span><span><strong>{activeBookings.length}</strong> attending</span></div></section>
    <FeedbackToast message={message} tone={messageTone} onClose={() => setMessage('')} />

    <nav className="section-nav" aria-label="Coach dashboard sections"><a href="#book-room">Book a room</a><a href="#teaching">Teaching</a><a href="#attending">Attending</a><a href="#find-session">Find a session</a><a href="#busy-times">Busy times</a></nav>

    <section id="book-room" className="dashboard-section"><details className="booking-details"><summary><span><strong>Book a room</strong><small>Create a new session at least 48 hours ahead.</small></span></summary><form onSubmit={submitRoomBooking}><label>Room<select required value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Choose a room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name} ({room.capacity} places)</option>)}</select></label><label>Discipline<input required value={discipline} onChange={(event) => setDiscipline(event.target.value)} /></label><label>Session type<select value={sessionType} onChange={(event) => setSessionType(event.target.value)}><option value="short">Short: 45 minutes, 30 credits</option><option value="standard">Standard: 60 minutes, 40 credits</option><option value="intensive">Intensive: 210 minutes, 120 credits</option></select></label><label>Date<input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Start time<select required value={startTime} onChange={(event) => setStartTime(event.target.value)}><option value="">Choose a time</option>{timeSlots.map((time) => <option key={time} value={time}>{time}</option>)}</select></label><button type="submit" disabled={submitting}>{submitting ? 'Booking room...' : 'Book room'}</button></form></details></section>

    <section id="teaching" className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Sessions you lead</p><h2>Your teaching schedule</h2></div></div>
      {displayedTeaching.length === 0 ? <div className="empty-state"><p>You have no upcoming teaching sessions.</p></div> : <div className="compact-list">{displayedTeaching.map((session) => {
        const isExpanded = expandedAttendees.has(session.id);
        const loadedAttendees = attendees[session.id] ?? [];
        const activeCount = session.enrolled_count ?? loadedAttendees.filter((attendee) => attendee.status === 'active').length;
        const cancelledCount = loadedAttendees.filter((attendee) => attendee.status === 'cancelled').length;
        return <article className="session-card" key={session.id}><div><strong>{session.discipline}</strong><span>{session.session_type}</span><span>Session #{session.id}</span><span>{session.room_name}</span><span>{centreDateTime.format(new Date(session.starts_at))}</span><span className="attendee-count">{activeCount} attending{session.room_capacity ? ` · ${session.room_capacity} capacity` : ''}</span></div><div className="session-actions"><button className="button-secondary" type="button" aria-expanded={isExpanded} aria-controls={`attendees-${session.id}`} disabled={loadingAttendeesId === session.id} onClick={() => toggleAttendees(session.id)}>{loadingAttendeesId === session.id ? 'Loading...' : isExpanded ? 'Hide attendees' : 'View attendees'}</button><button className="button-secondary" type="button" onClick={() => openReschedule(session)}>Reschedule</button><button className="button-danger" type="button" disabled={cancellingSessionId === session.id} onClick={() => cancelTeachingSession(session.id)}>{cancellingSessionId === session.id ? 'Cancelling...' : 'Cancel session'}</button></div>{reschedulingSession?.id === session.id ? <form className="reschedule-form" onSubmit={submitReschedule}><strong>Reschedule Session #{session.id}</strong><label>Room<select required value={rescheduleRoomId} onChange={(event) => setRescheduleRoomId(event.target.value)}><option value="">Choose a room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label>Date<input required type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} /></label><label>Start time<select required value={rescheduleTime} onChange={(event) => setRescheduleTime(event.target.value)}><option value="">Choose a time</option>{timeSlotsFor(session.session_type).map((time) => <option key={time} value={time}>{time}</option>)}</select></label><div className="button-row"><button type="submit" disabled={reschedulingSessionId === session.id}>{reschedulingSessionId === session.id ? 'Rescheduling...' : 'Confirm reschedule'}</button><button className="button-secondary" type="button" onClick={() => setReschedulingSession(null)}>Close</button></div></form> : null}{isExpanded ? <div className="attendee-panel" id={`attendees-${session.id}`}><strong className="attendee-summary">{activeCount} active attendee{activeCount === 1 ? '' : 's'} · {cancelledCount} cancelled</strong>{loadedAttendees.length === 0 ? <span className="muted">No participants booked.</span> : loadedAttendees.map((attendee) => <span key={attendee.id}>{attendee.full_name} - {attendee.email} - {attendee.status}</span>)}</div> : null}</article>;
      })}</div>}
      {ownSessions.length > 6 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllTeaching((value) => !value)}>{showAllTeaching ? 'Show fewer' : `Show all ${ownSessions.length}`}</button> : null}
    </section>

    <section id="attending" className="dashboard-section"><p className="eyebrow">Your own bookings</p><h2>Sessions you&apos;re attending</h2>
      {activeBookings.length === 0 ? <div className="empty-state"><p>You are not attending any upcoming sessions.</p></div> : <div className="compact-list">{activeBookings.map((booking) => <article className="session-card" key={booking.id}><div><strong>{booking.discipline}</strong><span>{booking.room_name}</span><span>{centreDateTime.format(new Date(booking.starts_at))}</span><span>{booking.credits_charged} credits paid</span></div><button className="button-secondary" type="button" onClick={() => cancelPlace(booking.session_id)}>Cancel attendance</button></article>)}</div>}
    </section>

    <section id="find-session" className="dashboard-section"><p className="eyebrow">Attend another coach</p><h2>Find a session</h2><p>Available sessions for the next 30 days. Attendee information is never shown here.</p>
      <div className="filters"><label>Discipline<input type="search" placeholder="Search discipline" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>Session type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="short">Short</option><option value="standard">Standard</option><option value="intensive">Intensive</option></select></label><label>Date<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label><button className="button-secondary filter-reset" type="button" onClick={() => { setSearch(''); setTypeFilter('all'); setDateFilter(''); }}>Clear filters</button></div>
      {displayedCatalogue.length === 0 ? <div className="empty-state"><p>No sessions match these filters.</p></div> : <div className="compact-list">{displayedCatalogue.map((session) => { const alreadyBooked = attendingIds.has(session.id); const isFull = (session.places_remaining ?? 0) < 1; return <article className="session-card" key={session.id}><div><strong>{session.discipline}</strong><span>{session.session_type} - {session.room_name}</span><span>{centreDateTime.format(new Date(session.starts_at))}</span><span>{session.seat_fee_credits} credits - {session.places_remaining} places left</span></div><button type="button" disabled={alreadyBooked || isFull} onClick={() => bookPlace(session)}>{alreadyBooked ? 'Booked' : isFull ? 'Full' : 'Book place'}</button></article>; })}</div>}
      {filteredCatalogue.length > 8 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllCatalogue((value) => !value)}>{showAllCatalogue ? 'Show fewer' : `Show more (${filteredCatalogue.length - 8})`}</button> : null}
    </section>

    <section id="busy-times" className="dashboard-section"><p className="eyebrow">Private planning view</p><h2>Other coaches&apos; busy times</h2><p>Only anonymous occupied periods are shown. Sessions you attend are listed separately above.</p>
      {displayedBusy.length === 0 ? <div className="empty-state"><p>No other coach commitments are currently scheduled.</p></div> : <div className="busy-grid">{displayedBusy.map((session) => <article className="busy-card" key={session.id}><strong>Busy</strong><span>{centreDateTime.format(new Date(session.starts_at))}</span><span>until {centreTime.format(new Date(session.ends_at))}</span></article>)}</div>}
      {busySessions.length > 8 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllBusy((value) => !value)}>{showAllBusy ? 'Show fewer' : `Show more (${busySessions.length - 8})`}</button> : null}
    </section>

  </main>;
}
