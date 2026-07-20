import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { checkAuth, TAKES_ROOT, validateSlug } from '@/lib/editor/paths';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const { slug } = await params;
  if (!validateSlug(slug)) {
    return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  }

  const file = path.join(TAKES_ROOT, slug, 'thumb.jpg');
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(file);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
