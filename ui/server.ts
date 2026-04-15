/**
 * ui/server.ts
 *
 * Simple Express server for the OHN Agent Testing UI.
 * Serves the chat interface and routes messages to the appropriate agent.
 *
 * Start: ANTHROPIC_API_KEY=sk-ant-... npx tsx ui/server.ts
 */

import express from "express";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { runResearchy } from "../agents/researchy/index.js";
import type { RedditPost, LLMInvokeParams } from "../agents/researchy/index.js";

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

// ─── Sample Reddit Posts (Researchy test data) ────────────────────────────────

const SAMPLE_POSTS: RedditPost[] = [
  {
    title: "Got SIM swapped yesterday — lost access to my bank account and email in minutes",
    upvotes: 312, comments: 87, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/sim1/",
    timeAgo: "8 hours ago",
    bodyPreview: "I woke up to no signal on my phone. Within 20 minutes someone had transferred $4,200 from my bank account. My carrier said someone called in pretending to be me.",
  },
  {
    title: "SIM swap attack — T-Mobile rep transferred my number without any verification",
    upvotes: 145, comments: 34, flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/sim2/",
    timeAgo: "14 hours ago",
    bodyPreview: "My T-Mobile number was transferred to a new SIM without me authorising it. They bypassed the PIN I had set.",
  },
  {
    title: "WARNING: New SIM swapping method bypasses carrier PINs — my elderly father was targeted",
    upvotes: 89, comments: 22, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/sim3/",
    timeAgo: "3 hours ago",
    bodyPreview: "My 72-year-old father lost $8,500 to a SIM swap. The scammer called the carrier using his leaked personal info to pass security questions.",
  },
  {
    title: "My mum got a call saying I was arrested — she nearly wired $3,000 to 'bail me out'",
    upvotes: 521, comments: 143, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/gp1/",
    timeAgo: "5 hours ago",
    bodyPreview: "Someone called my 67-year-old mum claiming to be a police officer. They said I'd been arrested and needed $3,000 bail. She called me first — I was fine. But she was shaking.",
  },
  {
    title: "Received official-looking HMRC email saying I owe £450 in unpaid tax — is this real?",
    upvotes: 28, comments: 11, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/hmrc1/",
    timeAgo: "18 hours ago",
    bodyPreview: "The email has the HMRC logo, my full name, and a link to pay. The URL looked odd though.",
  },
  {
    title: "Someone pretending to be WhatsApp support asked for my 6-digit code — lost my account",
    upvotes: 67, comments: 19, flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/wa1/",
    timeAgo: "11 hours ago",
    bodyPreview: "They messaged me through WhatsApp itself saying they needed to verify my account. Asked for the SMS code. Now I can't log in.",
  },
  {
    title: "Dad got a scary popup saying his computer has a virus — Microsoft phone number to call",
    upvotes: 6, comments: 3, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/ts1/",
    timeAgo: "31 hours ago",
    bodyPreview: "The popup froze his screen and played a loud alarm. There was a number to call. He called it and they asked him to install TeamViewer.",
  },
  {
    title: "Got a Royal Mail text saying I have a parcel on hold — need to pay £1.99 customs fee",
    upvotes: 44, comments: 16, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/rm1/",
    timeAgo: "9 hours ago",
    bodyPreview: "The link goes to a fake Royal Mail page that asks for full card details. I've seen several friends get this same text.",
  },
  {
    title: "Got scammed buying a Discord Nitro gift code — they took the money and ran",
    upvotes: 34, comments: 8, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/discord1/",
    timeAgo: "12 hours ago",
    bodyPreview: "Was on a Discord server and someone offered to sell me 3 months of Nitro for cheap. Paid via PayPal and they blocked me.",
  },
  {
    title: "Lost $800 in an NFT rug pull — project devs deleted everything overnight",
    upvotes: 156, comments: 43, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/nft1/",
    timeAgo: "4 hours ago",
    bodyPreview: "Minted into a new NFT project. Devs promised a game. Next morning the Twitter, Discord and website were all gone.",
  },
  {
    title: "Man knocked on my elderly neighbour's door pretending to be from the gas company",
    upvotes: 89, comments: 27, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/door1/",
    timeAgo: "6 hours ago",
    bodyPreview: "He showed a fake ID badge and said he needed to check the boiler. Once inside he grabbed cash from the kitchen.",
  },
  {
    title: "Mum has been talking to someone online for 4 months — now he's asking for $2,000 to visit",
    upvotes: 234, comments: 78, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/rom1/",
    timeAgo: "7 hours ago",
    bodyPreview: "She met him on Facebook. Very attractive profile. They talk every day for hours. Now he says he needs money for flights because he's stuck in Turkey on a work contract.",
  },
  {
    title: "Dad invested £5,000 in a crypto trading platform recommended by someone on LinkedIn",
    upvotes: 78, comments: 31, flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/inv1/",
    timeAgo: "16 hours ago",
    bodyPreview: "He's 63 and not tech-savvy. The platform shows his balance growing but when he tried to withdraw they asked for a 20% 'tax' fee first.",
  },
  {
    title: "Nan received a letter saying she won £25,000 in a prize draw she never entered",
    upvotes: 112, comments: 38, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/lot1/",
    timeAgo: "15 hours ago",
    bodyPreview: "She's 74 and very excited. The letter looks official with a company logo and asks her to pay a £95 'processing fee' to release the winnings.",
  },
  {
    title: "Met someone on Hinge who convinced me to invest in her family's trading platform — lost $12,000",
    upvotes: 445, comments: 134, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/pig1/",
    timeAgo: "2 hours ago",
    bodyPreview: "We talked for 6 weeks. She was beautiful, caring, smart. Then she started talking about her uncle's crypto platform. Said she makes $3k a week. I put in $12k across 3 months. Now the site is gone.",
  },
  {
    title: "Mum paid £300 to someone who called saying her broadband was about to be cut off — BT impersonator",
    upvotes: 58, comments: 21, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/bt1/",
    timeAgo: "19 hours ago",
    bodyPreview: "They called her landline and said they were from BT. Told her she needed to pay a reconnection fee or lose internet. She paid £300 by bank transfer.",
  },
  {
    title: "Offered a remote data entry job — they sent me a fake cheque to cash and keep $500",
    upvotes: 93, comments: 29, flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/job1/",
    timeAgo: "13 hours ago",
    bodyPreview: "Applied for a work-from-home data entry position on Indeed. They offered $800/week. Asked me to deposit a cheque for equipment and wire the surplus to a 'supplier'.",
  },
];

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
      const result = await runResearchy(
        {
          posts: SAMPLE_POSTS,
          timeWindow: "24 hours",
          scannedAt: new Date().toISOString(),
        },
        { invokeLLM: makeInvokeLLM() }
      );
      res.json({ agentId, type: "researchy", result });
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

app.listen(PORT, () => {
  console.log(`\n🚀  OHN Agent UI running at http://localhost:${PORT}`);
  console.log(`    Anthropic API key: ${API_KEY.slice(0, 12)}...`);
  console.log(`    Agents live: researchy`);
  console.log(`    Press Ctrl+C to stop\n`);
});
