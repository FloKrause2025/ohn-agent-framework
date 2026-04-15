---
name: researching-web
version: 1.0
used_by: [googly]
inputs: [topic, config, options]
outputs: [WebResearchResult]
---

## What This Skill Does

Searches the web for scam-related content using Serper, filters results to Tier 1 (government/law enforcement) and Tier 2 (trusted cybersecurity/consumer) sources, crawls the top pages, and returns structured raw findings. Does not interpret, summarise, or write reports — that is Googly's job.

## Why It Exists

Googly needs verified, source-backed research to produce accurate reports. This skill is the data layer — it handles the mechanics of searching, filtering, and extracting so Googly can focus entirely on synthesis and judgment.

## Architecture Fix (vs Original)

**Original flaw:** The search query generation, Serper API calls, and domain filtering lived in `routers.ts` and `csOrchestrator.ts` — not in the skill itself. This meant the same logic was duplicated in 3 places with diverging implementations.

**This version:** All search + filter + crawl logic is consolidated into a single `researchScamTopic()` function. One entry point. One source of truth.

## How It Works

1. **Generate queries** — converts topic into 2–3 targeted search queries
2. **Serper search** — executes queries via Google Search API, collects all results
3. **Domain filter** — classifies every URL as Tier 1, Tier 2, or Tier 3 (rejected)
4. **Crawl trusted pages** — fetches top 4 Tier 1/2 pages via plain HTTP, strips HTML noise, extracts clean article text (capped at 3,000 words per page)
5. **Return structured findings** — all sources classified, crawled pages with full content

## Source Tiers

**Tier 1 (always prioritise):** cisa.gov, fbi.gov, ftc.gov, consumer.ftc.gov, ic3.gov, ncsc.gov.uk, actionfraud.police.uk, cyber.gov.au, scamwatch.gov.au, canada.ca, irs.gov, hmrc.gov.uk, usa.gov

**Tier 2 (use if Tier 1 insufficient):** norton.com, kaspersky.com, malwarebytes.com, sophos.com, proofpoint.com, mimecast.com, aarp.org, consumerreports.org, which.co.uk

**Tier 3:** Rejected — forums, blogs, social media, news aggregators, any unverifiable source

## Inputs

```ts
interface WebResearchConfig {
  serperApiKey: string; // Required
}

interface WebResearchOptions {
  maxPages?: number;          // default: 4
  additionalQueries?: string[]; // appended to generated queries
}

researchScamTopic(topic: string, config: WebResearchConfig, options?: WebResearchOptions)
```

## Outputs

```ts
interface WebResearchResult {
  topic: string;
  sources: Source[];
  trustedSources: Source[];
  crawledPages: CrawledPage[];
  searchQueriesUsed: string[];
}

interface Source {
  title: string;
  url: string;
  snippet: string;
  tier: "TIER_1" | "TIER_2" | "TIER_3";
  isTrusted: boolean;
}

interface CrawledPage {
  url: string;
  title: string;
  content: string;   // cleaned text, max 3,000 words
  wordCount: number;
  tier: "TIER_1" | "TIER_2";
  error?: string;
}
```

## Failure Modes

| Failure | Behaviour |
|---|---|
| Missing serperApiKey | Throws `ConfigurationError` |
| Serper rate limit | Returns empty sources with error noted |
| Crawl timeout (15s) | That page skipped; others continue |
| HTTP error on crawl | That page skipped; others continue |
| No trusted sources found | Returns empty crawledPages — Googly decides how to handle |

## Constraints

- Only researches scam and cybersecurity topics
- Only crawls Tier 1 and Tier 2 domains
- Never interprets, recommends, or writes reports
- Every finding traceable to a source URL
- Max 4 pages crawled per request
- Max 3,000 words extracted per page
