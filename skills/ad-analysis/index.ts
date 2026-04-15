/**
 * ad-analysis/index.ts
 *
 * Addy — Ad Angle Analyzer for oh HACK no! Paid Media.
 *
 * CHANGES FROM ORIGINAL (server/skills/ad-analysis/scripts/addy.ts):
 * - ARCHITECTURE FIX: Removed direct imports of invokeLLM, getDb,
 *   saveQualityGateReview, all Drizzle schema tables, watchVideo, and
 *   buildVideoContext. All external dependencies injected via AdAnalysisDeps.
 * - SCORING FIX: Type-specific composite models instead of one formula for all:
 *     Video:          Hook Rate 30% + Hold Rate 20% + CTR 20% + CostPerResult 30%
 *     Image/Carousel: CTR 40% + CostPerResult 40% + CPM 20%
 *     Mixed angles:   Weighted blend based on video ad proportion
 * - AngleScore now includes scoreModel field ("video" | "image" | "mixed")
 *   so callers know which formula was applied.
 * - getRelevantKBSections() replaced by deps.getKbSections() — adapter-provided.
 * - Backward-compatible: pure functions (scoreAngles, groupAdsByAngle, benchmark*)
 *   remain callable without deps for testing.
 *
 * ORIGINAL: server/skills/ad-analysis/scripts/addy.ts (working — do not modify)
 */

// ─── LLM Interface Types ──────────────────────────────────────────────────────

export interface LLMContentBlock {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: string | LLMContentBlock[] | any;
}

export interface LLMInvokeParams {
  messages: LLMMessage[];
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
}

export interface LLMResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

// ─── Video Intelligence (minimal shape needed from video-analysis skill) ───────

