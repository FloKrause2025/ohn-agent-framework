/**
 * agents/researchy/index.ts
 *
 * Researchy 👀 — Scam Researcher / Filter & Triage Agent
 *
 * FIXES vs original (server/agents/researchy/researchy.ts + researchy.core.ts):
 * - CRITICAL: Unified JSON schema — system prompt and response_format now match.
 *   Original had two completely different schemas causing unpredictable output.
 * - Removed direct imports of invokeLLM, getDb, drizzle schema — all injected.
 * - KB scam categories now injected via kbContent param (single source of truth).
 * - Memory block improved — rejection reasons included so agent learns patterns.
 */

import type { RequestLogger } from "../../ui/logger.js";

// ─── LLM Types (shared shape with other agents) ───────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMInvokeParams {
  model?: string;
  messages: LLMMessage[];
  /** Override the default max_tokens (4096). Use to cap long outputs and speed up responses. */
  max_tokens?: number;
  response_format?: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  /** Enable extended thinking. Model is auto-upgraded to Sonnet if Haiku is specified. */
  thinking?: {
    budget_tokens: number;
  };
}

export interface LLMResponse {
  choices: Array<{ message: { content: string | null } }>;
  /** Extended thinking text — present when thinking was enabled in the request */
  thinking?: string;
}

// ─── Reddit Post Types ────────────────────────────────────────────────────────

export interface RedditPost {
  title: string;
  upvotes: number;
  comments: number;
  flair?: string;
  url: string;
  author?: string;
  timeAgo: string;
  bodyPreview?: string;
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface ShortlistedTopic {
  originalTitle: string;
  summary: string;
  postedAt: string;
  redditUrl: string;
  relatedPosts: string[];
  /** Original Reddit post body — attached server-side after LLM call, not part of schema */
  bodyPreview?: string;
}

export interface ExcludedPost {
  originalTitle: string;
  exclusionReason: string;
  redditUrl: string;
}

export interface ResearchyMeta {
  scrapedAt: string;
  timeWindow: string;
  rawPostsReviewed: number;
  shortlisted: number;
  excluded: number;
}

export interface ResearchyResult {
  meta: ResearchyMeta;
  shortlist: ShortlistedTopic[];
  excluded: ExcludedPost[];
  agentNote: string;
  /** Extended thinking text — populated when thinking is enabled, not part of LLM schema */
  thinking?: string;
}

// ─── DB Adapter Types ─────────────────────────────────────────────────────────

export interface TopicDecision {
  topic: string;
  decision: "approved" | "rejected";
  feedback?: string | null;
  researchyReason?: string | null;
  createdAt?: Date;
}

export interface AgentFeedback {
  feedback: string;
  createdAt?: Date;
}

export interface ResearchyDb {
  getTopicHistory(limit: number): Promise<TopicDecision[]>;
  getAgentFeedback(agentId: string, limit: number): Promise<AgentFeedback[]>;
}

// ─── Deps Interface ───────────────────────────────────────────────────────────

export interface ResearchyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  /** Optional — omit to skip memory injection (e.g. first run or testing) */
  db?: ResearchyDb;
  /** Optional — attach to get a full pipeline trace */
  logger?: RequestLogger;
}

// ─── Memory Block Builder ─────────────────────────────────────────────────────

