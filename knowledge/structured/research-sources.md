---
kb_id: research-sources
name: Trusted Research Sources — Tier Classification
version: 1.0
used_by: googly
owner: Content Team
last_updated: 2026-04-15
minimum_sources_per_report: 10
minimum_per_topic_area: 2
---

## What This KB Is For

This KB defines which sources Googly is authorised to cite, which to reject, and the minimum source requirements for a complete research report. Every finding in a Googly report must have a full source URL from an approved tier.

## Why the Agent Needs This

Without a source classification system, research quality becomes unpredictable — Googly might cite a Reddit forum post, a personal blog, or an unverified social media thread as evidence. Scripty then writes content based on unverified claims. That creates videos with factual errors that damage OHN's credibility.

> **If ignored:** Scripts contain unverified claims. One wrong statistic or incorrect scam description in a widely-shared video is a credibility crisis. Source quality is non-negotiable.

---

## Source Tier System

### Tier 1 — Government and Law Enforcement (Always Prioritise)

These are the highest-authority sources. Cite Tier 1 first. If a Tier 1 source covers a topic area — it takes precedence over any Tier 2 source on the same area.

| Source | Country | What It Covers |
|---|---|---|
| CISA (Cybersecurity and Infrastructure Security Agency) | USA | Cyber threats, phishing alerts, critical infrastructure |
| FBI / IC3 (Internet Crime Complaint Center) | USA | Cybercrime statistics, fraud reports, scam warnings |
| FTC (Federal Trade Commission) | USA | Consumer fraud, phishing, impersonation, romance scams |
| IRS | USA | Tax-related phishing, identity theft |
| USA.gov | USA | Government impersonation scams |
| NCSC (National Cyber Security Centre) | UK | Cyber threats, phishing guidance, technical advisories |
| Action Fraud | UK | UK fraud reporting, victim statistics |
| HMRC | UK | Tax scam warnings |
| ACSC (Australian Cyber Security Centre) | Australia | Cyber threats, scam warnings |
| Scamwatch | Australia | Consumer scam database, victim statistics |
| Canada.ca / RCMP | Canada | Fraud warnings, consumer scam advisories |

> **How to use:** Always attempt Tier 1 sources first via the `researching-web` skill. A report with strong Tier 1 coverage has significantly more authority than one based entirely on Tier 2.

---

### Tier 2 — Trusted Cybersecurity and Consumer Publishers

These are authoritative industry sources. Use when Tier 1 coverage is thin or when the topic requires more technical depth.

| Source | What It Covers |
|---|---|
| Norton (NortonLifeLock) | Consumer cybersecurity, scam explainers, how-to guides |
| Kaspersky | Technical threat analysis, phishing breakdowns |
| Malwarebytes | Malware analysis, technical scam mechanisms |
| Sophos | Threat intelligence, enterprise and consumer security |
| Proofpoint | Email phishing, social engineering, business fraud |
| Mimecast | Email security, phishing statistics |
| AARP | Scams targeting older adults, consumer protection |
| Consumer Reports | Consumer protection, product and service fraud |
| Which? (UK) | UK consumer protection, financial fraud |

---

### Tier 3 — Conditional Use Only ⚠️

Use these sources only if Tier 1 and Tier 2 coverage is insufficient for a specific topic area. Must be flagged in Section 6 (Unverified/Flagged Items) of the report.

| Source Type | Condition for Use |
|---|---|
| Major news outlets (BBC, Guardian, Reuters, AP, WSJ) | Only for recent breaking scam reports not yet covered by Tier 1/2 |
| Academic research papers | Only for statistics or psychological findings, must have DOI or institutional URL |
| Bank/financial institution security pages | Major banks only (Barclays, HSBC, Chase, etc.) — for scams targeting their specific platform |

---

### REJECTED — Never Cite

These source types are automatically rejected regardless of content quality.

| Rejected Source Type | Why |
|---|---|
| Reddit posts (including r/Scams) | Unverified, anonymous, subject to misinformation |
| Personal blogs | No editorial oversight, cannot be independently verified |
| Social media posts (any platform) | Unverified, anecdotal, no accountability |
| Forums (Quora, Stack Exchange, etc.) | Community-edited, no authoritative control |
| Any source without a verifiable author or organisation | Cannot be attributed — not citable |
| Undated content (no publication date) | Cannot verify currency — scam tactics evolve rapidly |

---

## Minimum Source Requirements

Every Googly report must meet ALL of these thresholds before submission:

| Requirement | Threshold |
|---|---|
| Total verified sources | 10+ across the full report |
| Per topic area | 2+ verified sources for EACH of the 5 topic areas |
| Tier 1 coverage | At least 1 Tier 1 source in the report |
| Source diversity | No more than 4 sources from the same domain |

> **If any topic area has fewer than 2 verified sources:** Do NOT submit the report. Escalate immediately to Content Strategist with the gap details (which area, which queries were tried, which sources were found but rejected and why).

---

## The 5 Topic Areas (What Every Report Must Cover)

| # | Topic Area | What to Find | Scripty Uses This For |
|---|---|---|---|
| 1 | What is the scam? | Clear definition and overview | Context — the normal situation before the scam hits |
| 2 | How do scammers do it? | Exact tactics, scripts, mechanics | Pivot — the mechanism reveal |
| 3 | How to spot it? | Red flags and warning signs | Pivot — red flag details |
| 4 | How to behave when targeted? | Practical advice on what to do | Payoff — action steps |
| 5 | How to report it? | Reporting channels and official resources | Payoff — include reporting info |

> This mapping is critical. If Topic Area 4 (how to behave) is weak, Scripty's Payoff will be weak. Source quality directly impacts script quality.

---

## Source Flags in Reports

### Unverified Items ⚠️
If a finding could not be fully verified with a Tier 1 or Tier 2 source — flag it in Section 6 of the report:

```
⚠️ UNVERIFIED: [Finding]
Source attempted: [URL or source name]
Why rejected: [Specific reason — e.g. "personal blog, no editorial oversight"]
Status: Do not use in script without Content Strategist approval
```

Scripty must NOT use flagged items without explicit Content Strategist approval.

### Jargon Flags 📝
If a finding contains technical or jargon-heavy language — flag it in Section 7:

```
📝 JARGON: "[Original technical term]"
Plain language equivalent: "[Simplified version for parents/grandparents]"
```

Scripty must simplify every flagged term. The target audience has no technical background.

---

## Search Query Strategy

Before running the `researching-web` skill, generate queries that cover all 5 topic areas. Think like a real person searching — not a researcher.

**Example queries for "PayPal Refund Scam":**
- "PayPal refund scam explained"
- "How does the PayPal refund scam work?"
- "How to spot a PayPal refund scam"
- "What to do if you receive a PayPal refund scam call"
- "How to report a PayPal refund scam UK / US"

Generate at least one query per topic area. Run them all before concluding the search is complete.

