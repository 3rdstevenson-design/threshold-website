# Blog content — authoring conventions

Posts are MDX files: `content/blog/<slug>.mdx`. The frontmatter schema lives in `lib/blog.ts` (`PostMeta`): `title`, `description`, `date`, `author`, `avatar`, `keyword`, and optional `cluster`, `pillar`, `heroImage`, `ogImage`.

## Share / Open Graph images — automatic

Every post automatically gets a branded 1200×630 share card **generated from its `title`** by `app/blog/[slug]/og/route.tsx` (Next `next/og`), served at `/blog/<slug>/og`. It matches the brand default card: obsidian background, crossing mark, Cormorant title, gold "THRESHOLD HEALTH & PERFORMANCE", "Reston, Virginia".

**You do not need to make a share image for a post.** A good `title` is enough. `app/blog/[slug]/page.tsx` wires it in as `image = post.ogImage ?? /blog/<slug>/og`, used for `og:image`, `twitter:image`, and JSON-LD.

### Overriding with a custom card (optional)
Only when a hand-designed card clearly beats the auto title card: place a 1200×630 PNG in `public/blog/` and point to it in frontmatter:

```yaml
ogImage: /blog/my-custom-card.png
```

Otherwise leave `ogImage` unset.

The site-wide default for non-blog pages is `public/og-default.png` (regenerate with `node scripts/generate-og-image.mjs`).
