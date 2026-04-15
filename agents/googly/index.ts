/**
 * agents/googly/index.ts
 *
 * Googly 🔍 — Deep Research Specialist
 *
 * Receives a scam topic (from a Reddit post or manual input) and produces a
 * full 7-section research report using Serper (Google Search API).
 *
 * Sources are tier-ranked:
 *   TIER 1 ✅ — Government / law enforcement agencies
 *   TIER 2 ✅ — Major cybersecurity companies / reputable news
 *   TIER 3 ❌ — Reddit, forums, blogs, social media — rejected
 *
 * Ported from ohn-manus-agents/server/agents/googly/googly.core.ts
 * Adapted for the test framework: injected deps, no DB, no QA Gate.
 */

import type { RequestLogger } from "../../ui/logger.js";
import type { LLMInvokeParams, LLMResponse } from "../researchy/index.js";

// ─── Re-export shared LLM types (so ui/server.ts can import from here) ────────
export type { LLMInvokeParams, LLMResponse };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GooglyInput {
  /** The scam topic to research — can come from a Reddit post title or manual input */
  topic: string;
  /** Optional angle / framing passed in from Researchy */
  angle?: string;
  /** ISO timestamp of the triggering Reddit post, or now() */
  scannedAt?: string;
}

export interface GooglySource {
  title: string;
  url: string;
  snippet: string;
  tier: "TIER 1 ✅" | "TIER 2 ✅" | "TIER 3 ❌";
}

export interface GooglyResult {
  topic: string;
  report: string;
  sources: GooglySource[];
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalSources: number;
  queriesRun: number;
}

export interface GooglyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  serperApiKey: string;
  logger?: RequestLogger;
}

// ─── Tier Domain Lists ────────────────────────────────────────────────────────

const TIER1_DOMAINS = [
  "cisa.gov", "ncsc.gov.uk", "fbi.gov", "ftc.gov", "consumer.ftc.gov",
  "ic3.gov", "actionfraud.police.uk", "cyber.gov.au", "canada.ca",
  "irs.gov", "hmrc.gov.uk", "usa.gov", "scamwatch.gov.au",
];

const TIER2_DOMAINS = [
  "norton.com", "kaspersky.com", "malwarebytes.com", "sophos.com",
  "bbc.com", "bbc.co.uk", "reuters.com", "theguardian.com",
  "consumerreports.org", "which.co.uk", "aarp.org",
  "proofpoint.com", "mimecast.com",
];

