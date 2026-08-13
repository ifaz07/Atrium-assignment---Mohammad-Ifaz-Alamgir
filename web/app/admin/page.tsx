'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCentreDays, centreDateString, centreLocalToIso, centreWeekMonday } from '../centre-time';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: 'admin' | 'coach' | 'participant' };
type Session = { id: number; starts_at: string; ends_at: string };
type CurrentPerson = { kind: 'admin' | 'coach' | 'participant' };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function AdminDashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      const currentResponse = await fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' });

      if (!currentResponse.ok) {
        router.replace('/login');
        return;
      }

      const currentPerson = (await currentResponse.json()) as CurrentPerson;
      if (currentPerson.kind !== 'admin') {
        router.replace(`/${currentPerson.kind}`);
        return;
      }

      const weekStart = centreWeekMonday(centreDateString(new Date()));
      const from = centreLocalToIso(weekStart, '00:00');
      const to = centreLocalToIso(addCentreDays(weekStart, 7), '00:00');
      const responses = await Promise.all([
        fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/sessions?from=${from}&to=${to}`, {
          credentials: 'include'
        })
      ]);

      if (responses.some((response) => !response.ok)) {
        setError('Could not load administrator data.');
        setLoading(false);
        return;
      }

      const [roomData, peopleData, sessionData] = await Promise.all(responses.map((response) => response.json()));
      if (!Array.isArray(roomData) || !Array.isArray(peopleData) || !Array.isArray(sessionData)) {
        setError('Could not load administrator data.');
        setLoading(false);
        return;
      }

      setRooms(roomData);
      setPeople(peopleData);
      setSessions(sessionData);
      setLoading(false);
    }

    void loadDashboard().catch(() => {
      setError('Could not load administrator data.');
      setLoading(false);
    });
  }, [router]);

  const participantCount = people.filter((person) => person.kind === 'participant').length;
  const coachCount = people.filter((person) => person.kind === 'coach').length;

  return (
    <main>
      <h1>Administrator dashboard</h1>
      {loading ? <p className="notice">Loading administrator data...</p> : null}
      {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
      {!loading && !error ? <div className="table-wrap admin-counts"><table className="counts">
        <thead>
          <tr>
            <th>Rooms</th>
            <th>Sessions this week</th>
            <th>Total people</th>
            <th>Participants</th>
            <th>Coaches</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{rooms.length}</td>
            <td>{sessions.length}</td>
            <td>{people.length}</td>
            <td>{participantCount}</td>
            <td>{coachCount}</td>
          </tr>
        </tbody>
      </table></div> : null}
      <p><a href="/calendar">Open the role-aware calendar</a></p>
    </main>
  );
}
