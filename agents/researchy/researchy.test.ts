/**
 * agents/researchy/researchy.test.ts
 *
 * Manual test harness — runs Researchy against sample Reddit posts.
 * Evaluates output quality: correct shortlist, urgency, exclusions, meta.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx agents/researchy/researchy.test.ts
 *
 * What to look for in the output:
 *   ✅ 3–7 items in the shortlist (not padded, not over-filtered)
 *   ✅ All 4 SHOULD_EXCLUDE posts appear in excluded[] with a reason
 *   ✅ The SIM Swap cluster (3 posts) gets urgency: "high"
 *   ✅ The grandparent scam (50+ upvotes) gets urgency: "high"
 *   ✅ The single low-engagement post gets urgency: "low"
 *   ✅ agentNote sounds warm, excited, on-personality
 *   ✅ meta funnel numbers make sense (rawPostsReviewed → afterRelevanceFilter)
 *   ❌ Any off-category post in shortlist = system prompt bug
 *   ❌ Missing excluded posts = system prompt bug
 *   ❌ Wrong urgency = scoring criteria not understood
 */

import Anthropic from "@anthropic-ai/sdk";
import { runResearchy, type RedditPost, type LLMInvokeParams } from "./index.js";

// ─── Sample Reddit Posts ──────────────────────────────────────────────────────
// 20 posts: mix of valid, invalid, edge cases, duplicates