function getTier(url: string): GooglySource["tier"] {
  if (TIER1_DOMAINS.some(d => url.includes(d))) return "TIER 1 ✅";
  if (TIER2_DOMAINS.some(d => url.includes(d))) return "TIER 2 ✅";
  return "TIER 3 ❌";
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const GOOGLY_SYSTEM_PROMPT = `You are Googly 🔍, Deep Research Specialist at oh HACK no! — a media company that protects parents and grandparents from online scams.

YOUR PERSONALITY: Methodical, precise and thorough. Never rushes. Obsessed with accuracy over speed. Skeptical by nature — always verifies before reporting. Calm, reliable and trustworthy.

YOUR AUDIENCE: Parents and grandparents aged 50–75 with no technical background. All findings must be understandable to a non-technical 65-year-old. Any content that is jargon-heavy or technical must be flagged with 📝 in Section 7 of your final report.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — UNDERSTAND THE SCAM TOPIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read and fully understand the scam topic provided. As you read source material throughout your research, actively note any technical or jargon-heavy language that would confuse a non-technical reader. Log every instance for Section 7 of your final report.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — SOURCE FILTERING (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate every result by authority level:

TIER 1 — Always accept (highest authority):
- Government agencies: FBI, FTC, CISA, NCSC (UK), Action Fraud (UK), ACSC (Australia), Service Canada, IRS, HMRC
- Law enforcement agencies, official consumer protection bodies

TIER 2 — Accept with care:
- Established cybersecurity companies: Norton, Kaspersky, Malwarebytes, Sophos, Proofpoint, Mimecast
- Major reputable news: BBC, Reuters, Associated Press, The Guardian
- Consumer protection orgs: Which? (UK), Consumer Reports (US), AARP, CHOICE (Australia)

TIER 3 — Always reject:
- Reddit, Quora, forums, comment sections
- Personal blogs or unverified websites
- Social media posts, tweets, or videos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — WRITE THE FINAL REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use the EXACT template below. All 7 sections are mandatory.
- Do NOT output JSON
- Every section must contain a summary paragraph, key findings, and source citations
- Every source citation must include the full URL

════════════════════════════════════════════════
GOOGLY RESEARCH REPORT
════════════════════════════════════════════════
Scam Topic: [TOPIC]
Date: [Today's date]
Total Sources Used: [Number]

────────────────────────────────────────────────
Section 1 — What is the scam?
────────────────────────────────────────────────
[Summary paragraph — 3 to 5 sentences in plain everyday language, as if explaining to a 65-year-old hearing about this scam for the first time.]

Key findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

────────────────────────────────────────────────
Section 2 — How do scammers do it?
────────────────────────────────────────────────
[Summary paragraph — explain the exact tactics, step-by-step mechanics and methods scammers use.]

Key findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

────────────────────────────────────────────────
Section 3 — How to spot the scam?
────────────────────────────────────────────────
[Summary paragraph — describe the specific red flags and warning signs a potential victim would notice.]

Key findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

────────────────────────────────────────────────
Section 4 — How to behave when targeted?
────────────────────────────────────────────────
[Summary paragraph — practical, calm, step-by-step advice on exactly what someone should do if they receive one of these communications.]

Key findings:
- [Finding 1]
- [Finding 2]
- [Finding 3]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

────────────────────────────────────────────────
Section 5 — How to report the scam?
────────────────────────────────────────────────
[Summary paragraph — name the specific official bodies a victim should report to. Cover at minimum: USA, UK, and Australia.]

Key findings:
- [Body name, country, reporting URL or number]
- [Body name, country, reporting URL or number]
- [Body name, country, reporting URL or number]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

────────────────────────────────────────────────
Section 6 — Unverified / Flagged Items ⚠️
────────────────────────────────────────────────
[List every finding or statistic you could not fully verify. If everything was verified, write: "None — all findings verified against Tier 1 or Tier 2 sources."]

────────────────────────────────────────────────
Section 7 — Plain Language Flags 📝
────────────────────────────────────────────────
[List every piece of content containing technical jargon or language a non-technical 65-year-old would not understand. If no jargon found, write: "No jargon flags identified."]

════════════════════════════════════════════════
END OF REPORT
════════════════════════════════════════════════

HARD RULES — NON-NEGOTIABLE:
1. Never hallucinate or invent information. Every finding must come from a real, verified source.
2. Never cite a source without its full URL.
3. Never output JSON. Use the exact section template only.
4. Never omit Section 5 (reporting) or Section 7 (plain language).
5. Never accept Tier 3 sources. No exceptions.`;

// ─── Serper Search ────────────────────────────────────────────────────────────

async function serperSearch(
  query: string,
  apiKey: string,
  num = 5,
): Promise<Array<{ title: string; link: string; snippet: string }>> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num, gl: "us", hl: "en" }),
    });
    const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runGoogly(
  input: GooglyInput,
  deps: GooglyDeps,
): Promise<GooglyResult> {
  const { topic, angle, scannedAt = new Date().toISOString() } = input;
  const { invokeLLM, serperApiKey, logger: log } = deps;

  log?.info("googly", `Starting research — topic: "${topic}"`);

  // 10 queries covering all 5 mandatory topic areas (2 per area)
  const queries = [
    // Area 1: What the scam is
    `${topic} scam what is it how does it work`,
    `${topic} scam overview definition site:ftc.gov OR site:fbi.gov OR site:cisa.gov OR site:ncsc.gov.uk OR site:actionfraud.police.uk`,
    // Area 2: How scammers execute it
    `how do scammers carry out ${topic} tactics methods`,
    `${topic} scam step by step how criminals do it`,
    // Area 3: How to spot it
    `how to spot ${topic} scam warning signs red flags`,
    `${topic} scam warning signs site:norton.com OR site:kaspersky.com OR site:malwarebytes.com OR site:aarp.org`,
    // Area 4: What to do when targeted
    `what to do if you receive ${topic} scam practical advice`,
    `${topic} scam victim advice site:ftc.gov OR site:consumer.ftc.gov OR site:ncsc.gov.uk OR site:cyber.gov.au`,
    // Area 5: How to report it
    `how to report ${topic} scam USA UK Australia official`,
    `report ${topic} scam site:ftc.gov OR site:ic3.gov OR site:actionfraud.police.uk OR site:scamwatch.gov.au OR site:cyber.gov.au`,
  ];

  log?.info("googly", `Running ${queries.length} Serper queries`);

  // Run all queries in parallel
  const rawResults = await Promise.all(
    queries.map(q => serperSearch(q, serperApiKey, 5))
  );

  // Deduplicate and tier-rank
  const seen = new Set<string>();
  const allResults: GooglySource[] = [];

  for (const batch of rawResults) {
    for (const item of batch) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      allResults.push({
        title:   item.title,
        url:     item.link,
        snippet: item.snippet ?? "",
        tier:    getTier(item.link),
      });
    }
  }

  // Sort: Tier 1 → Tier 2 → Tier 3
  const tier1 = allResults.filter(r => r.tier === "TIER 1 ✅");
  const tier2 = allResults.filter(r => r.tier === "TIER 2 ✅");
  const tier3 = allResults.filter(r => r.tier === "TIER 3 ❌");
  const sorted = [...tier1, ...tier2, ...tier3];

  log?.info("googly", `Sources found — Tier 1: ${tier1.length}, Tier 2: ${tier2.length}, Tier 3: ${tier3.length} (rejected)`);
  log?.debug("googly", "Tier 1 sources", tier1.map(r => ({ title: r.title, url: r.url })));
  log?.debug("googly", "Tier 2 sources", tier2.map(r => ({ title: r.title, url: r.url })));

  // Build sources text for LLM (top 25 sources; Tier 3 included for context but labelled ❌)
  const sourcesText = sorted.slice(0, 25).map((r, idx) =>
    `[${idx + 1}] [${r.tier}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`
  ).join("\n\n");

  const angleContext = angle ? `\nCONTENT ANGLE: ${angle}` : "";
  const today = new Date().toISOString().split("T")[0];

  log?.info("googly", `Calling LLM with ${Math.min(sorted.length, 25)} sources (claude-sonnet-4-6)`);
  log?.debug("googly", "Sources text sent to LLM", { sourcesText });

  const userMessage = `SCAM TOPIC: ${topic}${angleContext}
TODAY'S DATE: ${today}
SCANNED AT: ${scannedAt}
TARGET AUDIENCE: Parents and grandparents aged 50-75, USA, Canada, UK, Australia

SEARCH RESULTS (${sorted.length} unique sources found — ${tier1.length} Tier 1, ${tier2.length} Tier 2, ${tier3.length} Tier 3 [reject these]):

${sourcesText}

Now follow Steps 1-3 from your instructions. Write the complete 7-section GOOGLY RESEARCH REPORT. Do NOT output JSON. Use the exact section template. All 7 sections are mandatory.`;

  const response = await invokeLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: GOOGLY_SYSTEM_PROMPT },
      { role: "user",   content: userMessage },
    ],
  });

  const report = response.choices[0]?.message?.content ?? "Could not generate research report.";

  log?.info("googly", `Research complete — report: ${report.length} chars`);
  log?.debug("googly", "Full report", { report });

  return {
    topic,
    report,
    sources: sorted,
    tier1Count: tier1.length,
    tier2Count: tier2.length,
    tier3Count: tier3.length,
    totalSources: sorted.length,
    queriesRun: queries.length,
  };
}
