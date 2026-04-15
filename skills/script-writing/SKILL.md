---
name: writing-scripts
version: 1.0
used_by: [scripty]
inputs: [kbBasePath]
outputs: [KnowledgeBaseContent, append success/failure]
---

## What This Skill Does

Provides two functions: (1) read the live Scripty knowledge base file from disk and return its content for injection into the Scripty system prompt, and (2) append a new approved transcript back into the knowledge base — closing the learning loop.

## Why It Exists

Scripty needs to read real approved transcripts before writing. The more approved transcripts exist in the KB, the better Scripty's output quality. Without a persistent, writable KB, Scripty writes from static rules alone and never improves from past performance data.

## Architecture Fix (vs Original)

**Original flaw:** Hardcoded path `.manus/db/ohn_scripty_knowledge_base.md` — not portable, not multi-tenant.

**This version:** KB base path is injected at runtime via `kbBasePath`. Different tenants can have different KB locations. Falls back to the default `.manus/db/` path if not specified.

## How It Works

### Reading
`readScriptyKb(config?)` reads the full KB file and returns its content as a string. If the file doesn't exist, returns a message saying so — Scripty falls back to its static built-in knowledge.

### Appending
`appendTranscript(entry, config?)` inserts a new approved transcript into Section 2 of the KB file (before the Section 3 marker). The transcript becomes a reference example for future writing sessions.

## Inputs

```ts
interface ScriptWritingConfig {
  kbBasePath?: string; // default: process.cwd() + "/.manus/db/"
}

interface NewTranscriptEntry {
  topic: string;
  dateAdded: string;       // ISO date "YYYY-MM-DD"
  hook: string;
  context: string;
  tension: string;
  pivot: string;
  payoff: string;
  captionHook?: string;
  wordCount: number;
  hookFormula?: string;
  csNotes?: string;
  performanceData?: {
    views?: number;
    averageWatchTimePercent?: number;
    threeSecondRetention?: number;
    skipRate?: number;
    shareRate?: string;
    saveRate?: string;
  };
}
```

## Outputs

`readScriptyKb()` → `string` (KB content or fallback message)
`appendTranscript()` → `boolean` (true = success, false = failed)

## Failure Modes

| Failure | Behaviour |
|---|---|
| KB file not found | readScriptyKb returns fallback message — Scripty uses static knowledge |
| Section 3 marker not found | append fails (returns false) — KB file may need repair |
| File write fails | append returns false, logs error |

## Constraints

- Only appends to Section 2 — never modifies other sections
- Never deletes or overwrites existing entries
- KB file must contain `## SECTION 3 — LOW-PERFORMING TRANSCRIPT` marker as insertion anchor
