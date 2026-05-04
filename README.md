# OHN Agent Framework

Internal content automation system for **oh HACK no!** — a media company that protects people from online scams. The framework automates the full content pipeline from Reddit trend discovery through to a ready-to-shoot 60-second video script.

---

## What It Does

The pipeline runs in four stages, each handled by a dedicated agent:

```
Researchy → [approve/reject] → Googly → [approve] → Scripty → final script
                                                         ↑
                                              InstiStati informs
                                              what content performs
```

1. **Researchy** scrapes r/Scams via Serper, filters to online scams relevant to OHN's audience (adults 30–65), and presents a shortlist for owner review.
2. **Googly** takes an approved Reddit post and runs 10 targeted searches across government and cybersecurity sources (FTC, FBI, NCSC, Norton, etc.), scrapes the top pages, and generates a full 7-section research report.
3. **Scripty** takes Googly's research report and writes a 60-second video script in two stages: Core (Context → Tension → Pivot → Payoff) then 5 hook options to choose from.
4. **InstiStati** pulls live Instagram organic performance data (reach, engagement rate, 3-sec retention, watch time %) so you can see what's working before briefing new content.

---

## Architecture

```
ohn-agent-framework/
├── agents/                   # Agent orchestration logic
│   ├── researchy/            # Reddit filter + triage
│   ├── googly/               # Deep web research
│   ├── scripty/              # Video script writer
│   └── instistati/           # Instagram analytics display
│
├── skills/                   # Reusable capability modules
│   ├── reddit-scraping/      # Serper-based r/Scams fetcher
│   ├── instagram-analytics/  # Meta Graph API v21 pull
│   ├── script-writing/       # KB loader + prompt builder for Scripty
│   ├── web-research/         # Serper search utilities
│   ├── slack-messaging/      # Slack notification helper
│   └── video-analysis/       # Video frame + metadata analysis
│
├── knowledge/structured/     # Markdown knowledge bases
│   ├── scam-categories.md    # 10 approved scam categories + rules
│   ├── script-structure.md   # Core script format (Context/Tension/Pivot/Payoff)
│   ├── hook-formulas.md      # 56 hook writing formulas
│   ├── tone-and-voice.md     # OHN brand voice guidelines
│   ├── benchmark-transcripts.md  # High-performing script examples
│   ├── performance-benchmarks.md # IG metric benchmarks (3-sec, watch %, ER)
│   ├── research-sources.md   # Trusted source tiers (Tier 1 gov / Tier 2 cyber)
│   └── googly-report-template.md # 7-section report template
│
├── ui/
│   ├── server.ts             # Express API server + SSE streaming
│   └── logger.ts             # Request logger with circular buffer
│
├── public/index.html         # Single-file chat UI (vanilla JS + Tailwind-style CSS)
├── api/index.ts              # Vercel serverless entry point
└── vercel.json               # Vercel routing config
```

### Key Design Decisions

- **No database.** State is in-memory only. InstiStati uses a 2-hour TTL cache. The system is stateless across restarts — no Postgres, no Redis.
- **No framework.** The UI is a single HTML file. No React, no build step for the frontend.
- **LLM-injected dependencies.** Every agent receives `invokeLLM` as a parameter — no direct Anthropic SDK imports inside agents. This makes agents testable in isolation.
- **Structured knowledge bases.** All prompt content (hook formulas, tone rules, scam categories) lives in `knowledge/structured/*.md` files, not hardcoded strings. Updating a `.md` file updates every agent that reads it automatically.
- **SSE streaming.** Googly and Scripty stream progress events via Server-Sent Events so the UI stays live during long LLM calls. Researchy uses a standard POST/response.

### LLM Usage

| Agent | Model | Calls |
|---|---|---|
| Researchy | Claude Haiku 4.5 | 1 call — filter + triage |
| Googly | Claude Haiku 4.5 | 3 calls — topic extraction, relevance filter, report generation |
| Scripty | Claude Haiku 4.5 | 2 calls — core script, hooks |
| InstiStati | None | Display only, no LLM |

---

## Setup

