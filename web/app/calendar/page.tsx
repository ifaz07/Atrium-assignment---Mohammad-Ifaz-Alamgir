'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCentreDays, centreDateString, centreLocalToIso, centreTimeZone, centreWeekMonday } from '../centre-time';

type Role = 'admin' | 'coach' | 'participant';
type Person = { kind: Role };
type CalendarItem = { id: number; starts_at: string; ends_at: string; discipline?: string; room_name?: string; busy?: boolean; attending?: boolean; status?: string };
type Enrolment = CalendarItem & { session_id: number };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const dayHeading = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('en-US', { timeZone: centreTimeZone, hour: 'numeric', minute: '2-digit' });

export default function CalendarPage() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => centreWeekMonday(centreDateString(new Date())));
  const [role, setRole] = useState<Role | null>(null);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const days = Array.from({ length: 7 }, (_, index) => addCentreDays(weekStart, index));

  useEffect(() => {
    let active = true;
    async function loadCalendar() {
      setLoading(true);
      setError('');
      setRole(null);
      setItems([]);
      try {
        const personResponse = await fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' });
        if (!personResponse.ok) { router.replace('/login'); return; }
        const person = await personResponse.json() as Person;
        const from = centreLocalToIso(weekStart, '00:00');
        const to = centreLocalToIso(addCentreDays(weekStart, 7), '00:00');
        let filtered: CalendarItem[] = [];
        if (person.kind === 'participant') {
          const response = await fetch(`${apiBaseUrl}/api/sessions/mine/enrolments`, { credentials: 'include', cache: 'no-store' });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body)) throw new Error(body.error || 'Could not load the calendar.');
          filtered = (body as Enrolment[]).filter((item) => item.status === 'active' && item.starts_at >= from && item.starts_at < to).map((item) => ({ ...item, id: item.session_id, attending: true }));
        } else if (person.kind === 'coach') {
          const [scheduleResponse, bookingsResponse] = await Promise.all([
            fetch(`${apiBaseUrl}/api/sessions?from=${from}&to=${to}`, { credentials: 'include', cache: 'no-store' }),
            fetch(`${apiBaseUrl}/api/sessions/mine/enrolments`, { credentials: 'include', cache: 'no-store' })
          ]);
          const [schedule, bookings] = await Promise.all([scheduleResponse.json(), bookingsResponse.json()]);
          if (!scheduleResponse.ok || !bookingsResponse.ok || !Array.isArray(schedule) || !Array.isArray(bookings)) throw new Error('Could not load the calendar.');
          const attending = new Map((bookings as Enrolment[]).filter((item) => item.status === 'active' && item.starts_at >= from && item.starts_at < to).map((item) => [item.session_id, item]));
          filtered = (schedule as CalendarItem[]).map((item) => attending.has(item.id) ? { ...attending.get(item.id)!, id: item.id, busy: false, attending: true } : item);
        } else {
          const response = await fetch(`${apiBaseUrl}/api/sessions?from=${from}&to=${to}`, { credentials: 'include', cache: 'no-store' });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body)) throw new Error(body.error || 'Could not load the calendar.');
          filtered = body;
        }
        if (active) { setRole(person.kind); setItems(filtered); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the calendar.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadCalendar();
    return () => { active = false; };
  }, [router, weekStart, refreshKey]);

  useEffect(() => {
    const refresh = () => setRefreshKey((value) => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('atrium-auth-change', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('atrium-auth-change', refresh);
    };
  }, []);

  function itemsForDay(day: string) {
    return items.filter((item) => centreDateString(new Date(item.starts_at)) === day);
  }

  return (
    <main>
      <section className="page-heading"><div><p className="eyebrow">{role ? `${role} view` : 'Your schedule'}</p><h1>Weekly calendar</h1><p>All dates and times use America/New_York.</p></div><div className="button-row"><button className="button-secondary" type="button" onClick={() => setWeekStart(addCentreDays(weekStart, -7))}>Previous week</button><button className="button-secondary" type="button" onClick={() => setWeekStart(centreWeekMonday(centreDateString(new Date())))}>This week</button><button type="button" onClick={() => setWeekStart(addCentreDays(weekStart, 7))}>Next week</button></div></section>
      {loading ? <div className="notice">Loading your calendar...</div> : null}
      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
      {!loading && !error ? <div className="week-calendar">{days.map((day) => { const dayItems = itemsForDay(day); return <section className="calendar-day" key={day}><h2>{dayHeading.format(new Date(`${day}T12:00:00Z`))}</h2>{dayItems.length === 0 ? <p className="muted">No commitments</p> : dayItems.map((item) => <article className={item.busy ? 'calendar-event busy-event' : 'calendar-event'} key={`${item.id}-${item.starts_at}`}><strong>{item.busy ? 'Busy' : `${item.discipline}${role === 'coach' ? item.attending ? ' (attending)' : ' (teaching)' : ''}`}</strong><span>{timeOnly.format(new Date(item.starts_at))}–{timeOnly.format(new Date(item.ends_at))}</span>{item.room_name ? <span>{item.room_name}</span> : null}</article>)}</section>; })}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="empty-state"><h2>No commitments this week</h2><p>Your schedule is clear for the selected week.</p></div> : null}
    </main>
  );
}
