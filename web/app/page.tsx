import HeroActions from './hero-actions';

export const dynamic = 'force-dynamic';

type Session = {
  id: number;
  discipline: string;
  session_type: string;
  starts_at: string;
  ends_at: string;
  room_name: string;
  seat_fee_credits: number;
  places_remaining: number;
};

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

async function upcomingSessions(): Promise<{ sessions: Session[]; error: string }> {
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 14);
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/sessions?from=${from.toISOString()}&to=${to.toISOString()}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return { sessions: [], error: 'The session catalogue is temporarily unavailable.' };
    const body = await response.json();
    return Array.isArray(body) ? { sessions: body, error: '' } : { sessions: [], error: 'The session catalogue returned an unexpected response.' };
  } catch {
    return { sessions: [], error: 'The session catalogue is temporarily unavailable. Check that the API is running.' };
  }
}

export default async function PublicPage() {
  const { sessions, error } = await upcomingSessions();

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Coaching, made easier to plan</p>
        <h1>Find your next session at Atrium</h1>
        <p>Browse upcoming sessions, understand every fee and cancellation rule, then sign in to reserve your place.</p>
        <HeroActions />
      </section>

      <section className="section-block">
        <p className="eyebrow">Know before you book</p><h2>Fees and session lengths</h2>
        <div className="card-grid">
          <article className="card"><h3>Short</h3><p className="price">15 <span>participant credits</span></p><p>45 minutes of teaching. Coaches pay 30 credits to reserve the room.</p></article>
          <article className="card"><h3>Standard</h3><p className="price">20 <span>participant credits</span></p><p>60 minutes of teaching. Coaches pay 40 credits to reserve the room.</p></article>
          <article className="card"><h3>Intensive</h3><p className="price">60 <span>participant credits</span></p><p>180 minutes of teaching with a 30-minute lunch. The room is held for 210 minutes and coaches pay 120 credits.</p></article>
        </div>
      </section>

      <section className="section-block policy-grid">
        <article className="policy-card"><p className="eyebrow">For participants</p><h2>Cancellation refunds</h2><dl><div><dt>48+ hours before</dt><dd>100% refund</dd></div><div><dt>24–48 hours before</dt><dd>50% refund</dd></div><div><dt>Under 24 hours</dt><dd>No refund</dd></div></dl><p>If the coach cancels, every participant receives a full refund because the cancellation was outside their control.</p></article>
        <article className="policy-card"><p className="eyebrow">For coaches</p><h2>Room cancellation refunds</h2><dl><div><dt>96+ hours before</dt><dd>100% refund</dd></div><div><dt>48–96 hours before</dt><dd>50% refund</dd></div><div><dt>24–48 hours before</dt><dd>25% refund</dd></div><div><dt>Under 24 hours</dt><dd>No refund</dd></div></dl><p>Rooms must be booked at least 48 hours before the session begins.</p></article>
      </section>

      <section className="section-block rules"><p className="eyebrow">Centre rules</p><h2>Planning your booking</h2><div className="card-grid"><article className="card"><h3>Opening hours</h3><p>Monday–Saturday, 07:00–21:00. Sunday is closed. All times use America/New_York.</p></article><article className="card"><h3>Start times</h3><p>Sessions start at :00, :15, :30 or :45 and must finish before closing.</p></article><article className="card"><h3>Credits</h3><p>Credits are whole numbers. Uneven refunds round down. New participants receive 4000 credits and new coaches receive 2000.</p></article></div></section>

      <section id="sessions" className="section-block">
        <div className="section-heading"><div><p className="eyebrow">Next 14 days</p><h2>Upcoming sessions</h2></div><span className="timezone-badge">America/New_York time</span></div>
        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        {!error && sessions.length === 0 ? <div className="empty-state"><h3>No sessions available</h3><p>Please check again later.</p></div> : null}
        {!error && sessions.length > 0 ? (
          <div className="table-wrap"><table><thead><tr><th>Session</th><th>Date and time</th><th>Room</th><th>Fee</th><th>Availability</th></tr></thead><tbody>
            {sessions.map((session) => <tr key={session.id}><td><strong>{session.discipline}</strong><span className="table-note">{session.session_type}</span></td><td>{dateTime.format(new Date(session.starts_at))}</td><td>{session.room_name}</td><td>{session.seat_fee_credits} credits</td><td>{session.places_remaining > 0 ? `${session.places_remaining} places` : <span className="status-full">Full</span>}</td></tr>)}
          </tbody></table></div>
        ) : null}
      </section>
    </main>
  );
}
