/**
 * paid-media-analytics/index.ts
 *
 * Public interface for the Meta Ads data-pulling skill.
 *
 * IMPLEMENTATION NOTE:
 * The full implementation lives in the original framework at:
 *   server/agents/statsy/statsy.ts (or similar)
 *   No standalone implementation file exists in the skills directory.
 *
 * This file defines all public types and the interface that
 * framework adapters must implement.
 *
 * ORIGINAL: working — do not modify
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type AnomalyType =
  | "zero_spend_active"
  | "impressions_no_3s_views"
  | "high_frequency"
  | "missing_value"
  | "no_results";

export type AnomaltySeverity = "warning" | "critical";

export interface AnomalyFlag {
  adId: string;
  adName: string;
  type: AnomalyType;
  message: string;
  severity: AnomaltySeverity;
}

export type CreativeType = "image" | "video" | "carousel" | "unknown";

export interface StructuredAd {
  // Identity
  adId: string;
  adName: string;
  adStatus: string;
  campaignName: string;
  campaignId: string;
  adSetName: string;
  adSetId: string;
  angleLabel: string;
  // Creative
  creativeType: CreativeType;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  creativeUrl: string | null;
  creativeS3Url: string | null;
  instagramMediaId: string | null;
  // Performance
  impressions: number;
  reach: number;
  frequency: number;
  amountSpent: number;
  cpm: number;
  ctr: number;
  cpc: number;
  videoViews3s: number;
  thruPlay: number;
  hookRate: number | null;
  holdRate: number | null;
  costPerResult: number | null;
  results: number;
  // Anomalies
  anomalyFlags: AnomalyFlag[];
  // Targeting (from ad set)
  campaignObjective: string | null;
  targetingAgeMin: number | null;
  targetingAgeMax: number | null;
  targetingGenders: number[] | null;
  targetingCountries: string[] | null;
}

export interface AdSetGroup {
  adSetId: string;
  adSetName: string;
  angleLabel: string;
  ads: StructuredAd[];
  totals: {
    spend: number;
    impressions: number;
    results: number;
    avgHookRate: number | null;
    avgHoldRate: number | null;
  };
}

export interface CampaignGroup {
  campaignId: string;
  campaignName: string;
  adSets: AdSetGroup[];
  totals: { spend: number; impressions: number; results: number };
}

export interface PullSummary {
  totalSpend: number;
  totalImpressions: number;
  totalReach: number;
  totalResults: number;
  avgHookRate: number | null;
  avgHoldRate: number | null;
  avgCtr: number;
  avgCpm: number;
}

export interface StatsyPullResult {
  pullId: number;
  pulledAt: string;
  dateRange: string;
  totalAds: number;
  totalAnomalies: number;
  structuredData: { campaigns: CampaignGroup[] };
  anomalies: AnomalyFlag[];
  summary: PullSummary;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PaidMediaConfig {
  accessToken: string;
  storage: {
    put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  };
}

// ─── Interface (implemented by framework adapter) ─────────────────────────────

export type RunStatsyPullFn = (
  config: PaidMediaConfig,
  adAccountId: string,
  dateRange?: string
) => Promise<StatsyPullResult>;

export type GetLatestPullFn = () => Promise<StatsyPullResult | null>;

// ─── Benchmark helpers (used by Addy and Statsy) ─────────────────────────────

export type BenchmarkStatus = "✅" | "⚠️" | "🔴";

export function benchmarkHookRate(rate: number): BenchmarkStatus {
  if (rate >= 25) return "✅";
  if (rate >= 15) return "⚠️";
  return "🔴";
}

export function benchmarkHoldRate(rate: number): BenchmarkStatus {
  if (rate >= 20) return "✅";
  if (rate >= 10) return "⚠️";
  return "🔴";
}

export function benchmarkCtr(rate: number): BenchmarkStatus {
  if (rate >= 1) return "✅";
  if (rate >= 0.5) return "⚠️";
  return "🔴";
}

export function benchmarkFrequency(freq: number): BenchmarkStatus {
  if (freq <= 3) return "✅";
  if (freq <= 4) return "⚠️";
  return "🔴";
}
