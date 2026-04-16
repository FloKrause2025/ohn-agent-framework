/**
 * skills/instagram-analytics/index.ts
 *
 * Instagram organic analytics skill.
 * DEMO MODE (default) — realistic mock data, works with no credentials.
 * LIVE MODE — set INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID env vars.
 *
 * No database dependency — uses in-memory cache with 2-hour TTL.
 * Accessible by InstiStati agent and any future orchestrator agent.
 *
 * Ported from: server/agents/instistati/instistati.core.ts (original framework)
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DateRange = "last_7_days" | "last_30_days" | "last_90_days";
export type BenchmarkStatus = "🔴" | "🟡" | "🟢" | "⭐";

export interface IgAccountSummary {
  followers: number;
  following: number;
  mediaCount: number;
  profileViews: number;
  websiteClicks: number;
  reach: number;
  impressions: number;
  totalEngagements: number;
  avgEngagementRate: number;
  followersChange: number;
  reachChange: number;
  impressionsChange: number;
  engagementRateChange: number;
}

export interface IgPost {
  mediaId: string;
  caption: string;
  captionLine: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REEL";
  permalink: string;
  mediaUrl: string;
  timestamp: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  plays: number;
  engagementRate: number;
  isViral: boolean;
  avgWatchTimeSeconds: number | null;
  avgWatchTimePct: number | null;
  threeSecRetentionRate: number | null;
  completionRate: number | null;
  profileVisitsFromVideo: number | null;
  follows: number | null;
  videoDurationSeconds: number;
}

export interface IgAudienceData {
  ageGender: Array<{ label: string; percentage: number }>;
  topCountries: Array<{ country: string; percentage: number }>;
  topCities: Array<{ city: string; percentage: number }>;
  genderSplit: { female: number; male: number; other: number };
}

export interface IgBestPostingTimes {
  topSlots: Array<{ day: string; time: string; score: number }>;
}

export interface IgPullResult {
  pullId: number;
  pulledAt: Date;
  dateRange: string;
  isDemo: boolean;
  accountSummary: IgAccountSummary;
  posts: IgPost[];
  audienceData: IgAudienceData;
  bestPostingTimes: IgBestPostingTimes;
}

// ─── Benchmark helpers ─────────────────────────────────────────────────────────

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

// ─── In-memory cache ──────────────────────────────────────────────────────────

const PULL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

let _cachedPull: IgPullResult | null = null;
let _lastPullTime = 0;

export function getLatestIgPull(): IgPullResult | null {
  return _cachedPull;
}

export function isCacheStale(): boolean {
  return Date.now() - _lastPullTime > PULL_INTERVAL_MS;
}

export function getLastPullTime(): number {
  return _lastPullTime;
}

// ─── Demo data ────────────────────────────────────────────────────────────────

function generateDemoData(): Omit<IgPullResult, "pullId" | "pulledAt" | "dateRange" | "isDemo"> {
  const accountSummary: IgAccountSummary = {
    followers: 127_843,
    following: 412,
    mediaCount: 847,
    profileViews: 18_420,
    websiteClicks: 3_241,
    reach: 284_590,
    impressions: 512_340,
    totalEngagements: 19_872,
    avgEngagementRate: 6.98,
    followersChange: 2.4,
    reachChange: 14.2,
    impressionsChange: 8.7,
    engagementRateChange: 0.6,
  };

  const posts: IgPost[] = [
    {
      mediaId: "demo1", caption: "⚠️ This text message is NOT from your bank. Here's how to spot the difference. #scamalert",
      captionLine: "⚠️ This text message is NOT from your bank.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo1/", mediaUrl: "",
      timestamp: "2026-03-10T14:00:00Z",
      reach: 72_150, likes: 4_821, comments: 312, shares: 1_840, saves: 2_103, plays: 94_200,
      engagementRate: 12.57, isViral: true,
      avgWatchTimeSeconds: 38, avgWatchTimePct: 73, threeSecRetentionRate: 81, completionRate: 44,
      profileVisitsFromVideo: 1_840, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo2", caption: "Your grandma just got a call from 'Amazon'. Here's what to tell her. #scamprevention",
      captionLine: "Your grandma just got a call from 'Amazon'.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo2/", mediaUrl: "",
      timestamp: "2026-03-08T16:30:00Z",
      reach: 54_820, likes: 3_210, comments: 198, shares: 1_420, saves: 1_876, plays: 71_500,
      engagementRate: 12.22, isViral: true,
      avgWatchTimeSeconds: 34, avgWatchTimePct: 65, threeSecRetentionRate: 76, completionRate: 38,
      profileVisitsFromVideo: 1_430, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo3", caption: "The Gmail dot trick scam is back. Thousands of people falling for this. 🚨 #gmailscam",
      captionLine: "The Gmail dot trick scam is back.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo3/", mediaUrl: "",
      timestamp: "2026-03-06T12:00:00Z",
      reach: 44_380, likes: 2_840, comments: 156, shares: 980, saves: 1_540, plays: 58_900,
      engagementRate: 12.43, isViral: true,
      avgWatchTimeSeconds: 31, avgWatchTimePct: 60, threeSecRetentionRate: 72, completionRate: 34,
      profileVisitsFromVideo: 1_178, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo4", caption: "5 signs your phone has been hacked right now. Check these immediately. #phonehacked",
      captionLine: "5 signs your phone has been hacked right now.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo4/", mediaUrl: "",
      timestamp: "2026-03-04T10:00:00Z",
      reach: 39_840, likes: 2_410, comments: 134, shares: 820, saves: 1_320, plays: 52_100,
      engagementRate: 11.69, isViral: true,
      avgWatchTimeSeconds: 28, avgWatchTimePct: 54, threeSecRetentionRate: 68, completionRate: 29,
      profileVisitsFromVideo: 1_042, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo5", caption: "This QR code in a restaurant could steal your credit card. #qrcodescam",
      captionLine: "This QR code in a restaurant could steal your credit card.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo5/", mediaUrl: "",
      timestamp: "2026-03-02T14:00:00Z",
      reach: 33_920, likes: 1_980, comments: 112, shares: 640, saves: 1_120, plays: 44_300,
      engagementRate: 11.35, isViral: true,
      avgWatchTimeSeconds: 25, avgWatchTimePct: 48, threeSecRetentionRate: 63, completionRate: 24,
      profileVisitsFromVideo: 886, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo6", caption: "How scammers use your Facebook profile to steal your identity. 😱 #facebookscam",
      captionLine: "How scammers use your Facebook profile to steal your identity.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo6/", mediaUrl: "",
      timestamp: "2026-02-28T16:00:00Z",
      reach: 31_180, likes: 1_720, comments: 98, shares: 580, saves: 940, plays: 40_800,
      engagementRate: 10.71, isViral: true,
      avgWatchTimeSeconds: 23, avgWatchTimePct: 44, threeSecRetentionRate: 59, completionRate: 21,
      profileVisitsFromVideo: 816, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo7", caption: "The 'wrong number' text scam. They're not lost. They're targeting you. #wrongnumber",
      captionLine: "The 'wrong number' text scam.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo7/", mediaUrl: "",
      timestamp: "2026-02-26T12:00:00Z",
      reach: 26_540, likes: 1_480, comments: 87, shares: 490, saves: 820, plays: 34_200,
      engagementRate: 10.85, isViral: true,
      avgWatchTimeSeconds: 21, avgWatchTimePct: 40, threeSecRetentionRate: 56, completionRate: 18,
      profileVisitsFromVideo: 684, follows: null, videoDurationSeconds: 52,
    },
    {
      mediaId: "demo8", caption: "Real vs fake McAfee renewal email. Can you spot the difference? #phishing #mcafee",
      captionLine: "Real vs fake McAfee renewal email.",
      mediaType: "IMAGE", permalink: "https://www.instagram.com/p/demo8/", mediaUrl: "",
      timestamp: "2026-02-24T10:00:00Z",
      reach: 23_410, likes: 1_240, comments: 72, shares: 380, saves: 690, plays: 0,
      engagementRate: 9.78, isViral: false,
      avgWatchTimeSeconds: null, avgWatchTimePct: null, threeSecRetentionRate: null, completionRate: null,
      profileVisitsFromVideo: 468, follows: null, videoDurationSeconds: 0,
    },
    {
      mediaId: "demo9", caption: "Your Apple ID is NOT suspended. Here's the real email Apple sends. #applescam",
      captionLine: "Your Apple ID is NOT suspended.",
      mediaType: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/demo9/", mediaUrl: "",
      timestamp: "2026-02-22T14:00:00Z",
      reach: 20_340, likes: 1_080, comments: 63, shares: 310, saves: 580, plays: 0,
      engagementRate: 9.97, isViral: false,
      avgWatchTimeSeconds: null, avgWatchTimePct: null, threeSecRetentionRate: null, completionRate: null,
      profileVisitsFromVideo: 407, follows: null, videoDurationSeconds: 0,
    },
    {
      mediaId: "demo10", caption: "3 things to do if you clicked a phishing link. Do these RIGHT NOW. #phishing",
      captionLine: "3 things to do if you clicked a phishing link.",
      mediaType: "REEL", permalink: "https://www.instagram.com/reel/demo10/", mediaUrl: "",
      timestamp: "2026-02-20T16:00:00Z",
      reach: 18_120, likes: 940, comments: 58, shares: 280, saves: 510, plays: 23_400,
      engagementRate: 9.82, isViral: false,
      avgWatchTimeSeconds: 19, avgWatchTimePct: 37, threeSecRetentionRate: 53, completionRate: 16,
      profileVisitsFromVideo: 468, follows: null, videoDurationSeconds: 52,
    },
  ];

  const audienceData: IgAudienceData = {
    ageGender: [
      { label: "35-44 F", percentage: 31.2 },
      { label: "45-54 F", percentage: 22.8 },
      { label: "25-34 F", percentage: 18.4 },
      { label: "35-44 M", percentage: 10.1 },
      { label: "55-64 F", percentage: 8.7 },
      { label: "45-54 M", percentage: 5.2 },
      { label: "Other",   percentage: 3.6 },
    ],
    topCountries: [
      { country: "United States", percentage: 42.3 },
      { country: "United Kingdom", percentage: 18.7 },
      { country: "Canada", percentage: 14.2 },
      { country: "Australia", percentage: 12.8 },
      { country: "Ireland", percentage: 4.1 },
      { country: "Other", percentage: 7.9 },
    ],
    topCities: [
      { city: "New York", percentage: 8.4 },
      { city: "London", percentage: 7.2 },
      { city: "Los Angeles", percentage: 6.1 },
      { city: "Toronto", percentage: 5.8 },
      { city: "Sydney", percentage: 4.9 },
    ],
    genderSplit: { female: 81.1, male: 15.3, other: 3.6 },
  };

  const bestPostingTimes: IgBestPostingTimes = {
    topSlots: [
      { day: "Tuesday",   time: "7:00 PM",  score: 98 },
      { day: "Wednesday", time: "6:30 PM",  score: 95 },
      { day: "Thursday",  time: "8:00 PM",  score: 93 },
      { day: "Saturday",  time: "10:00 AM", score: 89 },
      { day: "Sunday",    time: "11:00 AM", score: 86 },
    ],
  };

  return { accountSummary, posts, audienceData, bestPostingTimes };
}

// ─── Live Meta Graph API pull ─────────────────────────────────────────────────

const IG_API_BASE = "https://graph.facebook.com/v21.0";

async function fetchInsightMetric(token: string, accountId: string, metric: string, since: number, until: number): Promise<number> {
  const url = `${IG_API_BASE}/${accountId}/insights?metric=${metric}&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json() as { data?: Array<{ total_value?: { value?: number } }> };
  return json?.data?.[0]?.total_value?.value ?? 0;
}

async function fetchFollowerDemographics(token: string, accountId: string, breakdown: string): Promise<Array<{ dimension_values: string[]; value: number }>> {
  const url = `${IG_API_BASE}/${accountId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${encodeURIComponent(breakdown)}&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json() as { data?: Array<{ total_value?: { breakdowns?: Array<{ results?: Array<{ dimension_values: string[]; value: number }> }> } }> };
  return json?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
}

async function fetchLiveData(
  token: string,
  accountId: string,
  dateRange: string,
): Promise<Omit<IgPullResult, "pullId" | "pulledAt" | "dateRange" | "isDemo">> {
  const now = Math.floor(Date.now() / 1000);
  const daysMap: Record<string, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90 };
  const days = daysMap[dateRange] ?? 30;
  const since = now - days * 86400;

  // Account basic info
  const accountRes = await fetch(`${IG_API_BASE}/${accountId}?fields=followers_count,follows_count,media_count&access_token=${token}`);
  const accountJson = await accountRes.json() as { followers_count?: number; follows_count?: number; media_count?: number };

  // Account insights (parallel)
  const [profileViews, websiteClicks, reach, likes, comments, shares, saves] = await Promise.all([
    fetchInsightMetric(token, accountId, "profile_views",      since, now),
    fetchInsightMetric(token, accountId, "website_clicks",     since, now),
    fetchInsightMetric(token, accountId, "reach",              since, now),
    fetchInsightMetric(token, accountId, "likes",              since, now),
    fetchInsightMetric(token, accountId, "comments",           since, now),
    fetchInsightMetric(token, accountId, "shares",             since, now),
    fetchInsightMetric(token, accountId, "saves",              since, now),
  ]);

  const totalEngagements = likes + comments + shares + saves;

  // Media list
  const mediaRes = await fetch(`${IG_API_BASE}/${accountId}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp&limit=30&access_token=${token}`);
  const mediaJson = await mediaRes.json() as { data?: Array<{ id: string; caption?: string; media_type: string; permalink?: string; thumbnail_url?: string; timestamp?: string }> };

  const posts: IgPost[] = [];
  const sinceDate = new Date(since * 1000);

  for (const media of (mediaJson.data ?? []).filter(m => !m.timestamp || new Date(m.timestamp) >= sinceDate)) {
    try {
      const isVideo = media.media_type === "VIDEO";
      const stdMetrics = isVideo ? "reach,likes,comments,shares,saved" : "reach,likes,comments,shares,saved,profile_visits";
      const postRes = await fetch(`${IG_API_BASE}/${media.id}/insights?metric=${stdMetrics}&access_token=${token}`);
      const postJson = await postRes.json() as { data?: Array<{ name: string; values?: Array<{ value: number }> }>; error?: { message: string } };

      const pm: Record<string, number> = {};
      for (const m of postJson.data ?? []) pm[m.name] = m.values?.[0]?.value ?? 0;

      let plays = 0;
      let avgWatchTimeSeconds: number | null = null;
      let avgWatchTimePct: number | null = null;
      let threeSecRetentionRate: number | null = null;
      let profileVisitsFromVideo: number | null = null;

      if (isVideo) {
        try {
          const reelRes = await fetch(`${IG_API_BASE}/${media.id}/insights?metric=ig_reels_avg_watch_time,views&access_token=${token}`);
          const reelJson = await reelRes.json() as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
          const rm: Record<string, number> = {};
          for (const m of reelJson.data ?? []) rm[m.name] = m.values?.[0]?.value ?? 0;
          plays = rm["views"] ?? 0;
          const avgMs = rm["ig_reels_avg_watch_time"] ?? 0;
          avgWatchTimeSeconds = avgMs > 0 ? parseFloat((avgMs / 1000).toFixed(1)) : null;
          threeSecRetentionRate = plays > 0 && pm.reach > 0 ? parseFloat(((plays / pm.reach) * 100).toFixed(1)) : null;
        } catch { /* ignore */ }
      } else {
        profileVisitsFromVideo = pm.profile_visits ?? null;
      }

      const engagements = (pm.likes ?? 0) + (pm.comments ?? 0) + (pm.shares ?? 0) + (pm.saved ?? 0);
      const engRate = pm.reach ? (engagements / pm.reach) * 100 : 0;
      const captionFull = media.caption ?? "";
      const captionLine = captionFull.split("\n")[0].trim();

      posts.push({
        mediaId: media.id, caption: captionFull, captionLine,
        mediaType: media.media_type as IgPost["mediaType"],
        permalink: media.permalink ?? "", mediaUrl: media.thumbnail_url ?? "",
        timestamp: media.timestamp ?? "",
        reach: pm.reach ?? 0, likes: pm.likes ?? 0, comments: pm.comments ?? 0,
        shares: pm.shares ?? 0, saves: pm.saved ?? 0, plays,
        engagementRate: parseFloat(engRate.toFixed(2)), isViral: engRate > 5,
        avgWatchTimeSeconds, avgWatchTimePct, threeSecRetentionRate, completionRate: null,
        profileVisitsFromVideo, follows: null, videoDurationSeconds: 0,
      });
    } catch { /* skip failed posts */ }
  }

  posts.sort((a, b) => b.engagementRate - a.engagementRate);

  const avgEngRate = posts.length > 0 ? posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length : 0;

  const accountSummary: IgAccountSummary = {
    followers: accountJson.followers_count ?? 0,
    following: accountJson.follows_count ?? 0,
    mediaCount: accountJson.media_count ?? 0,
    profileViews, websiteClicks, reach,
    impressions: 0,
    totalEngagements,
    avgEngagementRate: parseFloat(avgEngRate.toFixed(2)),
    followersChange: 0, reachChange: 0, impressionsChange: 0, engagementRateChange: 0,
  };

  // Audience demographics (parallel, best-effort)
  const audienceData: IgAudienceData = {
    ageGender: [], topCountries: [], topCities: [],
    genderSplit: { female: 0, male: 0, other: 0 },
  };

  try {
    const ageGenderResults = await fetchFollowerDemographics(token, accountId, "age,gender");
    const total = ageGenderResults.reduce((s, r) => s + r.value, 0);
    let female = 0, male = 0;
    const map: Record<string, number> = {};
    for (const r of ageGenderResults) {
      const [age, gender] = r.dimension_values;
      map[`${age} ${gender}`] = (map[`${age} ${gender}`] ?? 0) + r.value;
      if (gender === "F") female += r.value; else if (gender === "M") male += r.value;
    }
    audienceData.ageGender = Object.entries(map).sort(([,a],[,b]) => b-a).slice(0, 8)
      .map(([label, count]) => ({ label, percentage: total > 0 ? parseFloat(((count/total)*100).toFixed(1)) : 0 }));
    const other = total - female - male;
    audienceData.genderSplit = {
      female: total > 0 ? parseFloat(((female/total)*100).toFixed(1)) : 0,
      male:   total > 0 ? parseFloat(((male/total)*100).toFixed(1)) : 0,
      other:  total > 0 ? parseFloat(((other/total)*100).toFixed(1)) : 0,
    };
  } catch { /* ignore */ }

  try {
    const countryResults = await fetchFollowerDemographics(token, accountId, "country");
    const total = countryResults.reduce((s, r) => s + r.value, 0);
    audienceData.topCountries = countryResults.sort((a,b) => b.value-a.value).slice(0, 6)
      .map(r => ({ country: r.dimension_values[0], percentage: total > 0 ? parseFloat(((r.value/total)*100).toFixed(1)) : 0 }));
  } catch { /* ignore */ }

  try {
    const cityResults = await fetchFollowerDemographics(token, accountId, "city");
    const total = cityResults.reduce((s, r) => s + r.value, 0);
    audienceData.topCities = cityResults.sort((a,b) => b.value-a.value).slice(0, 5)
      .map(r => ({ city: r.dimension_values[0], percentage: total > 0 ? parseFloat(((r.value/total)*100).toFixed(1)) : 0 }));
  } catch { /* ignore */ }

  const bestPostingTimes: IgBestPostingTimes = {
    topSlots: [
      { day: "Tuesday",   time: "7:00 PM",  score: 98 },
      { day: "Wednesday", time: "6:30 PM",  score: 95 },
      { day: "Thursday",  time: "8:00 PM",  score: 93 },
      { day: "Saturday",  time: "10:00 AM", score: 89 },
      { day: "Sunday",    time: "11:00 AM", score: 86 },
    ],
  };

  return { accountSummary, posts, audienceData, bestPostingTimes };
}

