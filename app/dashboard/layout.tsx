'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const TABS = [
  { label: 'Pipeline', href: '/dashboard/pipeline', match: '/dashboard/pipeline' },
  { label: 'Queue', href: '/dashboard/queue', match: '/dashboard/queue' },
  { label: 'Carousels', href: '/dashboard/carousels', match: '/dashboard/carousels' },
  { label: 'Editor', href: '/dashboard/editor', match: '/dashboard/editor' },
  { label: 'Analytics', href: '/dashboard/analytics', match: '/dashboard/analytics' },
];

const SESSION_KEY = 'dashboard_authed';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const isLogin = pathname === '/dashboard';

  function signOut() {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY);
      router.replace('/dashboard');
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: isLogin ? 'var(--spotlight-hero)' : 'var(--spotlight-dashboard)',
        color: 'var(--fg-primary)',
      }}
    >
      {!isLogin && <DashboardNav pathname={pathname} onSignOut={signOut} />}
      <div style={{ paddingTop: isLogin ? 0 : 60 }}>{children}</div>
    </div>
  );
}

function DashboardNav({ pathname, onSignOut }: { pathname: string; onSignOut: () => void }) {
  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 60,
        background: 'rgba(13, 13, 24, 0.95)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 28px',
        gap: 28,
        zIndex: 50,
      }}
    >
      <Link
        href="/dashboard/queue"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textDecoration: 'none',
          color: 'var(--clinical-white)',
        }}
      >
        <svg
          viewBox="826 460 848 295"
          fill="currentColor"
          aria-hidden="true"
          style={{ height: 22, width: 32 }}
        >
          <path d="M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            color: 'var(--clinical-white)',
          }}
        >
          Threshold
        </span>
      </Link>

      <div style={{ flex: 1, display: 'flex', gap: 6, marginLeft: 16 }}>
        {TABS.map((tab) => {
          const active = pathname === tab.match || pathname.startsWith(tab.match + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                height: 60,
                padding: '0 14px',
                fontFamily: 'var(--font-ui)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.20em',
                textTransform: 'uppercase',
                color: active ? 'var(--clinical-white)' : 'var(--sterling-silver)',
                textDecoration: 'none',
                transition: 'color .2s ease',
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--clinical-white)';
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.color = 'var(--sterling-silver)';
              }}
            >
              {tab.label}
              {active && (
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    right: 14,
                    bottom: 0,
                    height: 1,
                    background: 'var(--threshold-purple)',
                    boxShadow: '0 0 8px rgba(112, 2, 171, 0.65)',
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>

      <button
        onClick={onSignOut}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--fg-muted)',
          background: 'transparent',
          border: 0,
          padding: '8px 4px',
          cursor: 'pointer',
          transition: 'color .2s ease',
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--clinical-white)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--fg-muted)')}
      >
        Sign out
      </button>
    </nav>
  );
}
