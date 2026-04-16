/**
 * agents/googly/index.ts
 *
 * Googly 🔍 — Deep Research Specialist
 *
 * Receives a scam topic (from a Reddit post or manual input) and produces a
 * full 7-section research report using Serper (Google Search API).
 *
 * Sources are tier-ranked:
 *   TIER 1 ✅ — Government / law enforcement agencies
 *   TIER 2 ✅ — Major cybersecurity companies / reputable news
 *   TIER 3 ❌ — Reddit, forums, blogs, social media — rejected
 *
 * Ported from ohn-manus-agents/server/agents/googly/googly.core.ts
 * Adapted for the test framework: injected deps, no DB, no QA Gate.
 */

import type { RequestLogger } from "../../ui/logger.js";
import type { LLMInvokeParams, LLMResponse } from "../researchy/index.js";

// ─── Re-export shared LLM types (so ui/server.ts can import from here) ────────
export type { LLMInvokeParams, LLMResponse };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GooglyInput {
  /**
   * Raw Reddit post body text — Googly will extract the scam type from this.
   * Provide either rawText OR topic, not both. rawText takes priority.
   */
  rawText?: string;
  /**
   * Pre-extracted scam topic — used when the caller already knows the topic
   * (e.g. direct testing). If rawText is provided this is ignored.
   */
  topic?: string;
  /** Optional angle / framing passed in from Researchy */
  angle?: string;
  /** ISO timestamp of the triggering Reddit post, or now() */
  scannedAt?: string;
}

export interface GooglySource {
  title: string;
  url: string;
  snippet: string;
  tier: "TIER 1 ✅" | "TIER 2 ✅" | "TIER 3 ❌";
}

export interface GooglyResult {
  /** The raw Reddit post text that was analysed (if provided) */
  rawText?: string;
  /** The scam topic extracted by LLM, or the directly-provided topic */
  topic: string;
  /** One-sentence explanation of why Googly chose this search query */
  topicReasoning?: string;
  report: string;
  sources: GooglySource[];
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSources: number;
  queriesRun: number;
}

export interface GooglyProgressEvent {
  step: "extracting_topic" | "searching" | "ranking_sources" | "writing_report";
  message: string;
  data?: Record<string, unknown>;
}

export interface GooglyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  serperApiKey: string;
  logger?: RequestLogger;
  /** Called after each major step — used by SSE endpoint to push progress to browser */
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

// ─── System Prompt ────────────────────────────────────────────────────────────

// Kept deliberately short (~300 tokens) to stay within Vercel's 60s function limit.
const GOOGLY_SYSTEM_PROMPT = `You are Googly 🔍, scam researcher for oh HACK no! Write a 7-section research report on the scam topic provided. Audience: non-technical adults aged 50-75. Plain English only.

Only use the TIER 1/TIER 2 sources given. Never invent facts. Never cite a URL you were not given.

Output this exact format — no JSON, no deviations:

GOOGLY RESEARCH REPORT
Topic: [topic] | Date: [date] | Sources used: [n]

Section 1 — What is the scam?
[2-3 plain-English sentences]
Key findings: [3 bullets]
Sources: [Name — URL]

Section 2 — How do scammers do it?
[2-3 sentences on tactics]
Key findings: [3 bullets]
Sources: [Name — URL]

Section 3 — How to spot it?
[2-3 sentences on red flags]
Key findings: [3 bullets]
Sources: [Name — URL]

Section 4 — What to do when targeted?
[2-3 sentences of practical advice]
Key findings: [3 bullets]
Sources: [Name — URL]

Section 5 — How to report it?
[Name reporting bodies for USA, UK, Australia with URLs]
Key findings: [3 bullets with body name, country, URL]
Sources: [Name — URL]

Section 6 — Unverified items ⚠️
[Any unverified claims, or write: None — all verified.]

Section 7 — Plain language flags 📝
[Any jargon a 65-year-old wouldn't understand, or write: No jargon found.]`;

// ─── Topic Extraction ─────────────────────────────────────────────────────────

interface ExtractedTopic {
  topic: string;
  reasoning: string;
}

