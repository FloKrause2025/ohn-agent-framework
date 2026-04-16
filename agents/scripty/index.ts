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
import { buildCoreSystemPrompt, buildHookSystemPrompt } from "../../skills/script-writing/index.js";

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

// ─── System Prompts (assembled from knowledge/structured/ via skill) ──────────
// Prompts are built once at module load from the centralised KB files.
// To update Scripty's knowledge: edit the files in knowledge/structured/*.md
// The same builders are available to any future orchestrator agent.

const CORE_SYSTEM_PROMPT = buildCoreSystemPrompt();
const HOOK_SYSTEM_PROMPT = buildHookSystemPrompt();

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
