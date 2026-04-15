---
kb_id: performance-benchmarks
name: OHN Instagram Performance Benchmarks
version: 1.0
used_by: instistati, statsy, content-strategist
owner: Content Team
last_updated: 2026-04-15
metrics: 5
---

## What This KB Is For

This KB defines the performance thresholds (🔴 / 🟡 / 🟢 / ⭐) for all 5 OHN Instagram organic metrics. Every metric reported by InstiStati must be labelled with its benchmark status. No number is reported without context.

## Why the Agent Needs This

Raw numbers without benchmarks are meaningless. A 42% watch time rate could be excellent or terrible depending on context. OHN's benchmarks are calibrated to the specific content type (scam-awareness short-form video) and business goal (sharing, not just views). Standard social media benchmarks do not apply — OHN's share rate targets are significantly higher because sharing is the core distribution mechanism.

> **If ignored:** Numbers are reported without context. Content Strategist cannot prioritise action. A 3% share rate might be celebrated when it is actually below OHN's floor. Decisions get made on gut feel instead of data.

---

## Benchmark Tables

---

### Metric 1 — 3-Second Retention Rate
**What it measures:** The percentage of viewers who watched at least 3 seconds (past the hook).
**Why it matters:** This is the hook signal. A failing hook means the content never gets seen — the algorithm penalises videos that lose viewers before the 3-second mark.

| Status | Range | What It Means | Action |
|---|---|---|---|
| 🔴 Below | Under 50% | Hook failed — most viewers scrolled before it finished | Rewrite hook for this topic type. Flag to Scripty. |
| 🟡 Acceptable | 50–64% | Hook had some pull but lost a significant portion | Hook needs improvement. Review formula used. |
| 🟢 Strong | 65–74% | Hook worked — most viewers gave the content a chance | Good. Monitor for consistency. |
| ⭐ Exceptional | 75%+ | Hook was exceptional — very few scrolled away | Study this hook. Add to benchmark library. |

**OHN Reference Points:**
- WhatsApp Phishing: 77% ⭐ (best hook in OHN library)
- Gmail Dot Scam: 75% ⭐ (pre-hook visual contributed)
- SIM Swapping: 71% 🟢
- Marketplace Refund: 41% 🔴 (hook too long, too vague, excluded audience)

---

### Metric 2 — Average Watch Time %
**What it measures:** The average percentage of the video watched across all views.
**Why it matters:** Watch time % determines how much of OHN's content is actually being consumed. It also signals to the algorithm that the content is worth distributing further. A high hook retention with low watch time means the body lost viewers (WhatsApp Phishing pattern).

| Status | Range | What It Means | Action |
|---|---|---|---|
| 🔴 Below | Under 30% | Content not holding attention after the hook | Investigate drop-off point. Script body likely too complex or energy drops. |
| 🟡 Acceptable | 30–49% | Some retention but significant drop-off | Content has issues in the middle sections. Tension or Pivot likely lost urgency. |
| 🟢 Strong | 50–69% | Good retention throughout | Script paced well. Content delivering on the hook's promise. |
| ⭐ Exceptional | 70%+ | Outstanding — viewers watching most of the video | Study the structure. This content is performing at the top of the benchmark. |

