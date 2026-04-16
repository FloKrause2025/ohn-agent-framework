/**
 * agents/scripty/index.ts
 *
 * Scripty 🎬 — Transcript Writer
 *
 * Two-stage pipeline (prevents SSE idle timeout):
 * Stage 1: Haiku writes Core — Context, Tension, Pivot, Payoff
 * Stage 2: Haiku writes Hooks from the approved Core
 *
 * Each stage is a separate LLM call. An SSE progress event fires
 * between stages so the stream never goes quiet.
 */

import type { RequestLogger } from "../../ui/logger.js";
import type { LLMInvokeParams, LLMResponse } from "../researchy/index.js";

export type { LLMInvokeParams, LLMResponse };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScriptyInput {
  topic: string;
  /** Googly's full research report — optional but strongly recommended */
  researchReport?: string;
}

export interface ScriptyCore {
  topic: string;
  context: string;
  tension: string;
  pivot: string;
  payoff: string;
  wordCount: number;
}

export interface ScriptyResult extends ScriptyCore {
  hookOptions: string[];
  selectedHook: string;
  preHookNote: string;
  captionHook: string;
  fullScript: string;
}

export interface ScriptyProgressEvent {
  step: "writing_core" | "core_complete" | "writing_hooks" | "done";
  message: string;
  data?: Record<string, unknown>;
}

export interface ScriptyDeps {
  invokeLLM: (params: LLMInvokeParams) => Promise<LLMResponse>;
  logger?: RequestLogger;
  onProgress?: (event: ScriptyProgressEvent) => void;
}

// ─── Stage 1 System Prompt — Core Writer ─────────────────────────────────────

const CORE_SYSTEM_PROMPT = `You are Scripty 🎬, Transcript Writer at oh HACK no! — a media company that protects parents and grandparents from online scams.

YOUR AUDIENCE: Women aged 35–44, USA/Canada/UK/Australia. NOT tech-savvy. Write for them — not cybersecurity professionals. If a non-technical 65-year-old cannot understand every sentence, rewrite it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 1: WRITE THE CORE ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write the 4 Core sections: Context → Tension → Pivot → Payoff.
DO NOT write any hooks. Hooks are written in Stage 2.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE 4 CORE SECTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTEXT (3–5 sentences):
- Set the scene in plain, everyday language before the scam hits
- Use the Story Entry Pattern: open with a specific ordinary moment the viewer recognises
- NEVER open with "You get an email/text/call" — open with what it claims and how the viewer FEELS
- Zero tech jargon

TENSION (4–5 sentences — ONE section only, never split):
- Place the viewer INSIDE a specific moment — not a list of scammer tactics
- BANNED: "They want your personal information. They create urgency."
- RIGHT: "While you sit there wondering why your signal is dead — they already have your number."
- The viewer must feel the threat personally, right now
- Never preachy or condescending

PIVOT (3–5 sentences):
- Reveal HOW the scam works — the "aha" moment
- Definitive language only — never "might be" or "could be"
- Short punchy sentences for the reveal

PAYOFF (3 tips max — never 4 or more):
- Each tip: 2 sentences — action + why it matters
- FRIEND VOICE not leaflet voice
- BANNED: "Monitor your financial accounts for suspicious activity."
- RIGHT: "Check your bank app right now. Look for anything you don't recognise."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORD COUNT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Core total: 150–170 words (room for the hook in Stage 2).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFERENCE EXAMPLES — STUDY THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ HIGH-PERFORMING: Gmail Dot Scam (228k views, 8.9% share rate)
CONTEXT: Let's say your email is peterpan@gmail.com. Scammers bought your email from the dark web. So they go to PayPal and create a new account. But they use peter.pan@gmail.com — with a dot.
TENSION: Here's the thing — dots don't matter in Gmail. Google says so directly in their help centre. So YOU still receive every email sent to that dotted address. You're clueless. Until one day you get an email from PayPal.
PIVOT: It's official. From service.paypal.com. Asking you to confirm your email address. You're confused — but you click confirm. Then BOOM. A second email arrives. This one is fake. Because you already verified the first, you're less suspicious. They ask for your password. And they get in.
PAYOFF: Here's what to do. Go to PayPal and check if any accounts use a dotted version of your email. If yes — report it immediately. And never confirm an email you didn't request.

✅ HIGH-PERFORMING: SIM Swapping (83k views, 5.9% save rate)
CONTEXT: One day your phone randomly loses all signal. Zero bars. You think it's just a bad area. But if the signal never comes back — scammers may have already stolen your SIM.
TENSION: You can't make calls. You can't load Instagram. But the real problem is your phone number. It's connected to your 2-Factor Authentication on every account. Your bank sends security codes by text to log in. If scammers have your SIM — they get those codes. They can reset every password you own in minutes. While you sit there wondering why your signal is dead.
PIVOT: Here's the thing — it's not a high-tech hack. The scammer just calls your mobile provider. They pretend to be you. They use your name, address, and the last four digits of your Social Security Number. All bought on the dark web for less than a coffee. They say: "I lost my phone, I need a new SIM immediately." The customer service agent just wants to help.
PAYOFF: Call your mobile provider today. Set a Transfer Pin or Port-Out Lock. This requires a secret password before any SIM changes — even if they have all your details. Then stop using your phone number for Multi-Factor Authentication. Switch to an Authenticator App like Google or Microsoft. If scammers steal your SIM now — they get nothing.

❌ LOW-PERFORMING: Marketplace Refund Scam (2k views, 63.9% skip rate)
WHY IT FAILED:
- Hook was 30+ words (maximum is 15)
- THREE tension sections instead of ONE — structure collapsed
- Preachy language: "If you're a good person" — never moralize
- Uncertain pivot language: "most likely FAKE" — either it is or it isn't
- FOUR payoff steps — maximum is 3
- 271 words — nearly double the maximum
NEVER repeat these patterns.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HARD RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Use the research report provided — never invent facts
2. ONE tension section only — never two or three
3. Max 3 payoff tips — each exactly 2 sentences
4. No tech jargon — plain everyday English only
5. No uncertain language in the Pivot
6. No preachy or condescending language
7. Core word count: 150–170 words`;

