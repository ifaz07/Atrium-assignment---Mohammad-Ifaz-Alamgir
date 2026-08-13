'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCentreDays, centreDateString, centreLocalToIso, centreWeekMonday } from '../centre-time';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: 'admin' | 'coach' | 'participant'; credits: number; active: boolean; enrolled_session_count: number; running_session_count: number };
type Session = { id: number; starts_at: string; ends_at: string };
type CurrentPerson = { kind: 'admin' | 'coach' | 'participant' };
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function AdminDashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]); const [people, setPeople] = useState<Person[]>([]); const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [showAllParticipants, setShowAllParticipants] = useState(false); const [showAllCoaches, setShowAllCoaches] = useState(false);

  useEffect(() => { void (async () => {
    try {
      const current = await fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' });
      if (!current.ok) { router.replace('/login'); return; }
      const person = await current.json() as CurrentPerson;
      if (person.kind !== 'admin') { router.replace(`/${person.kind}`); return; }
      const weekStart = centreWeekMonday(centreDateString(new Date())); const from = centreLocalToIso(weekStart, '00:00'); const to = centreLocalToIso(addCentreDays(weekStart, 7), '00:00');
      const responses = await Promise.all([fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include', cache: 'no-store' }), fetch(`${apiBaseUrl}/api/people`, { credentials: 'include', cache: 'no-store' }), fetch(`${apiBaseUrl}/api/sessions?from=${from}&to=${to}`, { credentials: 'include', cache: 'no-store' })]);
      if (responses.some(response => !response.ok)) throw new Error('Could not load administrator data.');
      const [roomData, peopleData, sessionData] = await Promise.all(responses.map(response => response.json()));
      if (!Array.isArray(roomData) || !Array.isArray(peopleData) || !Array.isArray(sessionData)) throw new Error('Could not load administrator data.');
      setRooms(roomData); setPeople(peopleData); setSessions(sessionData);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load administrator data.'); }
    finally { setLoading(false); }
  })(); }, [router]);

  const participants = useMemo(() => people.filter(person => person.kind === 'participant'), [people]);
  const coaches = useMemo(() => people.filter(person => person.kind === 'coach'), [people]);
  const visibleParticipants = showAllParticipants ? participants : participants.slice(0, 8); const visibleCoaches = showAllCoaches ? coaches : coaches.slice(0, 8);
  if (loading) return <main><p className="notice">Loading administrator data...</p></main>;
  if (error) return <main><p className="notice notice-error" role="alert">{error}</p></main>;
  return <main>
    <section className="page-heading"><div><p className="eyebrow">Centre operations</p><h1>Administrator dashboard</h1><p>People, credits and current booking activity across Atrium.</p></div><a className="button-secondary" href="/calendar">Open calendar</a></section>
    <div className="dashboard-stats admin-dashboard-stats"><span><strong>{rooms.length}</strong> rooms</span><span><strong>{sessions.length}</strong> sessions this week</span><span><strong>{participants.length}</strong> participants</span><span><strong>{coaches.length}</strong> coaches</span></div>
    <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Participant accounts</p><h2>Participants</h2><p>Credits and total sessions each participant has enrolled in.</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Sessions enrolled</th><th>Account</th></tr></thead><tbody>{visibleParticipants.map(person => <tr key={person.id}><td>{person.full_name}</td><td>{person.email}</td><td>{person.credits}</td><td>{person.enrolled_session_count}</td><td>{person.active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div>{participants.length > 8 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllParticipants(value => !value)}>{showAllParticipants ? 'Show fewer' : `Show all ${participants.length}`}</button> : null}</section>
    <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Coach accounts</p><h2>Coaches</h2><p>Credits and scheduled sessions currently run by each coach.</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Scheduled sessions</th><th>Account</th></tr></thead><tbody>{visibleCoaches.map(person => <tr key={person.id}><td>{person.full_name}</td><td>{person.email}</td><td>{person.credits}</td><td>{person.running_session_count}</td><td>{person.active ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div>{coaches.length > 8 ? <button className="button-secondary show-more" type="button" onClick={() => setShowAllCoaches(value => !value)}>{showAllCoaches ? 'Show fewer' : `Show all ${coaches.length}`}</button> : null}</section>
  </main>;
}
