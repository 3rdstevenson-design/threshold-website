import fs from 'fs';
import os from 'os';
import path from 'path';

function rootFor(type: 'reel' | 'carousel'): { finalDir: string; rejectedDir: string } | null {
  const base = type === 'reel' ? 'Reels' : 'Carousels';
  const candidates = [
    path.join(os.homedir(), 'Code', 'Social Media', base),
    path.join(os.homedir(), 'Social Media', base),
  ];
  const parent = candidates.find(d => fs.existsSync(path.join(d, 'Final')));
  if (!parent) return null;
  return {
    finalDir: path.join(parent, 'Final'),
    rejectedDir: path.join(parent, 'Rejected'),
  };
}

export function moveToRejected(
  type: 'reel' | 'carousel' | 'image' | undefined,
  notes: string | undefined,
): { moved: boolean; from?: string; to?: string } {
  if (!notes) return { moved: false };
  if (type !== 'reel' && type !== 'carousel') return { moved: false };

  const dirs = rootFor(type);
  if (!dirs) return { moved: false };

  const src = path.join(dirs.finalDir, notes);
  if (!fs.existsSync(src)) return { moved: false };

  fs.mkdirSync(dirs.rejectedDir, { recursive: true });

  let dest = path.join(dirs.rejectedDir, notes);
  if (fs.existsSync(dest)) {
    const ext = path.extname(notes);
    const stem = ext ? notes.slice(0, -ext.length) : notes;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    dest = path.join(dirs.rejectedDir, `${stem}--${stamp}${ext}`);
  }

  fs.renameSync(src, dest);
  return { moved: true, from: src, to: dest };
}
