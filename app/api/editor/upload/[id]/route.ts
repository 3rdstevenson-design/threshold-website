import { NextRequest, NextResponse } from 'next/server';
import { checkAuth, UPLOADS_ROOT } from '@/lib/editor/paths';
import { isValidUploadId, removeUpload } from '@/lib/editor/uploadParts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** DELETE /api/editor/upload/[id] — discard a partial upload. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;
  if (!isValidUploadId(params.id)) return NextResponse.json({ error: 'bad upload id' }, { status: 400 });
  removeUpload(UPLOADS_ROOT, params.id);
  return NextResponse.json({ ok: true });
}
