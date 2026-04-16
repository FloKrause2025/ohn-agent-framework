/**
 * skills/script-writing/index.ts
 *
 * Centralised script-writing knowledge layer.
 * Provides everything Scripty needs to write a script, and is accessible
 * to any future orchestrator agent that needs script-writing tools or knowledge.
 *
 * EXPORTS:
 *   Static KB readers  — readScriptStructure, readToneAndVoice, readHookFormulas, readBenchmarkTranscripts
 *   Prompt builders    — buildCoreSystemPrompt, buildHookSystemPrompt
 *   Dynamic KB         — readScriptyKb (live learning-loop KB)
 *   Learning loop      — appendTranscript
 *
 * ARCHITECTURE:
 *   Static knowledge lives in knowledge/structured/*.md — versioned in git,
 *   read at runtime, injected into LLM prompts. One change to a markdown file
 *   updates every agent that uses it.
 *
 *   Dynamic knowledge lives in .manus/db/ohn_scripty_knowledge_base.md —
 *   appended each time an approved transcript is added (learning loop).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

// knowledge/structured/ is two levels up from skills/script-writing/
const KNOWLEDGE_DIR = join(__dir, "..", "..", "knowledge", "structured");

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ScriptWritingConfig {
  /** Base directory where dynamic KB files live. Defaults to process.cwd() + "/.manus/db/" */
  kbBasePath?: string;
}

export interface NewTranscriptEntry {
  topic: string;
  dateAdded: string;
  performanceData?: {
    views?: number;
    averageWatchTimePercent?: number;
    threeSecondRetention?: number;
    skipRate?: number;
    shareRate?: string;
    saveRate?: string;
  };
  hook: string;
  context: string;
  tension: string;
  pivot: string;
  payoff: string;
  captionHook?: string;
  wordCount: number;
  hookFormula?: string;
  csNotes?: string;
}

// ─── Static Knowledge File Readers ───────────────────────────────────────────
// Each reader returns the full content of one knowledge/structured/*.md file.
// These are the single source of truth for all script-writing knowledge.
// Importable by Scripty or any future orchestrator agent.