// ─── Main pull function ───────────────────────────────────────────────────────

export async function runIgPull(dateRange: DateRange = "last_30_days"): Promise<IgPullResult> {
  const token     = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "17841476712984525";
  const isDemo    = !token;

  const data = isDemo ? generateDemoData() : await fetchLiveData(token!, accountId, dateRange);

  const result: IgPullResult = {
    pullId:    Date.now(),
    pulledAt:  new Date(),
    dateRange,
    isDemo,
    ...data,
  };

  _cachedPull   = result;
  _lastPullTime = Date.now();

  console.log(`[InstisStati] Pull complete — ${isDemo ? "DEMO" : "LIVE"} · ${result.posts.length} posts`);
  return result;
}

// ─── Context formatter (for other agents / LLM injection) ────────────────────

/**
 * Format a pull result as a compact text block for LLM injection.
 * Used by ContentStrategist, QualityGate, or any orchestrator agent.
 */
export function formatIgDataForAgents(result: IgPullResult): string {
  const a = result.accountSummary;
  const topPosts = result.posts.slice(0, 10).map(p =>
    `  • ${p.captionLine.slice(0, 60)} | ER: ${p.engagementRate}% | Reach: ${p.reach.toLocaleString()} | Shares: ${p.shares} | Saves: ${p.saves} | ${p.mediaType}`
  ).join("\n");

  return `INSTAGRAM DATA (${result.isDemo ? "DEMO" : "LIVE"}) — last updated: ${result.pulledAt.toISOString()}
Followers: ${a.followers.toLocaleString()} | Reach 30d: ${a.reach.toLocaleString()} | Avg ER: ${a.avgEngagementRate}%
Top ${result.posts.slice(0,10).length} posts by engagement:
${topPosts}`;
}
