import { NextRequest, NextResponse } from 'next/server';
import { runPerformanceSync } from '@/lib/performanceSync';

async function handle(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runPerformanceSync();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to fetch media list: ${err.message}` },
      { status: 500 },
    );
  }
}

// Vercel cron invocations arrive as GET (with the CRON_SECRET bearer);
// POST kept for manual/scripted triggering.
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
