import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Tradeflow',
    template: '%s · Tradeflow',
  },
  description: 'Customers, quotes, jobs, scheduling and invoicing for trade businesses.',
};

/**
 * The root layout is the document and nothing else.
 *
 * The application chrome lives in the `(app)` group's layout so that the
 * customer's quote page at `/q/[token]` — which must render without a session
 * and in a light, printable palette — does not inherit a dark sidebar it has no
 * use for.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="antialiased">{children}</body>
    </html>
  );
}