const SAMPLE_POSTS: RedditPost[] = [
  // ── CLUSTER 1: SIM Swap (3 posts = HIGH urgency) ──────────────────────────
  {
    title: "Got SIM swapped yesterday — lost access to my bank account and email in minutes",
    upvotes: 312,
    comments: 87,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/sim1/",
    timeAgo: "8 hours ago",
    bodyPreview: "I woke up to no signal on my phone. Within 20 minutes someone had transferred $4,200 from my bank account. My carrier said someone called in pretending to be me.",
  },
  {
    title: "SIM swap attack — T-Mobile rep transferred my number without any verification",
    upvotes: 145,
    comments: 34,
    flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/sim2/",
    timeAgo: "14 hours ago",
    bodyPreview: "My T-Mobile number was transferred to a new SIM without me authorising it. They bypassed the PIN I had set.",
  },
  {
    title: "WARNING: New SIM swapping method bypasses carrier PINs — my elderly father was targeted",
    upvotes: 89,
    comments: 22,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/sim3/",
    timeAgo: "3 hours ago",
    bodyPreview: "My 72-year-old father lost $8,500 to a SIM swap. The scammer called the carrier using his leaked personal info to pass security questions.",
  },

  // ── CLUSTER 2: Grandparent Emergency Scam (HIGH — 50+ upvotes + $1k+ loss) ──
  {
    title: "My mum got a call saying I was arrested — she nearly wired $3,000 to 'bail me out'",
    upvotes: 521,
    comments: 143,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/gp1/",
    timeAgo: "5 hours ago",
    bodyPreview: "Someone called my 67-year-old mum claiming to be a police officer. They said I'd been arrested and needed $3,000 bail. She called me first — I was fine. But she was shaking.",
  },

  // ── SINGLE: Phishing email (MEDIUM — 1 post, 28 upvotes) ─────────────────
  {
    title: "Received official-looking HMRC email saying I owe £450 in unpaid tax — is this real?",
    upvotes: 28,
    comments: 11,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/hmrc1/",
    timeAgo: "18 hours ago",
    bodyPreview: "The email has the HMRC logo, my full name, and a link to pay. The URL looked odd though.",
  },

  // ── SINGLE: WhatsApp account takeover (MEDIUM — 1 post, good engagement) ──
  {
    title: "Someone pretending to be WhatsApp support asked for my 6-digit code — I gave it and lost my account",
    upvotes: 67,
    comments: 19,
    flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/wa1/",
    timeAgo: "11 hours ago",
    bodyPreview: "They messaged me through WhatsApp itself saying they needed to verify my account. Asked for the SMS code. Now I can't log in.",
  },

  // ── SINGLE: Tech support popup (LOW — 1 post, 6 upvotes) ─────────────────
  {
    title: "Dad got a scary popup saying his computer has a virus — Microsoft phone number to call",
    upvotes: 6,
    comments: 3,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/ts1/",
    timeAgo: "31 hours ago",
    bodyPreview: "The popup froze his screen and played a loud alarm. There was a number to call. He called it and they asked him to install TeamViewer.",
  },

  // ── SINGLE: Fake parcel delivery text (MEDIUM) ────────────────────────────
  {
    title: "Got a Royal Mail text saying I have a parcel on hold — need to pay £1.99 customs fee",
    upvotes: 44,
    comments: 16,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/rm1/",
    timeAgo: "9 hours ago",
    bodyPreview: "The link goes to a fake Royal Mail page that asks for full card details. I've seen several friends get this same text.",
  },

  // ── SHOULD EXCLUDE: Discord scam (wrong category) ─────────────────────────
  {
    title: "Got scammed buying a Discord Nitro gift code from someone — they took the money and ran",
    upvotes: 34,
    comments: 8,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/discord1/",
    timeAgo: "12 hours ago",
    bodyPreview: "Was on a Discord server and someone offered to sell me 3 months of Nitro for cheap. Paid via PayPal and they blocked me.",
  },

  // ── SHOULD EXCLUDE: NFT scam (excluded category) ──────────────────────────
  {
    title: "Lost $800 in an NFT rug pull — project devs deleted everything overnight",
    upvotes: 156,
    comments: 43,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/nft1/",
    timeAgo: "4 hours ago",
    bodyPreview: "Minted into a new NFT project. Devs promised a game. Next morning the Twitter, Discord and website were all gone.",
  },

  // ── SHOULD EXCLUDE: In-person scam ────────────────────────────────────────
  {
    title: "Man knocked on my elderly neighbour's door pretending to be from the gas company — stole £200",
    upvotes: 89,
    comments: 27,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/door1/",
    timeAgo: "6 hours ago",
    bodyPreview: "He showed a fake ID badge and said he needed to check the boiler. Once inside he grabbed cash from the kitchen.",
  },

  // ── SHOULD EXCLUDE: Too low engagement ────────────────────────────────────
  {
    title: "Suspicious email about a Netflix refund — looks fake",
    upvotes: 2,
    comments: 1,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/nf1/",
    timeAgo: "22 hours ago",
    bodyPreview: "",
  },

  // ── BORDERLINE: Romance scam (qualifies — 50+ audience, financial risk) ───
  {
    title: "Mum has been talking to someone online for 4 months — now he's asking for $2,000 to visit",
    upvotes: 234,
    comments: 78,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/rom1/",
    timeAgo: "7 hours ago",
    bodyPreview: "She met him on Facebook. Very attractive profile. They talk every day for hours. Now he says he needs money for flights because he's stuck in Turkey on a work contract.",
  },

  // ── EDGE CASE: Investment scam (qualifies but borderline on audience) ─────
  {
    title: "Dad invested £5,000 in a crypto trading platform recommended by someone he met on LinkedIn",
    upvotes: 78,
    comments: 31,
    flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/inv1/",
    timeAgo: "16 hours ago",
    bodyPreview: "He's 63 and not tech-savvy. The platform shows his balance growing but when he tried to withdraw they asked for a 20% 'tax' fee first.",
  },

  // ── LOW QUALITY: Vague, no useful details ─────────────────────────────────
  {
    title: "I think I got scammed, not sure what to do",
    upvotes: 4,
    comments: 2,
    flair: "Help Needed",
    url: "https://www.reddit.com/r/Scams/comments/vague1/",
    timeAgo: "20 hours ago",
    bodyPreview: "Someone online asked me to do something and now I'm worried. Can't say more.",
  },

  // ── Gaming scam (SHOULD EXCLUDE) ──────────────────────────────────────────
  {
    title: "Scammed buying a Steam game key from a third party site — key was already used",
    upvotes: 45,
    comments: 14,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/game1/",
    timeAgo: "10 hours ago",
    bodyPreview: "Bought a key for a new game from a grey market site. When I tried to redeem it Steam said the key had already been used.",
  },

  // ── Job scam (qualifies) ──────────────────────────────────────────────────
  {
    title: "Offered a remote data entry job — they sent me a fake cheque to cash and keep $500, send the rest",
    upvotes: 93,
    comments: 29,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/job1/",
    timeAgo: "13 hours ago",
    bodyPreview: "Applied for a work-from-home data entry position on Indeed. They offered $800/week. Asked me to deposit a cheque for equipment and wire the surplus to a 'supplier'.",
  },

  // ── Lottery scam (qualifies) ──────────────────────────────────────────────
  {
    title: "Nan received a letter saying she won £25,000 in a prize draw she never entered",
    upvotes: 112,
    comments: 38,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/lot1/",
    timeAgo: "15 hours ago",
    bodyPreview: "She's 74 and very excited. The letter looks official with a company logo and asks her to pay a £95 'processing fee' to release the winnings.",
  },

  // ── Crypto pig butchering (qualifies — investment scam variant) ───────────
  {
    title: "Met someone on Hinge who convinced me to invest in her 'family's trading platform' — lost $12,000",
    upvotes: 445,
    comments: 134,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/pig1/",
    timeAgo: "2 hours ago",
    bodyPreview: "We talked for 6 weeks. She was beautiful, caring, smart. Then she started talking about her uncle's crypto platform. Said she makes $3k a week. I put in $12k across 3 months. Now the site is gone.",
  },

  // ── Microsoft tech support call (qualifies — cluster with popup) ──────────
  {
    title: "Mum paid £300 to someone who called saying her broadband was about to be cut off — BT impersonator",
    upvotes: 58,
    comments: 21,
    flair: "Is this a scam?",
    url: "https://www.reddit.com/r/Scams/comments/bt1/",
    timeAgo: "19 hours ago",
    bodyPreview: "They called her landline and said they were from BT. Told her she needed to pay a reconnection fee or lose internet. She paid £300 by bank transfer.",
  },
];

