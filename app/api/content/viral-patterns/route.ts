import { NextRequest, NextResponse } from 'next/server';
import { extractPatterns } from '@/lib/viralPatternsService';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysParam = parseInt(searchParams.get('days') ?? '90', 10);
  const days = Math.min(Math.max(daysParam || 90, 1), 365);

  const patterns = await extractPatterns(days);
  return NextResponse.json(patterns);
}
