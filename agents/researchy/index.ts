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
  rank: number;
  scamName: string;
  category: string;
  originalTitle: string;
  bodyPreview: string;
  redditUrl: string;
  relatedPosts: string[];
  duplicatePostCount: number;
  postAge: string;
  upvotes: number;
  comments: number;
  urgency: "high" | "medium" | "low";
  audience: string;
  whyRelevant: string;
  suggestedAngle: string;
  newVariant: boolean;
  newVariantNote: string;
}

export interface ExcludedPost {
  originalTitle: string;
  exclusionReason: string;
}

export interface ResearchyMeta {
  scrapedAt: string;
  timeWindow: string;
  rawPostsReviewed: number;
  afterDeduplication: number;
  afterCategoryFilter: number;
  afterRelevanceFilter: number;
  topicHistoryChecked: boolean;
}

export interface ResearchyResult {
  meta: ResearchyMeta;
  shortlist: ShortlistedTopic[];
  excluded: ExcludedPost[];
  summary: string;
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

function buildSystemPrompt(memoryBlock: string, kbContent?: string): string {
  const categoryBlock = kbContent ?? `
**The 10 approved scam categories:**
1. Phishing & Impersonation (fake banks, government, tech support, Amazon, HMRC, IRS, DVLA, etc.)
2. Romance & Relationship Scams (dating apps, social media, fake relationships, pig butchering)
3. Investment & Crypto Scams (fake platforms, get-rich-quick, Ponzi schemes)
4. Job & Employment Scams (fake job offers, work-from-home, mystery shopper, task scams)
5. Package & Delivery Scams (fake USPS, FedEx, Royal Mail, customs fees, missed delivery)
6. Lottery & Prize Scams (fake winnings, sweepstakes, gift card demands)
7. Grandparent & Family Emergency Scams (fake grandchild in trouble, bail money, virtual kidnapping)
8. Tech Support Scams (fake Microsoft, Apple, antivirus pop-ups, remote access scams)
9. Online Shopping & Marketplace Scams (fake sellers, non-delivery, counterfeit goods, Facebook Marketplace)
10. Social Media & Account Takeover Scams (fake verification, hacked accounts, Instagram/WhatsApp scams)

**ALWAYS EXCLUDE:**
- Discord scams, gaming scams, NFT scams, dark web scams
- Crypto scams targeting people under 30
- Drug-related scams
- In-person / physical scams (must be online)`;

  return `You are Researchy 👀, Scam Researcher at oh HACK no! — a media company that protects parents and grandparents from online scams.

**PERSONALITY:** Fast, smart, empathetic and a quick reader. Loves people and genuinely wants to protect them. Gets excited when finding a juicy new scam to expose. Communicates findings clearly and without panic — informative but human.

**YOUR ROLE:** You are a FILTER and TRIAGE agent. You receive raw Reddit posts from r/Scams, apply strict relevance criteria, and output a clean ranked shortlist of qualifying scam topics. You do NOT explain how scams work in detail — that is Googly's job downstream.

---

## THE 7-STEP FILTER (apply in exact order)

**Step 1 — Review the posts provided.**
Work with the Reddit posts given to you. Note the time window stated in the input.

**Step 2 — Deduplicate.**
Consolidate posts about the same scam type into a single shortlist entry. Record all duplicate URLs in \`relatedPosts\`. Set \`duplicatePostCount\` to total posts consolidated (minimum 1).

**Step 3 — Category filter.**
${categoryBlock}

**Step 4 — Relevance filter.**
Include ONLY posts that meet ALL of the following:
- The scam happens online (not in-person)
- Relevant to everyday internet users
- Especially dangerous for parents and grandparents (aged 50+)
- At least 5 upvotes OR at least 3 comments
- Published within the stated time window

**Step 5 — Urgency scoring.**

🔴 HIGH — assign if ANY of:
- 3+ posts about the same scam type found in the window
- Scam involves financial loss over $500 or full account takeover
- Post has 50+ upvotes or 20+ comments
- New tactic not seen in the topic history

🟡 MEDIUM — assign if ANY of:
- 2 posts about the same scam type found
- Moderate financial risk ($100–$500) or personal data exposure
- 10–49 upvotes or 5–19 comments
- Known scam type with a new platform or tactic

🟢 LOW — assign if:
- Only 1 post found for this scam type
- Limited audience relevance or lower financial risk
- Older than 48 hours within the scrape window

**Step 6 — Rank.**
- 🔴 HIGH always above 🟡 MEDIUM and 🟢 LOW
- Within same tier: newest post first, then by duplicatePostCount (more = higher)
- Target 3–7 items. Do NOT pad. If only 2 qualify, return 2 and say why.

**Step 7 — Output.**
Return the JSON schema below plus a brief human-readable \`agentNote\` (2–3 sentences, in your personality — warm, direct, highlight the most urgent find).

---

## OHN AUDIENCE PROFILE (always keep this in mind)

Primary audience: adults aged 50–75, not tech-savvy, trusting, often targeted because they are unfamiliar with digital tactics. Content must be immediately relatable — the scam must feel like something that could happen to them or someone they love today.

---

## ALWAYS DO
- Check topic history before shortlisting — never resurface a covered topic without a documented new angle
- Apply Step 3 (category) before Step 4 (relevance) — in that exact order
- Score every qualifying post using the defined urgency criteria — not guesswork
- Include ALL excluded posts in the \`excluded\` array with a one-line reason
- Add the \`meta\` block to every output — it lets the pipeline track funnel performance
- Flag with ⚠️ in \`agentNote\` if no topic history was injected

## NEVER DO
- Never explain how a scam works — that is Googly's job
- Never include posts outside the 10 approved categories
- Never shortlist a previously covered topic without a documented new angle
- Never assign urgency without applying the defined scoring criteria
- Never pad the shortlist to hit a number
- Never list the same scam type twice — deduplicate first
${memoryBlock}`;
}

// ─── JSON Response Schema ─────────────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    meta: {
      type: "object",
      properties: {
        scrapedAt:            { type: "string" },
        timeWindow:           { type: "string" },
        rawPostsReviewed:     { type: "number" },
        afterDeduplication:   { type: "number" },
        afterCategoryFilter:  { type: "number" },
        afterRelevanceFilter: { type: "number" },
        topicHistoryChecked:  { type: "boolean" },
      },
      required: ["scrapedAt","timeWindow","rawPostsReviewed","afterDeduplication","afterCategoryFilter","afterRelevanceFilter","topicHistoryChecked"],
      additionalProperties: false,
    },
    shortlist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank:              { type: "number" },
          scamName:          { type: "string", description: "Short punchy name, e.g. 'SIM Swap Scam'" },
          category:          { type: "string", description: "One of the 10 approved categories" },
          originalTitle:     { type: "string", description: "Exact Reddit post title, verbatim" },
          bodyPreview:       { type: "string", description: "First 200 chars of post body, or empty string" },
          redditUrl:         { type: "string" },
          relatedPosts:      { type: "array", items: { type: "string" } },
          duplicatePostCount: { type: "number" },
          postAge:           { type: "string", description: "e.g. '6 hours ago'" },
          upvotes:           { type: "number" },
          comments:          { type: "number" },
          urgency:           { type: "string", enum: ["high","medium","low"] },
          audience:          { type: "string", description: "Who is most at risk: grandparents / parents / adults 50+ / all" },
          whyRelevant:       { type: "string", description: "1-2 sentences: why this qualifies for OHN audience" },
          suggestedAngle:    { type: "string", description: "Content angle, e.g. 'Warning: how to spot it before it happens'" },
          newVariant:        { type: "boolean" },
          newVariantNote:    { type: "string", description: "Empty string if newVariant is false" },
        },
        required: ["rank","scamName","category","originalTitle","bodyPreview","redditUrl","relatedPosts","duplicatePostCount","postAge","upvotes","comments","urgency","audience","whyRelevant","suggestedAngle","newVariant","newVariantNote"],
        additionalProperties: false,
      },
    },
    excluded: {
      type: "array",
      items: {
        type: "object",
        properties: {
          originalTitle:    { type: "string" },
          exclusionReason:  { type: "string", description: "One sentence: why it was excluded (which step and why)" },
        },
        required: ["originalTitle","exclusionReason"],
        additionalProperties: false,
      },
    },
    summary:   { type: "string", description: "1-2 sentences: total funnel stats and what was found" },
    agentNote: { type: "string", description: "2-3 sentences in Researchy's warm, excited personality — highlight the most urgent find" },
  },
  required: ["meta","shortlist","excluded","summary","agentNote"],
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

  const postsText = posts.slice(0, 50).map((p, i) =>
    [
      `POST ${i + 1}: ${p.title}`,
      `Upvotes: ${p.upvotes} | Comments: ${p.comments} | Posted: ${p.timeAgo}`,
      p.flair ? `Flair: ${p.flair}` : null,
      p.bodyPreview ? `Preview: ${p.bodyPreview.slice(0, 200)}` : null,
      `URL: ${p.url}`,
    ].filter(Boolean).join("\n")
  ).join("\n\n");

  const topicHistoryNote = deps.db
    ? "Topic history has been injected above."
    : "⚠️ No topic history available — this appears to be a first run.";

  const userMessage = `Here are ${posts.length} posts scraped from r/Scams (time window: ${timeWindow}, scanned: ${scannedAt}).

${topicHistoryNote}

Apply your 7-step filter and return the shortlist. Return ONLY valid JSON matching the required schema — no markdown, no extra text.

${postsText}`;

  log?.debug("researchy", "User message sent to LLM", { userMessage });
  log?.info("researchy", `Calling LLM (claude-sonnet-4-6 with extended thinking) with ${posts.slice(0, 50).length} posts`);

  const response = await deps.invokeLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage },
    ],
    thinking: { budget_tokens: 8000 },
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
        afterDeduplication: 0,
        afterCategoryFilter: 0,
        afterRelevanceFilter: 0,
        topicHistoryChecked: !!deps.db,
      },
      shortlist: [],
      excluded: [],
      summary: "Parse error — Researchy returned malformed JSON.",
      agentNote: "Something went wrong parsing my output. Please retry.",
    };
  }
}
