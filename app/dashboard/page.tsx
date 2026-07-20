'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, FieldLabel, Alert } from './_ui';

const SESSION_KEY = 'dashboard_authed';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default function DashboardPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      const { expiry } = JSON.parse(stored);
      if (Date.now() < expiry) {
        router.replace('/dashboard/queue');
        return;
      }
      localStorage.removeItem(SESSION_KEY);
    }
    setChecking(false);
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch('/api/auth/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ expiry: Date.now() + SESSION_TTL, password }));
      router.replace('/dashboard/queue');
    } else {
      setError('Incorrect password.');
      setPassword('');
      setSubmitting(false);
    }
  }

  if (checking) return null;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          padding: '40px 36px 36px',
          background: 'var(--bg-elevated)',
          borderTop: '2px solid var(--threshold-purple)',
          boxShadow: 'var(--glow-md)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: 'var(--threshold-purple)',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          Internal · Restricted
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            fontSize: 32,
            color: 'var(--clinical-white)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          Threshold Dashboard
        </h1>
        <p
          style={{
            textAlign: 'center',
            marginTop: 10,
            marginBottom: 28,
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            color: 'var(--fg-secondary)',
            lineHeight: 1.5,
          }}
        >
          Reston, Virginia · Internal use only
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              errored={!!error}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <Alert kind="error" title="Couldn't sign in">
              {error}
            </Alert>
          )}

          <Button type="submit" disabled={submitting || !password} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Signing in…' : 'Enter →'}
          </Button>
        </form>
      </div>
    </main>
  );
}
