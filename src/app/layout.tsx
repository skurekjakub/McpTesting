import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'MCP Bot',
  description: 'Model Context Protocol Bot',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header style={{ 
          padding: '12px 20px', 
          background: '#1a1a1a', 
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center' 
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>MCP Bot</h1>
          </div>
          <nav>
            <ul style={{ 
              display: 'flex', 
              gap: '20px',
              listStyle: 'none',
              margin: 0,
              padding: 0
            }}>
              <li>
                <Link href="/" style={{ color: 'white', textDecoration: 'none' }}>
                  Chat
                </Link>
              </li>
              <li>
                <Link href="/logs" style={{ color: 'white', textDecoration: 'none' }}>
                  Logs
                </Link>
              </li>
            </ul>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
