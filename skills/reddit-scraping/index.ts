/**
 * reddit-scraping/index.ts
 *
 * Scrapes r/Scams flair feeds for recent scam posts and enriches them
 * with real upvote/comment data from the Reddit JSON API.
 *
 * CHANGES FROM ORIGINAL (server/skills/reddit-scraping/scripts/reddit_fetcher.ts):
 * - Removed direct ENV import — config is injected via RedditScrapingConfig parameter
 * - Added explicit types for all internal interfaces
 * - Removed fromRedditApi / fromSerperFallback counters (not used by consumers)
 * - Kept all OAuth, enrichment, flair inference, and sanitisation logic intact
 *
 * ORIGINAL: server/skills/reddit-scraping/scripts/reddit_fetcher.ts (working — do not modify)
 */

import type { RequestLogger } from "../../ui/logger.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface RedditScrapingConfig {
  serperApiKey?: string;
  redditClientId?: string;
  redditClientSecret?: string;
  /** Optional — attach to get a full trace of what was fetched */
  logger?: RequestLogger;
}

export interface FetchedRedditPost {
  title: string;
  upvotes: number;
  comments: number;
  upvoteRatio: number;
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
  rawResultCount: number;
  enrichedCount: number;
  authMethod: string;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface RedditPostData {
  score: number;
  num_comments: number;
  upvote_ratio: number;
  author: string;
}

interface DiscoveredPost {
  title: string;
  url: string;
  snippet: string;
  date: string;
  selftext: string;
  // Pre-populated from listing endpoint (avoids second network call per post)
  _score?: number;
  _comments?: number;
  _upvoteRatio?: number;
  _author?: string;
  _flair?: string;
}

// ─── OAuth Token Cache (module-level, reused across calls) ───────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getOAuthToken(
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 60_000) {
    return _cachedToken.token;
  }
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "User-Agent": "OHN-Content-Pipeline/1.0",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    _cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return _cachedToken.token;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[<>{}|\\^`]/g, "")
    // Prompt injection protection
    .replace(/ignore\s+previous\s+instructions?/gi, "")
    .replace(/\[INST\]/gi, "")
    .replace(/system\s*prompt/gi, "")
    .slice(0, 300);
}

function inferFlair(title: string, snippet: string): string {
  const combined = (title + " " + snippet).toLowerCase();
  if (combined.includes("phishing") || combined.includes("email")) return "Phishing";
  if (combined.includes("sms") || combined.includes("text message")) return "Smishing";
  if (combined.includes("romance")) return "Romance Scam";
  if (combined.includes("job") || combined.includes("employment")) return "Job Scam";
  if (combined.includes("bank") || combined.includes("paypal") || combined.includes("zelle")) return "Financial Scam";
  if (combined.includes("amazon") || combined.includes("ebay") || combined.includes("marketplace")) return "Online Shopping";
  if (combined.includes("crypto") || combined.includes("bitcoin")) return "Crypto";
  if (combined.includes("irs") || combined.includes("tax") || combined.includes("social security")) return "Government Impersonation";
  if (combined.includes("tech support")) return "Tech Support Scam";
  if (combined.includes("sim") || combined.includes("phone")) return "SIM Swap";
  if (combined.includes("ai") || combined.includes("deepfake") || combined.includes("voice clone")) return "AI Scam";
  return "Scam";
}

function extractPostId(url: string): string | null {
  const match = url.match(/\/comments\/([a-z0-9]+)/i);
  return match ? match[1] : null;
}

// ─── Reddit API Calls ─────────────────────────────────────────────────────────

/**
 * Phase 0: Direct listing fetch — works without OAuth.
 * https://www.reddit.com/r/Scams/new.json returns up to 100 posts
 * including their flair, selftext, upvotes, and comment counts.
 * No auth needed, no search query, no rate-limit issues.
 *
 * NOTE: Reddit blocks requests from known cloud/hosting IPs (AWS, Vercel, etc.).
 * Returns { posts, status } so callers can log the actual HTTP status for debugging.
 */
async function fetchListingDirect(
  sort: "new" | "hot",
  limit: number
): Promise<{ posts: DiscoveredPost[]; status: number | null; error?: string }> {
  try {
    const url = `https://www.reddit.com/r/Scams/${sort}.json?limit=${limit}&raw_json=1`;
    const res = await fetch(url, {
      headers: {
        // Reddit requires a descriptive User-Agent — generic strings get blocked
        "User-Agent": "Mozilla/5.0 (compatible; OHN-Scam-Monitor/1.0; +https://ohhackno.com)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { posts: [], status: res.status, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const data = (await res.json()) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            permalink?: string;
            selftext?: string;
            created_utc?: number;
            link_flair_text?: string;
            score?: number;
            num_comments?: number;
            upvote_ratio?: number;
            author?: string;
          };
        }>;
      };
    };

    const mapped = (data?.data?.children ?? [])
      .filter((c) => c.data?.permalink)
      .map((c) => {
        const d = c.data!;
        const permalink = `https://www.reddit.com${d.permalink}`;
        const selftext = (d.selftext ?? "").slice(0, 300);
        const createdAgo = d.created_utc
          ? `${Math.round((Date.now() / 1000 - d.created_utc) / 3600)}h ago`
          : "recent";
        return {
          title: d.title ?? "",
          url: permalink,
          snippet: selftext || d.link_flair_text || "",
          date: createdAgo,
          selftext,
          _score: d.score ?? 0,
          _comments: d.num_comments ?? 0,
          _upvoteRatio: d.upvote_ratio ?? 0,
          _author: d.author ?? "r/Scams",
          _flair: d.link_flair_text ?? "",
        } as DiscoveredPost & {
          _score: number;
          _comments: number;
          _upvoteRatio: number;
          _author: string;
          _flair: string;
        };
      });
    return { posts: mapped, status: res.status };
  } catch (err) {
    return { posts: [], status: null, error: String(err) };
  }
}

