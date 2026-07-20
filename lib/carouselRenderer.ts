import { Slide, SlidePlan } from './carouselDrafts';
import { SITE_TAGLINE } from './site';

// TS port of slide-templates.sh. Dashboard preview can optionally place
// generated design-layer art behind the existing HTML typography.

export interface RenderPreviewOptions {
  visualBackgrounds?: Record<number, string>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function progressBar(idx: number, total: number, dark: boolean): string {
  const pct = Math.round(((idx + 1) / total) * 100);
  const track = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const fill = dark ? '#fff' : '#7002AB';
  const counter = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)';
  return `<div style="position:absolute;bottom:0;left:0;right:0;padding:16px 28px 20px;display:flex;align-items:center;gap:12px;z-index:20;">
    <div style="flex:1;height:3px;border-radius:2px;background:${track};">
      <div style="width:${pct}%;height:100%;border-radius:2px;background:${fill};"></div>
    </div>
    <span style="font-family:'Montserrat',system-ui,sans-serif;font-size:11px;font-weight:500;color:${counter};white-space:nowrap;">${idx + 1}/${total}</span>
  </div>`;
}

function swipeArrow(idx: number, total: number, dark: boolean): string {
  if (idx >= total - 1) return '';
  const bg = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const stroke = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
  const grad = dark
    ? 'linear-gradient(to right, transparent, rgba(255,255,255,0.04))'
    : 'linear-gradient(to right, transparent, rgba(0,0,0,0.03))';
  void bg;
  return `<div style="position:absolute;top:0;right:0;bottom:0;width:48px;background:${grad};display:flex;align-items:center;justify-content:center;z-index:20;">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>`;
}

function tagLabel(text: string, mode: 'light' | 'dark' | 'gradient'): string {
  const color = mode === 'dark' ? '#9B30D9' : mode === 'gradient' ? 'rgba(255,255,255,0.6)' : '#7002AB';
  return `<span style="font-family:'Montserrat',system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${color};margin-bottom:16px;display:block;">${esc(text)}</span>`;
}

