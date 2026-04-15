---
kb_id: googly-report-template
name: Googly Research Report — 7-Section Template
version: 1.0
used_by: googly, scripty, content-strategist
owner: Content Team
last_updated: 2026-04-15
sections: 7
---

## What This KB Is For

This KB defines the exact 7-section structure for every Googly research report. It specifies what goes in each section, why each section exists, and how Scripty maps each section to the script structure.

## Why the Agent Needs This

Without a consistent report format, the handoff from Googly to Scripty breaks down. Scripty needs specific types of information in specific places to write each part of the script. If Googly's research is presented as a general summary, Scripty cannot reliably map research to structure.

> **If ignored:** Scripty writes the Pivot from the wrong section. The Payoff is missing reporting information. The Context section is vague. Inconsistent handoffs produce inconsistent scripts.

---

## The Scripty Mapping

This is why the report format exists. Each section in the Googly report feeds a specific part of the script:

| Report Section | Maps To Script Part | What Scripty Extracts |
|---|---|---|
| Section 1 — What is the scam? | Context | The normal situation before the scam hits |
| Section 2 — How do scammers do it? | Pivot | The mechanism reveal — the "aha" moment |
| Section 3 — How to spot it? | Pivot (red flags) | Warning signs viewers can recognise |
| Section 4 — How to behave when targeted? | Payoff | The 2–3 action steps |
| Section 5 — How to report it? | Payoff (reporting tip) | Where to report — official channels only |
| Section 6 — Unverified items | Do not use without approval | Scripty must NOT use ⚠️-flagged findings |
| Section 7 — Jargon flags | All sections | Scripty must simplify every 📝-flagged term |

---

## Report Template

Every Googly report must follow this exact structure.

---

```
GOOGLY RESEARCH REPORT
======================
Scam Topic: [Topic name]
Date: [YYYY-MM-DD]
Research File: googly_research_[scam_topic]_[date].md (saved to .manus/db/)
Total Sources Used: [Number]
Tier 1 Sources: [Number]
Tier 2 Sources: [Number]

---

SECTION 1 — WHAT IS THE SCAM?
[2–3 sentence summary in plain language. No jargon. Write for a 65-year-old
with no technical background.]

Key findings:
- [Specific finding with plain language explanation]
- [Specific finding with plain language explanation]
- [Specific finding with plain language explanation]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

---

SECTION 2 — HOW DO SCAMMERS DO IT?
[2–3 sentence summary of the exact mechanism — the step-by-step trick.]

Key findings:
- [Step 1 of the scam mechanism]
- [Step 2 of the scam mechanism]
- [Step 3 of the scam mechanism]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

---

SECTION 3 — HOW TO SPOT IT?
[2–3 sentence summary of the red flags a victim would notice.]

Key findings:
- [Red flag 1 — specific and observable]
- [Red flag 2 — specific and observable]
- [Red flag 3 — specific and observable]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

---

SECTION 4 — HOW TO BEHAVE WHEN TARGETED?
[2–3 sentence summary of immediate action steps.]

Key findings:
- [Action step 1 — specific app/setting/phone call]
- [Action step 2 — specific app/setting/phone call]
- [Action step 3 — specific app/setting/phone call]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

---

SECTION 5 — HOW TO REPORT IT?
[2–3 sentence summary of the official reporting channels.]

Key findings:
- [Reporting channel 1 — name, URL or phone number]
- [Reporting channel 2 — name, URL or phone number]
- [Reporting channel 3 — name, URL or phone number]

Sources:
- [Source Name] — [Full URL]
- [Source Name] — [Full URL]

---

SECTION 6 — UNVERIFIED / FLAGGED ITEMS ⚠️
[List every finding that could not be verified with a Tier 1 or Tier 2 source.]

Format per item:
⚠️ UNVERIFIED: [The specific finding]
Source attempted: [URL or source name that was found but rejected]
Why rejected: [Specific reason — e.g. "personal blog, no editorial oversight"]
Status: Do NOT use in script without Content Strategist approval

If no unverified items: "No unverified items in this report."

---

SECTION 7 — PLAIN LANGUAGE FLAGS 📝
[List every technical term or jargon phrase that needs simplification before
reaching the target audience.]

Format per item:
📝 JARGON: "[Original technical term as it appeared in the source]"
Plain language: "[Simplified version — as you would explain it to a grandparent]"

If no jargon flags: "No jargon flags in this report."
```

---

## Section-by-Section Guidance

### Section 1 — What is the scam?
The goal is to give Scripty a plain-language overview of the scam that can feed the Context section of the script. Focus on the victim's perspective, not the technical mechanism.