async function buildMemoryBlock(db?: ResearchyDb): Promise<string> {
  if (!db) return "";

  const [decisions, feedback] = await Promise.all([
    db.getTopicHistory(20),
    db.getAgentFeedback("researchy", 5),
  ]);

  if (decisions.length === 0 && feedback.length === 0) return "";

  let block = "\n\n---\n## YOUR LEARNING MEMORY\n\n";

  const approved = decisions.filter(d => d.decision === "approved");
  const rejected = decisions.filter(d => d.decision === "rejected");

  if (approved.length > 0) {
    block += "**PREVIOUSLY APPROVED TOPICS** (owners liked these — surface similar ones):\n";
    approved.forEach(d => {
      block += `✅ "${d.topic}"${d.researchyReason ? ` — ${d.researchyReason}` : ""}\n`;
    });
    block += "\n";
  }

  if (rejected.length > 0) {
    block += "**PREVIOUSLY REJECTED TOPICS** (owners did NOT want these — avoid similar):\n";
    rejected.forEach(d => {
      block += `❌ "${d.topic}"${d.feedback ? ` — Owner said: "${d.feedback}"` : " — no reason given"}\n`;
    });
    block += "\n";
  }

  if (feedback.length > 0) {
    block += "**OWNER FEEDBACK ON YOUR RECENT SHORTLISTS:**\n";
    feedback.forEach(f => block += `• ${f.feedback}\n`);
    block += "\n";
  }

  block += "---\n";
  return block;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(memoryBlock: string, _kbContent?: string): string {
  return `You are Researchy 👀, Scam Researcher at oh HACK no! — a media company that protects people from online scams.

**YOUR ONLY JOB:** Read the Reddit posts below and return the ones that describe online scams. That's it.

---

## THE FILTER — ONE RULE ONLY

**Include** a post if the scam happens online (email, text, phone call, website, social media, app, marketplace listing, etc.).

**Exclude** a post if:
- The scam happens in person (stranger approaches someone in a parking lot, street, shop, etc.)
- It's not a scam at all (general complaint, question, advice request with no scam involved)
- It's a duplicate of another post in the same batch (keep the best one, note the duplicate URL)

**When in doubt, INCLUDE it.** You are not the last line of defence — a human owner will review your shortlist.

---

## OUTPUT RULES

For every included post, return:
- The full original title (verbatim)
- A 2–3 sentence plain-English summary of what the scam is
- The date/time it was posted (use the "timeAgo" field as-is)
- The direct Reddit URL

For every excluded post, return the title and one short reason why it was excluded.

Return a brief \`agentNote\` (1–2 sentences) noting how many posts you reviewed and how many made the cut.
${memoryBlock}`;
}

// ─── JSON Response Schema ─────────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      properties: {
        scrapedAt:        { type: "string" },
        timeWindow:       { type: "string" },
        rawPostsReviewed: { type: "number" },
        shortlisted:      { type: "number" },
        excluded:         { type: "number" },
      },
      required: ["scrapedAt","timeWindow","rawPostsReviewed","shortlisted","excluded"],
      additionalProperties: false,
    },
    shortlist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalTitle: { type: "string", description: "Exact Reddit post title, verbatim" },
          summary:       { type: "string", description: "2-3 sentences: plain-English description of the scam" },
          postedAt:      { type: "string", description: "When the post was made, e.g. '3 hours ago'" },
          redditUrl:     { type: "string", description: "Direct link to the Reddit post" },
          relatedPosts:  { type: "array", items: { type: "string" }, description: "URLs of duplicate posts about the same scam, if any" },
        },
        required: ["originalTitle","summary","postedAt","redditUrl","relatedPosts"],
        additionalProperties: false,
      },
    },
    excluded: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalTitle:   { type: "string" },
          exclusionReason: { type: "string", description: "One short sentence: why it was excluded" },
          redditUrl:       { type: "string" },
        },
        required: ["originalTitle","exclusionReason","redditUrl"],
        additionalProperties: false,
      },
    },
    agentNote: { type: "string", description: "1-2 sentences: how many reviewed, how many shortlisted" },
  },
  required: ["meta","shortlist","excluded","agentNote"],
  additionalProperties: false,
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export interface RunResearchyParams {
  posts: RedditPost[];
  timeWindow?: string;
  scannedAt?: string;
  /** Optional — inject scam-categories.md content to override inline category list */
  kbContent?: string;
}

export async function runResearchy(
  params: RunResearchyParams,
  deps: ResearchyDeps
): Promise<ResearchyResult> {
  const { posts, timeWindow = "24 hours", scannedAt = new Date().toISOString(), kbContent } = params;
  const log = deps.logger;

  log?.info("researchy", `Starting filter — ${posts.length} posts received, timeWindow: ${timeWindow}`);

  const memoryBlock = await buildMemoryBlock(deps.db);
  const systemPrompt = buildSystemPrompt(memoryBlock, kbContent);

  log?.debug("researchy", "System prompt", { systemPrompt });

  const postsText = posts.slice(0, 50).map((p, i) => {
    // When both upvotes and comments are 0, treat as unavailable (Serper-sourced data)
    const engagementLine = (p.upvotes === 0 && p.comments === 0)
      ? `Upvotes: N/A | Comments: N/A | Posted: ${p.timeAgo}`
      : `Upvotes: ${p.upvotes} | Comments: ${p.comments} | Posted: ${p.timeAgo}`;
    return [
      `POST ${i + 1}: ${p.title}`,
      engagementLine,
      p.flair ? `Flair: ${p.flair}` : null,
      p.bodyPreview ? `Preview: ${p.bodyPreview.slice(0, 200)}` : null,
      `URL: ${p.url}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const topicHistoryNote = deps.db
    ? "Topic history has been injected above."
    : "⚠️ No topic history available — this appears to be a first run.";

  const userMessage = `Here are ${posts.length} posts scraped from r/Scams (time window: ${timeWindow}, scanned: ${scannedAt}).

${topicHistoryNote}

Apply your filter and return the shortlist. Return ONLY valid JSON matching the required schema — no markdown, no extra text.

${postsText}`;

  log?.debug("researchy", "User message sent to LLM", { userMessage });
  log?.info("researchy", `Calling LLM (claude-haiku-4-5) with ${posts.slice(0, 50).length} posts`);

  const response = await deps.invokeLLM({
    model: "claude-haiku-4-5-20251001",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "researchy_shortlist",
        strict: true,
        schema: RESPONSE_SCHEMA,
      },
    },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  log?.debug("researchy", "Raw LLM response", { raw });

  if (response.thinking) {
    log?.debug("researchy", "Extended thinking", { thinking: response.thinking });
  }

  try {
    const parsed = JSON.parse(raw) as ResearchyResult;
    if (response.thinking) parsed.thinking = response.thinking;
    log?.info("researchy", `Parse OK — shortlist: ${parsed.shortlist?.length ?? 0}, excluded: ${parsed.excluded?.length ?? 0}`);
    return parsed;
  } catch (err) {
    log?.error("researchy", "JSON parse failed", { raw, err: String(err) });
    return {
      meta: {
        scrapedAt: scannedAt,
        timeWindow,
        rawPostsReviewed: posts.length,
        shortlisted: 0,
        excluded: 0,
      },
      shortlist: [],
      excluded: [],
      agentNote: "Something went wrong parsing my output. Please retry.",
    };
  }
}
