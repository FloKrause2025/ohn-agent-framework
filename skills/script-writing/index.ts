/**
 * script-writing/index.ts
 *
 * Manages the live Scripty knowledge base — reading it for system prompt injection
 * and appending approved transcripts to close the learning loop.
 *
 * CHANGES FROM ORIGINAL (server/skills/script-writing/scripts/scriptyKnowledgeBase.ts):
 * - ARCHITECTURE FIX: KB base path is now injected via ScriptWritingConfig instead
 *   of being hardcoded to `.manus/db/ohn_scripty_knowledge_base.md`.
 * - Multi-tenant ready: different tenants can have different KB paths.
 * - Function names updated to be more descriptive (readScriptyKb, appendTranscript).
 * - Original exports retained as aliases for backward compatibility.
 * - All insertion logic unchanged.
 *
 * ORIGINAL: server/skills/script-writing/scripts/scriptyKnowledgeBase.ts (working — do not modify)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ScriptWritingConfig {
  /** Base directory where KB files live. Defaults to process.cwd() + "/.manus/db/" */
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getKbPath(config?: ScriptWritingConfig): string {
  const base = config?.kbBasePath ?? join(process.cwd(), ".manus", "db");
  return join(base, "ohn_scripty_knowledge_base.md");
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read the full Scripty knowledge base and return its content for LLM injection.
 * Returns a fallback message if the file doesn't exist — Scripty uses static knowledge.
 */
export function readScriptyKb(config?: ScriptWritingConfig): string {
  const kbPath = getKbPath(config);
  if (!existsSync(kbPath)) {
    return `[Knowledge base file not found at ${kbPath}. Proceeding with built-in knowledge only.]`;
  }
  try {
    return readFileSync(kbPath, "utf-8");
  } catch (err) {
    return `[Failed to read knowledge base: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ─── Append ───────────────────────────────────────────────────────────────────

/**
 * Append an approved transcript to Section 2 of the Scripty KB.
 * The transcript becomes a reference example for future writing sessions.
 * Returns true on success, false on failure.
 */
export function appendTranscript(
  entry: NewTranscriptEntry,
  config?: ScriptWritingConfig
): boolean {
  const kbPath = getKbPath(config);

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

// ─── Backward-compatible aliases (matches original function names) ─────────────

/** @deprecated Use readScriptyKb() */
export const readScriptyKnowledgeBase = (config?: ScriptWritingConfig) => readScriptyKb(config);

/** @deprecated Use appendTranscript() */
export const appendTranscriptToKnowledgeBase = (entry: NewTranscriptEntry, config?: ScriptWritingConfig) =>
  appendTranscript(entry, config);
