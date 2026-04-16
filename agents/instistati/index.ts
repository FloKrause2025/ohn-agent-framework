/**
 * agents/instistati/index.ts
 *
 * InstiStati 📸 — Organic Instagram Analytics Agent
 *
 * PURPOSE: Data display only. No LLM calls. No analysis.
 * - Returns the latest Instagram pull result for UI display
 * - Exposes getInstiStatiData() for any other agent to consume
 * - Triggers a fresh pull if cache is empty or stale
 *
 * DATA MODES:
 *   DEMO (default) — realistic mock data, works with no credentials
 *   LIVE           — set INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID
 */

export {
  runIgPull,
  getLatestIgPull,
  isCacheStale,
  getLastPullTime,
  formatIgDataForAgents,
  benchmarkThreeSecRetention,
  benchmarkWatchTimePct,
  benchmarkShareRate,
  benchmarkSaveRate,
  benchmarkEngagementRate,
} from "../../skills/instagram-analytics/index.js";

export type {
  IgPullResult,
  IgAccountSummary,
  IgPost,
  IgAudienceData,
  IgBestPostingTimes,
  DateRange,
  BenchmarkStatus,
} from "../../skills/instagram-analytics/index.js";

/**
 * Get the latest Instagram data — or trigger a pull if cache is empty/stale.
 * This is the single entry point other agents use to request IG data.
 */
export async function getInstiStatiData() {
  const { getLatestIgPull, isCacheStale, runIgPull } = await import("../../skills/instagram-analytics/index.js");
  const cached = getLatestIgPull();
  if (!cached || isCacheStale()) {
    return runIgPull();
  }
  return cached;
}
