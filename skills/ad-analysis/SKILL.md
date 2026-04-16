---
name: ad-analysis
version: 1.0
used_by: [addy, paid-marketing]
inputs: [AdAnalysisDeps, pullId?, activeOnly?]
outputs: [AddyAnalysisResult]
---

## What This Skill Does

Scores every ad angle in the Meta Ads account using a composite performance
model, classifies each as WINNER / WATCH / STOP, generates LLM creative
insights per angle (vision-enabled for video), and produces a ranked Priority
Action List of max 5 actions. Stores the result in the database.

## Why It Exists

Raw numbers from Statsy mean nothing without context. Addy connects the
creative (what the ad is saying and showing) to the data (how the audience
responded) and tells the team exactly what to do next — scale, iterate, or
stop. The feedback loop runs: Statsy pulls → Addy scores → decisions made.

## Architecture Changes (vs Original)

**Original flaws:**
1. Direct imports of `invokeLLM`, `getDb`, `saveQualityGateReview`, all Drizzle
   schema tables, and `watchVideo`/`buildVideoContext` — completely coupled to
   one framework.
2. Single scoring formula used for ALL creative types, including image and
   carousel ads where Hook Rate and Hold Rate are always null — those weights
   were wasted and image ads were systematically under-scored.

**This version:**
1. All external dependencies injected via `AdAnalysisDeps` — LLM caller, video
   watcher, video context builder, KB retrieval, and database adapter.
2. **Type-specific scoring models** (the key fix):
   - **Video:** Hook Rate 30% + Hold Rate 20% + CTR 20% + Cost/Result 30%
   - **Image/Carousel:** CTR 40% + Cost/Result 40% + CPM 20%
   - **Mixed angles:** Weighted blend based on proportion of video vs image ads
3. KB retrieval abstracted behind `deps.getKbSections()` — can query DB table
   or load from file depending on adapter.

## Scoring Model

### Video Angles
| Metric | Weight | Rationale |
|---|---|---|
| Hook Rate | 30% | Primary video health signal |
| Hold Rate | 20% | Retention depth indicator |
| CTR | 20% | Click intent signal |
| Cost / Result | 30% | Business outcome (highest weight) |

### Image / Carousel Angles
| Metric | Weight | Rationale |
|---|---|---|
| CTR | 40% | Primary engagement signal (no video metrics) |
| Cost / Result | 40% | Business outcome |
| CPM | 20% | Inverted — lower CPM = higher score |

All metrics normalised 0–100 relative to other angles in the same account.
Cost per Result and CPM are inverted (lower = better).

## Verdict Classification

| Verdict | Condition |
|---|---|
| 🏆 WINNER | Top 20% composite score + ≥$50 spend + ≥3 ads in angle |
| 👀 WATCH | Mid-tier OR insufficient data (<$50 spend or <3 ads) |
| 🔴 STOP | Bottom 30% composite score, OR Hook Rate <15%, OR Frequency >4.0 |

Hard STOP conditions override score-based classification.

## Inputs

```ts
interface AdAnalysisDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  watchVideo?: (mediaId: string) => Promise<VideoIntelligence>;
  buildVideoContext?: (vi: VideoIntelligence) => string;
  getKbSections?: (topics: string[]) => Promise<string>;
  db: AdAnalysisDb;
}

runAddyAnalysis(deps: AdAnalysisDeps, pullId?: number, activeOnly?: boolean): Promise<AddyAnalysisResult>
getLatestAddyAnalysis(deps: AdAnalysisDeps): Promise<AddyAnalysisResult | null>
getRecentAddyAnalyses(deps: AdAnalysisDeps, limit?: number): Promise<AnalysisSummary[]>
```

## Key Outputs

```ts
interface AddyAnalysisResult {
  analysisId: number;
  pullId: number;
  dateRange: string;
  totalAngles: number;
  winners: AngleScore[];
  watches: AngleScore[];
  stops: AngleScore[];
  priorityActions: string[];     // max 5 ranked actions
  llmInsights: AngleLLMInsight[];
  createdAt: string;
}

interface AngleScore {
  angleLabel: string;
  campaignName: string;
  compositeScore: number;        // 0–100 normalised
  verdict: "WINNER" | "WATCH" | "STOP";
  verdictReason: string;
  scoreModel: "video" | "image" | "mixed";  // NEW — which model was applied
  ads: AdForAnalysis[];
}
```

## Pure Functions (no deps required)

- `groupAdsByAngle(ads)` — groups ads by `campaignId::angleLabel`
- `scoreAngles(ads)` — full scoring pipeline, returns classified `AngleScore[]`
- `benchmarkHookRate(rate)`, `benchmarkHoldRate(rate)`, `benchmarkCtr(rate)`,
  `benchmarkFrequency(freq)` — re-exported from paid-media-analytics

## Constraints

- Angles with <$50 spend are always WATCH (never WINNER or STOP)
- Angles with Frequency >4.0 are always STOP regardless of score
- LLM analysis limited to top 10 angles per run (API cost management)
- Vision analysis: video frames from `watchVideo()` preferred; falls back to
  S3 thumbnail if no Instagram media ID; text-only if neither available
- Historical analyses never overwritten — each run creates a new record
