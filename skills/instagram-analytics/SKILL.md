---
name: analyzing-instagram
version: 1.0
used_by: [instistati, content-strategist]
inputs: [InstagramAnalyticsConfig, dateRange]
outputs: [IgPullResult]
---

## What This Skill Does

Pulls organic Instagram performance data from the Meta Graph API — account-level metrics, per-reel performance (3-second retention, average watch time, engagement), audience demographics, and period-over-period comparisons. Stores every pull in the database. Returns raw structured metrics only — does not interpret or recommend.

## Why It Exists

Every reel OHN publishes generates performance data that agents need to make decisions: InstiStati benchmarks it, ContentStrategist audits it, and the feedback loop uses it to improve future scripts and topic choices.

## Architecture Fix (vs Original)

**Original flaw:** Instagram account ID hardcoded as a constant (`17841476712984525`). Direct ENV imports. No multi-tenant support.

**This version:** All credentials and account ID injected via `InstagramAnalyticsConfig`. Swap config to switch accounts. Works for any Instagram Business Account.

## How It Works

1. **Account metrics** — pulls followers, profile views, website clicks, reach, impressions via Graph API Insights
2. **Period comparison** — calculates deltas vs previous equivalent period from stored pull history
3. **Per-reel metrics** — for each reel in date range: 3-second retention, avg watch time, reach, engagement
4. **Audience demographics** — age/gender breakdown, top countries/cities
5. **Cross-reference with video-analysis** — reads `videoIntelligenceCache` for video duration (enables watch time % calculation)
6. **Store in database** — archives every pull (never overwrites historical data)

## Inputs

```ts
interface InstagramAnalyticsConfig {
  accessToken: string;           // Instagram Graph API token
  businessAccountId: string;     // Instagram Business Account ID
  db: DatabaseAdapter;           // injected DB adapter
}

type DateRange = "last_7_days" | "last_30_days" | "last_90_days";

runIgPull(config: InstagramAnalyticsConfig, dateRange?: DateRange): Promise<IgPullResult>
getLatestIgPull(db: DatabaseAdapter): Promise<IgPullResult | null>
```

## Outputs (key types)

```ts
interface IgPullResult {
  pullId: number;
  pulledAt: Date;
  dateRange: string;
  accountSummary: IgAccountSummary;
  posts: IgPost[];
  audienceData: IgAudienceData;
}

interface IgPost {
  mediaId: string;
  captionLine: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REEL";
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagementRate: number;
  threeSecRetentionRate: number | null;  // null if insufficient views
  avgWatchTimeSeconds: number | null;
  avgWatchTimePct: number | null;        // requires video-analysis skill to have run
}
```

## Known Architecture Issue

The `ig_reels_skip_rate` metric (added to the Meta API in December 2025) should replace the current proxy calculation for 3-second retention. The current code uses `plays / reach × 100` which is inaccurate. See original SKILL.md for the exact code change needed.

## Constraints

- Auto-refreshes every 2 hours — never more frequently
- Historical pulls never overwritten
- 3-second retention returns null for low-reach reels (Meta requirement)
- Watch time % requires video-analysis skill to have processed the video
