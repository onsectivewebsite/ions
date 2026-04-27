import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider, type Branding } from '@onsecboad/ui';
import '@onsecboad/ui/styles.css';
import './globals.css';

export const metadata = {
  title: 'OnsecBoad — AI Immigration Office Management',
  description:
    'OnsecBoad is the AI-powered case management, CRM, and client-portal platform for Canadian immigration law firms. Built and sold by Onsective Inc.',
};

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

const DEFAULT_BRANDING: Branding = { themeCode: 'maple' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <ThemeProvider branding={DEFAULT_BRANDING}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