**OHN Reference Points:**
- SIM Swapping: 42.7% 🟡
- Gmail Dot Scam: 42% 🟡
- WhatsApp Phishing: 30.4% 🔴 (hook/body gap — hook created high expectations, body didn't sustain)
- Marketplace Refund: 14.1% 🔴

**The Hook/Body Gap Warning:**
> If 3-second retention is ⭐ Exceptional but watch time is 🔴 Below — the hook is working but the body is failing. This is the WhatsApp pattern. The hook set a promise the script did not keep. Flag to Content Strategist for Scripty feedback.

---

### Metric 3 — Share Rate
**Formula:** Shares ÷ Views × 100
**What it measures:** The percentage of viewers who shared the video.
**Why it matters for OHN specifically:** Sharing is OHN's primary distribution mechanism. Unlike most social media content where likes drive the algorithm, OHN's mission is explicitly to get content shared to family members. A 1% share rate means 1 in 100 viewers shared — meaning the content reached ~200 people per 100 views. This is why OHN's share rate benchmarks are set higher than standard social media.

| Status | Range | What It Means | Action |
|---|---|---|---|
| 🔴 Below | Under 1% | Content not being shared — critical for OHN | Urgently review script CTA and scam relevance. |
| 🟡 Acceptable | 1–3.9% | Some sharing activity | Review CTA strength. Is the sharing framing compelling? |
| 🟢 Strong | 4–7.9% | Good viral signal | Content resonating. Study what drove shares. |
| ⭐ Exceptional | 8%+ | Highly shareable content | Best-in-class for OHN. Analyse mechanism and hook for replication. |

**OHN Reference Points:**
- Gmail Dot Scam: 8.9% ⭐ (counterintuitive mechanism + universal audience)
- WhatsApp Phishing: 4.2% 🟢 (trusted contact mechanism inherently shareable)
- SIM Swapping: 3.6% 🟡
- Marketplace Refund: 0.4% 🔴

---

### Metric 4 — Save Rate
**Formula:** Saves ÷ Views × 100
**What it measures:** The percentage of viewers who saved the video.
**Why it matters:** Saves signal that the viewer found the content valuable enough to return to. High save rate = high perceived value. For OHN, saves often mean the viewer wants to share later or act on the Payoff steps after watching.

| Status | Range | What It Means | Action |
|---|---|---|---|
| 🔴 Below | Under 1% | Low perceived value — viewers not saving for later | Payoff likely too vague. Review actionability of tips. |
| 🟡 Acceptable | 1–2.9% | Some value signal | Payoff delivering some value. Room for improvement. |
| 🟢 Strong | 3–4.9% | High perceived value | Payoff tips resonating. Viewers saving to act on. |
| ⭐ Exceptional | 5%+ | Viewers saving for later action | Best-in-class Payoff. Specific, exclusive-feeling tips. |

**OHN Reference Points:**
- SIM Swapping: 5.9% ⭐ (Transfer Pin / Port-Out Lock — exclusive-feeling insider tips)
- Gmail Dot Scam: 3.4% 🟢
- WhatsApp Phishing: 1.3% 🟡
- Marketplace Refund: 0.26% 🔴

**High Save Rate Signal:**
> A 🟢 or ⭐ save rate combined with 🟡 or 🔴 share rate = content with perceived value but low urgency to warn others. Review the CTA framing — is it compelling people to share or just to save for themselves?

---

### Metric 5 — Overall Engagement Rate
**Formula:** (Likes + Comments + Shares + Saves) ÷ Views × 100
**What it measures:** Total interaction across all action types as a percentage of views.
**Why it matters:** Engagement rate is the algorithm's primary signal for continued distribution. High engagement means the platform pushes the content to more non-followers.

| Status | Range | What It Means | Action |
|---|---|---|---|
| 🔴 Below | Under 2% | Low engagement | Review all metrics. Likely multiple underperforming areas. |
| 🟡 Acceptable | 2–4.9% | Average engagement | Content working but not exceptional. |
| 🟢 Strong | 5–7.9% | Strong engagement — at the viral threshold for this niche | Content hitting well. Study and replicate. |
| ⭐ Exceptional | 8%+ | Exceptional engagement across all interaction types | Best-in-class. Full analysis recommended. |

---

## Report Format — How InstiStati Reports Metrics

Every metric in every report must follow this format:

```
[METRIC NAME]: [VALUE] [STATUS EMOJI]
→ Benchmark: [threshold label] ([range])
→ Interpretation: [one sentence in plain language]
```

**Example:**
```
3-SECOND RETENTION: 75% ⭐
→ Benchmark: Exceptional (75%+)
→ Interpretation: The hook worked exceptionally — very few viewers scrolled before it finished.

SHARE RATE: 4.2% 🟢
→ Benchmark: Strong (4–7.9%)
→ Interpretation: Good viral signal — content is being shared to family and contacts.
```

---

## Missing Data Protocol

If a metric is unavailable for a video:

```
[METRIC NAME]: NOT AVAILABLE
→ Reason: [exactly why — e.g. "Instagram API did not return this value for videos older than 30 days"]
→ Status: Cannot be benchmarked
```

Never skip a missing metric silently. Every gap must be named and explained.

---

## Data Freshness Protocol

Every report must open with:

```
DATA LAST UPDATED: [timestamp of most recent pull]
```

If the last pull was more than 24 hours ago, add:

```
⚠️ DATA WARNING: Last update was [X] hours ago. Numbers may not reflect recent activity.
```

