'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <section className="empty-state">
        <h1>Something went wrong</h1>
        <p>We could not load this page. Check that the API is running and try again.</p>
        <button type="button" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
