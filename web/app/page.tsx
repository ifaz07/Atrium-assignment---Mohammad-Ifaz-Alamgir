export const dynamic = 'force-dynamic';

type Session = {
  id: number;
  discipline: string;
  session_type: string;
  status: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  room_capacity: number;
  coach_name: string;
  enrolled_count: number;
  places_remaining: number;
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

export default async function PublicSessions() {
  const from = new Date();
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);

  const res = await fetch(
    `${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`,
    { cache: 'no-store' }
  );
  const sessions: Session[] = await res.json();

  return (
    <main>
      <h1>Upcoming sessions</h1>
      <table>
        <thead>
          <tr>
            <th>Discipline</th>
            <th>Date</th>
            <th>Time</th>
            <th>Room</th>
            <th>Places remaining</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>{session.discipline}</td>
              <td>{new Date(session.starts_at).toLocaleDateString()}</td>
              <td>
                {new Date(session.starts_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
                {' – '}
                {new Date(session.ends_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </td>
              <td>{session.room_name}</td>
              <td>{session.places_remaining}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
