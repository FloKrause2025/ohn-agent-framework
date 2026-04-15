/**
 * reddit-scraping/index.ts
 *
 * Fetches recent r/Scams posts via Serper (Google Search API).
 * Reddit blocks direct API calls from cloud hosting IPs (Vercel/AWS),
 * so Serper is the only reliable source in this environment.
 */

import type { RequestLogger } from "../../ui/logger.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface RedditScrapingConfig {
  serperApiKey: string;
  /** Optional — attach to get a full trace of what was fetched */
  logger?: RequestLogger;
}

export interface FetchedRedditPost {
  title: string;
  upvotes: number;
  comments: number;
  flair: string;
  url: string;
  author: string;
  timeAgo: string;
  bodyPreview: string;
}

export interface RedditFetchResult {
  posts: FetchedRedditPost[];
  scannedAt: string;
  queriesUsed: string[];
  authMethod: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>{}|\\^`]/g, "")
    .replace(/ignore\s+previous\s+instructions?/gi, "")
    .replace(/\[INST\]/gi, "")
    .replace(/system\s*prompt/gi, "")
    .slice(0, 500);
}

function inferFlair(title: string, snippet: string): string {
  const t = (title + " " + snippet).toLowerCase();
  if (t.includes("phishing") || t.includes("email"))                              return "Phishing";
  if (t.includes("sms") || t.includes("text message") || t.includes("smishing")) return "Smishing";
  if (t.includes("romance"))                                                       return "Romance Scam";
  if (t.includes("job") || t.includes("employment"))                              return "Job Scam";
  if (t.includes("bank") || t.includes("paypal") || t.includes("zelle"))         return "Financial Scam";
  if (t.includes("amazon") || t.includes("ebay") || t.includes("marketplace"))   return "Online Shopping";
  if (t.includes("crypto") || t.includes("bitcoin"))                              return "Crypto";
  if (t.includes("irs") || t.includes("tax") || t.includes("social security"))   return "Government Impersonation";
  if (t.includes("tech support"))                                                  return "Tech Support";
  if (t.includes("sim") || t.includes("phone"))                                   return "SIM Swap";
  return "Scam";
}

// ─── Serper Queries ───────────────────────────────────────────────────────────

const SERPER_QUERIES = [
  { q: 'site:reddit.com/r/Scams "is this a scam" OR "help needed"', tbs: "qdr:w", num: 15 },
  { q: "site:reddit.com/r/Scams online scam phishing SMS email",    tbs: "qdr:w", num: 10 },
];

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function fetchRedditScamPosts(
  config: RedditScrapingConfig
): Promise<RedditFetchResult> {
  const { serperApiKey, logger: log } = config;
  const scannedAt = new Date().toISOString();

  log?.info("reddit", "Fetching r/Scams posts via Serper");

  const searchResults = await Promise.all(
    SERPER_QUERIES.map(({ q, tbs, num }) =>
      fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q, tbs, num, gl: "us", hl: "en" }),
      })
        .then(r => r.json() as Promise<{
          organic?: Array<{ title: string; link: string; snippet: string; date?: string }>;
        }>)
        .catch(() => ({ organic: [] }))
    )
  );

  const seen = new Set<string>();
  const posts: FetchedRedditPost[] = [];

  for (const result of searchResults) {
    for (const item of result.organic ?? []) {
      if (!/\/r\/[Ss]cams\/comments\//.test(item.link)) continue;
      if (seen.has(item.link)) continue;
      seen.add(item.link);

      const cleanTitle = item.title
        .replace(/\s*[:\-–|]\s*(r\/Scams|Reddit).*$/i, "")
        .trim();

      posts.push({
        title:       sanitise(cleanTitle),
        upvotes:     0,
        comments:    0,
        flair:       inferFlair(cleanTitle, item.snippet ?? ""),
        url:         item.link,
        author:      "r/Scams",
        timeAgo:     item.date ?? "recent",
        bodyPreview: sanitise(item.snippet ?? ""),
      });
    }
  }

  log?.info("reddit", `Fetched ${posts.length} posts via Serper`);
  log?.debug("reddit", "Posts", posts.map(p => ({ title: p.title, flair: p.flair, timeAgo: p.timeAgo, url: p.url })));

  return {
    posts,
    scannedAt,
    queriesUsed: SERPER_QUERIES.map(q => q.q),
    authMethod: "Serper (Google Search)",
  };
}
