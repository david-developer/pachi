import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './premium.css';

const heading = localFont({ src: './fonts/manrope.ttf', variable: '--font-heading', display: 'swap', weight: '200 800' });
const body = localFont({ src: './fonts/dmsans.ttf', variable: '--font-body', display: 'swap', weight: '100 1000' });

export const metadata: Metadata = {
  title: 'Pachi — Find your place in Cameroon',
  description: 'Discover homes, land and commercial spaces for rent, sale and short stays in Southwest and Littoral, Cameroon.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${heading.variable} ${body.variable}`}><body>{children}</body></html>;
}
