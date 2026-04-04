'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const SESSION_KEY = 'dashboard_authed';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default function DashboardPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

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
    const res = await fetch('/api/auth/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ expiry: Date.now() + SESSION_TTL }));
      router.replace('/dashboard/queue');
    } else {
      setError('Incorrect password.');
      setPassword('');
    }
  }

  if (checking) return null;

  return (
    <main className="min-h-screen flex items-center justify-center" style={{ background: '#0D0D18' }}>
      <div className="w-full max-w-sm px-8 py-10 rounded-2xl" style={{ background: '#1A1A2E' }}>
        <h1
          className="text-2xl font-bold mb-1 text-center"
          style={{ color: '#F5F5F5', fontFamily: 'var(--font-montserrat)' }}
        >
          Threshold Dashboard
        </h1>
        <p className="text-center mb-8 text-sm" style={{ color: '#C0C0C0' }}>
          Internal use only
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full px-4 py-3 rounded-lg text-sm outline-none"
            style={{
              background: '#0D0D18',
              color: '#F5F5F5',
              border: '1px solid #333',
            }}
          />
          {error && <p className="text-sm text-center" style={{ color: '#ef4444' }}>{error}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ background: '#7002AB', color: '#F5F5F5', fontFamily: 'var(--font-montserrat)' }}
          >
            Enter
          </button>
        </form>
      </div>
    </main>
  );
}
