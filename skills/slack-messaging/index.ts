/**
 * slack-messaging/index.ts
 *
 * Bolt-based Slack integration with Socket Mode. Routes channel messages
 * to injected agent handlers and posts responses back.
 *
 * CHANGES FROM ORIGINAL (server/skills/slack-messaging/scripts/slack.ts):
 * - ARCHITECTURE FIX: Removed direct imports of ENV, invokeLLM, getDb,
 *   saveAgentMemory, saveConversationMessage, CONTENT_STRATEGIST_SYSTEM_PROMPT,
 *   and all agent-specific data queries.
 * - All agent handling is now injected via channelHandlers map.
 * - The skill handles routing, threading, and formatting — not agent logic.
 * - Block Kit builders (buildStatsyBlocks, buildInstiStatiBlocks) moved to the
 *   agent layer — they require DB access and belong with the agents.
 * - Channel→agent routing, cache, threading, and deduplication logic unchanged.
 *
 * ORIGINAL: server/skills/slack-messaging/scripts/slack.ts (working — do not modify)
 * ORIGINAL: server/skills/slack-messaging/scripts/slackBlockKit.ts (working — do not modify)
 */

import { App, LogLevel } from "@slack/bolt";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface SlackAgentResponse {
  text: string;
  blocks?: object[];
}

export type SlackAgentHandler = (
  channelId: string,
  userMessage: string,
  userName: string
) => Promise<SlackAgentResponse>;

export interface SlackConfig {
  botToken: string;
  appToken: string;
  /** Channel name (without #) → agent handler. Unmatched channels are ignored. */
  channelHandlers: Record<string, SlackAgentHandler>;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  botUserId: string | null;
  registeredChannels: string[];
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _app: App | null = null;
let _botUserId: string | null = null;
let _config: SlackConfig | null = null;
const _channelNameCache = new Map<string, string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveChannelName(client: App["client"], channelId: string): Promise<string> {
  if (_channelNameCache.has(channelId)) return _channelNameCache.get(channelId)!;
  try {
    const info = await client.conversations.info({ channel: channelId });
    const name = (info.channel as { name?: string })?.name ?? "";
    if (name) _channelNameCache.set(channelId, name);
    return name;
  } catch {
    return "";
  }
}

async function resolveUserName(client: App["client"], userId: string): Promise<string> {
  try {
    const info = await client.users.info({ user: userId });
    const user = info.user as { real_name?: string; name?: string } | undefined;
    return user?.real_name ?? user?.name ?? "User";
  } catch {
    return "User";
  }
}

// ─── Core: process a message ──────────────────────────────────────────────────

async function handleIncomingMessage({
  channelId,
  channelName,
  userId,
  text,
  threadTs,
  client,
}: {
  channelId: string;
  channelName: string;
  userId: string;
  text: string;
  threadTs: string;
  client: App["client"];
}) {
  if (!_config) return;

  const handler = _config.channelHandlers[channelName];
  if (!handler) return; // No handler registered for this channel — ignore silently

  const userName = await resolveUserName(client, userId);

  // Show thinking reaction while processing
  await client.reactions.add({ channel: channelId, timestamp: threadTs, name: "thinking_face" }).catch(() => {});

  try {
    const response = await handler(channelId, text, userName);

    if (response.blocks) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: response.text,
        blocks: response.blocks as never[],
      });
    } else {
      await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: response.text });
    }
  } catch (err) {
    console.error(`[slack-messaging] Handler error for channel ${channelName}:`, err);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "Sorry, I ran into an error. Please try again.",
    });
  } finally {
    await client.reactions.remove({ channel: channelId, timestamp: threadTs, name: "thinking_face" }).catch(() => {});
  }
}

// ─── Main Export: init ────────────────────────────────────────────────────────

