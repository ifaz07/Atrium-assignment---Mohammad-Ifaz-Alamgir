'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Person = {
  full_name: string;
  kind: 'admin' | 'coach' | 'participant';
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/me`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((currentPerson) => {
        if (active) setPerson(currentPerson);
      })
      .catch(() => {
        if (active) setPerson(null);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => { active = false; };
  }, [pathname]);

  async function logout() {
    await fetch(`${apiBaseUrl}/api/logout`, { method: 'POST', credentials: 'include' });
    window.dispatchEvent(new Event('atrium-auth-change'));
    setPerson(null);
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="brand" href="/">Atrium</Link>
        <div className="nav-links">
          <Link href="/">Sessions & policies</Link>
          <Link href="/assistant">Assistant</Link>
          {person ? <Link href={`/${person.kind}`}>Dashboard</Link> : null}
          {person ? <Link href="/calendar">Calendar</Link> : null}
          {loaded && !person ? <Link href="/login">Log in</Link> : null}
          {person ? <button className="button-secondary button-small" type="button" onClick={logout}>Log out</button> : null}
        </div>
      </nav>
    </header>
  );
}
