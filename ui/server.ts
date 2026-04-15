/**
 * ui/server.ts
 *
 * Simple Express server for the OHN Agent Testing UI.
 * Serves the chat interface and routes messages to the appropriate agent.
 *
 * Start: ANTHROPIC_API_KEY=sk-ant-... npx tsx ui/server.ts
 */

import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { runResearchy } from "../agents/researchy/index.js";
import type { RedditPost, LLMInvokeParams } from "../agents/researchy/index.js";
// RedditPost used for mapping below; LLMInvokeParams used by makeInvokeLLM
import { fetchRedditScamPosts } from "../skills/reddit-scraping/index.js";
import type { RedditScrapingConfig } from "../skills/reddit-scraping/index.js";
import { RequestLogger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3333;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  throw new Error(
    "ANTHROPIC_API_KEY is not set. " +
    "Set it in your environment or Vercel project settings."
  );
}

const anthropic = new Anthropic({ apiKey: API_KEY });

// ─── LLM Adapter ─────────────────────────────────────────────────────────────

function makeInvokeLLM() {
  return async (params: LLMInvokeParams) => {
    const systemMsg = params.messages.find(m => m.role === "system")?.content ?? "";
    const userMsgs  = params.messages.filter(m => m.role !== "system");

    // Thinking requires Sonnet or Opus — auto-upgrade from Haiku if needed
    const requestedModel = params.model ?? "claude-haiku-4-5-20251001";
    const model = params.thinking && requestedModel.includes("haiku")
      ? "claude-sonnet-4-6"
      : requestedModel;

    // When thinking is enabled: max_tokens must exceed budget_tokens.
    // Keep total under ~8k to avoid Vercel's 60s function timeout.
    const maxTokens = params.thinking
      ? params.thinking.budget_tokens + 4096
      : 4096;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thinkingParam = params.thinking
      ? { type: "enabled" as const, budget_tokens: params.thinking.budget_tokens }
      : undefined;

    // Anthropic doesn't support response_format — use tool_use to enforce schema
    if (params.response_format?.type === "json_schema") {
      const { name, schema } = params.response_format.json_schema;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (anthropic.messages.create as any)({
        model,
        max_tokens: maxTokens,
        ...(thinkingParam ? { thinking: thinkingParam } : {}),
        system: systemMsg,
        messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
        tools: [{
          name,
          description: `Return structured output matching the ${name} schema.`,
          input_schema: schema,
        }],
        // Thinking is incompatible with forced tool use ("tool" or "any").
        // With "auto" the model sees one tool + a clear description and always calls it.
        tool_choice: thinkingParam ? { type: "auto" } : { type: "tool", name },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = response.content as Array<{ type: string; input?: unknown; thinking?: string }>;
      const toolBlock    = blocks.find(b => b.type === "tool_use");
      const thinkingBlock = blocks.find(b => b.type === "thinking");
      const json = toolBlock ? JSON.stringify(toolBlock.input) : "{}";
      return {
        choices: [{ message: { content: json } }],
        thinking: thinkingBlock?.thinking,
      };
    }

    // No schema required — plain text response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (anthropic.messages.create as any)({
      model,
      max_tokens: maxTokens,
      ...(thinkingParam ? { thinking: thinkingParam } : {}),
      system: systemMsg,
      messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = response.content as Array<{ type: string; text?: string; thinking?: string }>;
    const textBlock     = blocks.find(b => b.type === "text");
    const thinkingBlock = blocks.find(b => b.type === "thinking");
    return {
      choices: [{ message: { content: textBlock?.text ?? "" } }],
      thinking: thinkingBlock?.thinking,
    };
  };
}

// ─── Result Store ─────────────────────────────────────────────────────────────
// In-memory cache — Vercel keeps function instances warm for ~5-10 min.
// Good enough for "just ran it, share with Claude" workflow.

interface StoredRun {
  runId: string;
  agentId: string;
  timestamp: string;
  result: unknown;
  logs: unknown;
  meta: unknown;
}

const resultStore = new Map<string, StoredRun>();
const MAX_STORED = 20;

function storeRun(run: StoredRun): void {
  if (resultStore.size >= MAX_STORED) {
    // Drop the oldest entry
    const oldest = resultStore.keys().next().value;
    if (oldest) resultStore.delete(oldest);
  }
  resultStore.set(run.runId, run);
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
// On Vercel, static files are served natively from /public at the repo root.
// Locally (npm start), Express serves them from ui/public/.
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "public")));
}

