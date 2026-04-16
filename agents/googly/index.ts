/**
 * agents/googly/index.ts
 *
 * Googly 🔍 — Deep Research Specialist
 *
 * Step 1: Haiku — extract scam topic from raw text
 * Step 2: 3 Serper queries — find sources, tier-rank them
 * Step 3: Fetch the best Tier 1 page (or Tier 2 fallback), strip HTML
 * Step 4: Haiku — extract key facts from that one page
 *
 * One page scrape + one small LLM call keeps total time well under 60s.
 */

import type { RequestLogger } from "../../ui/logger.js";
import type { LLMInvokeParams, LLMResponse } from "../researchy/index.js";

export type { LLMInvokeParams, LLMResponse };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GooglyInput {
  rawText?: string;
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

export interface GooglyScrapedPage {
  url: string;
  title: string;
  tier: GooglySource["tier"];
  /** Plain text extracted from the page, first ~3000 chars */
  text: string;
}

export interface GooglyResult {
  rawText?: string;
  topic: string;
  topicReasoning?: string;
  sources: GooglySource[];
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSources: number;
  queriesRun: number;
  /** The page that was scraped */
  scrapedPage?: GooglyScrapedPage;
  /** Key facts extracted from the scraped page by Haiku */
  extractedFacts?: string;
}

export interface GooglyProgressEvent {
  step: "extracting_topic" | "searching" | "scraping" | "extracting_facts" | "done";
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

// ─── Step 1: Topic Extraction ─────────────────────────────────────────────────

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
      { role: "user", content: rawText.slice(0, 1500) },
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
    log?.warn("googly", `Parse failed — fallback: "${fallback}"`);
    return { topic: fallback, reasoning: "Fallback extraction." };
  }
}

// ─── Step 2: Serper Search ────────────────────────────────────────────────────

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

// ─── Step 3: Webpage Scrape ───────────────────────────────────────────────────

async function scrapePage(url: string, log?: RequestLogger): Promise<string> {
  log?.info("googly", `Scraping: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OHN-Research-Bot/1.0)",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(8000), // 8s max — don't let one slow page kill us
    });

    if (!res.ok) {
      log?.warn("googly", `Scrape failed: HTTP ${res.status} for ${url}`);
      return "";
    }

    const html = await res.text();

    // Strip tags, collapse whitespace, take first 3500 chars
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 3500);

    log?.info("googly", `Scraped ${text.length} chars from ${url}`);
    return text;
  } catch (err) {
    log?.warn("googly", `Scrape error for ${url}: ${String(err)}`);
    return "";
  }
}

// ─── Step 4: Fact Extraction ──────────────────────────────────────────────────

async function extractFacts(
  topic: string,
  pageText: string,
  pageUrl: string,
  invokeLLM: GooglyDeps["invokeLLM"],
  log?: RequestLogger,
): Promise<string> {
  log?.info("googly", "Extracting key facts from scraped page");

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content: `You extract scam research facts from a webpage for a media company.
Write in plain English for a non-technical adult aged 60+. Be concise.
Output format:
**What is it?** [2 sentences]
**How it works:** [3 bullet points]
**Red flags:** [3 bullet points]
**What to do:** [3 bullet points]
**How to report:** [1-2 sentences with URLs if present]`,
      },
      {
        role: "user",
        content: `SCAM TOPIC: ${topic}\nSOURCE: ${pageUrl}\n\nPAGE CONTENT:\n${pageText}`,
      },
    ],
  });

  const facts = response.choices[0]?.message?.content ?? "";
  log?.info("googly", `Facts extracted: ${facts.length} chars`);
  log?.debug("googly", "Extracted facts", { facts });
  return facts;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runGoogly(
  input: GooglyInput,
  deps: GooglyDeps,
): Promise<GooglyResult> {
  const { rawText } = input;
  const { invokeLLM, serperApiKey, logger: log, onProgress } = deps;

  // ── Step 1: Extract topic ────────────────────────────────────────────────
  let topic = input.topic ?? "";
  let topicReasoning: string | undefined;

  if (rawText) {
    onProgress?.({ step: "extracting_topic", message: "Identifying scam type from your text…" });
    const extracted = await extractScamTopic(rawText, invokeLLM, log);
    topic = extracted.topic;
    topicReasoning = extracted.reasoning;
    onProgress?.({ step: "extracting_topic", message: `Topic: "${topic}"`, data: { topic, reasoning: topicReasoning } });
  }

  if (!topic) throw new Error("Provide either rawText or a topic.");

  // ── Step 2: Serper queries ───────────────────────────────────────────────
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

  // Deduplicate + tier-rank
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

  log?.info("googly", `Sources — Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length}`);
  log?.debug("googly", "All sources", sorted.map(s => ({ title: s.title, url: s.url, tier: s.tier })));

  // ── Step 3: Scrape the best available page ───────────────────────────────
  const pageToScrape = tier1[0] ?? tier2[0]; // best source wins
  let scrapedPage: GooglyScrapedPage | undefined;
  let extractedFacts: string | undefined;

  if (pageToScrape) {
    onProgress?.({ step: "scraping", message: `Reading: ${pageToScrape.url}` });
    const text = await scrapePage(pageToScrape.url, log);

    if (text.length > 100) {
      scrapedPage = {
        url:   pageToScrape.url,
        title: pageToScrape.title,
        tier:  pageToScrape.tier,
        text,
      };

      // ── Step 4: Extract key facts ──────────────────────────────────────
      onProgress?.({ step: "extracting_facts", message: `Extracting key facts from ${pageToScrape.tier} source…` });
      extractedFacts = await extractFacts(topic, text, pageToScrape.url, invokeLLM, log);
    } else {
      log?.warn("googly", `Page too short or blocked (${text.length} chars) — skipping fact extraction`);
      onProgress?.({ step: "extracting_facts", message: "Page blocked — using snippets only" });
    }
  }

  onProgress?.({
    step: "done",
    message: `Done — ${tier1.length} gov sources, ${tier2.length} cybersec/news sources${scrapedPage ? `, facts extracted from ${scrapedPage.tier} source` : ""}`,
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
    scrapedPage,
    extractedFacts,
  };
}
