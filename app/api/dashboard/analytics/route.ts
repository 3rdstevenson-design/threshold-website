import { NextRequest, NextResponse } from 'next/server';
import { extractPatterns } from '@/lib/viralPatternsService';

export async function GET(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '90', 10) || 90, 1), 365);
  const patterns = await extractPatterns(days);
  return NextResponse.json(patterns);
}

export async function POST(req: NextRequest) {
  const pwd = req.headers.get('x-dashboard-key');
  if (!process.env.DASHBOARD_PASSWORD || pwd !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { runPerformanceSync } = await import('@/lib/performanceSync');
  try {
    const result = await runPerformanceSync();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