// List of available agents and their status
app.get("/api/agents", (_req, res) => {
  res.json([
    { id: "researchy",      name: "Researchy",       emoji: "👀", status: "live",        description: "Scam Researcher — filters r/Scams for OHN content topics" },
    { id: "googly",         name: "Googly",           emoji: "🔍", status: "coming_soon", description: "Deep Research Specialist — investigates approved topics" },
    { id: "scripty",        name: "Scripty",          emoji: "🎬", status: "coming_soon", description: "Script Writer — writes 60-second video scripts" },
    { id: "quality-gate",   name: "Quality Gate",     emoji: "✅", status: "coming_soon", description: "QA Reviewer — checks scripts before approval" },
    { id: "instistati",     name: "InstiStati",       emoji: "📸", status: "coming_soon", description: "Instagram Analytics — organic performance reports" },
    { id: "statsy",         name: "Statsy",           emoji: "📊", status: "coming_soon", description: "Meta Ads Analytics — paid media performance" },
    { id: "addy",           name: "Addy",             emoji: "🎯", status: "coming_soon", description: "Ad Analyzer — angles, winners and stops" },
    { id: "paid-marketing", name: "PaidMarketing",    emoji: "💰", status: "coming_soon", description: "Paid Media Strategist — full campaign recommendations" },
  ]);
});

// Result lookup endpoint — lets Claude fetch a run by ID
app.get("/api/result/:runId", (req, res) => {
  const run = resultStore.get(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found. Results are cached for ~10 minutes — try running the agent again." });
    return;
  }
  res.json(run);
});

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
  const { agentId, message } = req.body as { agentId: string; message: string };

  if (!agentId || !message) {
    res.status(400).json({ error: "agentId and message are required" });
    return;
  }

  try {
    if (agentId === "researchy") {
      const logger = new RequestLogger();
      logger.info("server", `Request received — agentId: ${agentId}`);

      const redditConfig: RedditScrapingConfig = {
        redditClientId:     process.env.REDDIT_CLIENT_ID,
        redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
        serperApiKey:       process.env.SERPER_API_KEY,
        logger,
      };

      const fetched = await fetchRedditScamPosts(redditConfig);

      if (fetched.posts.length === 0) {
        const hasSerper = !!process.env.SERPER_API_KEY;
        logger.error("server", "Reddit returned 0 posts", { authMethod: fetched.authMethod, queriesUsed: fetched.queriesUsed, hasSerper });
        res.status(502).json({
          error: hasSerper
            ? "Serper returned no results and Reddit is blocking this server's IP. Check your SERPER_API_KEY in Vercel settings."
            : "Reddit is blocking requests from this server's IP (common on Vercel/AWS). Fix: add SERPER_API_KEY to your Vercel environment variables. Get a free key at serper.dev (2,500 free searches/month).",
          logs: logger.entries,
        });
        return;
      }

      const posts: RedditPost[] = fetched.posts.map(p => ({
        title:       p.title,
        upvotes:     p.upvotes,
        comments:    p.comments,
        flair:       p.flair,
        url:         p.url,
        author:      p.author,
        timeAgo:     p.timeAgo,
        bodyPreview: p.bodyPreview,
      }));

      const result = await runResearchy(
        { posts, timeWindow: "7 days", scannedAt: fetched.scannedAt },
        { invokeLLM: makeInvokeLLM(), logger }
      );

      const runId = generateRunId();
      const meta = { postsFetched: fetched.posts.length, authMethod: fetched.authMethod };
      storeRun({ runId, agentId, timestamp: new Date().toISOString(), result, logs: logger.entries, meta });

      logger.info("server", `Request complete — runId: ${runId}`);
      res.json({
        agentId,
        type: "researchy",
        result,
        meta,
        logs: logger.entries,
        runId,
      });
      return;
    }

    // Agents not yet implemented
    res.json({
      agentId,
      type: "coming_soon",
      result: { message: `${agentId} is being built. Check back soon.` },
    });
  } catch (err) {
    console.error(`[${agentId}] Error:`, err);
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }

});

// ─── Start ────────────────────────────────────────────────────────────────────

// On Vercel the app is exported as a serverless handler — no listen() needed.
// Locally (npm start / tsx ui/server.ts) we listen normally.
if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀  OHN Agent UI running at http://localhost:${PORT}`);
    console.log(`    Anthropic API key: ${API_KEY.slice(0, 12)}...`);
    console.log(`    Agents live: researchy`);
    console.log(`    Press Ctrl+C to stop\n`);
  });
}

// Vercel serverless handler
export default app;
