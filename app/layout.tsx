import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scum Master App',
  description: 'Local sprint capacity and development timeline planning',
  icons: { icon: '/scum-master-logo.png' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