async function extractScamTopic(
  rawText: string,
  invokeLLM: GooglyDeps["invokeLLM"],
  log?: RequestLogger,
): Promise<ExtractedTopic> {
  log?.info("googly", "Extracting scam topic from raw text");

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    messages: [
      {
        role: "system",
        content: `You are a scam classification assistant. Your ONLY job is to read a Reddit post and output JSON with two fields:
- "topic": a concise 2-5 word scam type label, optimized as a Google search query (e.g. "PayPal overpayment scam", "online marketplace prop scam", "romance scam advance payment", "fake tech support scam"). Make it specific enough to get useful search results.
- "reasoning": one sentence explaining what type of scam this appears to be.

Output ONLY valid JSON. No markdown. No explanation outside the JSON.
Example: {"topic":"PayPal goods not received scam","reasoning":"The seller is pushing for more sales after a deal, a classic overpayment or non-delivery scam pattern."}`
      },
      {
        role: "user",
        content: `Reddit post text:\n\n${rawText.slice(0, 2000)}\n\nExtract the scam topic as JSON.`,
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

  const raw = response.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw) as ExtractedTopic;
    log?.info("googly", `Extracted topic: "${parsed.topic}" — ${parsed.reasoning}`);
    return parsed;
  } catch {
    // Fallback: use first 60 chars of raw text as topic
    const fallback = rawText.slice(0, 60).trim();
    log?.warn?.("googly", `Topic extraction parse failed, using fallback: "${fallback}"`);
    return { topic: fallback, reasoning: "Fallback — could not parse LLM response." };
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
  const { rawText, angle, scannedAt = new Date().toISOString() } = input;
  const { invokeLLM, serperApiKey, logger: log, onProgress } = deps;

  // ── Step 1: Extract the scam topic from raw text (if provided) ───────────
  let topic = input.topic ?? "";
  let topicReasoning: string | undefined;

  if (rawText) {
    log?.info("googly", "Raw text received — running topic extraction step");
    log?.debug("googly", "Raw text", { rawText });
    onProgress?.({ step: "extracting_topic", message: "Analysing your text to identify the scam type…" });
    const extracted = await extractScamTopic(rawText, invokeLLM, log);
    topic = extracted.topic;
    topicReasoning = extracted.reasoning;
    onProgress?.({ step: "extracting_topic", message: `Topic identified: "${topic}"`, data: { topic, reasoning: topicReasoning } });
  }

  if (!topic) {
    throw new Error("Googly needs either rawText or a topic to research.");
  }

  log?.info("googly", `Starting research — topic: "${topic}"`);

  // 6 queries — one per topic area + one authority-site query
  // Kept tight to stay well within Vercel's 60s limit
  const queries = [
    // Area 1: What the scam is
    `${topic} scam what is it how does it work`,
    // Area 2: How scammers execute it — target gov/cybersec sites directly
    `${topic} scam tactics methods site:ftc.gov OR site:fbi.gov OR site:ncsc.gov.uk OR site:norton.com OR site:kaspersky.com`,
    // Area 3: How to spot it
    `how to spot ${topic} scam warning signs red flags`,
    // Area 4: What to do when targeted
    `what to do if you receive ${topic} scam victim advice`,
    // Area 5: How to report it
    `report ${topic} scam site:ftc.gov OR site:ic3.gov OR site:actionfraud.police.uk OR site:scamwatch.gov.au`,
    // Broad authority sweep
    `${topic} scam site:ftc.gov OR site:fbi.gov OR site:cisa.gov OR site:aarp.org OR site:consumer.ftc.gov`,
  ];

  log?.info("googly", `Running ${queries.length} Serper queries`);
  onProgress?.({ step: "searching", message: `Running ${queries.length} targeted searches for "${topic}"…` });

  // Run all queries in parallel (3 results each — enough for dedup, fast enough for Vercel)
  const rawResults = await Promise.all(
    queries.map(q => serperSearch(q, serperApiKey, 3))
  );

  // Deduplicate and tier-rank
  const seen = new Set<string>();
  const allResults: GooglySource[] = [];

  for (const batch of rawResults) {
    for (const item of batch) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      allResults.push({
        title:   item.title,
        url:     item.link,
        snippet: item.snippet ?? "",
        tier:    getTier(item.link),
      });
    }
  }

  // Sort: Tier 1 → Tier 2 → Tier 3
  const tier1 = allResults.filter(r => r.tier === "TIER 1 ✅");
  const tier2 = allResults.filter(r => r.tier === "TIER 2 ✅");
  const tier3 = allResults.filter(r => r.tier === "TIER 3 ❌");
  const sorted = [...tier1, ...tier2, ...tier3];

  log?.info("googly", `Sources found — Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length} (rejected)`);
  onProgress?.({ step: "ranking_sources", message: `Found ${sorted.length} sources — Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3 rejected: ${tier3.length}`, data: { tier1Count: tier1.length, tier2Count: tier2.length, tier3Count: tier3.length } });
  log?.debug("googly", "Tier 1 sources", tier1.map(r => ({ title: r.title, url: r.url })));
  log?.debug("googly", "Tier 2 sources", tier2.map(r => ({ title: r.title, url: r.url })));

  // Top 12 sources only (Tier 1 + Tier 2 preferred; Tier 3 excluded from LLM context)
  const acceptedSources = [...tier1, ...tier2].slice(0, 12);
  const sourcesText = acceptedSources.map((r, idx) =>
    `[${idx + 1}] [${r.tier}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet.slice(0, 200)}`
  ).join("\n\n");

  const angleContext = angle ? `\nCONTENT ANGLE: ${angle}` : "";
  const today = new Date().toISOString().split("T")[0];

  log?.info("googly", `Calling LLM with ${Math.min(sorted.length, 25)} sources (claude-haiku-4-5-20251001)`);
  onProgress?.({ step: "writing_report", message: `Writing 7-section research report using ${acceptedSources.length} verified sources…` });
  log?.debug("googly", "Sources text sent to LLM", { sourcesText });

  const userMessage = `SCAM TOPIC: ${topic}${angleContext}
TODAY'S DATE: ${today}
TARGET AUDIENCE: Parents and grandparents aged 50-75, USA, Canada, UK, Australia

SOURCES (${acceptedSources.length} verified — Tier 1 + Tier 2 only):

${sourcesText}

Write the complete 7-section GOOGLY RESEARCH REPORT. Use the exact section template. All 7 sections are mandatory. Be concise — aim for 1 paragraph + 3 bullet points per section.`;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [
      { role: "system", content: GOOGLY_SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
  });

  const report = response.choices[0]?.message?.content ?? "Could not generate research report.";

  log?.info("googly", `Research complete — report: ${report.length} chars`);
  log?.debug("googly", "Full report", { report });

  return {
    rawText,
    topic,
    topicReasoning,
    report,
    sources: sorted,          // all sources for UI display
    tier1Count: tier1.length,
    tier2Count: tier2.length,
    tier3Count: tier3.length,
    totalSources: sorted.length,
    queriesRun: queries.length,
  };
}
