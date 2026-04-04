import { NextResponse } from 'next/server';
import { readQueue } from '@/lib/queue';

export async function GET() {
  try {
    const posts = await readQueue();
    return NextResponse.json(posts);
  } catch (err) {
    return NextResponse.json({ error: 'Failed to read queue' }, { status: 500 });
  }
}
