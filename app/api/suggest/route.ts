import { NextRequest, NextResponse } from 'next/server';
import { readQueue, ContentPillar } from '@/lib/queue';
import { suggestScheduleTimes } from '@/lib/scheduler';

export async function GET(req: NextRequest) {
  const pillar = req.nextUrl.searchParams.get('pillar') as ContentPillar | null;
  if (!pillar) return NextResponse.json({ error: 'pillar is required' }, { status: 400 });

  const posts = await readQueue();
  const suggestions = suggestScheduleTimes(pillar, posts);
  return NextResponse.json(suggestions.map(d => d.toISOString()));
}
