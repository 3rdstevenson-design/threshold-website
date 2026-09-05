# Instagram Insights — internal API map (retention data)

Canonical endpoint map for pulling per-second retention data out of
Instagram's own web professional dashboard, per the workspace's
API-first-browser-fallback pattern. Filled in at runtime by the
`/sync-retention` routine; every discovery session MUST append findings
here before it ends.

## Status

**Blocked — not available on instagram.com web (verified 2026-07-22).**

Instagram's *web* professional dashboard does not expose per-second
retention at all. A Reel's web insights view
(`instagram.com/insights/media/<pk>/`) renders a fixed metric set and
nothing else:

> Views · follower/non-follower split · Accounts reached · Interactions ·
> Likes · Comments · Saves · Shares · Accounts engaged · Profile activity ·
> Follows · "Boost this reel"

No retention curve, no watch time, no average view duration, no "Viewers
over time" graph. Verified identical on three separate Reels (pks
`3939723082641955847`, `3927609496847228372`, `3934557581536016140`).

This blocks **both** documented paths of `/sync-retention`:
- the internal-API path — there is no series in any web payload; and
- the screenshot fallback — there is no chart on screen to capture.

The retention graph is an Instagram **mobile app** feature. Until a
mobile-side capture path exists, `/sync-retention` cannot ingest curves
from a desktop Chrome session and will report 0 reels every run.

Meta Business Suite and the Graph API were both checked as alternatives
and **neither carries the curve either** — see "Probed and not available".

**Suggested next avenues:**
1. **Use `reels_skip_rate` instead** (Graph API, works today — see below).
   It is the scalar version of the question the retention curve was meant
   to answer: what fraction of viewers bailed. Cheap, no browser, no
   vision parse.
2. Screenshot the retention chart by hand in the IG mobile app and POST
   it to `/api/analytics/retention-upload` — that route already accepts a
   multipart image and parses it with Claude vision. Only way to get a
   true per-second curve today.
3. Untested: mobile web under a spoofed mobile user-agent. Needs a tool
   that can set the request UA; the Chrome MCP cannot.

## Discovery procedure

1. In the logged-in instagram.com Chrome tab, open a Reel's insights:
   Professional dashboard → Content → the Reel → View insights (or
   `instagram.com/reel/<shortcode>/insights/` if routable directly).
2. Start observing network traffic (`read_network_requests`) BEFORE the
   retention chart renders, filtered to `graphql` and `/api/v1/`.
3. Let the chart load, then inspect the captured requests for a response
   containing a per-second array (look for field names like
   `retention`, `audience_retention`, `viewer_retention`, value arrays of
   length ≈ video seconds, or fractions that start near 1.0 and decay).
4. Record below: URL, method, `doc_id` / `query_hash` / friendly name for
   GraphQL, required headers (`x-ig-app-id`, `x-csrftoken`, cookies are
   supplied automatically by the tab), request body/variables, and the
   exact JSON path to the series.
5. Convert the series to `{sec, pctViewers}[]` (0–100 scale) and POST to
   `/api/analytics/retention-data` with `source: 'ig-internal-api'`.
6. Re-verify the mapping on a SECOND reel before trusting it.

## Known endpoint

| Method | URL / doc_id | Auth | Response path to series | Verified |
|---|---|---|---|---|
| — | — | — | — | — |

## Response → RetentionPoint mapping

_To be filled on discovery. Note the series' x-unit (seconds vs bucket
index vs fraction-of-duration) and y-unit (fraction 0–1 vs percent)._

## Fragility notes

- GraphQL `doc_id`s churn on Instagram deploys — re-verify when a
  previously working call starts returning empty data.
- A checkpoint/challenge page means STOP: report to Lars, never attempt
  to solve challenges or log in.
- Empty responses from a valid endpoint usually mean the reel is too
  recent (insights lag ~24-48h) — skip reels younger than 2 days.

## Probed and not available

### 2026-07-22 — desktop web session (dr.larsandincharge)

