'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Room = { id: number; name: string; capacity: number };
type Person = { id: number; full_name: string; email: string; kind: string };
type Session = { id: number; starts_at: string; ends_at: string };
type CurrentPerson = { kind: 'admin' | 'coach' | 'participant' };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState('');

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

      const from = startOfWeek(new Date());
      const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
      const responses = await Promise.all([
        fetch(`${apiBaseUrl}/api/rooms`, { credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/people`, { credentials: 'include' }),
        fetch(`${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`, {
          credentials: 'include'
        })
      ]);

      if (responses.some((response) => !response.ok)) {
        setError('Could not load administrator data.');
        return;
      }

      const [roomData, peopleData, sessionData] = await Promise.all(responses.map((response) => response.json()));
      if (!Array.isArray(roomData) || !Array.isArray(peopleData) || !Array.isArray(sessionData)) {
        setError('Could not load administrator data.');
        return;
      }

      setRooms(roomData);
      setPeople(peopleData);
      setSessions(sessionData);
    }

    void loadDashboard();
  }, [router]);

  return (
    <main>
      <h1>Administrator dashboard</h1>
      {error ? <p role="alert">{error}</p> : null}
      <table className="counts">
        <thead>
          <tr>
            <th>Rooms</th>
            <th>Sessions this week</th>
            <th>People</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{rooms.length}</td>
            <td>{sessions.length}</td>
            <td>{people.length}</td>
          </tr>
        </tbody>
      </table>
      <p><a href="/admin/sessions">Session calendar</a></p>
    </main>
  );
}
