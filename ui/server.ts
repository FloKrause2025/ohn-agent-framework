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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3333;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY is not set.");
  console.error("    Start with: ANTHROPIC_API_KEY=sk-ant-... npx tsx ui/server.ts");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: API_KEY });

// ─── LLM Adapter ─────────────────────────────────────────────────────────────

function makeInvokeLLM() {
  return async (params: LLMInvokeParams) => {
    const systemMsg = params.messages.find(m => m.role === "system")?.content ?? "";
    const userMsgs  = params.messages.filter(m => m.role !== "system");
    const model     = params.model ?? "claude-haiku-4-5-20251001";

    // Anthropic doesn't support response_format — use tool_use to enforce schema
    if (params.response_format?.type === "json_schema") {
      const { name, schema } = params.response_format.json_schema;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (anthropic.messages.create as any)({
        model,
        max_tokens: 4096,
        system: systemMsg,
        messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
        tools: [{
          name,
          description: `Return structured output matching the ${name} schema.`,
          input_schema: schema,
        }],
        tool_choice: { type: "tool", name },
      });

      // Extract the tool input as JSON string
      const toolBlock = response.content?.find((b: { type: string }) => b.type === "tool_use");
      const json = toolBlock ? JSON.stringify(toolBlock.input) : "{}";
      return { choices: [{ message: { content: json } }] };
    }

    // No schema required — plain text response
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: systemMsg,
      messages: userMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return { choices: [{ message: { content: text } }] };
  };
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

// Main chat endpoint
app.post("/api/chat", async (req, res) => {
  const { agentId, message } = req.body as { agentId: string; message: string };

  if (!agentId || !message) {
    res.status(400).json({ error: "agentId and message are required" });
    return;
  }

  try {
    if (agentId === "researchy") {
      // Pull real posts from r/Scams — works without credentials via public API
      const redditConfig: RedditScrapingConfig = {
        redditClientId:     process.env.REDDIT_CLIENT_ID,
        redditClientSecret: process.env.REDDIT_CLIENT_SECRET,
        serperApiKey:       process.env.SERPER_API_KEY,
      };

      console.log("[researchy] Fetching live posts from r/Scams...");
      const fetched = await fetchRedditScamPosts(redditConfig);
      console.log(`[researchy] Got ${fetched.posts.length} posts (auth: ${fetched.authMethod})`);

      if (fetched.posts.length === 0) {
        res.status(502).json({ error: "Reddit returned no posts. Reddit may be rate-limiting — wait a minute and try again." });
        return;
      }

      // Map skill output to agent input (field names match, just re-shape)
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
        {
          posts,
          timeWindow: "24 hours",
          scannedAt:  fetched.scannedAt,
        },
        { invokeLLM: makeInvokeLLM() }
      );
      res.json({ agentId, type: "researchy", result, meta: { postsFetched: fetched.posts.length, authMethod: fetched.authMethod } });
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