function cssUrl(url: string): string {
  return esc(url).replace(/'/g, "\\'");
}

function bgLayer(mode: 'light' | 'dark' | 'gradient' = 'gradient', imageUrl?: string): string {
  if (imageUrl) {
    const overlay =
      mode === 'light'
        ? 'rgba(245,245,245,0.72)'
        : mode === 'dark'
          ? 'rgba(13,13,24,0.58)'
          : 'linear-gradient(165deg,rgba(13,13,24,0.62) 0%,rgba(112,2,171,0.46) 52%,rgba(13,13,24,0.68) 100%)';

    return `<div style="position:absolute;inset:0;z-index:0;background-image:url('${cssUrl(imageUrl)}');background-size:cover;background-position:center;"></div>
    <div style="position:absolute;inset:0;z-index:1;background:${overlay};"></div>`;
  }

  if (mode === 'dark') {
    return `<div style="position:absolute;inset:0;z-index:0;background:#0D0D18;"></div>`;
  }
  if (mode === 'light') {
    return `<div style="position:absolute;inset:0;z-index:0;background:#F5F5F5;"></div>`;
  }
  return `<div style="position:absolute;inset:0;z-index:0;background:linear-gradient(135deg,#0D0D18 0%,#1A1A2E 50%,#7002AB 100%);"></div>`;
}

function slideNumberWatermark(idx: number, _dark?: boolean): string {
  const n = String(idx).padStart(2, '0');
  return `<div style="position:absolute;top:44px;right:56px;z-index:5;font-family:'Cormorant Garamond',Georgia,serif;font-size:200px;font-weight:700;line-height:1;color:rgba(155,48,217,0.16);letter-spacing:-6px;pointer-events:none;">${n}</div>`;
}

function goldDivider(): string {
  return `<div style="width:48px;height:2px;background:#C9A84C;margin:18px 0;border-radius:2px;"></div>`;
}

function renderHero(s: Slide, total: number, bgUrl?: string): string {
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#C0C0C0;margin-bottom:28px;">${esc(s.tag)}</span>
    <h1 class="serif" style="font-size:72px;font-weight:700;color:#F5F5F5;letter-spacing:-1.4px;line-height:0.98;margin-bottom:32px;max-width:920px;">${esc(s.headline)}</h1>
    <div style="width:72px;height:3px;background:#C9A84C;margin-bottom:28px;"></div>
    <p class="sans" style="font-size:22px;font-weight:400;color:#D0D0D8;line-height:1.45;max-width:820px;">${esc(s.body ?? '')}</p>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderProblem(s: Slide, total: number, bgUrl?: string): string {
  const pills = (s.pills ?? [])
    .map(
      (p) =>
        `<span style="font-size:13px;padding:7px 14px;border:1px solid rgba(155,48,217,0.4);border-radius:20px;color:rgba(255,255,255,0.55);text-decoration:line-through;font-family:'Montserrat',system-ui,sans-serif;background:rgba(112,2,171,0.12);">${esc(p)}</span>`
    )
    .join('');
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#9B30D9;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:58px;font-weight:600;color:#F5F5F5;letter-spacing:-1px;line-height:1.0;margin-bottom:28px;max-width:900px;">${esc(s.headline)}</h2>
    <div style="width:56px;height:2px;background:#C9A84C;margin-bottom:24px;"></div>
    <p class="sans" style="font-size:19px;color:#D0D0D8;line-height:1.5;max-width:780px;margin-bottom:32px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">${pills}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderSolution(s: Slide, total: number, bgUrl?: string): string {
  const quote =
    s.quoteText
      ? `<div style="padding:22px 24px;background:rgba(13,13,24,0.55);border-radius:14px;border:1px solid rgba(201,168,76,0.3);">
          <p class="sans" style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C9A84C;margin-bottom:10px;">${esc(s.quoteLabel ?? '')}</p>
          <p class="serif" style="font-size:19px;color:#F5F5F5;font-style:italic;line-height:1.4;">&ldquo;${esc(s.quoteText)}&rdquo;</p>
        </div>`
      : '';
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#9B30D9;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:58px;font-weight:600;color:#F5F5F5;letter-spacing:-1px;line-height:1.0;margin-bottom:28px;max-width:900px;">${esc(s.headline)}</h2>
    <div style="width:56px;height:2px;background:#C9A84C;margin-bottom:24px;"></div>
    <p class="sans" style="font-size:19px;color:#D0D0D8;line-height:1.5;max-width:780px;margin-bottom:28px;">${esc(s.body ?? '')}</p>
    ${quote}
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderFeatures(s: Slide, total: number, bgUrl?: string): string {
  const rows = (s.features ?? [])
    .map(
      (f) =>
        `<div style="display:flex;align-items:flex-start;gap:18px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="color:#9B30D9;font-size:20px;width:26px;text-align:center;flex-shrink:0;line-height:1.4;">${esc(f.icon)}</span>
          <div>
            <div class="sans" style="font-size:18px;font-weight:600;color:#F5F5F5;line-height:1.3;margin-bottom:4px;">${esc(f.label)}</div>
            <div class="sans" style="font-size:15px;color:#C0C0C0;line-height:1.5;">${esc(f.desc)}</div>
          </div>
        </div>`
    )
    .join('');
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#9B30D9;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:54px;font-weight:600;color:#F5F5F5;letter-spacing:-0.9px;line-height:1.02;margin-bottom:24px;max-width:880px;">${esc(s.headline)}</h2>
    <div style="width:56px;height:2px;background:#C9A84C;margin-bottom:24px;"></div>
    <div>${rows}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderDetails(s: Slide, total: number, bgUrl?: string): string {
  const pills = (s.pills ?? [])
    .map(
      (p) =>
        `<span style="font-size:13px;padding:7px 14px;background:rgba(155,48,217,0.15);border:1px solid rgba(155,48,217,0.35);border-radius:20px;color:#fff;font-family:'Montserrat',system-ui,sans-serif;">${esc(p)}</span>`
    )
    .join('');
  const gold = s.goldAccent
    ? `<p class="sans" style="font-size:15px;font-weight:600;color:#C9A84C;margin-top:24px;letter-spacing:0.5px;">${esc(s.goldAccent)}</p>`
    : '';
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#9B30D9;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:54px;font-weight:600;color:#F5F5F5;letter-spacing:-0.9px;line-height:1.02;margin-bottom:24px;max-width:880px;">${esc(s.headline)}</h2>
    <div style="width:56px;height:2px;background:#C9A84C;margin-bottom:24px;"></div>
    <p class="sans" style="font-size:19px;color:#D0D0D8;line-height:1.5;max-width:780px;margin-bottom:28px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">${pills}</div>
    ${gold}
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderHowto(s: Slide, total: number, bgUrl?: string): string {
  const steps = (s.steps ?? [])
    .map(
      (step) =>
        `<div style="display:flex;align-items:flex-start;gap:20px;padding:18px 0;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span class="serif" style="font-size:36px;font-weight:300;color:#C9A84C;min-width:44px;line-height:1;flex-shrink:0;">${esc(step.number)}</span>
          <div>
            <div class="sans" style="font-size:18px;font-weight:600;color:#F5F5F5;line-height:1.3;margin-bottom:4px;">${esc(step.title)}</div>
            <div class="sans" style="font-size:15px;color:#C0C0C0;line-height:1.5;">${esc(step.desc)}</div>
          </div>
        </div>`
    )
    .join('');
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#9B30D9;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:54px;font-weight:600;color:#F5F5F5;letter-spacing:-0.9px;line-height:1.02;margin-bottom:24px;max-width:880px;">${esc(s.headline)}</h2>
    <div style="width:56px;height:2px;background:#C9A84C;margin-bottom:20px;"></div>
    <div>${steps}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderCta(s: Slide, total: number, bgUrl?: string): string {
  const tagline = s.tagline ?? SITE_TAGLINE;
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:flex-end;padding:0 56px 120px;">
    <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#C9A84C;margin-bottom:24px;">${esc(s.tag)}</span>
    <h2 class="serif" style="font-size:58px;font-weight:600;color:#F5F5F5;letter-spacing:-1px;line-height:1.0;margin-bottom:24px;font-style:italic;max-width:900px;">${esc(tagline)}</h2>
    <div style="width:72px;height:3px;background:#C9A84C;margin-bottom:28px;"></div>
    <p class="sans" style="font-size:19px;color:#D0D0D8;line-height:1.5;margin-bottom:40px;max-width:740px;">${esc(s.body ?? '')}</p>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:16px 36px;background:#C9A84C;color:#0D0D18;font-family:'Montserrat',system-ui,sans-serif;font-weight:700;font-size:16px;border-radius:32px;align-self:flex-start;">${esc(s.ctaText ?? 'Book a free call')}</div>
  </div>
  ${progressBar(s.idx, total, true)}`;
}

function renderTimeline(s: Slide, total: number, bgUrl?: string): string {
  const steps = s.timelineSteps ?? [];
  const count = Math.max(steps.length, 1);
  const dotColor = (tone?: string) => {
    if (tone === 'purple') return '#9B30D9';
    if (tone === 'gold') return '#C9A84C';
    return '#8A8A9A';
  };
  const labelColor = (tone?: string) => {
    if (tone === 'purple') return '#9B30D9';
    if (tone === 'gold') return '#C9A84C';
    return 'rgba(255,255,255,0.55)';
  };
  const dots = steps
    .map(
      (step) => `<div style="display:flex;flex-direction:column;align-items:center;gap:14px;flex:1;min-width:0;">
        <div style="width:20px;height:20px;border-radius:50%;background:${dotColor(step.tone)};box-shadow:0 0 0 4px rgba(255,255,255,0.04);"></div>
        <span style="font-family:'Montserrat',system-ui,sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${labelColor(step.tone)};text-align:center;line-height:1.3;">${esc(step.label)}</span>
      </div>`
    )
    .join('<div style="flex:0 0 auto;height:2px;background:rgba(255,255,255,0.12);align-self:center;margin:0 -8px 28px -8px;flex:1;"></div>');
  void count;
  return `${bgLayer('dark', bgUrl)}
  ${slideNumberWatermark(s.idx, true)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:center;padding:0 36px 72px;">
    ${tagLabel(s.tag, 'dark')}
    <h2 class="serif" style="font-size:46px;font-weight:600;color:#fff;letter-spacing:-0.6px;line-height:1.05;margin-bottom:0;">${esc(s.headline)}</h2>
    ${goldDivider()}
    <p class="sans" style="font-size:15px;color:rgba(255,255,255,0.65);line-height:1.5;margin-bottom:48px;max-width:620px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;position:relative;">
      <div style="position:absolute;left:10px;right:10px;top:9px;height:2px;background:rgba(255,255,255,0.12);z-index:0;"></div>
      <div style="display:flex;justify-content:space-between;width:100%;position:relative;z-index:1;">${dots}</div>
    </div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderComparison(s: Slide, total: number, bgUrl?: string): string {
  const left = s.comparisonLeft;
  const right = s.comparisonRight;
  const column = (c: typeof left, accent: boolean) => {
    if (!c) return '';
    const head = accent ? '#C9A84C' : 'rgba(255,255,255,0.45)';
    const itemColor = accent ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    const border = accent ? '1px solid rgba(201,168,76,0.4)' : '1px solid rgba(255,255,255,0.08)';
    const items = c.items.map((it) => `<div class="sans" style="font-size:15px;color:${itemColor};line-height:1.6;">${esc(it)}</div>`).join('');
    return `<div style="flex:1;padding:24px 22px;border-radius:14px;border:${border};background:rgba(255,255,255,0.02);">
      <div class="sans" style="font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:${head};text-align:center;margin-bottom:18px;">${esc(c.heading)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;text-align:center;">${items}</div>
    </div>`;
  };
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx, true)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:center;padding:0 36px 72px;">
    ${tagLabel(s.tag, 'gradient')}
    <h2 class="serif" style="font-size:42px;font-weight:600;color:#fff;letter-spacing:-0.5px;line-height:1.05;margin-bottom:0;">${esc(s.headline)}</h2>
    ${goldDivider()}
    <p class="sans" style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;margin-bottom:32px;max-width:620px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;gap:18px;">${column(left, false)}${column(right, true)}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderDialogue(s: Slide, total: number, bgUrl?: string): string {
  const card = (c?: DialogueCardLike) => {
    if (!c) return '';
    return `<div style="flex:1;padding:28px 22px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.03);display:flex;flex-direction:column;gap:14px;">
      <div class="sans" style="font-size:10px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#9B30D9;text-align:center;">${esc(c.label)}</div>
      <div class="serif" style="font-size:17px;font-style:italic;color:rgba(255,255,255,0.85);text-align:center;line-height:1.4;">&ldquo;${esc(c.quote)}&rdquo;</div>
    </div>`;
  };
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx, true)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:center;padding:0 36px 72px;">
    ${tagLabel(s.tag, 'gradient')}
    <h2 class="serif" style="font-size:42px;font-weight:600;color:#fff;letter-spacing:-0.5px;line-height:1.05;margin-bottom:0;">${esc(s.headline)}</h2>
    ${goldDivider()}
    <p class="sans" style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;margin-bottom:36px;max-width:620px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;gap:18px;">${card(s.dialogueLeft)}${card(s.dialogueRight)}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

function renderDiagram(s: Slide, total: number, bgUrl?: string): string {
  const boxes = s.diagramBoxes ?? [];
  const connector = s.diagramConnector ?? '?';
  const boxStyle = (tone: string) => {
    if (tone === 'accent') return 'background:rgba(112,2,171,0.55);border:1px solid rgba(155,48,217,0.8);color:#fff;';
    if (tone === 'dashed') return 'background:transparent;border:2px dashed rgba(201,168,76,0.6);color:#C9A84C;';
    return 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.18);color:rgba(255,255,255,0.85);';
  };
  const els: string[] = [];
  boxes.forEach((b, i) => {
    els.push(
      `<div style="flex:1;min-height:120px;border-radius:14px;display:flex;align-items:center;justify-content:center;padding:16px;${boxStyle(b.tone)}">
        <span class="sans" style="font-size:13px;font-weight:600;letter-spacing:3px;text-transform:uppercase;text-align:center;line-height:1.4;">${esc(b.label)}</span>
      </div>`
    );
    if (i < boxes.length - 1) {
      els.push(
        `<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;padding:0 6px;">
          <span class="serif" style="font-size:32px;color:#C9A84C;font-weight:600;">${esc(connector)}</span>
        </div>`
      );
    }
  });
  return `${bgLayer('gradient', bgUrl)}
  ${slideNumberWatermark(s.idx, true)}
  <div style="position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;justify-content:center;padding:0 36px 72px;">
    ${tagLabel(s.tag, 'gradient')}
    <h2 class="serif" style="font-size:42px;font-weight:600;color:#fff;letter-spacing:-0.5px;line-height:1.05;margin-bottom:0;">${esc(s.headline)}</h2>
    ${goldDivider()}
    <p class="sans" style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.5;margin-bottom:40px;max-width:620px;">${esc(s.body ?? '')}</p>
    <div style="display:flex;align-items:stretch;gap:4px;">${els.join('')}</div>
  </div>
  ${progressBar(s.idx, total, true)}
  ${swipeArrow(s.idx, total, true)}`;
}

type DialogueCardLike = { label: string; quote: string };

function renderSlide(s: Slide, total: number, visualBackgrounds: Record<number, string> = {}): string {
  const bgUrl = visualBackgrounds[s.idx];
  switch (s.type) {
    case 'hero':
      return renderHero(s, total, bgUrl);
    case 'problem':
      return renderProblem(s, total, bgUrl);
    case 'solution':
      return renderSolution(s, total, bgUrl);
    case 'features':
      return renderFeatures(s, total, bgUrl);
    case 'details':
      return renderDetails(s, total, bgUrl);
    case 'howto':
      return renderHowto(s, total, bgUrl);
    case 'cta':
      return renderCta(s, total, bgUrl);
    case 'timeline':
      return renderTimeline(s, total, bgUrl);
    case 'comparison':
      return renderComparison(s, total, bgUrl);
    case 'dialogue':
      return renderDialogue(s, total, bgUrl);
    case 'diagram':
      return renderDiagram(s, total, bgUrl);
    default:
      return `<div>Unknown slide type: ${esc(s.type)}</div>`;
  }
}

/**
 * Single-slide Instagram-style viewer. One slide fills the iframe at a time,
 * scaled to fit. Left/right arrows, keyboard arrows, and horizontal trackpad
 * swipe navigate. Clicking the slide postMessages the dashboard to open the
 * per-slide editor. ?slide=N query param deep-links to a starting index.
 */
export function renderPreviewHtml(plan: SlidePlan, options: RenderPreviewOptions = {}): string {
  const total = plan.slides.length;
  const visualBackgrounds = options.visualBackgrounds ?? {};
  const slotsHtml = plan.slides
    .map(
      (s) => `<section class="slot" data-slide-idx="${s.idx}">
        <div class="slide">${renderSlide(s, total, visualBackgrounds)}</div>
      </section>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(plan.meta.topic)} — draft ${esc(plan.meta.id)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;background:#0D0D18;overflow:hidden;}
body{font-family:'Montserrat',system-ui,sans-serif;-webkit-font-smoothing:antialiased;}
.serif{font-family:'Cormorant Garamond',Georgia,serif;}
.sans{font-family:'Montserrat',system-ui,sans-serif;}
.viewer{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}
.stage{position:relative;width:100%;height:100%;overflow:hidden;}
.track{display:flex;width:100%;height:100%;transition:transform 0.3s ease;}
.slot{flex:0 0 100%;height:100%;display:flex;align-items:center;justify-content:center;padding:8px 56px;}
.slide{position:relative;width:1080px;height:1350px;flex-shrink:0;overflow:hidden;transform-origin:center center;transform:scale(var(--fit, 1));box-shadow:0 8px 24px rgba(0,0,0,0.4);cursor:pointer;}
.slide:hover{outline:2px solid rgba(201,168,76,0.6);outline-offset:-2px;}
.nav{position:absolute;top:50%;transform:translateY(-50%);z-index:10;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.15);font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;padding:0;line-height:1;}
.nav:hover:not([disabled]){background:rgba(255,255,255,0.15);}
.nav[disabled]{opacity:0.25;cursor:default;}
.nav.prev{left:12px;}
.nav.next{right:12px;}
.counter{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#C0C0C0;font-family:'Montserrat',system-ui,sans-serif;font-size:12px;letter-spacing:2px;background:rgba(0,0,0,0.4);padding:5px 12px;border-radius:14px;z-index:10;}
</style>
</head>
<body>
<div class="viewer">
  <button class="nav prev" aria-label="previous slide">&lsaquo;</button>
  <div class="stage">
    <div class="track" id="track">
${slotsHtml}
    </div>
  </div>
  <button class="nav next" aria-label="next slide">&rsaquo;</button>
  <div class="counter" id="counter">1 / ${total}</div>
</div>
<script>
(function(){
  var total = ${total};
  var draftId = ${JSON.stringify(plan.meta.id)};
  var params = new URLSearchParams(location.search);
  var urlIdx = parseInt(params.get('slide') || '0', 10);
  if (isNaN(urlIdx)) urlIdx = 0;
  var idx = Math.max(0, Math.min(total - 1, urlIdx));

  var track = document.getElementById('track');
  var counter = document.getElementById('counter');
  var prev = document.querySelector('.nav.prev');
  var next = document.querySelector('.nav.next');

  function fit(){
    var scale = Math.min((window.innerHeight - 40) / 1350, (window.innerWidth - 120) / 1080);
    if (scale <= 0 || !isFinite(scale)) scale = 1;
    document.documentElement.style.setProperty('--fit', String(scale));
  }

  function render(){
    track.style.transform = 'translateX(' + (-idx * 100) + '%)';
    counter.textContent = (idx + 1) + ' / ' + total;
    prev.disabled = idx === 0;
    next.disabled = idx === total - 1;
  }

  function go(delta){
    var nextIdx = Math.max(0, Math.min(total - 1, idx + delta));
    if (nextIdx === idx) return;
    idx = nextIdx;
    render();
  }

  prev.addEventListener('click', function(e){ e.stopPropagation(); go(-1); });
  next.addEventListener('click', function(e){ e.stopPropagation(); go(1); });

  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  });

  var swipeLock = false;
  window.addEventListener('wheel', function(e){
    if (Math.abs(e.deltaX) < 40 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    if (swipeLock) return;
    swipeLock = true;
    setTimeout(function(){ swipeLock = false; }, 400);
    go(e.deltaX > 0 ? 1 : -1);
  }, { passive: true });

  document.querySelectorAll('.slot').forEach(function(slot){
    var slideEl = slot.querySelector('.slide');
    if (!slideEl) return;
    slideEl.addEventListener('click', function(){
      var slideIdx = parseInt(slot.getAttribute('data-slide-idx'), 10);
      if (window.parent) {
        window.parent.postMessage({ type: 'carousel-slide-click', draftId: draftId, slideIdx: slideIdx }, '*');
      }
    });
  });

  window.addEventListener('resize', fit);
  fit();
  render();
})();
</script>
</body>
</html>`;
}
