# Threshold Dashboard

**Full context**: read `@../../Claude Second Brain/wiki/project-threshold-dashboard.md` first. For brand application, read `@../../Claude Second Brain/wiki/threshold-brand.md`.

This file provides guidance to Claude Code when working with code in this repository.

## Overview

This repository contains three things, all served from the same Next.js 14 app:

1. **Marketing website** for Threshold Health & Performance (`app/page.tsx`) — single-page, prerendered.
2. **Threshold Dashboard** — internal Instagram CMS at `app/dashboard/*`. Queue (`app/dashboard/queue/page.tsx`), carousels (`app/dashboard/carousels/page.tsx`), editor (`app/dashboard/editor/`), etc. The queue scans the local filesystem for finished reels and carousels via `app/api/local-scan/route.ts` (canonical paths: `~/Code/Social Media/Reels/Final/` and `~/Code/Social Media/Carousels/Final/`) and approves/publishes them through Meta's Instagram API.
3. **Brand identity asset library** (`Logos/`) — logos, social kit, stationery.

## Canonical export paths (do not change without updating the dashboard scanner)

- Reels: `~/Code/Social Media/Reels/Final/<slug>.mp4`
- Carousels: `~/Code/Social Media/Carousels/Final/<title>/slide-NN.png`

These are read by `app/api/local-scan/route.ts`. If you change them there, also update `~/Code/Social Media/my-video-projects/scripts/render-slides.ts` (reels) and `~/Code/Social Media/threshold-carousel/templates/export.js` (carousels).

## Commands

```bash
npm install       # install dependencies
npm run dev       # local dev server at localhost:3000
npm run build     # production build (run before deploying)
npm run lint      # ESLint
npm test          # vitest run
```

## Architecture notes

- **`app/layout.tsx`** — root layout; loads Cormorant Garamond, Montserrat, and Nunito Sans via `next/font/google`.
- **`app/page.tsx`** — marketing site (static, prerendered).
- **`app/dashboard/*`** — interactive CMS pages, all `'use client'`.
- **`app/api/*`** — server routes for queue, scanner, approve, Meta publish, etc.
- **`scripts/`** — long-running watcher (`watch-renders.mjs`) launched via `~/Library/LaunchAgents/com.threshold.{watch-renders,autopublish}.plist`. Carousels are auto-queued by `~/Code/Social Media/Carousels/templates/export.js` POSTing to `/api/local-scan/upload` after each export — no separate watcher needed.
- **`tailwind.config.ts`** — custom colors (`obsidian`, `deep-navy`, `threshold-purple`, `clinical-white`, `sterling-silver`, `champion-gold`) and font families mapped to CSS variables.

Vercel deploys from the GitHub remote (project keyed by `projectId`, not folder name).

## Brand Colors

| Token | Hex |
|---|---|
| `obsidian` | `#0D0D18` |
| `deep-navy` | `#1A1A2E` |
| `threshold-purple` | `#7002AB` |
| `clinical-white` | `#F5F5F5` |
| `sterling-silver` | `#C0C0C0` |
| `champion-gold` | `#C9A84C` (use sparingly) |

## Brand Asset Library

- **Logos/** — Core brand logo in multiple formats
  - Source files: Adobe Illustrator (`.ai`), EPS
  - Print/document: PDF
  - Web/raster: JPG, PNG, SVG
- **Logos/Social Media Kit/** — Platform-specific profile images and cover photos for Facebook, Instagram, LinkedIn, X (Twitter), and YouTube
- **Logos/Stationary Design/** — Corporate letterhead and envelope templates in editable (`.docx`, `.ai`) and reference (PDF, JPG, SVG) formats

## Working with Assets

- `.ai` files are the authoritative source files — edits to logos or stationery should start here
- `.docx` files in Stationary Design are the editable versions for end users who don't have Illustrator
- Exported raster/vector formats (JPG, PNG, SVG, EPS, PDF) are derived outputs from the source `.ai` files
