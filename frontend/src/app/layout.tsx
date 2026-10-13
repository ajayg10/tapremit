import type { Metadata } from 'next';
import './globals.css';
import AdapterBadges from '@/components/AdapterBadges';

export const metadata: Metadata = {
  title: 'TapRemit · Trust-First Programmable Payments',
  description: 'Stablecoin remittance layer with AI proposal flow, deterministic policy engine, and human approval.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-gray-100 min-h-screen flex flex-col antialiased">
        <AdapterBadges />
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
