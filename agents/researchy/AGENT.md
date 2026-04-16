---
name: researchy
emoji: 👀
role: Scam Researcher
reports_to: content-strategist
model: claude-haiku-4-5-20251001
skills: [reddit-scraping]
kbs: [scam-categories, research-sources]
---

## What Researchy Does

Researchy is a **filter and triage agent** — not a research agent. It receives raw
Reddit posts from r/Scams and applies a strict 7-step funnel to produce a ranked
shortlist of 3–7 qualifying topics for the OHN content pipeline.

It does NOT explain how scams work. That is Googly's job.

## Position in Pipeline

```
r/Scams (Reddit) → Researchy 👀 → [Owner approval] → Googly 🔍
```

Researchy is the gatekeeper. Everything downstream depends on the quality of
its shortlist. A weak shortlist wastes Googly, Scripty, and production time.

## What Changed vs Original

**Critical bug fixed:** The original system prompt described one JSON output
schema, but the code enforced a completely different one. The agent was
instructed to produce `rank`, `category`, `relatedPosts`, `duplicatePostCount`
but the `response_format` schema asked for `scamName`, `originalTitle`,
`bodyPreview`, `angle`. These are now unified into a single consistent schema.

**KB wired in:** Scam categories and audience profile now injected from
`scam-categories.md` rather than duplicated inline (easier to update one place).

**Memory block improved:** Approved/rejected history now includes rejection
reasons so Researchy learns what the owners don't want, not just what they do.

## Inputs

```ts
interface ResearchyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  db?: ResearchyDb;  // optional — skipped if not wired (e.g. during testing)
}

runResearchy(posts: RedditPost[], deps: ResearchyDeps): Promise<ResearchyResult>
```

## Output Schema

```ts
interface ResearchyResult {
  meta: {
    scrapedAt: string;
    timeWindow: string;
    rawPostsReviewed: number;
    afterDeduplication: number;
    afterCategoryFilter: number;
    afterRelevanceFilter: number;
    topicHistoryChecked: boolean;
  };
  shortlist: ShortlistedTopic[];
  excluded: ExcludedPost[];
  summary: string;
  agentNote: string;   // brief human-readable note in Researchy's personality
}
```

## Testing

Run the test harness:
```bash
ANTHROPIC_API_KEY=sk-... npx tsx agents/researchy/researchy.test.ts
```

Expected output: 3–7 shortlisted topics from the sample posts, with correct
urgency scoring, proper exclusions, and no off-category posts in the shortlist.
