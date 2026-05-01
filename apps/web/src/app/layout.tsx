import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider, type Branding } from '@onsecboad/ui';
import { LocaleProvider } from '../i18n';
import '@onsecboad/ui/styles.css';
import './globals.css';

export const metadata = {
  title: 'OnsecBoad — AI Immigration Office Management',
  description:
    'OnsecBoad is the AI-powered case management, CRM, and client-portal platform for Canadian immigration law firms. Built and sold by Onsective Inc.',
  applicationName: 'OnsecBoad',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'OnsecBoad',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport = {
  themeColor: '#B5132B',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
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
        <LocaleProvider>
          <ThemeProvider branding={DEFAULT_BRANDING}>{children}</ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
