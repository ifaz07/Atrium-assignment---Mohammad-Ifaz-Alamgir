'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Person = { full_name: string; kind: string; credits: number };
type Room = { id: number; name: string; capacity: number };
type Session = { id: number; discipline?: string; session_type?: string; starts_at: string; ends_at: string; room_name?: string; busy?: boolean };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const newYorkDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const newYorkTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit'
});

export default function CoachDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [roomId, setRoomId] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [sessionType, setSessionType] = useState('standard');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadDashboard() {
    const [personResponse, roomsResponse, sessionsResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' }),
      fetch(`${apiBaseUrl}/api/sessions?from=${new Date().toISOString()}`, { credentials: 'include' })
    ]);
    if (!personResponse.ok) {
      router.replace('/login');
      return;
    }
    const currentPerson = await personResponse.json();
    if (currentPerson.kind !== 'coach') {
      router.replace(`/${currentPerson.kind}`);
      return;
    }
    setPerson(currentPerson);
    const loadedRooms = await roomsResponse.json();
    const loadedSessions = await sessionsResponse.json();
    setRooms(Array.isArray(loadedRooms) ? loadedRooms : []);
    setSessions(Array.isArray(loadedSessions) ? loadedSessions : []);
  }

  function newYorkTimeToIso(value: string): string {
    const [date, time] = value.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(localAsUtc));
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const observedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute);
    return new Date(localAsUtc - (observedAsUtc - localAsUtc)).toISOString();
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    const duration = sessionType === 'short' ? 45 : sessionType === 'intensive' ? 210 : 60;
    const start = newYorkTimeToIso(`${startDate}T${startTime}`);
    const end = new Date(new Date(start).getTime() + duration * 60 * 1000).toISOString();
    const response = await fetch(`${apiBaseUrl}/api/sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: Number(roomId), discipline, session_type: sessionType, starts_at: start, ends_at: end })
    });
    const body = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setMessage(body.error || 'Could not create the booking.');
      return;
    }
    setMessage('Room booked successfully.');
    setDiscipline('');
    setStartDate('');
    setStartTime('');
    await loadDashboard();
  }

  useEffect(() => {
    loadDashboard().catch(() => setMessage('Could not load your coach dashboard.'));
  }, [router]);

  if (!person) return <main><p>Loading your dashboard...</p></main>;

  const duration = sessionType === 'short' ? 45 : sessionType === 'intensive' ? 210 : 60;
  const latestStartMinute = 21 * 60 - duration;
  const timeSlots = Array.from(
    { length: (latestStartMinute - 7 * 60) / 15 + 1 },
    (_, index) => {
      const minutes = 7 * 60 + index * 15;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
  );

  return <main>
    <h1>Coach dashboard</h1>
    <p>Welcome, {person.full_name}.</p>
    <p>Credit balance: {person.credits}</p>
    <h2>Book a room</h2>
    <p>Times are America/New_York. Bookings must be at least 48 hours ahead and between 07:00 and 21:00 Monday to Saturday.</p>
    <form onSubmit={submitBooking}>
      <p><label>Room <select required value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Choose a room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name} ({room.capacity} places)</option>)}</select></label></p>
      <p><label>Discipline <input required value={discipline} onChange={(event) => setDiscipline(event.target.value)} /></label></p>
      <p><label>Session type <select value={sessionType} onChange={(event) => setSessionType(event.target.value)}><option value="short">Short: 45 minutes, 30 credits</option><option value="standard">Standard: 60 minutes, 40 credits</option><option value="intensive">Intensive: 210 minutes, 120 credits</option></select></label></p>
      <p><label>Date <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label></p>
      <p><label>Start time <select required value={startTime} onChange={(event) => setStartTime(event.target.value)}><option value="">Choose a time</option>{timeSlots.map((time) => <option key={time} value={time}>{time}</option>)}</select></label></p>
      <button type="submit" disabled={submitting}>{submitting ? 'Booking room...' : 'Book room'}</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    <h2>Your upcoming sessions</h2>
    <p>All times are America/New_York.</p>
    {sessions.length === 0 ? <p>No upcoming sessions.</p> : <ul>{sessions.map((session) => session.busy ? <li key={session.id}>Busy: {newYorkDateTime.format(new Date(session.starts_at))} to {newYorkTime.format(new Date(session.ends_at))}</li> : <li key={session.id}>{session.discipline} — {session.room_name} — {newYorkDateTime.format(new Date(session.starts_at))}</li>)}</ul>}
  </main>;
}