export async function initSlackApp(config: SlackConfig): Promise<void> {
  if (!config.botToken || !config.appToken) {
    console.log("[slack-messaging] botToken or appToken missing — Slack integration disabled.");
    return;
  }

  _config = config;

  const logLevelMap: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
  };

  _app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: logLevelMap[config.logLevel ?? "warn"] ?? LogLevel.WARN,
  });

  // Fetch bot's own user ID to prevent self-reply loops
  try {
    const auth = await _app.client.auth.test();
    _botUserId = (auth.user_id as string) ?? null;
    console.log(`[slack-messaging] Bot authenticated as ${auth.user} (${_botUserId})`);
  } catch (err) {
    console.error("[slack-messaging] auth.test failed:", err);
  }

  // ── Handle @mentions ──────────────────────────────────────────────────────
  _app.event("app_mention", async ({ event, client }) => {
    try {
      const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;
      const channelName = await resolveChannelName(client, event.channel);
      const threadTs = event.thread_ts ?? event.ts;
      await handleIncomingMessage({ channelId: event.channel, channelName, userId: event.user ?? "", text, threadTs, client });
    } catch (err) {
      console.error("[slack-messaging] app_mention handler error:", err);
    }
  });

  // ── Handle thread replies and DMs ──────────────────────────────────────────
  _app.event("message", async ({ event, client }) => {
    const msg = event as {
      subtype?: string;
      bot_id?: string;
      user?: string;
      text?: string;
      channel?: string;
      channel_type?: string;
      ts?: string;
      thread_ts?: string;
    };

    // Ignore bot messages, edits, deletes, and self-messages
    if (msg.subtype || msg.bot_id) return;
    if (_botUserId && msg.user === _botUserId) return;

    const text = (msg.text ?? "").trim();
    if (!text) return;

    // ── DM handler ───────────────────────────────────────────────────────
    if (msg.channel_type === "im") {
      const dmHandler = _config?.channelHandlers["dm"] ?? _config?.channelHandlers["bobs"];
      if (!dmHandler) return;
      const userName = await resolveUserName(client, msg.user ?? "");
      await client.reactions.add({ channel: msg.channel ?? "", timestamp: msg.ts ?? "", name: "thinking_face" }).catch(() => {});
      try {
        const response = await dmHandler(msg.channel ?? "dm", text, userName);
        if (response.blocks) {
          await client.chat.postMessage({ channel: msg.channel ?? "", text: response.text, blocks: response.blocks as never[] });
        } else {
          await client.chat.postMessage({ channel: msg.channel ?? "", text: response.text });
        }
      } catch (err) {
        console.error("[slack-messaging] DM handler error:", err);
        await client.chat.postMessage({ channel: msg.channel ?? "", text: "Sorry, I ran into an error." });
      } finally {
        await client.reactions.remove({ channel: msg.channel ?? "", timestamp: msg.ts ?? "", name: "thinking_face" }).catch(() => {});
      }
      return;
    }

    // ── Thread reply handler ─────────────────────────────────────────────
    // Only respond to thread replies in known agent channels
    if (!msg.thread_ts || msg.thread_ts === msg.ts) return;

    const channelName = await resolveChannelName(client, msg.channel ?? "");
    if (!_config?.channelHandlers[channelName]) {
      // Check if the bot has posted in this thread before responding in unknown channels
      try {
        const replies = await client.conversations.replies({ channel: msg.channel ?? "", ts: msg.thread_ts, limit: 20 });
        const botPostedHere = (replies.messages ?? []).some(
          (m: { bot_id?: string; user?: string }) => m.bot_id || (_botUserId && m.user === _botUserId)
        );
        if (!botPostedHere) return;
      } catch {
        return;
      }
    }

    await handleIncomingMessage({
      channelId: msg.channel ?? "",
      channelName,
      userId: msg.user ?? "",
      text,
      threadTs: msg.thread_ts,
      client,
    });
  });

  await _app.start();
  console.log("[slack-messaging] Bolt app started with Socket Mode.");
}

// ─── Utility exports ──────────────────────────────────────────────────────────

export function getSlackApp(): App | null {
  return _app;
}

export function getSlackStatus(): SlackStatus {
  return {
    configured: !!(_config?.botToken && _config?.appToken),
    connected: _app !== null,
    botUserId: _botUserId,
    registeredChannels: Object.keys(_config?.channelHandlers ?? {}),
  };
}

export function isSlackConfigured(config?: Pick<SlackConfig, "botToken" | "appToken">): boolean {
  const c = config ?? _config;
  return !!(c?.botToken && c?.appToken);
}

/**
 * Send a message to a specific channel (for agent-initiated messages, not replies).
 */
export async function sendMessage(
  channel: string,
  text: string,
  blocks?: object[]
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  if (!_app) return { ok: false, error: "Slack app not initialised" };
  try {
    const result = await _app.client.chat.postMessage({ channel, text, ...(blocks ? { blocks: blocks as never[] } : {}) });
    return { ok: true, ts: result.ts as string | undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
