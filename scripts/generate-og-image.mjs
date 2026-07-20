// One-off: generate the 1200x630 Open Graph / Twitter share card on an
// obsidian background, on-brand for Threshold Health & Performance.
// Run: node scripts/generate-og-image.mjs
// Writes public/og-default.png. Safe to delete after the PNG lands in public/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const W = 1200;
const H = 630;

// The crossing mark only (third <g> in public/logo-dark.svg), white fill.
// Viewbox reused from gen-pwa-icons.mjs (already tightly cropped to the mark).
const MARK_VIEWBOX = '826 460 848 295';
const MARK_PATH =
  'M1674.35,464.18s-86.86-2.87-176.53,29.02c-44.21,15.72-129.8,51.59-240.99,129.98,0,0,77.76,68.47,187.49,96.12,0,0-93.91-19.04-194.32-90.68-100.41,71.64-194.32,90.68-194.32,90.68,109.73-27.66,187.49-96.12,187.49-96.12-111.19-78.39-196.79-114.26-240.99-129.98-89.68-31.89-176.53-29.02-176.53-29.02,0,0,62.16-1.99,150,31.13,135.87,51.24,231.21,131.61,231.21,131.61-152.65,109.2-358.85,123.04-368.63,123.64,132.46-7.72,210.87-23.73,283.35-46.38,72.55-22.67,128.42-51.54,128.42-51.54,0,0,55.87,28.87,128.42,51.54,72.48,22.65,150.89,38.66,283.35,46.38-9.78-.6-215.98-14.44-368.63-123.64,0,0,95.34-80.37,231.21-131.61,87.84-33.12,150-31.13,150-31.13Z';

// Brand fonts live in the threshold-design-system repo. List candidates so the
// script keeps working if those assets move.
const FONT_DIRS = [
  '/Users/larsstevenson/Code/Development/threshold-design-system/uploads',
  '/Users/larsstevenson/Code/Development/threshold-design-system/fonts',
];

function findFont(file) {
  for (const dir of FONT_DIRS) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Font not found in any FONT_DIRS: ${file}`);
}

function dataUri(file) {
  const b64 = fs.readFileSync(findFont(file)).toString('base64');
  return `data:font/ttf;base64,${b64}`;
}

const FONTS = {
  cormorantLight: dataUri('CormorantGaramond-Light.ttf'),
  cormorantItalic: dataUri('CormorantGaramond-Italic.ttf'),
  montserratMedium: dataUri('Montserrat-Medium.ttf'),
};

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Cormorant Garamond';
    font-weight: 300; font-style: normal;
    src: url('${FONTS.cormorantLight}') format('truetype');
  }
  @font-face {
    font-family: 'Cormorant Garamond';
    font-weight: 400; font-style: italic;
    src: url('${FONTS.cormorantItalic}') format('truetype');
  }
  @font-face {
    font-family: 'Montserrat';
    font-weight: 500; font-style: normal;
    src: url('${FONTS.montserratMedium}') format('truetype');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; }
  .card {
    width: ${W}px; height: ${H}px; position: relative; overflow: hidden;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background:
      radial-gradient(110% 95% at 50% 26%, rgba(112,2,171,0.20), rgba(112,2,171,0) 52%),
      radial-gradient(70% 90% at 100% 108%, rgba(155,48,217,0.22), rgba(112,2,171,0) 58%),
      linear-gradient(135deg, #0D0D18 0%, #14142A 52%, #1A1A2E 100%);
  }
  /* thin inset frame for a premium 'card' feel */
  .frame {
    position: absolute; inset: 30px;
    border: 1px solid rgba(192,192,192,0.10);
  }
  .mark {
    width: 232px; height: auto; display: block;
    filter: drop-shadow(0 0 26px rgba(112,2,171,0.55));
  }
  .wordmark {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 300; font-style: normal;
    font-size: 88px; line-height: 1;
    color: #F5F5F5;
    letter-spacing: 0.16em; padding-left: 0.16em; /* offset trailing tracking */
    margin-top: 36px;
  }
  .descriptor {
    font-family: 'Montserrat', sans-serif;
    font-weight: 500; font-size: 19px;
    color: #C9A84C; /* champion gold — single sparing use, echoes the logo */
    text-transform: uppercase;
    letter-spacing: 0.46em; padding-left: 0.46em;
    margin-top: 18px;
  }
  .divider {
    width: 64px; height: 2px; border-radius: 1px;
    margin: 30px 0;
    background: linear-gradient(90deg, #7002AB, #9B30D9);
    box-shadow: 0 0 14px rgba(112,2,171,0.6);
  }
  .tagline {
    font-family: 'Cormorant Garamond', serif;
    font-weight: 400; font-style: italic;
    font-size: 37px; line-height: 1.15;
    color: #E6E6EE;
  }
  .location {
    font-family: 'Montserrat', sans-serif;
    font-weight: 500; font-size: 14px;
    color: #8A8A9A;
    text-transform: uppercase;
    letter-spacing: 0.42em; padding-left: 0.42em;
    margin-top: 42px;
  }
</style></head>
<body>
  <div class="card">
    <div class="frame"></div>
    <svg class="mark" viewBox="${MARK_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
      <path fill="#F5F5F5" d="${MARK_PATH}"/>
    </svg>
    <div class="wordmark">THRESHOLD</div>
    <div class="descriptor">Health &amp; Performance</div>
    <div class="divider"></div>
    <div class="tagline">It's time to cross your threshold.</div>
    <div class="location">Reston, Virginia</div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const el = await page.$('.card');
await el.screenshot({ path: path.join(PUBLIC, 'og-default.png'), omitBackground: false });
await browser.close();
console.log(`wrote og-default.png (${W}x${H})`);
