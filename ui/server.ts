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
import { runGoogly } from "../agents/googly/index.js";
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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

    // Retry up to 3 times on 529 overloaded errors (1s, 3s, 6s backoff)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callAPI = async (attempt = 0): Promise<any> => {
      try {
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
            tool_choice: thinkingParam ? { type: "auto" } : { type: "tool", name },
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const blocks = response.content as Array<{ type: string; input?: unknown; thinking?: string }>;
          const toolBlock     = blocks.find(b => b.type === "tool_use");
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
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 529 && attempt < 3) {
          const waitMs = [1000, 3000, 6000][attempt];
          console.warn(`[LLM] 529 overloaded — retrying in ${waitMs}ms (attempt ${attempt + 1}/3)`);
          await sleep(waitMs);
          return callAPI(attempt + 1);
        }
        throw err;
      }
    };

    return callAPI();
  };
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
    { id: "googly",         name: "Googly",           emoji: "🔍", status: "live",        description: "Deep Research Specialist — investigates approved topics" },
    { id: "scripty",        name: "Scripty",          emoji: "🎬", status: "coming_soon", description: "Script Writer — writes 60-second video scripts" },
    { id: "quality-gate",   name: "Quality Gate",     emoji: "✅", status: "coming_soon", description: "QA Reviewer — checks scripts before approval" },
    { id: "instistati",     name: "InstiStati",       emoji: "📸", status: "coming_soon", description: "Instagram Analytics — organic performance reports" },
    { id: "statsy",         name: "Statsy",           emoji: "📊", status: "coming_soon", description: "Meta Ads Analytics — paid media performance" },
    { id: "addy",           name: "Addy",             emoji: "🎯", status: "coming_soon", description: "Ad Analyzer — angles, winners and stops" },
    { id: "paid-marketing", name: "PaidMarketing",    emoji: "💰", status: "coming_soon", description: "Paid Media Strategist — full campaign recommendations" },
  ]);
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
        serperApiKey: process.env.SERPER_API_KEY ?? "",
        logger,
      };

      const fetched = await fetchRedditScamPosts(redditConfig);

      if (fetched.posts.length === 0) {
        logger.error("server", "Serper returned 0 posts", { queriesUsed: fetched.queriesUsed });
        res.status(502).json({
          error: "Serper returned no results. Check your SERPER_API_KEY in Vercel settings.",
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

      logger.info("server", "Request complete");
      res.json({
        agentId,
        type: "researchy",
        result,
        meta: { postsFetched: fetched.posts.length },
        logs: logger.entries,
      });
      return;
    }

    if (agentId === "googly") {
      const logger = new RequestLogger();
      logger.info("server", `Request received — agentId: ${agentId}`);

      const serperApiKey = process.env.SERPER_API_KEY ?? "";
      if (!serperApiKey) {
        res.status(502).json({ error: "SERPER_API_KEY is not set.", logs: logger.entries });
        return;
      }

      // message is the scam topic to research (can be a Reddit post title or manual input)
      const result = await runGoogly(
        { topic: message, scannedAt: new Date().toISOString() },
        { invokeLLM: makeInvokeLLM(), serperApiKey, logger },
      );

      logger.info("server", "Request complete");
      res.json({
        agentId,
        type: "googly",
        result,
        logs: logger.entries,
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
