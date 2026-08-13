'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Role = 'admin' | 'coach' | 'participant';
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function HeroActions() {
  const [role, setRole] = useState<Role | null | undefined>(undefined);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((person) => setRole(person?.kind ?? null))
      .catch(() => setRole(null));
  }, []);

  const destination = role === 'participant' ? '/participant' : role === 'coach' ? '/coach' : role === 'admin' ? '/admin' : '/login';
  const label = role === 'participant' ? 'View my bookings' : role === 'coach' ? 'Book a room' : role === 'admin' ? 'Open admin dashboard' : 'Log in to book';

  return <div className="button-row"><a className="button" href="#sessions">Browse sessions</a>{role !== undefined ? <Link className="button-secondary" href={destination}>{label}</Link> : null}</div>;
}