function readKbFile(filename: string): string {
  const filePath = join(KNOWLEDGE_DIR, filename);
  if (!existsSync(filePath)) {
    return `[Knowledge file not found: ${filename}. Expected at: ${filePath}]`;
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    return `[Failed to read ${filename}: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/** OHN Script Structure — 5-Part Framework (Curiosity Loop, rules per section, Voice Breaks, Hard Rules) */
export function readScriptStructure(): string {
  return readKbFile("script-structure.md");
}

/** OHN Tone and Voice Guide (voice identity, rhythm patterns, banned phrases, caption hook rules) */
export function readToneAndVoice(): string {
  return readKbFile("tone-and-voice.md");
}

/** Hook Writing Formula Library — 56 formulas across 7 categories */
export function readHookFormulas(): string {
  return readKbFile("hook-formulas.md");
}

/** OHN Benchmark Transcripts — 3 high-performing + 1 low-performing with full analysis */
export function readBenchmarkTranscripts(): string {
  return readKbFile("benchmark-transcripts.md");
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────
// Assemble complete LLM system prompts from the static knowledge files.
// Scripty imports these — any future orchestrator can import them too.

const SCRIPTY_PERSONA = `You are Scripty 🎬, Transcript Writer at oh HACK no! — a media company that protects parents and grandparents from online scams.

YOUR AUDIENCE: Women aged 35–44, USA/Canada/UK/Australia. NOT tech-savvy. Write for them — not cybersecurity professionals. If a non-technical 65-year-old cannot understand every sentence, rewrite it.`;

/**
 * Build the Stage 1 (Core) system prompt from knowledge base files.
 * Includes: persona · script structure rules · tone & voice guide · benchmark transcripts.
 * Stage 1 writes: Context → Tension → Pivot → Payoff.
 */
export function buildCoreSystemPrompt(): string {
  return `${SCRIPTY_PERSONA}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 1: WRITE THE CORE ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write the 4 Core sections: Context → Tension → Pivot → Payoff.
DO NOT write any hooks. Hooks are written in Stage 2.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT STRUCTURE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readScriptStructure()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE AND VOICE GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readToneAndVoice()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BENCHMARK TRANSCRIPTS — STUDY THESE BEFORE WRITING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readBenchmarkTranscripts()}`;
}

/**
 * Build the Stage 2 (Hook) system prompt from knowledge base files.
 * Includes: persona · 56 hook formulas · tone & voice guide.
 * Stage 2 writes: hookOptions · selectedHook · preHookNote · captionHook.
 */
export function buildHookSystemPrompt(): string {
  return `${SCRIPTY_PERSONA}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STAGE 2: WRITE THE HOOKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The Core has been written. Now write 3 hook options.
Select the strongest one. Write the preHookNote and captionHook.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOOK FORMULA LIBRARY (56 FORMULAS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readHookFormulas()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE AND VOICE — HOOK AND CAPTION HOOK GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${readToneAndVoice()}`;
}

// ─── Dynamic KB (Learning Loop) ───────────────────────────────────────────────
// The live KB is appended each time an approved transcript is added.
// Separate from the static knowledge files above.

function getDynamicKbPath(config?: ScriptWritingConfig): string {
  const base = config?.kbBasePath ?? join(process.cwd(), ".manus", "db");
  return join(base, "ohn_scripty_knowledge_base.md");
}

/**
 * Read the full Scripty dynamic knowledge base for LLM injection.
 * Returns a fallback message if the file doesn't exist.
 */
export function readScriptyKb(config?: ScriptWritingConfig): string {
  const kbPath = getDynamicKbPath(config);
  if (!existsSync(kbPath)) {
    return `[Knowledge base file not found at ${kbPath}. Proceeding with built-in knowledge only.]`;
  }
  try {
    return readFileSync(kbPath, "utf-8");
  } catch (err) {
    return `[Failed to read knowledge base: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * Append an approved transcript to Section 2 of the Scripty dynamic KB.
 * The transcript becomes a reference example for future writing sessions.
 * Returns true on success, false on failure.
 */
export function appendTranscript(
  entry: NewTranscriptEntry,
  config?: ScriptWritingConfig
): boolean {
  const kbPath = getDynamicKbPath(config);

  if (!existsSync(kbPath)) {
    console.error(`[script-writing] KB file not found at ${kbPath}`);
    return false;
  }

  try {
    const content = readFileSync(kbPath, "utf-8");
    const SECTION_3_MARKER = "## SECTION 3 — LOW-PERFORMING TRANSCRIPT";
    const insertionIndex = content.indexOf(SECTION_3_MARKER);

    if (insertionIndex === -1) {
      console.error("[script-writing] Could not find Section 3 marker in KB file");
      return false;
    }

    const perfData = entry.performanceData;
    const perfBlock = perfData
      ? `**PERFORMANCE DATA:**
- Views: ${perfData.views !== undefined ? perfData.views.toLocaleString() : "TBC"}
- Average Watch Time: ${perfData.averageWatchTimePercent !== undefined ? `${perfData.averageWatchTimePercent}%` : "TBC"}
- 3-Second Retention: ${perfData.threeSecondRetention !== undefined ? `${perfData.threeSecondRetention}%` : "TBC"}
- Skip Rate: ${perfData.skipRate !== undefined ? `${perfData.skipRate}%` : "TBC"}
- Share Rate: ${perfData.shareRate ?? "TBC"}
- Save Rate: ${perfData.saveRate ?? "TBC"}`
      : `**PERFORMANCE DATA:** Not yet available — transcript added ${entry.dateAdded}`;

    const newEntry = `
---

### TRANSCRIPT: ${entry.topic.toUpperCase()} *(added ${entry.dateAdded})*

${perfBlock}${entry.hookFormula ? `\n**HOOK FORMULA USED:** ${entry.hookFormula}` : ""}${entry.csNotes ? `\n**CS QC NOTES:** ${entry.csNotes}` : ""}

**RAW TRANSCRIPT:**

\`\`\`
HOOK: "${entry.hook}"

CONTEXT: ${entry.context}

TENSION: ${entry.tension}

PIVOT: ${entry.pivot}

PAYOFF: ${entry.payoff}
${entry.captionHook ? `\nCAPTION HOOK: "${entry.captionHook}"` : ""}
WORD COUNT: ${entry.wordCount}
\`\`\`

**ANNOTATION:** *(To be completed after performance data is available)*

---

`;

    writeFileSync(kbPath, content.slice(0, insertionIndex) + newEntry + content.slice(insertionIndex), "utf-8");
    console.log(`[script-writing] Appended transcript for "${entry.topic}" to KB`);
    return true;
  } catch (err) {
    console.error(`[script-writing] Failed to append transcript: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ─── Backward-compatible aliases ──────────────────────────────────────────────

/** @deprecated Use readScriptyKb() */
export const readScriptyKnowledgeBase = (config?: ScriptWritingConfig) => readScriptyKb(config);

/** @deprecated Use appendTranscript() */
export const appendTranscriptToKnowledgeBase = (entry: NewTranscriptEntry, config?: ScriptWritingConfig) =>
  appendTranscript(entry, config);
