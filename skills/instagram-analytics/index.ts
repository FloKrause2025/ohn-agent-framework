/**
 * instagram-analytics/index.ts
 *
 * Public interface for the Instagram organic analytics skill.
 * Pulls Meta Graph API data, calculates period-over-period changes,
 * and stores every pull for historical analysis.
 *
 * IMPLEMENTATION NOTE:
 * The full implementation lives in the original framework at:
 *   server/skills/instagram-analytics/scripts/instistati_system_prompt.ts
 *   server/agents/instistati/ (data pull logic)
 *
 * This file defines the public interface. The implementation adapter
 * for this framework should be wired up in the agent layer.
 *
 * ORIGINAL: working — do not modify
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export type DateRange = "last_7_days" | "last_30_days" | "last_90_days";

export interface IgAccountSummary {
  followers: number;
  profileViews: number;
  websiteClicks: number;
  reach: number;
  totalEngagements: number;
  avgEngagementRate: number;
  avgWatchTimeSeconds: number | null;
  avgThreeSecRetention: number | null;
  // Period-over-period deltas
  followersChange: number;
  followersChangeRate: number;
  reachChange: number;
  engagementRateChange: number;
  profileViewsChange: number;
  websiteClicksChange: number;
  avgWatchTimeChange: number | null;
  threeSecRetentionChange: number | null;
}

export interface IgPost {
  mediaId: string;
  caption: string;
  captionLine: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REEL";
  permalink: string;
  timestamp: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  plays: number;
  engagementRate: number;
  threeSecRetentionRate: number | null;
  avgWatchTimeSeconds: number | null;
  avgWatchTimePct: number | null;
  videoDurationSeconds: number;
  isViral: boolean;
}

export interface IgAudienceData {
  ageGender: Array<{ label: string; percentage: number }>;
  topCountries: Array<{ country: string; percentage: number }>;
  topCities: Array<{ city: string; percentage: number }>;
  genderSplit: { female: number; male: number; other: number };
}

export interface IgPullResult {
  pullId: number;
  pulledAt: Date;
  dateRange: string;
  accountSummary: IgAccountSummary;
  posts: IgPost[];
  audienceData: IgAudienceData;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface InstagramAnalyticsConfig {
  accessToken: string;
  businessAccountId: string;
}

// ─── Interface (implemented by framework adapter) ─────────────────────────────

/**
 * Trigger a fresh pull from the Instagram Graph API.
 * Implementation must be provided by the framework adapter.
 */
export type RunIgPullFn = (
  config: InstagramAnalyticsConfig,
  dateRange?: DateRange
) => Promise<IgPullResult>;

/**
 * Get the most recent completed pull from the database (no API call).
 * Implementation must be provided by the framework adapter.
 */
export type GetLatestIgPullFn = () => Promise<IgPullResult | null>;

/**
 * Benchmark status labels for Instagram metrics.
 * Used by InstiStati when formatting reports.
 */
export type BenchmarkStatus = "🔴" | "🟡" | "🟢" | "⭐";

export function benchmarkThreeSecRetention(rate: number): BenchmarkStatus {
  if (rate >= 75) return "⭐";
  if (rate >= 65) return "🟢";
  if (rate >= 50) return "🟡";
  return "🔴";
}

export function benchmarkWatchTimePct(pct: number): BenchmarkStatus {
  if (pct >= 70) return "⭐";
  if (pct >= 50) return "🟢";
  if (pct >= 30) return "🟡";
  return "🔴";
}

export function benchmarkShareRate(rate: number): BenchmarkStatus {
  if (rate >= 8) return "⭐";
  if (rate >= 4) return "🟢";
  if (rate >= 1) return "🟡";
  return "🔴";
}

export function benchmarkSaveRate(rate: number): BenchmarkStatus {
  if (rate >= 5) return "⭐";
  if (rate >= 3) return "🟢";
  if (rate >= 1) return "🟡";
  return "🔴";
}

export function benchmarkEngagementRate(rate: number): BenchmarkStatus {
  if (rate >= 8) return "⭐";
  if (rate >= 5) return "🟢";
  if (rate >= 2) return "🟡";
  return "🔴";
}
