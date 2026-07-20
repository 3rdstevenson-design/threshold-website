import { NextResponse } from 'next/server';
import { listDrafts } from '@/lib/carouselDrafts';

export async function GET() {
  const drafts = listDrafts();
  return NextResponse.json({ drafts });
}