async function enrichPost(
  url: string,
  token: string | null
): Promise<RedditPostData | null> {
  try {
    const postId = extractPostId(url);
    if (!postId) return null;

    const apiUrl = token
      ? `https://oauth.reddit.com/comments/${postId}.json?limit=1&raw_json=1`
      : `https://www.reddit.com/comments/${postId}.json?limit=1&raw_json=1`;

    const headers: Record<string, string> = { "User-Agent": "OHN-Content-Pipeline/1.0" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) return null;

    const listing = data[0] as {
      data?: { children?: Array<{ data?: RedditPostData }> };
    };
    const postData = listing?.data?.children?.[0]?.data;
    if (!postData) return null;

    return {
      score: typeof postData.score === "number" ? postData.score : 0,
      num_comments: typeof postData.num_comments === "number" ? postData.num_comments : 0,
      upvote_ratio: typeof postData.upvote_ratio === "number" ? postData.upvote_ratio : 0,
      author: typeof postData.author === "string" ? postData.author : "unknown",
    };
  } catch {
    return null;
  }
}

async function enrichBatch(
  posts: Array<{ url: string }>,
  token: string | null,
  concurrency = 8
): Promise<Map<string, RedditPostData>> {
  const results = new Map<string, RedditPostData>();
  const queue = [...posts];

  async function worker() {
    while (queue.length > 0) {
      const post = queue.shift();
      if (!post) break;
      const data = await enrichPost(post.url, token);
      if (data) results.set(post.url, data);
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, posts.length) }, () => worker())
  );
  return results;
}