export interface VideoIntelligence {
  frames: Array<{ url: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface AdForAnalysis {
  adId: string;
  adName: string;
  adStatus: string;
  campaignName: string;
  campaignId: string;
  campaignObjective: string | null;
  adSetName: string;
  adSetId: string;
  angleLabel: string;
  creativeType: string;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  creativeUrl: string | null;
  creativeS3Url: string | null;
  instagramMediaId: string | null;
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
  targetingAgeMin: number | null;
  targetingAgeMax: number | null;
  targetingGenders: number[] | null;
  targetingCountries: string[] | null;
}

export interface AngleScore {
  angleLabel: string;
  campaignName: string;
  campaignObjective: string | null;
  adCount: number;
  totalSpend: number;
  totalImpressions: number;
  totalResults: number;
  avgHookRate: number | null;
  avgHoldRate: number | null;
  avgCtr: number;
  avgCostPerResult: number | null;
  avgCpm: number;
  avgFrequency: number;
  compositeScore: number;
  verdict: "WINNER" | "WATCH" | "STOP";
  verdictReason: string;
  /** Which scoring model was applied: "video", "image", or "mixed" */
  scoreModel: "video" | "image" | "mixed";
  ads: AdForAnalysis[];
}

export interface AngleLLMInsight {
  angleLabel: string;
  verdict: "WINNER" | "WATCH" | "STOP";
  creativeReading: string;
  dataInsight: string;
  recommendation: string;
  kbPrinciple: string;
  budgetAction?: string;
}

export interface AddyAnalysisResult {
  analysisId: number;
  pullId: number;
  dateRange: string;
  totalAngles: number;
  winners: AngleScore[];
  watches: AngleScore[];
  stops: AngleScore[];
  priorityActions: string[];
  llmInsights: AngleLLMInsight[];
  createdAt: string;
}

export interface AnalysisSummary {
  id: number;
  pullId: number;
  status: string;
  dateRange: string | null;
  totalAngles: number | null;
  winners: number | null;
  watches: number | null;
  stops: number | null;
  createdAt: Date;
}

// ─── Database Adapter Interface ───────────────────────────────────────────────

export interface AdPullRecord {
  id: number;
  status: string;
  dateRange: string;
}

export interface RawAdDataRow {
  adId: string | null;
  adName: string | null;
  adStatus: string | null;
  campaignName: string | null;
  campaignId: string | null;
  campaignObjective: string | null;
  adSetName: string | null;
  adSetId: string | null;
  angleLabel: string | null;
  creativeType: string | null;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  creativeUrl: string | null;
  creativeS3Url: string | null;
  instagramMediaId: string | null;
  impressions: number | null;
  reach: number | null;
  amountSpent: string | null;
  cpm: string | null;
  ctr: string | null;
  cpc: string | null;
  videoViews3s: number | null;
  thruPlay: number | null;
  hookRate: string | null;
  holdRate: string | null;
  costPerResult: string | null;
  results: number | null;
  targetingAgeMin: number | null;
  targetingAgeMax: number | null;
  targetingGenders: string | null;
  targetingCountries: string | null;
}

export interface StoredAnalysis {
  id: number;
  pullId: number;
  status: string;
  dateRange: string | null;
  totalAngles: number | null;
  analysisData: string | null;
  priorityActions: string | null;
  createdAt: Date;
}

export interface QualityGateReviewData {
  runId: string;
  stepId: number;
  agentId: string;
  outputType: string;
  inputContent: string;
  decision: "approved" | "rejected";
  revisionFeedback?: string;
  revisionCount: number;
}

/**
 * Database adapter interface — implemented by the framework adapter layer.
 * All Drizzle ORM calls are behind this interface.
 */
export interface AdAnalysisDb {
  /** Get a specific pull by ID, or the latest completed pull if no ID provided */
  getPull(pullId?: number): Promise<AdPullRecord | null>;
  /** Load all ad rows for a pull (activeOnly filters to ACTIVE status only) */
  getAdDataForPull(pullId: number, activeOnly: boolean): Promise<RawAdDataRow[]>;
  /** Create a new analysis record in "running" status, returns the new ID */
  createAnalysis(data: { pullId: number; status: string; dateRange: string }): Promise<number>;
  /** Update an existing analysis record */
  updateAnalysis(id: number, data: {
    status?: string;
    totalAngles?: number;
    winners?: number;
    watches?: number;
    stops?: number;
    analysisData?: string;
    priorityActions?: string;
    errorMessage?: string;
  }): Promise<void>;
  /** Get the most recent completed analysis */
  getLatestCompletedAnalysis(): Promise<StoredAnalysis | null>;
  /** Get a list of recent analyses (summary only, no analysisData payload) */
  getRecentAnalyses(limit?: number): Promise<AnalysisSummary[]>;
  /** Log a Quality Gate review — optional, non-blocking */
  logQualityGateReview?: (data: QualityGateReviewData) => Promise<void>;
}

// ─── Deps Interface ───────────────────────────────────────────────────────────

export interface AdAnalysisDeps {
  /** LLM invocation function (Claude / OpenAI compatible) */
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  /** Watch a video by Instagram media ID — from video-analysis skill */
  watchVideo?: (mediaId: string) => Promise<VideoIntelligence>;
  /** Build LLM text context from VideoIntelligence — from video-analysis skill */
  buildVideoContext?: (vi: VideoIntelligence) => string;
  /** Retrieve formatted KB sections relevant to the given topics */
  getKbSections?: (topics: string[]) => Promise<string>;
  /** Database adapter */
  db: AdAnalysisDb;
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────

/**
 * Determine the dominant creative model for an angle.
 * Returns "video", "image", or "mixed" (≥20% of either type).
 */
function resolveScoreModel(ads: AdForAnalysis[]): "video" | "image" | "mixed" {
  const videoCount = ads.filter(a => a.creativeType === "video").length;
  const total = ads.length;
  if (total === 0) return "image";
  const videoPct = videoCount / total;
  if (videoPct >= 0.8) return "video";
  if (videoPct <= 0.2) return "image";
  return "mixed";
}

type AngleMetrics = {
  avgHookRate: number | null;
  avgHoldRate: number | null;
  avgCtr: number;
  avgCostPerResult: number | null;
  avgCpm: number;
};

/**
 * Calculate composite score for a single angle.
 *
 * Video model:           Hook 30% + Hold 20% + CTR 20% + CPR 30%
 * Image/Carousel model:  CTR 40% + CPR 40% + CPM 20%
 * Mixed:                 Weighted blend based on video ad proportion.
 *
 * All metrics normalised 0–100 relative to all angles in the account.
 * Cost metrics (CPR, CPM) are inverted — lower is better.
 */
function calculateCompositeScore(
  angle: AngleMetrics,
  scoreModel: "video" | "image" | "mixed",
  videoPct: number,
  allAngles: AngleMetrics[]
): number {
  // ── Normalisation helpers ──
  const norm = (val: number, max: number): number => max > 0 ? Math.min(100, (val / max) * 100) : 0;
  const normInv = (val: number | null, min: number | null, max: number | null): number => {
    if (val === null || min === null || max === null || max <= min) return 50;
    const score = ((max - val) / (max - min)) * 100;
    return Math.max(0, Math.min(100, score));
  };

  const maxHookRate = Math.max(...allAngles.map(a => a.avgHookRate ?? 0), 1);
  const maxHoldRate = Math.max(...allAngles.map(a => a.avgHoldRate ?? 0), 1);
  const maxCtr     = Math.max(...allAngles.map(a => a.avgCtr), 0.01);
  const maxCpm     = Math.max(...allAngles.map(a => a.avgCpm), 0.01);

  const validCprs = allAngles.map(a => a.avgCostPerResult).filter((c): c is number => c !== null && c > 0);
  const minCpr = validCprs.length > 0 ? Math.min(...validCprs) : null;
  const maxCpr = validCprs.length > 0 ? Math.max(...validCprs) : null;

  const validCpms = allAngles.map(a => a.avgCpm).filter(c => c > 0);
  const minCpm = validCpms.length > 0 ? Math.min(...validCpms) : null;
  const maxCpmVal = validCpms.length > 0 ? Math.max(...validCpms) : null;

  const hookScore = norm(angle.avgHookRate ?? 0, maxHookRate);
  const holdScore = norm(angle.avgHoldRate ?? 0, maxHoldRate);
  const ctrScore  = norm(angle.avgCtr, maxCtr);
  const cprScore  = normInv(angle.avgCostPerResult, minCpr, maxCpr);
  const cpmScore  = normInv(angle.avgCpm > 0 ? angle.avgCpm : null, minCpm, maxCpmVal ?? maxCpm);

  const videoScore = (hookScore * 0.30) + (holdScore * 0.20) + (ctrScore * 0.20) + (cprScore * 0.30);
  const imageScore = (ctrScore * 0.40) + (cprScore * 0.40) + (cpmScore * 0.20);

  if (scoreModel === "video") return videoScore;
  if (scoreModel === "image") return imageScore;
  // Mixed: blend proportionally
  return (videoScore * videoPct) + (imageScore * (1 - videoPct));
}

/**
 * Group ads by campaignId::angleLabel key.
 * Pure function — no deps required.
 */
export function groupAdsByAngle(ads: AdForAnalysis[]): Map<string, AdForAnalysis[]> {
  const groups = new Map<string, AdForAnalysis[]>();
  for (const ad of ads) {
    const key = `${ad.campaignId}::${ad.angleLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ad);
  }
  return groups;
}

/**
 * Score and classify all angles from a flat ad list.
 * Pure function — no deps required. Used by runAddyAnalysis and in tests.
 */
export function scoreAngles(ads: AdForAnalysis[]): AngleScore[] {
  const groups = groupAdsByAngle(ads);

  // First pass: aggregate metrics per angle
  const rawAngles: (Omit<AngleScore, "compositeScore" | "verdict" | "verdictReason"> & { videoPct: number })[] = [];

  for (const [, angleAds] of Array.from(groups.entries())) {
    const totalSpend       = angleAds.reduce((s, a) => s + a.amountSpent, 0);
    const totalImpressions = angleAds.reduce((s, a) => s + a.impressions, 0);
    const totalResults     = angleAds.reduce((s, a) => s + a.results, 0);
    const totalReach       = angleAds.reduce((s, a) => s + a.reach, 0);

    const hookAds = angleAds.filter(a => a.hookRate !== null);
    const avgHookRate = hookAds.length > 0
      ? hookAds.reduce((s, a) => s + a.hookRate!, 0) / hookAds.length
      : null;

    const holdAds = angleAds.filter(a => a.holdRate !== null);
    const avgHoldRate = holdAds.length > 0
      ? holdAds.reduce((s, a) => s + a.holdRate!, 0) / holdAds.length
      : null;

    const avgCtr = totalImpressions > 0
      ? angleAds.reduce((s, a) => s + (a.ctr * a.impressions), 0) / totalImpressions
      : 0;

    const cprAds = angleAds.filter(a => a.costPerResult !== null && a.costPerResult > 0);
    const avgCostPerResult = cprAds.length > 0
      ? cprAds.reduce((s, a) => s + a.costPerResult!, 0) / cprAds.length
      : null;

    const avgCpm = totalImpressions > 0
      ? angleAds.reduce((s, a) => s + (a.cpm * a.impressions), 0) / totalImpressions
      : 0;

    const avgFrequency = totalReach > 0 ? totalImpressions / totalReach : 0;

    const scoreModel = resolveScoreModel(angleAds);
    const videoPct   = angleAds.filter(a => a.creativeType === "video").length / Math.max(angleAds.length, 1);

    rawAngles.push({
      angleLabel:       angleAds[0].angleLabel,
      campaignName:     angleAds[0].campaignName,
      campaignObjective: angleAds[0].campaignObjective,
      adCount:          angleAds.length,
      totalSpend,
      totalImpressions,
      totalResults,
      avgHookRate,
      avgHoldRate,
      avgCtr,
      avgCostPerResult,
      avgCpm,
      avgFrequency,
      scoreModel,
      videoPct,
      ads: angleAds,
    });
  }

  // Second pass: compute composite scores with cross-angle normalisation
  const withScores = rawAngles.map(angle => ({
    ...angle,
    compositeScore: calculateCompositeScore(angle, angle.scoreModel, angle.videoPct, rawAngles),
  }));

  withScores.sort((a, b) => b.compositeScore - a.compositeScore);

  const total      = withScores.length;
  const top20pct   = Math.ceil(total * 0.2);
  const bottom30idx = Math.floor(total * 0.7);

  // Third pass: classify with hard-override conditions
  return withScores.map((angle, idx) => {
    // eslint-disable-next-line prefer-const
    let { videoPct: _vp, ...rest } = angle; void _vp;
    let verdict: "WINNER" | "WATCH" | "STOP";
    let verdictReason: string;

    if (angle.avgHookRate !== null && angle.avgHookRate < 15) {
      verdict = "STOP";
      verdictReason = `Hook Rate of ${angle.avgHookRate.toFixed(1)}% is below the 15% threshold — creative not stopping the scroll.`;
    } else if (angle.avgFrequency > 4.0) {
      verdict = "STOP";
      verdictReason = `Frequency of ${angle.avgFrequency.toFixed(1)} exceeds 4.0 — audience fatigue likely. Refresh before scaling.`;
    } else if (angle.totalSpend < 50) {
      verdict = "WATCH";
      verdictReason = `Only $${angle.totalSpend.toFixed(2)} spent — insufficient data. Minimum threshold is $50.`;
    } else if (angle.adCount < 3 && angle.totalSpend < 100) {
      verdict = "WATCH";
      verdictReason = `Only ${angle.adCount} ad(s) in this angle with limited spend — need more data before classifying.`;
    } else if (idx < top20pct && angle.totalSpend >= 50 && angle.adCount >= 3) {
      verdict = "WINNER";
      verdictReason = `Top ${Math.round((idx / Math.max(total, 1)) * 100)}% composite score (${angle.compositeScore.toFixed(1)}/100) with $${angle.totalSpend.toFixed(2)} spend across ${angle.adCount} ads.`;
    } else if (idx >= bottom30idx) {
      verdict = "STOP";
      verdictReason = `Bottom ${Math.round(((total - idx) / Math.max(total, 1)) * 100)}% composite score (${angle.compositeScore.toFixed(1)}/100). Underperforming relative to other angles.`;
    } else {
      verdict = "WATCH";
      verdictReason = `Mid-tier composite score (${angle.compositeScore.toFixed(1)}/100). Signals present but not yet conclusive.`;
    }

    return { ...rest, verdict, verdictReason };
  });
}

// ─── LLM Analysis ─────────────────────────────────────────────────────────────

function buildAddySystemPrompt(kbContext: string): string {
  return `You are Addy 🔍, Ads Analyzer for oh HACK no! Paid Media.

You receive structured ad data from Statsy and your job is to find the winning angles — the ones worth iterating and scaling into ad homeruns. Before you touch a single number, read the full creative: headline, primary text, CTA, and the image or video. Understand what the ad is trying to do and who it is talking to. Check the campaign objective. Then consult your Knowledge Base and pressure-test your thinking.

Score every angle using the type-specific model (video: Hook 30% + Hold 20% + CTR 20% + CPR 30%; image/carousel: CTR 40% + CPR 40% + CPM 20%). Classify as WINNER, WATCH, or STOP. For winners, tell us exactly what is working and what to test next. For stops, tell us exactly why and what to change. Never assume. Never separate numbers from creatives. End every analysis with a maximum 5-action Priority List. Be fast, be specific, be right.

PERSONALITY: Sharp, opinionated, and fast-moving. Thinks like a performance creative director — equal parts data analyst and creative strategist. Deeply respects context. Will never call an ad "bad" without understanding what it was trying to do. Hates wasted spend. Loves a winning angle. Always cites the data behind every opinion.

RULES:
- Never analyse a metric without first reading the full creative context (headline + primary text + CTA + creative asset)
- Never assume what an ad is trying to do — always read the campaign objective and creative before forming an opinion
- Never give a verdict on an angle with less than $50 spent — flag it as insufficient data instead
- Never make a recommendation that contradicts the Knowledge Base without explicitly flagging the contradiction and explaining the reasoning
- Never use vague language — every recommendation must be specific, actionable, and tied to a data point and a creative observation
- Never recommend scaling an angle with a Frequency above 4.0 — flag audience fatigue first
- Never look at ads in isolation — always compare to the other angles running in the same campaign
- For image/carousel angles, do not reference Hook Rate or Hold Rate (not applicable)

KNOWLEDGE BASE (M4 Method — Meta Ads Framework):
${kbContext}`;
}

async function analyseAngleWithLLM(
  angle: AngleScore,
  allAngles: AngleScore[],
  kbContext: string,
  deps: AdAnalysisDeps
): Promise<AngleLLMInsight> {
  const systemPrompt = buildAddySystemPrompt(kbContext);

  const adContexts = angle.ads.map(ad => {
    const lines = [
      `AD: ${ad.adName}`,
      `Status: ${ad.adStatus}`,
      `Creative Type: ${ad.creativeType}`,
      `Headline: ${ad.headline ?? "N/A"}`,
      `Primary Text: ${ad.primaryText ? ad.primaryText.slice(0, 300) : "N/A"}`,
      `CTA: ${ad.cta ?? "N/A"}`,
      `Spend: $${ad.amountSpent.toFixed(2)}`,
      `Impressions: ${ad.impressions.toLocaleString()}`,
      `Frequency: ${ad.frequency.toFixed(2)}`,
      `CTR: ${ad.ctr.toFixed(2)}%`,
      `CPM: $${ad.cpm.toFixed(2)}`,
      `Hook Rate: ${ad.hookRate !== null ? ad.hookRate.toFixed(1) + "%" : "N/A (non-video)"}`,
      `Hold Rate: ${ad.holdRate !== null ? ad.holdRate.toFixed(1) + "%" : "N/A (non-video)"}`,
      `Results: ${ad.results}`,
      `Cost per Result: ${ad.costPerResult !== null ? "$" + ad.costPerResult.toFixed(2) : "N/A"}`,
    ];
    if (ad.creativeUrl) lines.push(`Creative URL: ${ad.creativeUrl}`);
    return lines.join("\n");
  }).join("\n\n---\n\n");

  const comparisonContext = allAngles
    .map(a => `${a.angleLabel}: Score ${a.compositeScore.toFixed(1)} [${a.scoreModel}], Spend $${a.totalSpend.toFixed(2)}, ${a.verdict}`)
    .join("\n");

  // ── Video analysis (if applicable and deps provided) ──
  const isVideoAngle = angle.ads.some(a => a.creativeType === "video");
  let videoContext: string | null = null;
  let videoFrameUrls: string[] = [];

  if (isVideoAngle && deps.watchVideo && deps.buildVideoContext) {
    const adWithMediaId = angle.ads.find(a => a.instagramMediaId);
    if (adWithMediaId?.instagramMediaId) {
      try {
        const vi = await deps.watchVideo(adWithMediaId.instagramMediaId);
        videoContext = deps.buildVideoContext(vi);
        videoFrameUrls = vi.frames.map(f => f.url);
      } catch (err) {
        console.warn(`[ad-analysis] watchVideo failed for ${adWithMediaId.instagramMediaId}:`, err);
        // Non-fatal — fall through to thumbnail fallback
      }
    }
  }

  const representativeAd = angle.ads.find(a => a.creativeS3Url ?? a.creativeUrl) ?? angle.ads[0];
  const bestImageUrl     = representativeAd?.creativeS3Url ?? representativeAd?.creativeUrl ?? null;
  const hasCreativeUrl   = videoFrameUrls.length > 0 || !!bestImageUrl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMessageContent: any[] = [
    {
      type: "text",
      text: `Analyse the following angle from the OHN Instagram ad account.

ANGLE: ${angle.angleLabel}
CAMPAIGN: ${angle.campaignName}
CAMPAIGN OBJECTIVE: ${angle.campaignObjective ?? "Unknown"}
SCORE MODEL: ${angle.scoreModel}
VERDICT (data-driven): ${angle.verdict}
VERDICT REASON: ${angle.verdictReason}
COMPOSITE SCORE: ${angle.compositeScore.toFixed(1)}/100
TOTAL SPEND: $${angle.totalSpend.toFixed(2)}
AVG HOOK RATE: ${angle.avgHookRate !== null ? angle.avgHookRate.toFixed(1) + "%" : "N/A"}
AVG HOLD RATE: ${angle.avgHoldRate !== null ? angle.avgHoldRate.toFixed(1) + "%" : "N/A"}
AVG CTR: ${angle.avgCtr.toFixed(2)}%
AVG CPM: $${angle.avgCpm.toFixed(2)}
AVG COST PER RESULT: ${angle.avgCostPerResult !== null ? "$" + angle.avgCostPerResult.toFixed(2) : "N/A"}
AVG FREQUENCY: ${angle.avgFrequency.toFixed(2)}
AD COUNT: ${angle.adCount}

ADS IN THIS ANGLE:
${adContexts}

ALL ANGLES IN ACCOUNT (for comparison):
${comparisonContext}

${videoContext ? `VIDEO CREATIVE ANALYSIS:\n${videoContext}\n\nAll video frames are attached below. Read the transcript and frames together before forming your analysis.` : hasCreativeUrl ? "The representative creative image is attached. Read it carefully before forming your analysis." : "No creative asset available — base analysis on copy and data only."}

Provide your analysis in this exact JSON structure:
{
  "creativeReading": "What is this ad actually communicating? What emotion or action is it designed to trigger? What is the creative doing well or poorly? (2-3 sentences, specific)",
  "dataInsight": "What does the data tell you about this angle's performance? Cite specific numbers. Compare to other angles where relevant. (2-3 sentences)",
  "recommendation": "What specific action should be taken? Be direct — what to change, test, pause, or scale. (2-3 sentences)",
  "kbPrinciple": "Which principle from the Knowledge Base applies here? Quote it briefly and state whether your recommendation aligns with or contradicts it. (1-2 sentences)",
  "budgetAction": "WINNER: specific budget multiplier. STOP: pause immediately or iterate with X change. WATCH: minimum spend/impression threshold before next decision. (1 sentence)"
}`
    }
  ];

  // Attach visual content
  if (videoFrameUrls.length > 0) {
    for (const frameUrl of videoFrameUrls) {
      userMessageContent.push({ type: "image_url", image_url: { url: frameUrl } });
    }
  } else if (hasCreativeUrl && bestImageUrl) {
    userMessageContent.push({ type: "image_url", image_url: { url: bestImageUrl } });
  }

  try {
    const response = await deps.invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessageContent }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "addy_angle_insight",
          strict: true,
          schema: {
            type: "object",
            properties: {
              creativeReading: { type: "string" },
              dataInsight:     { type: "string" },
              recommendation:  { type: "string" },
              kbPrinciple:     { type: "string" },
              budgetAction:    { type: "string" }
            },
            required: ["creativeReading", "dataInsight", "recommendation", "kbPrinciple", "budgetAction"],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    const parsed  = typeof content === "string" ? JSON.parse(content) : content;

    return {
      angleLabel:      angle.angleLabel,
      verdict:         angle.verdict,
      creativeReading: parsed.creativeReading ?? "",
      dataInsight:     parsed.dataInsight ?? "",
      recommendation:  parsed.recommendation ?? "",
      kbPrinciple:     parsed.kbPrinciple ?? "",
      budgetAction:    parsed.budgetAction ?? "",
    };
  } catch {
    return {
      angleLabel:      angle.angleLabel,
      verdict:         angle.verdict,
      creativeReading: "Creative analysis unavailable.",
      dataInsight:     angle.verdictReason,
      recommendation:  angle.verdict === "WINNER" ? "Scale this angle." : angle.verdict === "STOP" ? "Pause or iterate." : "Monitor for 48 hours.",
      kbPrinciple:     "Analysis error — KB consultation skipped.",
      budgetAction:    "",
    };
  }
}

async function generatePriorityActions(
  angles: AngleScore[],
  insights: AngleLLMInsight[],
  kbContext: string,
  deps: AdAnalysisDeps
): Promise<string[]> {
  const systemPrompt = buildAddySystemPrompt(kbContext);

  const summary = angles.map(a => {
    const insight = insights.find(i => i.angleLabel === a.angleLabel);
    return `${a.verdict} | ${a.angleLabel} | Score: ${a.compositeScore.toFixed(1)} [${a.scoreModel}] | Spend: $${a.totalSpend.toFixed(2)} | ${insight?.recommendation ?? a.verdictReason}`;
  }).join("\n");

  try {
    const response = await deps.invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Based on the following angle analysis for the OHN Instagram ad account, generate a Priority Action List of maximum 5 actions, ranked by estimated impact on results. Write each action as a direct instruction — specific, actionable, tied to a data point.

ANGLE SUMMARY:
${summary}

Respond with a JSON object containing an "actions" array of 1–5 strings. Example:
{"actions": ["1. Increase budget on Angle_X from $30/day to $60/day — Hook Rate 38%, top performer.", "2. Pause Angle_Y immediately — Hook Rate 9%, creative not stopping scroll."]}`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "priority_actions",
          strict: true,
          schema: {
            type: "object",
            properties: {
              actions: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 5
              }
            },
            required: ["actions"],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    const parsed  = typeof content === "string" ? JSON.parse(content) : content;
    return parsed.actions ?? [];
  } catch {
    // Fallback: generate directly from data
    const actions: string[] = [];
    const winners = angles.filter(a => a.verdict === "WINNER").slice(0, 2);
    const stops   = angles.filter(a => a.verdict === "STOP").slice(0, 2);
    const watches = angles.filter(a => a.verdict === "WATCH").slice(0, 1);

    for (const w of winners) {
      actions.push(`Scale ${w.angleLabel} — composite ${w.compositeScore.toFixed(0)}/100, $${w.totalSpend.toFixed(0)} spend. Increase daily budget by 1.5×.`);
    }
    for (const s of stops) {
      actions.push(`Pause ${s.angleLabel} — ${s.verdictReason}`);
    }
    for (const w of watches) {
      actions.push(`Monitor ${w.angleLabel} — ${w.verdictReason}`);
    }
    return actions.slice(0, 5);
  }
}

// ─── Ad Row Converter ─────────────────────────────────────────────────────────

function rowToAdForAnalysis(row: RawAdDataRow): AdForAnalysis {
  return {
    adId:              row.adId ?? "",
    adName:            row.adName ?? "",
    adStatus:          row.adStatus ?? "UNKNOWN",
    campaignName:      row.campaignName ?? "",
    campaignId:        row.campaignId ?? "",
    campaignObjective: row.campaignObjective ?? null,
    adSetName:         row.adSetName ?? "",
    adSetId:           row.adSetId ?? "",
    angleLabel:        row.angleLabel ?? row.adSetName ?? "Unknown Angle",
    creativeType:      row.creativeType ?? "unknown",
    primaryText:       row.primaryText ?? null,
    headline:          row.headline ?? null,
    cta:               row.cta ?? null,
    creativeUrl:       row.creativeUrl ?? null,
    creativeS3Url:     row.creativeS3Url ?? null,
    instagramMediaId:  row.instagramMediaId ?? null,
    impressions:       row.impressions ?? 0,
    reach:             row.reach ?? 0,
    frequency:         row.reach && row.reach > 0 ? (row.impressions ?? 0) / row.reach : 0,
    amountSpent:       parseFloat(row.amountSpent ?? "0") || 0,
    cpm:               parseFloat(row.cpm ?? "0") || 0,
    ctr:               parseFloat(row.ctr ?? "0") || 0,
    cpc:               parseFloat(row.cpc ?? "0") || 0,
    videoViews3s:      row.videoViews3s ?? 0,
    thruPlay:          row.thruPlay ?? 0,
    hookRate:          row.hookRate ? parseFloat(row.hookRate) : null,
    holdRate:          row.holdRate ? parseFloat(row.holdRate) : null,
    costPerResult:     row.costPerResult ? parseFloat(row.costPerResult) : null,
    results:           row.results ?? 0,
    targetingAgeMin:   row.targetingAgeMin ?? null,
    targetingAgeMax:   row.targetingAgeMax ?? null,
    targetingGenders:  row.targetingGenders ? JSON.parse(row.targetingGenders) : null,
    targetingCountries: row.targetingCountries ? JSON.parse(row.targetingCountries) : null,
  };
}

// ─── Main Exported Functions ──────────────────────────────────────────────────

/**
 * Run a full Addy analysis on a Statsy pull.
 * Loads ads, scores angles, generates LLM insights, stores result in DB.
 *
 * @param deps       - All external dependencies (LLM, DB, optional video/KB)
 * @param pullId     - Specific pull ID to analyse; defaults to latest completed pull
 * @param activeOnly - If true, only analyse ACTIVE ads (default: false)
 */
export async function runAddyAnalysis(
  deps: AdAnalysisDeps,
  pullId?: number,
  activeOnly = false
): Promise<AddyAnalysisResult> {
  const pull = await deps.db.getPull(pullId);
  if (!pull) {
    throw new Error(
      pullId
        ? `Pull #${pullId} not found.`
        : "No completed Statsy pull found. Run a Statsy pull first."
    );
  }

  const analysisId = await deps.db.createAnalysis({
    pullId:    pull.id,
    status:    "running",
    dateRange: pull.dateRange,
  });

  try {
    // ── Load ad data ──
    const rawRows = await deps.db.getAdDataForPull(pull.id, activeOnly);

    if (rawRows.length === 0) {
      throw new Error(
        activeOnly
          ? "No ACTIVE ads found in this pull. All ads may be paused or inactive."
          : "No ad data found for this pull. The pull may have returned no ads."
      );
    }

    const ads = rawRows.map(rowToAdForAnalysis);

    // ── Score angles ──
    const scoredAngles = scoreAngles(ads);

    // ── Get KB context ──
    const kbTopics = [
      "hook rate", "hold rate", "CTR", "CPM", "creative testing", "angle",
      "winner", "stop", "scale", "iteration", "concept", "pack",
      "frequency", "audience fatigue", "budget", "image", "video", "carousel"
    ];
    const kbContext = deps.getKbSections
      ? await deps.getKbSections(kbTopics)
      : "";

    // ── LLM insights (top 10 angles to manage API cost) ──
    const anglesToAnalyse = scoredAngles.slice(0, 10);
    const llmInsights: AngleLLMInsight[] = [];

    for (const angle of anglesToAnalyse) {
      const insight = await analyseAngleWithLLM(angle, scoredAngles, kbContext, deps);
      llmInsights.push(insight);
    }

    // ── Priority Action List ──
    const priorityActions = await generatePriorityActions(scoredAngles, llmInsights, kbContext, deps);

    // ── Classify ──
    const winners = scoredAngles.filter(a => a.verdict === "WINNER");
    const watches = scoredAngles.filter(a => a.verdict === "WATCH");
    const stops   = scoredAngles.filter(a => a.verdict === "STOP");

    // ── Persist ──
    await deps.db.updateAnalysis(analysisId, {
      status:        "completed",
      totalAngles:   scoredAngles.length,
      winners:       winners.length,
      watches:       watches.length,
      stops:         stops.length,
      analysisData:  JSON.stringify({ angles: scoredAngles, insights: llmInsights }),
      priorityActions: JSON.stringify(priorityActions),
    });

    // ── Quality Gate review log (non-blocking, optional) ──
    if (deps.db.logQualityGateReview) {
      deps.db.logQualityGateReview({
        runId:          `addy-${analysisId}`,
        stepId:         analysisId,
        agentId:        "addy",
        outputType:     "ad_analysis",
        inputContent:   JSON.stringify({ angles: scoredAngles, insights: llmInsights, priorityActions }),
        decision:       "approved",
        revisionCount:  0,
      }).catch(() => { /* non-blocking */ });
    }

    return {
      analysisId,
      pullId:       pull.id,
      dateRange:    pull.dateRange,
      totalAngles:  scoredAngles.length,
      winners,
      watches,
      stops,
      priorityActions,
      llmInsights,
      createdAt:    new Date().toISOString(),
    };
  } catch (err) {
    await deps.db.updateAnalysis(analysisId, {
      status:       "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get the most recent completed Addy analysis from the database.
 * No API calls — DB read only.
 */
export async function getLatestAddyAnalysis(
  deps: Pick<AdAnalysisDeps, "db">
): Promise<AddyAnalysisResult | null> {
  const latest = await deps.db.getLatestCompletedAnalysis();
  if (!latest) return null;

  const analysisData  = latest.analysisData ? JSON.parse(latest.analysisData) : { angles: [], insights: [] };
  const angles:   AngleScore[]     = analysisData.angles  ?? [];
  const insights: AngleLLMInsight[] = analysisData.insights ?? [];
  const priorityActions: string[]  = latest.priorityActions ? JSON.parse(latest.priorityActions) : [];

  return {
    analysisId:   latest.id,
    pullId:       latest.pullId,
    dateRange:    latest.dateRange ?? "",
    totalAngles:  latest.totalAngles ?? 0,
    winners:      angles.filter(a => a.verdict === "WINNER"),
    watches:      angles.filter(a => a.verdict === "WATCH"),
    stops:        angles.filter(a => a.verdict === "STOP"),
    priorityActions,
    llmInsights:  insights,
    createdAt:    latest.createdAt.toISOString(),
  };
}

/**
 * Get a list of recent analysis runs (summary only — no full analysisData payload).
 */
export async function getRecentAddyAnalyses(
  deps: Pick<AdAnalysisDeps, "db">,
  limit = 10
): Promise<AnalysisSummary[]> {
  return deps.db.getRecentAnalyses(limit);
}

// ─── Benchmark Helpers (re-exported from paid-media-analytics) ────────────────
// These are duplicated here so callers don't need to import two skills.

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
