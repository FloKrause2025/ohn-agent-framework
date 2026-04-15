---
name: scraping-reddit
version: 1.0
used_by: [researchy]
inputs: [config]
outputs: [RedditFetchResult]
---

## What This Skill Does

Scrapes r/Scams flair feeds ("Is this a scam?" and "Help Needed") for posts from the last 72 hours. Returns raw, enriched posts. Does not filter, rank, or judge relevance — that is Researchy's job.

## Why It Exists

Researchy needs a continuous feed of new scam reports. Reddit's r/Scams is the highest-signal source of emerging scam types reported by real victims in real time. This skill is the data collection layer — it fetches and enriches, nothing more.

## How It Works

1. **Flair feed fetch** — pulls up to 25 posts per flair from Reddit's listing API using OAuth when credentials are available (avoids 403 blocks), falls back to public JSON API
2. **Serper fallback** — if fewer than 15 posts come back from Reddit, supplements with 2 Serper Google searches (`site:reddit.com/r/Scams`)
3. **Deduplication** — removes duplicate URLs across both flair feeds
4. **Enrichment** — for each post, fetches real upvote score, comment count, upvote ratio, and author from Reddit's post JSON API (batched, concurrency-capped at 8)
5. **Flair inference** — infers scam category from title/body keywords (best-effort, not authoritative)
6. **Sanitisation** — strips HTML, removes prompt injection patterns, caps body preview at 300 chars

## Inputs

```ts
interface RedditScrapingConfig {
  serperApiKey?: string;       // Required only if Reddit returns < 15 posts
  redditClientId?: string;     // Optional — enables OAuth (bypasses 403 blocks)
  redditClientSecret?: string; // Optional — required if redditClientId is set
}
```

Call: `fetchRedditScamPosts(config)`

## Outputs

```ts
interface FetchedRedditPost {
  title: string;        // cleaned title (Reddit suffix stripped)
  upvotes: number;      // real score from Reddit JSON API (0 if unavailable)
  comments: number;     // real comment count (0 if unavailable)
  upvoteRatio: number;  // 0–1 ratio (0 if unavailable)
  flair: string;        // inferred scam category
  url: string;          // full Reddit post URL
  author: string;       // real username (fallback: "r/Scams")
  timeAgo: string;      // relative time string e.g. "12h ago"
  bodyPreview: string;  // first 300 chars of post body (sanitised)
}

interface RedditFetchResult {
  posts: FetchedRedditPost[];
  scannedAt: string;          // ISO timestamp
  queriesUsed: string[];      // flair feeds + any Serper queries
  rawResultCount: number;     // total posts found
  enrichedCount: number;      // posts that got real upvote/comment data
  authMethod: string;         // "OAuth" or "Public JSON API"
}
```

## Failure Modes

| Failure | Behaviour |
|---|---|
| Reddit API rate limited | Serper fallback kicks in automatically |
| Serper key missing | Relies on Reddit flair feeds only — still functional |
| Both sources return 0 posts | Returns empty `posts` array — caller surfaces error |

## Constraints

- Only scrapes `r/Scams` — no other subreddits
- Only targets "Is this a scam?" and "Help Needed" flair feeds
- Never replies to, votes on, or interacts with Reddit posts
- Body previews sanitised — HTML stripped, special chars removed, 300-char cap