async function fetchFlairFeed(
  flairName: string,
  limit: number,
  token: string | null
): Promise<DiscoveredPost[]> {
  const encoded = encodeURIComponent(flairName);
  const baseUrl = `https://www.reddit.com/r/Scams/search.json?q=flair_name%3A%22${encoded}%22&restrict_sr=1&sort=new&limit=${limit}&raw_json=1`;
  const oauthUrl = `https://oauth.reddit.com/r/Scams/search.json?q=flair_name%3A%22${encoded}%22&restrict_sr=1&sort=new&limit=${limit}&raw_json=1`;

  const headers: Record<string, string> = { "User-Agent": "OHN-Content-Pipeline/1.0" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(token ? oauthUrl : baseUrl, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            permalink?: string;
            selftext?: string;
            created_utc?: number;
          };
        }>;
      };
    };

    return (data?.data?.children ?? [])
      .filter((c) => c.data?.permalink)
      .map((c) => {
        const d = c.data!;
        const permalink = `https://www.reddit.com${d.permalink}`;
        const selftext = (d.selftext ?? "").slice(0, 300);
        const createdAgo = d.created_utc
          ? `${Math.round((Date.now() / 1000 - d.created_utc) / 3600)}h ago`
          : "recent";
        return { title: d.title ?? "", url: permalink, snippet: selftext || `[${flairName}]`, date: createdAgo, selftext };
      });
  } catch {
    return [];
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

const FLAIR_FEEDS = ["Is this a scam?", "Help Needed"] as const;

const SERPER_QUERIES = [
  { q: 'site:reddit.com/r/Scams "is this a scam" OR "help needed"', tbs: "qdr:w", num: 15 },
  { q: "site:reddit.com/r/Scams online scam phishing SMS email", tbs: "qdr:w", num: 10 },
];

export async function fetchRedditScamPosts(
  config: RedditScrapingConfig
): Promise<RedditFetchResult> {
  const log = config.logger;
  const scannedAt = new Date().toISOString();
  const queriesUsed: string[] = [];

  log?.info("reddit", "Starting Reddit fetch", { scannedAt, hasOAuth: !!(config.redditClientId && config.redditClientSecret), hasSerper: !!config.serperApiKey });

  // ── OAuth token ───────────────────────────────────────────────────────────
  let token: string | null = null;
  if (config.redditClientId && config.redditClientSecret) {
    token = await getOAuthToken(config.redditClientId, config.redditClientSecret);
    log?.info("reddit", token ? "OAuth token obtained" : "OAuth token failed — falling back to public API");
  }

  const seen = new Set<string>();
  const discovered: DiscoveredPost[] = [];

  // ── Phase 0: Direct listing (no auth required, returns real data) ─────────
  const [newResult, hotResult] = await Promise.all([
    fetchListingDirect("new", 50),
    fetchListingDirect("hot", 25),
  ]);
  queriesUsed.push("r/Scams/new (listing)", "r/Scams/hot (listing)");

  // Log actual HTTP status — if Reddit is blocking (403/429/503) this will show it
  log?.info("reddit", `Phase 0 listing: /new → HTTP ${newResult.status ?? "error"} (${newResult.posts.length} posts)${newResult.error ? ` — ${newResult.error}` : ""}`, {
    newStatus: newResult.status, hotStatus: hotResult.status,
    newError: newResult.error, hotError: hotResult.error,
  });

  if (newResult.status && newResult.status !== 200) {
    log?.warn("reddit", `Reddit returned HTTP ${newResult.status} — likely blocking this server's IP. Add SERPER_API_KEY as fallback.`);
  }

  for (const post of [...newResult.posts, ...hotResult.posts]) {
    if (!post.url || seen.has(post.url)) continue;
    if (!/\/r\/[Ss]cams\/comments\//.test(post.url)) continue;
    seen.add(post.url);
    discovered.push(post);
  }
  log?.info("reddit", `After dedup: ${discovered.length} unique posts`);

  // ── Phase 1: Serper (runs first if key is set — immune to Reddit IP blocks) ─
  // Reddit actively blocks requests from cloud hosting IPs (Vercel/AWS/etc).
  // Serper routes through Google Search, bypassing Reddit's IP restrictions entirely.
  if (config.serperApiKey && discovered.length < 30) {
    log?.info("reddit", "Phase 1: fetching via Serper (bypasses Reddit IP blocks on cloud hosts)");
    const searchResults = await Promise.all(
      SERPER_QUERIES.map(({ q, tbs, num }) =>
        fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": config.serperApiKey!, "Content-Type": "application/json" },
          body: JSON.stringify({ q, tbs, num, gl: "us", hl: "en" }),
        })
          .then((r) =>
            r.json() as Promise<{
              organic?: Array<{ title: string; link: string; snippet: string; date?: string }>;
            }>
          )
          .catch(() => ({ organic: [] }))
      )
    );
    queriesUsed.push(...SERPER_QUERIES.map((q) => q.q));

    let serperCount = 0;
    for (const result of searchResults) {
      for (const item of result.organic ?? []) {
        if (!/\/r\/[Ss]cams\/comments\//.test(item.link)) continue;
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        discovered.push({ title: item.title, url: item.link, snippet: item.snippet ?? "", date: item.date ?? "recent", selftext: item.snippet ?? "" });
        serperCount++;
      }
    }
    log?.info("reddit", `Phase 1 Serper: added ${serperCount} posts`);
  }

  // ── Phase 2: Flair feeds (OAuth only, supplements if still need more) ─────
  if (token && discovered.length < 30) {
    const flairResults = await Promise.all(
      FLAIR_FEEDS.map((flair) => fetchFlairFeed(flair, 25, token))
    );
    queriesUsed.push(...FLAIR_FEEDS.map((f) => `r/Scams flair: "${f}"`));
    log?.info("reddit", `Phase 2 flair feeds returned ${flairResults.flat().length} additional posts`);

    for (const posts of flairResults) {
      for (const post of posts) {
        if (!post.url || seen.has(post.url)) continue;
        if (!/\/r\/[Ss]cams\/comments\//.test(post.url)) continue;
        seen.add(post.url);
        discovered.push(post);
      }
    }
  }

  // ── Phase 3: Enrich posts that don't have pre-loaded data ────────────────
  const needsEnrich = discovered.filter((p) => p._score === undefined);
  if (needsEnrich.length > 0) {
    log?.info("reddit", `Phase 3: enriching ${needsEnrich.length} posts that lack score data`);
  }
  const enrichMap = needsEnrich.length > 0
    ? await enrichBatch(needsEnrich, token)
    : new Map<string, RedditPostData>();

  // ── Assemble ──────────────────────────────────────────────────────────────
  const posts: FetchedRedditPost[] = discovered.map((item) => {
    const enriched = enrichMap.get(item.url);
    const cleanTitle = item.title
      .replace(/\s*[:\-–|]\s*(r\/Scams|Reddit).*$/i, "")
      .trim();
    const bodyText = item.selftext?.length > 10 ? item.selftext : item.snippet;

    const score    = item._score      ?? enriched?.score         ?? 0;
    const comments = item._comments   ?? enriched?.num_comments  ?? 0;
    const ratio    = item._upvoteRatio ?? enriched?.upvote_ratio ?? 0;
    const author   = item._author     ?? enriched?.author        ?? "r/Scams";
    const flair    = (item._flair && item._flair.length > 0)
      ? item._flair
      : inferFlair(cleanTitle, bodyText);

    return {
      title: sanitise(cleanTitle),
      upvotes: score,
      comments,
      upvoteRatio: ratio,
      flair,
      url: item.url,
      author,
      timeAgo: item.date,
      bodyPreview: sanitise(bodyText),
    };
  });

  const authMethod = token
    ? "OAuth (reddit app credentials)"
    : "Direct listing (no auth required)";

  // Log the full list of raw posts for debugging
  log?.debug("reddit", `All ${posts.length} raw posts sent to agent`, posts.map(p => ({
    title: p.title,
    upvotes: p.upvotes,
    comments: p.comments,
    flair: p.flair,
    timeAgo: p.timeAgo,
    url: p.url,
  })));

  log?.info("reddit", `Fetch complete — ${posts.length} posts, auth: ${authMethod}`);

  return {
    posts,
    scannedAt,
    queriesUsed,
    rawResultCount: posts.length,
    enrichedCount: enrichMap.size + discovered.filter((p) => p._score !== undefined).length,
    authMethod,
  };
}
