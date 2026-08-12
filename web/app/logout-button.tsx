'use client';

import { useRouter } from 'next/navigation';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch(`${apiBaseUrl}/api/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    router.push('/login');
  }

  return <button type="button" onClick={logout}>Log out</button>;
}
