# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains two things: a **Next.js marketing website** for Threshold Health & Performance, and a **brand identity asset library** (logos, social kit, stationery).

## Commands

```bash
npm install       # install dependencies
npm run dev       # local dev server at localhost:3000
npm run build     # production build (run before deploying)
npm run lint      # ESLint
```

## Website Architecture

Single-page Next.js 14 App Router site (`app/page.tsx`). No client components — fully static, prerendered at build time.

- **`app/layout.tsx`** — root layout; loads Cormorant Garamond, Montserrat, and Nunito Sans via `next/font/google` as CSS variables
- **`app/page.tsx`** — all five sections plus `Nav` and `CrossCard` components inline; booking URL constant at top
- **`app/globals.css`** — sets `scroll-behavior: smooth` and base colors
- **`tailwind.config.ts`** — custom colors (`obsidian`, `deep-navy`, `threshold-purple`, `clinical-white`, `sterling-silver`, `champion-gold`) and font families mapped to CSS variables

The site is deploy-ready for Vercel with no additional configuration needed.

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
