// One-off: generate PWA / home-screen icons from the Threshold crossing mark
// on an obsidian background. Run: node scripts/gen-pwa-icons.mjs
// Safe to delete after the PNGs land in public/.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const OBSIDIAN = '#0D0D18';
// The crossing mark only (third <g> in public/logo-dark.svg), white fill.
const MARK_VIEWBOX = '826 460 848 295';
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z';

function html(size, markPct) {
  const markW = Math.round(size * markPct);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .icon{width:${size}px;height:${size}px;background:${OBSIDIAN};display:flex;align-items:center;justify-content:center}
    svg{width:${markW}px;height:auto;display:block}
  </style></head><body>
    <div class="icon"><svg viewBox="${MARK_VIEWBOX}" xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="${MARK_PATH}"/></svg></div>
  </body></html>`;
}

const ICONS = [
  { file: 'apple-icon.png', size: 180, pct: 0.70 },
  { file: 'icon-192.png', size: 192, pct: 0.70 },
  { file: 'icon-512.png', size: 512, pct: 0.70 },
  // Maskable: keep the mark well inside the ~80% safe zone (platforms crop).
  { file: 'icon-512-maskable.png', size: 512, pct: 0.52 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, pct } of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, pct), { waitUntil: 'load' });
  const el = await page.$('.icon');
  await el.screenshot({ path: path.join(PUBLIC, file), omitBackground: false });
  console.log('wrote', file, `${size}x${size}`);
}
await browser.close();
