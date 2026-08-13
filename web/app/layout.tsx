import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navigation from './navigation';

export const metadata: Metadata = {
  title: 'Atrium Coaching Centre',
  description: 'Book coaching sessions and rooms at Atrium Coaching Centre.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Navigation />
        {children}
      </body>
    </html>
  );
}