### Requirements

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Serper API key](https://serper.dev/) (for Researchy + Googly)
- *(Optional)* Instagram Business Account + Meta access token (for InstiStati live data)

### Local Development

```bash
# 1. Clone the repo
git clone https://github.com/FloKrause2025/ohn-agent-framework.git
cd ohn-agent-framework

# 2. Install dependencies
npm install

# 3. Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export SERPER_API_KEY=your_serper_key

# Optional — for live Instagram data:
export INSTAGRAM_ACCESS_TOKEN=your_long_lived_token
export INSTAGRAM_BUSINESS_ACCOUNT_ID=your_ig_business_account_id

# 4. Start the server
npm start
# → http://localhost:3333
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SERPER_API_KEY` | Yes | Google Search API key (Researchy + Googly) |
| `INSTAGRAM_ACCESS_TOKEN` | No | Long-lived Meta token for InstiStati live data |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | No | IG business account ID for InstiStati |
| `PORT` | No | HTTP port (default: 3333) |

### Vercel Deployment

The repo is configured for Vercel. Push to `main` and Vercel deploys automatically.

Set the environment variables above in **Vercel → Settings → Environment Variables**.

InstiStati's 2-hour auto-refresh does not run on Vercel (serverless has no persistent process). Instead, the endpoint fetches fresh data on each request when the cache is stale.

---

## Agents

### Researchy 👀
Fetches the latest posts from r/Scams via Serper, then passes them to Claude Haiku to filter down to online scams relevant to OHN's audience. Returns a shortlist with approve/reject buttons. Approved posts go directly to Googly.

**Input:** Serper query → r/Scams posts  
**Output:** Shortlist of online scams with summaries

### Googly 🔍
Takes an approved Reddit post (title + summary + body) and runs a 10-query deep research pass across government agencies (FTC, FBI, NCSC, CISA) and cybersecurity sources (Norton, Kaspersky, BBC). Scrapes the top 10 Tier 1+2 pages and generates a full 7-section research report.

**Input:** Reddit post text  
**Output:** 7-section research report (what it is, how it works, red flags, what to do, how to report)

### Scripty 🎬
Takes Googly's research report and writes a 60-second video script optimised for OHN's audience. Stage 1 writes the Core (Context → Tension → Pivot → Payoff). Stage 2 writes 5 hook options using OHN's 56-formula hook library. Hooks are selectable — clicking one updates the full combined script.

**Input:** Topic + Googly research report  
**Output:** Full script with 5 hook options, selected hook, caption hook

### InstiStati 📸
Pulls organic performance data from the connected Instagram Business account via Meta Graph API v21. Shows reach, engagement rate, 3-sec retention, watch time %, share rate, and save rate for the last 30 posts. Colour-coded against OHN's internal performance benchmarks. Refreshes every 2 hours, or on demand.

**Input:** Instagram Business Account credentials  
**Output:** Account summary cards + post performance table + audience breakdown

---

## Content Pipeline Flow

```
1. Open Researchy → click "Scan"
   → Reddit posts fetched and filtered
   → Review shortlist

2. Click "Research with Googly →" on a post
   → Googly runs 10 searches + scrapes sources
   → 7-section research report generated

3. Click "Generate Script with Scripty →"
   → Scripty writes Core script + 5 hook options
   → Select a hook → full script updates

4. Copy script → brief video production
```

---

## Knowledge Bases

All agent knowledge lives in `knowledge/structured/` as plain Markdown files. These are read at server startup and injected into agent prompts — no hardcoded strings in agent code.

| File | Used By | Purpose |
|---|---|---|
| `scam-categories.md` | Researchy | Which scam types to include/exclude |
| `script-structure.md` | Scripty | Core script format rules |
| `hook-formulas.md` | Scripty | 56 hook writing formulas with examples |
| `tone-and-voice.md` | Scripty | OHN brand voice, language rules |
| `benchmark-transcripts.md` | Scripty | High-performing script examples |
| `performance-benchmarks.md` | InstiStati | IG metric thresholds (green/amber/red) |
| `research-sources.md` | Googly | Trusted source tier definitions |
| `googly-report-template.md` | Googly | 7-section report format |

To update any agent's behaviour, edit the relevant `.md` file and restart the server.