**Good Section 1:**
> "The Gmail Dot Scam exploits a quirk in how Google handles email addresses. Gmail ignores dots in email addresses, so peterpan@gmail.com and peter.pan@gmail.com receive the same emails. Scammers use dotted versions of real email addresses to create fake accounts on services like PayPal — and the real account holder receives all the confirmation emails."

**Weak Section 1:**
> "This scam involves the exploitation of email address parsing in Gmail via a dot alias vulnerability that allows fraudulent account creation on third-party platforms."
> ❌ Jargon-heavy. Scripty cannot use this directly. Must be flagged in Section 7.

---

### Section 2 — How do scammers do it?
This feeds the Pivot. The mechanism must be specific enough that Scripty can write a step-by-step walkthrough. Vague descriptions produce vague Pivots.

**Good Section 2:**
- "Scammer buys the victim's real email address from the dark web."
- "Creates a PayPal account using a dotted version of the email (peter.pan@gmail.com)."
- "The victim receives all PayPal confirmation emails because dots are ignored by Gmail."
- "Victim clicks 'Confirm' on what appears to be a PayPal email — unknowingly activating the scammer's account."

**Weak Section 2:**
> "The scammer creates a fraudulent account using a variation of the victim's email address."
> ❌ Too vague. Scripty cannot write a specific mechanism reveal from this.

---

### Section 3 — How to spot it?
Red flags must be specific and observable — something a real person would notice in the moment.

**Good red flags:**
- "Receiving a PayPal confirmation email for an account you didn't create"
- "Email address in the confirmation shows a dotted version of your own email"
- "Confirmation request arrives without you initiating any PayPal action"

**Weak red flags:**
- "Suspicious emails from payment platforms" ❌ — not specific enough
- "Unusual account activity" ❌ — too vague, not observable in the moment

---

### Section 4 — How to behave when targeted?
This feeds the Payoff. Action steps must be so specific that Scripty can write exact app/setting/button instructions. Vague advice produces vague Payoff steps.

**Good action steps:**
- "Go to PayPal.com → Log in → Settings → Account → Check for alternate email addresses linked to the account"
- "Click 'Report' on any PayPal email you did not request"
- "Never confirm a service email you did not initiate — contact the service directly by navigating to their website manually"

**Weak action steps:**
- "Report the scam to your payment provider" ❌ — which provider? How?
- "Be careful about confirming emails" ❌ — not actionable

---

### Section 5 — How to report it?
Must include official reporting channels with URLs or phone numbers. Country-specific where possible.

**Good reporting entries:**
- "Report to Action Fraud (UK): actionfraud.police.uk / 0300 123 2040"
- "Report to FTC (USA): reportfraud.ftc.gov"
- "Report PayPal phishing emails: phishing@paypal.com"

**Weak reporting entries:**
- "Report to authorities" ❌ — which authorities? How?
- "Contact your local police" ❌ — not specific enough for a Payoff tip

---

### Section 6 — Unverified Items ⚠️
This is a safety net. If Googly found compelling information on a forum, a news site, or a personal blog — it goes here, not in Sections 1–5. Scripty must not use unverified findings.

> The ⚠️ flag is not a failure. A report that flags 2 unverified items is more trustworthy than one that silently includes them.

---

### Section 7 — Jargon Flags 📝
Flag any technical term a 65-year-old with no technical background would not immediately understand. Scripty must not pass jargon into the script.

**Terms that always require flagging:**
- "Phishing", "smishing", "vishing" — use "fake email", "fake text", "fake phone call"
- "2FA" / "multi-factor authentication" — use "two-step login" or "security code"
- "SIM swap" / "port-out" — explain what this means in plain terms
- "Credential harvesting" — use "stealing your password"
- "Social engineering" — use "psychological tricks to gain trust"
- "Dark web" — acceptable for OHN audience (widely understood) but note it

---

## Completion Checklist

Before submitting the report to Content Strategist, verify:

- [ ] All 5 topic areas covered with 2+ verified sources each
- [ ] Total source count is 10+
- [ ] At least 1 Tier 1 source in the report
- [ ] Research file saved to `.manus/db/googly_research_[topic]_[date].md`
- [ ] Every unverified finding in Section 6 with full explanation
- [ ] Every jargon term in Section 7 with plain language equivalent
- [ ] Every source has a full URL (no partial URLs, no paywalled links)
- [ ] All findings are in plain language — no unexplained technical terms in Sections 1–5

> If any checkbox is unchecked — do NOT submit. Escalate the gap to Content Strategist with full details.

