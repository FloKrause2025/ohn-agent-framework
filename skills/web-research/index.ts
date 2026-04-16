/**
 * web-research/index.ts
 *
 * Unified search + filter + crawl skill for Googly.
 *
 * CHANGES FROM ORIGINAL (server/skills/web-research/scripts/crawler.ts):
 * - ARCHITECTURE FIX: Consolidated Serper search + domain filtering + crawling
 *   into one researchScamTopic() function. In the original, search and filtering
 *   lived in routers.ts and csOrchestrator.ts — duplicated in 3 places.
 * - Config injected as parameter (no ENV import)
 * - Extended Tier 1/2 domain lists to match research-sources KB
 * - Added source tier classification on all returned results
 * - Kept all crawling and text extraction logic identical to original
 *
 * ORIGINAL: server/skills/web-research/scripts/crawler.ts (working — do not modify)
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface WebResearchConfig {
  serperApiKey: string;
}

export interface WebResearchOptions {
  maxPages?: number;
  additionalQueries?: string[];
}

export type SourceTier = "TIER_1" | "TIER_2" | "TIER_3";

export interface Source {
  title: string;
  url: string;
  snippet: string;
  tier: SourceTier;
  isTrusted: boolean;
}

export interface CrawledPage {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  tier: SourceTier;
  error?: string;
}

export interface WebResearchResult {
  topic: string;
  sources: Source[];
  trustedSources: Source[];
  crawledPages: CrawledPage[];
  searchQueriesUsed: string[];
}

// ─── Domain Classification ────────────────────────────────────────────────────

const TIER_1_DOMAINS = [
  "cisa.gov",
  "fbi.gov",
  "ftc.gov",
  "consumer.ftc.gov",
  "ic3.gov",
  "ncsc.gov.uk",
  "actionfraud.police.uk",
  "cyber.gov.au",
  "scamwatch.gov.au",
  "canada.ca",
  "irs.gov",
  "hmrc.gov.uk",
  "usa.gov",
];

const TIER_2_DOMAINS = [
  "norton.com",
  "kaspersky.com",
  "malwarebytes.com",
  "sophos.com",
  "proofpoint.com",
  "mimecast.com",
  "aarp.org",
  "consumerreports.org",
  "which.co.uk",
];

function classifyUrl(url: string): SourceTier {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (TIER_1_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return "TIER_1";
    if (TIER_2_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return "TIER_2";
    return "TIER_3";
  } catch {
    return "TIER_3";
  }
}

// ─── Query Generation ─────────────────────────────────────────────────────────

function generateQueries(topic: string): string[] {
  return [
    `${topic} scam explained`,
    `how does ${topic} scam work`,
    `how to spot ${topic} scam`,
  ];
}

// ─── Serper Search ────────────────────────────────────────────────────────────

interface SerperResult {
  organic?: Array<{ title: string; link: string; snippet: string }>;
}

async function serperSearch(query: string, apiKey: string): Promise<SerperResult> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5, gl: "us", hl: "en" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { organic: [] };
    return res.json() as Promise<SerperResult>;
  } catch {
    return { organic: [] };
  }
}

// ─── Page Crawler ─────────────────────────────────────────────────────────────

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "";
}

function extractText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();

  const words = text.split(" ");
  return words.length > 3000 ? words.slice(0, 3000).join(" ") + "..." : text;
}

async function crawlPage(url: string, tier: SourceTier): Promise<CrawledPage> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!res.ok) {
      return { url, title: "", content: "", wordCount: 0, tier, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractText(html);

    return { url, title, content, wordCount: content.split(" ").length, tier };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, title: "", content: "", wordCount: 0, tier, error: message };
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function researchScamTopic(
  topic: string,
  config: WebResearchConfig,
  options: WebResearchOptions = {}
): Promise<WebResearchResult> {
  const { maxPages = 4, additionalQueries = [] } = options;

  if (!config.serperApiKey) {
    throw new Error("ConfigurationError: serperApiKey is required for web research");
  }

  // ── Generate and execute queries ──────────────────────────────────────────
  const queries = [...generateQueries(topic), ...additionalQueries];
  const searchResults = await Promise.all(
    queries.map((q) => serperSearch(q, config.serperApiKey))
  );

  // ── Deduplicate and classify all sources ──────────────────────────────────
  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const result of searchResults) {
    for (const item of result.organic ?? []) {
      if (!item.link || seen.has(item.link)) continue;
      seen.add(item.link);
      const tier = classifyUrl(item.link);
      sources.push({
        title: item.title,
        url: item.link,
        snippet: item.snippet ?? "",
        tier,
        isTrusted: tier !== "TIER_3",
      });
    }
  }

  const trustedSources = sources.filter((s) => s.isTrusted);

  // ── Crawl top trusted pages ───────────────────────────────────────────────
  // Prioritise Tier 1 over Tier 2
  const tier1 = trustedSources.filter((s) => s.tier === "TIER_1");
  const tier2 = trustedSources.filter((s) => s.tier === "TIER_2");
  const pagesToCrawl = [...tier1, ...tier2].slice(0, maxPages);

  const crawlResults = await Promise.all(
    pagesToCrawl.map((s) => crawlPage(s.url, s.tier))
  );

  const crawledPages = crawlResults.filter((p) => !p.error && p.wordCount > 50);

  return {
    topic,
    sources,
    trustedSources,
    crawledPages,
    searchQueriesUsed: queries,
  };
}

// ─── Named exports for backward-compat (mirrors original crawler.ts exports) ─

export async function crawlUrl(url: string): Promise<CrawledPage> {
  const tier = classifyUrl(url);
  return crawlPage(url, tier);
}

export async function crawlUrls(urls: string[], maxPages = 4): Promise<CrawledPage[]> {
  const results = await Promise.all(
    urls.slice(0, maxPages).map((url) => crawlUrl(url))
  );
  return results.filter((p) => !p.error && p.wordCount > 50);
}

export function isTrustedUrl(url: string): boolean {
  return classifyUrl(url) !== "TIER_3";
}