// ─── Stage 2 System Prompt — Hook Writer ─────────────────────────────────────

const HOOK_SYSTEM_PROMPT = `You are Scripty 🎬, Transcript Writer at oh HACK no! — a media company that protects parents and grandparents from online scams.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 2: WRITE THE HOOKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Core has been written. Now write the hooks.

THE 3 C'S — every hook must have all three:
- CLARITY: viewer instantly knows what this is about
- CONTEXT: viewer knows who/what is involved
- CURIOSITY: viewer MUST keep watching to find out more

HOOK RULES:
- 10–15 words maximum (3–5 seconds spoken aloud)
- Never start with a greeting ("Hey guys", "Welcome back")
- Never ask a yes/no question
- Relevant to ANYONE who uses the internet
- Must be 100% deliverable by the Core

25 HOOK FORMULAS (adapt — never copy verbatim):
1. "Scammers have found a way to [shocking action] using your [familiar thing]."
2. "There is a scam targeting [specific group] right now. Here is what to know."
3. "If you use [common app/service], you need to see this."
4. "Everything you thought you knew about [common safety belief] is wrong."
5. "Most people do not know this scam exists. Here is how it works."
6. "You will look at [familiar thing] differently after the next 30 seconds."
7. "Why is nobody talking about [scam type]?"
8. "Warning: if you ever [common action], watch this first."
9. "Before you [common digital action] again — watch this."
10. "Stop doing this. It is giving scammers exactly what they need."
11. "Do not make this mistake when [common action]."
12. "If you have [common account/app], listen up."
13. "Here are the red flags that [scam scenario] is happening to you."
14. "How would you know if [scam scenario] was happening to you right now?"
15. "Can you spot what is wrong with this [email/text/call]?"
16. "If we asked you which of these is safer — what would you say?"
17. "What would you do if [scary but realistic scenario]?"
18. "I bet you did not know [shocking scam fact] about [familiar thing]."
19. "Your mum just got a text from her bank. Here is what to do."
20. "This happened to someone's parent last week. It can happen to yours."
21. "Imagine losing access to your [account] in under 60 seconds."
22. "This video is for anyone who uses [common app]. Keep scrolling if that is not you."
23. "Scammers have a way to use your own [familiar thing] to [scary outcome]. Here is how."
24. "Scammers are claiming [believable lie] to gain control of your [account]. Here is how."
25. "If one day your [normal thing] suddenly [stops working] — scammers may have already [bad outcome]."

BEST-PERFORMING OHN HOOKS (study these):
- "Scammers have a way to use your own Gmail address to open fake accounts — just by adding a dot. Here's how." (228k views)
- "If we asked you which option is safer to receive a security code — what would you say?" (83k views)
- "Scammers are claiming they have photos of you to gain control of your WhatsApp account. Here's how." (252k views)

PRE-HOOK NOTE:
Always include this note in preHookNote:
"If an authentic, unscripted reaction moment was captured during filming — place it here before the spoken hook begins. Even 1 second of genuine human reaction can dramatically increase 3-second retention."

CAPTION HOOK: 1 sentence, under 15 words, hints at payoff, sparks curiosity.`;