// ─── Anthropic invokeLLM Adapter ──────────────────────────────────────────────

function makeInvokeLLM(apiKey: string) {
  const client = new Anthropic({ apiKey });

  return async (params: LLMInvokeParams) => {
    const model = params.model ?? "claude-haiku-4-5-20251001";
    const systemMsg = params.messages.find(m => m.role === "system")?.content ?? "";
    const userMsgs = params.messages.filter(m => m.role !== "system");

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemMsg,
      messages: userMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return { choices: [{ message: { content: text } }] };
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌  Set ANTHROPIC_API_KEY before running this test.");
    process.exit(1);
  }

  console.log("🔍  Running Researchy test...\n");
  console.log(`📋  Input: ${SAMPLE_POSTS.length} Reddit posts`);
  console.log("─".repeat(60));

  const result = await runResearchy(
    {
      posts: SAMPLE_POSTS,
      timeWindow: "24 hours",
      scannedAt: new Date().toISOString(),
    },
    {
      invokeLLM: makeInvokeLLM(apiKey),
      // No db — first run / no topic history
    }
  );

  // ── Print Meta ──
  console.log("\n📊  FUNNEL STATS");
  console.log(`   Raw posts reviewed:     ${result.meta.rawPostsReviewed}`);
  console.log(`   After deduplication:    ${result.meta.afterDeduplication}`);
  console.log(`   After category filter:  ${result.meta.afterCategoryFilter}`);
  console.log(`   After relevance filter: ${result.meta.afterRelevanceFilter}`);
  console.log(`   Topic history checked:  ${result.meta.topicHistoryChecked}`);

  // ── Print Shortlist ──
  console.log(`\n✅  SHORTLIST (${result.shortlist.length} topics)`);
  console.log("─".repeat(60));
  result.shortlist.forEach(t => {
    const urgencyIcon = t.urgency === "high" ? "🔴" : t.urgency === "medium" ? "🟡" : "🟢";
    console.log(`\n  #${t.rank} ${urgencyIcon} ${t.scamName} [${t.category}]`);
    console.log(`     Title:    "${t.originalTitle}"`);
    console.log(`     Angle:    ${t.suggestedAngle}`);
    console.log(`     Why:      ${t.whyRelevant}`);
    console.log(`     Audience: ${t.audience}`);
    console.log(`     Stats:    ${t.upvotes} upvotes · ${t.comments} comments · ${t.postAge}`);
    if (t.duplicatePostCount > 1) console.log(`     Dupes:    ${t.duplicatePostCount} posts consolidated`);
    if (t.newVariant) console.log(`     ⚡ NEW VARIANT: ${t.newVariantNote}`);
  });

  // ── Print Excluded ──
  console.log(`\n🚫  EXCLUDED (${result.excluded.length} posts)`);
  console.log("─".repeat(60));
  result.excluded.forEach(e => {
    console.log(`  • "${e.originalTitle}"`);
    console.log(`    → ${e.exclusionReason}`);
  });

  // ── Print Summary + Note ──
  console.log("\n📝  SUMMARY");
  console.log(`  ${result.summary}`);
  console.log("\n💬  AGENT NOTE");
  console.log(`  ${result.agentNote}`);

  // ── Automated Checks ──
  console.log("\n─".repeat(60));
  console.log("🧪  AUTOMATED CHECKS");

  const checks: { label: string; pass: boolean; note?: string }[] = [
    {
      label: "Shortlist has 3–7 items",
      pass: result.shortlist.length >= 3 && result.shortlist.length <= 7,
      note: `Got ${result.shortlist.length}`,
    },
    {
      label: "Discord scam excluded",
      pass: result.excluded.some(e => e.originalTitle.toLowerCase().includes("discord")),
    },
    {
      label: "NFT scam excluded",
      pass: result.excluded.some(e => e.originalTitle.toLowerCase().includes("nft")),
    },
    {
      label: "In-person (door) scam excluded",
      pass: result.excluded.some(e => e.originalTitle.toLowerCase().includes("door") || e.exclusionReason.toLowerCase().includes("in-person")),
    },
    {
      label: "Gaming (Steam) scam excluded",
      pass: result.excluded.some(e => e.originalTitle.toLowerCase().includes("steam") || e.originalTitle.toLowerCase().includes("game")),
    },
    {
      label: "SIM swap gets 'high' urgency",
      pass: result.shortlist.some(t => t.scamName.toLowerCase().includes("sim") && t.urgency === "high"),
    },
    {
      label: "Grandparent/bail scam present",
      pass: result.shortlist.some(t =>
        t.originalTitle.toLowerCase().includes("arrested") ||
        t.category.toLowerCase().includes("grandparent") ||
        t.scamName.toLowerCase().includes("grandparent")
      ),
    },
    {
      label: "meta funnel numbers are decreasing",
      pass: result.meta.rawPostsReviewed >= result.meta.afterDeduplication &&
            result.meta.afterDeduplication >= result.meta.afterCategoryFilter &&
            result.meta.afterCategoryFilter >= result.meta.afterRelevanceFilter,
    },
    {
      label: "agentNote is non-empty",
      pass: result.agentNote.length > 20,
    },
  ];

  let passed = 0;
  checks.forEach(c => {
    const icon = c.pass ? "✅" : "❌";
    console.log(`  ${icon} ${c.label}${c.note ? ` (${c.note})` : ""}`);
    if (c.pass) passed++;
  });

  console.log(`\n  ${passed}/${checks.length} checks passed`);

  if (passed < checks.length) {
    console.log("\n⚠️  Some checks failed — review the output above and iterate on the system prompt.");
  } else {
    console.log("\n🎉  All checks passed — Researchy output looks good!");
  }
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
