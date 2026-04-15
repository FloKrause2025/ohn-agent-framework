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

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface RedditScrapingConfig {
  serperApiKey?: string;
  redditClientId?: string;
  redditClientSecret?: string;
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
 */
async function fetchListingDirect(
  sort: "new" | "hot",
  limit: number
): Promise<DiscoveredPost[]> {
  try {
    const url = `https://www.reddit.com/r/Scams/${sort}.json?limit=${limit}&raw_json=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "OHN-Content-Pipeline/1.0" },
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
            link_flair_text?: string;
            score?: number;
            num_comments?: number;
            upvote_ratio?: number;
            author?: string;
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
        return {
          title: d.title ?? "",
          url: permalink,
          snippet: selftext || d.link_flair_text || "",
          date: createdAgo,
          selftext,
          // Carry enriched data so we can skip the enrichment network call
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
  } catch {
    return [];
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
  const scannedAt = new Date().toISOString();
  const queriesUsed: string[] = [];

  // ── OAuth token ───────────────────────────────────────────────────────────
  let token: string | null = null;
  if (config.redditClientId && config.redditClientSecret) {
    token = await getOAuthToken(config.redditClientId, config.redditClientSecret);
  }

  const seen = new Set<string>();
  const discovered: DiscoveredPost[] = [];

  // ── Phase 0: Direct listing (no auth required, returns real data) ─────────
  // Fetches r/Scams/new and r/Scams/hot directly — no flair query, no OAuth.
  // Reddit's listing API always works for public subreddits and includes
  // score, num_comments, flair, and author in the response payload itself,
  // so no per-post enrichment calls are needed for these.
  const [newPosts, hotPosts] = await Promise.all([
    fetchListingDirect("new", 50),
    fetchListingDirect("hot", 25),
  ]);
  queriesUsed.push("r/Scams/new (listing)", "r/Scams/hot (listing)");

  for (const post of [...newPosts, ...hotPosts]) {
    if (!post.url || seen.has(post.url)) continue;
    if (!/\/r\/[Ss]cams\/comments\//.test(post.url)) continue;
    seen.add(post.url);
    discovered.push(post);
  }

  // ── Phase 1: Flair feeds (if OAuth available and need more posts) ─────────
  if (token && discovered.length < 30) {
    const flairResults = await Promise.all(
      FLAIR_FEEDS.map((flair) => fetchFlairFeed(flair, 25, token))
    );
    queriesUsed.push(...FLAIR_FEEDS.map((f) => `r/Scams flair: "${f}"`));

    for (const posts of flairResults) {
      for (const post of posts) {
        if (!post.url || seen.has(post.url)) continue;
        if (!/\/r\/[Ss]cams\/comments\//.test(post.url)) continue;
        seen.add(post.url);
        discovered.push(post);
      }
    }
  }

  // ── Phase 2: Serper fallback (if still not enough) ───────────────────────
  if (discovered.length < 15 && config.serperApiKey) {
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

    for (const result of searchResults) {
      for (const item of result.organic ?? []) {
        if (!/\/r\/[Ss]cams\/comments\//.test(item.link)) continue;
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        discovered.push({ title: item.title, url: item.link, snippet: item.snippet ?? "", date: item.date ?? "recent", selftext: item.snippet ?? "" });
      }
    }
  }

  // ── Phase 3: Enrich posts that don't have pre-loaded data ────────────────
  // Posts from Phase 0 already carry _score/_comments etc. (from the listing
  // payload). Only Phase 1/2 posts need enrichment.
  const needsEnrich = discovered.filter((p) => p._score === undefined);
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

    // Use pre-loaded data from Phase 0 if available, otherwise enrichment
    const score   = item._score   ?? enriched?.score          ?? 0;
    const comments= item._comments?? enriched?.num_comments   ?? 0;
    const ratio   = item._upvoteRatio ?? enriched?.upvote_ratio ?? 0;
    const author  = item._author  ?? enriched?.author         ?? "r/Scams";
    // Phase 0 returns actual flair text; fall back to inference for Serper results
    const flair   = (item._flair && item._flair.length > 0)
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

  return {
    posts,
    scannedAt,
    queriesUsed,
    rawResultCount: posts.length,
    enrichedCount: enrichMap.size + discovered.filter((p) => p._score !== undefined).length,
    authMethod,
  };
}