// ─── Stage 1: Write Core ──────────────────────────────────────────────────────

async function writeCore(
  topic: string,
  researchReport: string | undefined,
  invokeLLM: ScriptyDeps["invokeLLM"],
  log?: RequestLogger,
): Promise<ScriptyCore> {
  log?.info("scripty", `Stage 1: writing core for "${topic}"`);

  const researchSection = researchReport
    ? `\nGOOGLY RESEARCH REPORT:\n${researchReport.slice(0, 3000)}`
    : "\n(No research report provided — write from your knowledge of this scam type.)";

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [
      { role: "system", content: CORE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `SCAM TOPIC: ${topic}${researchSection}

Write the Stage 1 Core now. Output ONLY valid JSON — no extra text.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scripty_core",
        strict: true,
        schema: {
          type: "object",
          properties: {
            topic:     { type: "string" },
            context:   { type: "string" },
            tension:   { type: "string" },
            pivot:     { type: "string" },
            payoff:    { type: "string" },
            wordCount: { type: "number" },
          },
          required: ["topic", "context", "tension", "pivot", "payoff", "wordCount"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as ScriptyCore;
  log?.info("scripty", `Core written — ${parsed.wordCount} words`);
  return parsed;
}

// ─── Stage 2: Write Hooks ─────────────────────────────────────────────────────

interface HookOutput {
  hookOptions: string[];
  selectedHook: string;
  preHookNote: string;
  captionHook: string;
}

async function writeHooks(
  topic: string,
  core: ScriptyCore,
  invokeLLM: ScriptyDeps["invokeLLM"],
  log?: RequestLogger,
): Promise<HookOutput> {
  log?.info("scripty", `Stage 2: writing hooks for "${topic}"`);

  const coreText = `CONTEXT: ${core.context}\n\nTENSION: ${core.tension}\n\nPIVOT: ${core.pivot}\n\nPAYOFF: ${core.payoff}`;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [
      { role: "system", content: HOOK_SYSTEM_PROMPT },
      {
        role: "user",
        content: `SCAM TOPIC: ${topic}

APPROVED CORE:
${coreText}

Write 3 hook options. Select the strongest one. Write the caption hook and preHookNote.
Output ONLY valid JSON — no extra text.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scripty_hooks",
        strict: true,
        schema: {
          type: "object",
          properties: {
            hookOptions:  { type: "array", items: { type: "string" } },
            selectedHook: { type: "string" },
            preHookNote:  { type: "string" },
            captionHook:  { type: "string" },
          },
          required: ["hookOptions", "selectedHook", "preHookNote", "captionHook"],
          additionalProperties: false,
        },
      },
    },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as HookOutput;
  log?.info("scripty", `Hooks written — selected: "${parsed.selectedHook?.slice(0, 60)}…"`);
  return parsed;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function runScripty(
  input: ScriptyInput,
  deps: ScriptyDeps,
): Promise<ScriptyResult> {
  const { topic, researchReport } = input;
  const { invokeLLM, logger: log, onProgress } = deps;

  // ── Stage 1: Core ────────────────────────────────────────────────────────
  onProgress?.({ step: "writing_core", message: `Writing script core for "${topic}"…` });

  const core = await writeCore(topic, researchReport, invokeLLM, log);

  onProgress?.({
    step: "core_complete",
    message: `Core written — ${core.wordCount} words. Now writing hooks…`,
    data: { wordCount: core.wordCount, context: core.context, tension: core.tension, pivot: core.pivot, payoff: core.payoff },
  });

  // ── Stage 2: Hooks ───────────────────────────────────────────────────────
  onProgress?.({ step: "writing_hooks", message: "Writing 3 hook options…" });

  const hooks = await writeHooks(topic, core, invokeLLM, log);

  // ── Assemble full result ─────────────────────────────────────────────────
  const fullScript = [
    hooks.selectedHook,
    core.context,
    core.tension,
    core.pivot,
    core.payoff,
  ].join("\n\n");

  onProgress?.({ step: "done", message: "Script complete." });

  return {
    ...core,
    topic,
    hookOptions:  hooks.hookOptions,
    selectedHook: hooks.selectedHook,
    preHookNote:  hooks.preHookNote,
    captionHook:  hooks.captionHook,
    fullScript,
  };
}
