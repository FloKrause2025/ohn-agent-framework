---
name: analyzing-paid-media
version: 1.0
used_by: [statsy, addy, paid-marketing]
inputs: [PaidMediaConfig, adAccountId, dateRange]
outputs: [StatsyPullResult]
---

## What This Skill Does

Pulls the full Meta Ads hierarchy (campaigns → ad sets → ads) from the Meta Marketing API, calculates Hook Rate and Hold Rate, detects anomalies, caches creative thumbnails to permanent storage, and stores everything in the database. Returns raw structured data — does not interpret or recommend. That is Addy's job.

## Why It Exists

OHN runs paid ads to grow its audience. Every ad generates performance data. This skill pulls that data so agents can make data-driven decisions — Addy scores angles, Statsy answers owner questions, PaidMarketing synthesises everything.

## How It Works

1. **Campaigns** — pulls objectives, budgets, status
2. **Ad sets** — pulls targeting (age, gender, countries), optimization goals
3. **Ads + creatives** — pulls copy, headlines, CTAs, video/image assets
4. **Performance insights** — impressions, reach, spend, CPM, CTR, 3s views, ThruPlay, conversions
5. **Derived metrics** — calculates Hook Rate (`3s views / impressions × 100`) and Hold Rate (`ThruPlay / 3s views × 100`)
6. **Thumbnail caching** — downloads Meta CDN thumbnails and re-uploads to permanent storage (Meta CDN URLs expire)
7. **Anomaly detection** — flags zero-spend active ads, impressions with no 3s views, high frequency (>4.0), missing data
8. **DB storage** — archives to `adPulls` + `adData` tables (never overwrites historical)

## Inputs

```ts
interface PaidMediaConfig {
  accessToken: string;    // Meta Marketing API token
  storage: {
    put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  };
  db: DatabaseAdapter;
}

runStatsyPull(config: PaidMediaConfig, adAccountId: string, dateRange?: string): Promise<StatsyPullResult>
```

## Key Outputs

```ts
interface StructuredAd {
  adId: string;
  adName: string;
  angleLabel: string;        // extracted from ad set name — used by Addy
  creativeType: "image" | "video" | "carousel" | "unknown";
  impressions: number;
  hookRate: number | null;   // video only: 3s views / impressions × 100
  holdRate: number | null;   // video only: ThruPlay / 3s views × 100
  ctr: number;
  amountSpent: number;
  costPerResult: number | null;
  anomalyFlags: string[];
  creativeS3Url: string | null;  // permanent thumbnail URL
}

type AnomalyType = "zero_spend_active" | "impressions_no_3s_views" | "high_frequency" | "missing_value";
```

## Constraints

- Never interprets or recommends — raw data and calculations only
- Historical pulls never overwritten
- Anomaly flags are structured data, not prose
- Hook Rate and Hold Rate are null for image/carousel ads
