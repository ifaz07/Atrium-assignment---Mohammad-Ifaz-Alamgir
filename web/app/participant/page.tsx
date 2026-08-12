'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Person = { full_name: string; kind: string; credits: number };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' }).then(async (response) => {
      if (!response.ok) {
        router.replace('/login');
        return;
      }

      const currentPerson = await response.json();
      if (currentPerson.kind !== 'participant') {
        router.replace(`/${currentPerson.kind}`);
        return;
      }

      setPerson(currentPerson);
    });
  }, [router]);

  if (!person) return <main><p>Loading your dashboard...</p></main>;

  return <main><h1>Participant dashboard</h1><p>Welcome, {person.full_name}.</p><p>Credit balance: {person.credits}</p></main>;
}