| Probe | Result |
|---|---|
| `instagram.com/insights/media/<pk>/` UI | Renders fixed metric set only — **no retention chart, nothing to screenshot**. Confirmed on 3 reels. |
| Page HTML scan for `retention`, `audience_retention`, `viewer_retention`, `watch_time`, `viewers_over_time`, `time_series`, `seconds_viewed` | Zero real hits. The single `retention` match is `oz_www_prefetch_retention_duration_ms` (video-player prefetch config, unrelated). |
| `POST /api/graphql` on the insights route | Fires once on hard load only. Soft-navigating between reels' insights issues **no** further requests — every media's metrics are preloaded by the grid query, and that payload has no series. |
| `GET /api/v1/insights/media_organic_insights/<pk>/` | 404 (returns logged-out HTML shell) |
| `GET /api/v1/media/<pk>/insights/` | 404 (same) |
| `GET /api/v1/insights/media/<pk>/` | 404 (same) |
| `GET /api/v1/clips/item/<pk>/insights/` | 404 (same) |

The `/api/v1/*` private mobile endpoints are not routed for web sessions —
they return the not-logged-in shell regardless of `x-ig-app-id` and cookies.

### 2026-07-22 — Meta Business Suite

`business.facebook.com/latest/insights/object_insights/?asset_id=<IG_ASSET>&business_id=<BIZ>&content_id=<GRAPH_MEDIA_ID>`

Richer than IG web, but **still no per-second retention curve**. A Reel's
detail view carries exactly:

- Overview: Views, Reach, Interactions, Watch time, Follows
- **Views over time** — a real time series, but the x-axis is *calendar
  time since publish* (15m / 9h / 1d 6h / 7d), not position in the video.
  Comes with P25/P75 benchmark bands vs your typical post. Not retention.
- Reach + audience demographics (age bucket × gender)
- Interactions breakdown (likes, comments, shares, saves)
- Watch time: **Average watch time** (e.g. `7s`) and total (`27m 39s`)

No audience-retention graph, no per-second series, and it does not even
surface `reels_skip_rate`. Dead end for curves.

**Useful side effect:** Business Suite addresses posts by the *Graph API
`mediaId`* via `content_id` — the same id the dashboard stores. So if a
Business Suite scrape is ever needed, no id translation is required
(unlike instagram.com, see gotcha below).

### 2026-07-22 — Graph API v22 (definitive metric list)

Requesting a bogus metric makes Meta enumerate the valid set. For an IG
media object the complete list is:

```
impressions, reach, replies, saved, likes, comments, shares,
total_interactions, follows, profile_visits, profile_activity,
navigation, ig_reels_video_view_total_time, ig_reels_avg_watch_time,
views, reels_skip_rate, reposts, facebook_views, crossposted_views,
total_views, total_likes, total_comments, link_clicks
```

**No per-second retention metric exists.** But `reels_skip_rate` does,
and it is the best available retention proxy — verified returning real
values on 5 reels:

| mediaId | skip rate | avg watch (ms) | views |
|---|---|---|---|
| 18446366836143081 | 46.7 | 6253 | 2268 |
| 18081381782659389 | 47.0 | 6600 | 835 |
| 18086912693390586 | 61.9 | 6999 | 307 |
| 18053883074528948 | 67.6 | 6118 | 323 |
| 18110340445756683 | 76.2 | 4592 | 301 |

Note the signal: the two lowest skip rates are the two highest-view
reels. `reels_skip_rate` is **not** currently captured by
`performanceSync` / `analyticsStore` — adding it is the cheapest way to
get hook-strength data into the dashboard without any browser work.

### ID-space gotcha (worth keeping)

The Graph API `mediaId` stored in the dashboard is **not** the internal pk
used in insights URLs, and the standard base64 shortcode derivation does
**not** convert between them:

| Graph `mediaId` | insights pk |
|---|---|
| `18446366836143081` | `3939723082641955847` |

Mapping them requires walking the content-insights grid and matching by
thumbnail/caption — there is no arithmetic conversion. Any future
mobile-side capture path needs to solve this to attribute a curve to the
right dashboard record.
