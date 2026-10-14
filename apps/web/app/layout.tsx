import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pachi — Find your place in Cameroon',
  description: 'Discover homes, land and commercial spaces for rent, sale and short stays in Southwest and Littoral, Cameroon.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
