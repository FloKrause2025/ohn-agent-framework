/**
 * agents/googly/index.ts
 *
 * Googly 🔍 — Deep Research Specialist
 *
 * Step 1: Haiku call — extract scam topic from raw Reddit text
 * Step 2: 3 focused Serper queries
 * Step 3: Return top results tier-ranked (Tier 1 > Tier 2 > Tier 3)
 *
 * No LLM report generation — keeps total time well under Vercel's 60s limit.
 */

import type { RequestLogger } from "../../ui/logger.js";
import type { LLMInvokeParams, LLMResponse } from "../researchy/index.js";

// ─── Re-export shared LLM types ───────────────────────────────────────────────
export type { LLMInvokeParams, LLMResponse };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GooglyInput {
  /** Raw Reddit post body — Googly extracts the scam type from this. */
  rawText?: string;
  /** Pre-extracted topic — used when caller already knows it. */
  topic?: string;
  scannedAt?: string;
}

export interface GooglySource {
  title: string;
  url: string;
  snippet: string;
  tier: "TIER 1 ✅" | "TIER 2 ✅" | "TIER 3 ❌";
  query: string;
}

export interface GooglyResult {
  rawText?: string;
  topic: string;
  topicReasoning?: string;
  /** Top results returned to the UI — Tier 1 first, then Tier 2, Tier 3 last */
  sources: GooglySource[];
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSources: number;
  queriesRun: number;
}

export interface GooglyProgressEvent {
  step: "extracting_topic" | "searching" | "done";
  message: string;
  data?: Record<string, unknown>;
}

export interface GooglyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  serperApiKey: string;
  logger?: RequestLogger;
  onProgress?: (event: GooglyProgressEvent) => void;
}

// ─── Tier Domain Lists ────────────────────────────────────────────────────────

const TIER1_DOMAINS = [
  "cisa.gov", "ncsc.gov.uk", "fbi.gov", "ftc.gov", "consumer.ftc.gov",
  "ic3.gov", "actionfraud.police.uk", "cyber.gov.au", "canada.ca",
  "irs.gov", "hmrc.gov.uk", "usa.gov", "scamwatch.gov.au",
];

const TIER2_DOMAINS = [
  "norton.com", "kaspersky.com", "malwarebytes.com", "sophos.com",
  "bbc.com", "bbc.co.uk", "reuters.com", "theguardian.com",
  "consumerreports.org", "which.co.uk", "aarp.org",
  "proofpoint.com", "mimecast.com",
];

function getTier(url: string): GooglySource["tier"] {
  if (TIER1_DOMAINS.some(d => url.includes(d))) return "TIER 1 ✅";
  if (TIER2_DOMAINS.some(d => url.includes(d))) return "TIER 2 ✅";
  return "TIER 3 ❌";
}

// ─── Topic Extraction ─────────────────────────────────────────────────────────

async function extractScamTopic(
  rawText: string,
  invokeLLM: GooglyDeps["invokeLLM"],
  log?: RequestLogger,
): Promise<{ topic: string; reasoning: string }> {
  log?.info("googly", "Extracting scam topic from raw text");

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "system",
        content: `Extract the scam type from a Reddit post. Output JSON only: {"topic":"2-5 word scam label optimised for Google search","reasoning":"one sentence"}`,
      },
      {
        role: "user",
        content: rawText.slice(0, 1500),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scam_topic",
        strict: true,
        schema: {
          type: "object",
          properties: {
            topic:     { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["topic", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { topic: string; reasoning: string };
    log?.info("googly", `Topic extracted: "${parsed.topic}"`);
    return parsed;
  } catch {
    const fallback = rawText.slice(0, 50).trim();
    log?.warn("googly", `Parse failed — using fallback: "${fallback}"`);
    return { topic: fallback, reasoning: "Fallback extraction." };
  }
}

// ─── Serper Search ────────────────────────────────────────────────────────────

async function serperSearch(
  query: string,
  apiKey: string,
  num = 5,
): Promise<Array<{ title: string; link: string; snippet: string }>> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num, gl: "us", hl: "en" }),
    });
    const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runGoogly(
  input: GooglyInput,
  deps: GooglyDeps,
): Promise<GooglyResult> {
  const { rawText, scannedAt = new Date().toISOString() } = input;
  const { invokeLLM, serperApiKey, logger: log, onProgress } = deps;

  // ── Step 1: Extract topic ─────────────────────────────────────────────────
  let topic = input.topic ?? "";
  let topicReasoning: string | undefined;

  if (rawText) {
    onProgress?.({ step: "extracting_topic", message: "Identifying scam type from your text…" });
    const extracted = await extractScamTopic(rawText, invokeLLM, log);
    topic = extracted.topic;
    topicReasoning = extracted.reasoning;
    onProgress?.({ step: "extracting_topic", message: `Topic: "${topic}" — ${extracted.reasoning}`, data: { topic, reasoning: topicReasoning } });
  }

  if (!topic) throw new Error("Provide either rawText or a topic.");

  // ── Step 2: 3 focused Serper queries ─────────────────────────────────────
  const queries = [
    `${topic} scam`,
    `${topic} scam site:ftc.gov OR site:fbi.gov OR site:ncsc.gov.uk OR site:consumer.ftc.gov OR site:actionfraud.police.uk OR site:scamwatch.gov.au`,
    `${topic} scam warning signs how to protect yourself site:norton.com OR site:kaspersky.com OR site:aarp.org OR site:malwarebytes.com`,
  ];

  log?.info("googly", `Running ${queries.length} Serper queries for "${topic}"`);
  onProgress?.({ step: "searching", message: `Searching for "${topic}" across trusted sources…` });

  const rawResults = await Promise.all(
    queries.map(async (q) => {
      const results = await serperSearch(q, serperApiKey, 5);
      return results.map(r => ({ ...r, query: q }));
    })
  );

  // ── Step 3: Deduplicate + tier-rank ───────────────────────────────────────
  const seen = new Set<string>();
  const allSources: GooglySource[] = [];

  for (const batch of rawResults) {
    for (const item of batch) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      allSources.push({
        title:   item.title,
        url:     item.link,
        snippet: item.snippet ?? "",
        tier:    getTier(item.link),
        query:   item.query,
      });
    }
  }

  const tier1 = allSources.filter(s => s.tier === "TIER 1 ✅");
  const tier2 = allSources.filter(s => s.tier === "TIER 2 ✅");
  const tier3 = allSources.filter(s => s.tier === "TIER 3 ❌");
  const sorted = [...tier1, ...tier2, ...tier3];

  log?.info("googly", `Done — Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length}`);
  log?.debug("googly", "All sources", sorted.map(s => ({ title: s.title, url: s.url, tier: s.tier })));

  onProgress?.({
    step: "done",
    message: `Found ${sorted.length} sources — ${tier1.length} government, ${tier2.length} cybersec/news, ${tier3.length} other`,
    data: { tier1Count: tier1.length, tier2Count: tier2.length, tier3Count: tier3.length },
  });

  return {
    rawText,
    topic,
    topicReasoning,
    sources: sorted,
    tier1Count: tier1.length,
    tier2Count: tier2.length,
    tier3Count: tier3.length,
    totalSources: sorted.length,
    queriesRun: queries.length,
  };
}
