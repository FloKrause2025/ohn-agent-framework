---
name: messaging-slack
version: 1.0
used_by: [all-agents]
inputs: [SlackConfig, message params]
outputs: [SlackResult]
---

## What This Skill Does

Connects OHN agents to Slack via a Bolt app with Socket Mode. Routes incoming @mentions and thread replies to the correct agent by channel name. Sends plain text or Block Kit formatted responses back. No public webhook URL required.

## Why It Exists

Owners interact with agents directly in Slack — asking questions, reviewing data, triggering pipelines. This skill is the communication layer that bridges Slack events to agent handlers and routes agent responses back to the right channel.

## Architecture Fix (vs Original)

**Original flaw:** Direct imports to `ENV`, `invokeLLM`, `getDb`, `saveAgentMemory`, and the full agent system prompt. This tightly coupled the Slack skill to the entire original framework.

**This version:** All dependencies injected via `SlackConfig`. The skill handles the Slack routing and message formatting — the calling layer provides the LLM function, DB persistence, and system prompts.

## How It Works

1. **Bolt app starts** — Socket Mode, single app for all channels
2. **Incoming message** — `app_mention` event or thread reply
3. **Resolve channel name** — maps channel ID to human-readable name (cached)
4. **Route to agent** — matches channel name to agent ID via CHANNEL_AGENT_MAP
5. **Call agent handler** — injected `handleMessage` function
6. **Post response** — plain text or Block Kit blocks

## Channel → Agent Mapping

| Channel | Agent |
|---|---|
| `#content-strategist` | contentStrategist |
| `#statsy` | statsy |
| `#addy` | addy |
| `#instistati` | instiStati |
| `#paid-marketing` | paidMarketing |
| `#bobs` | bobs |
| `#medy` | medy |

## Inputs

```ts
interface SlackConfig {
  botToken: string;   // xoxb-...
  appToken: string;   // xapp-...

  /** Map of channel name → agent handler function */
  channelHandlers: Record<string, SlackAgentHandler>;

  /** Optional: log level override */
  logLevel?: "debug" | "info" | "warn" | "error";
}

type SlackAgentHandler = (
  channelId: string,
  userMessage: string,
  userName: string
) => Promise<SlackAgentResponse>;

interface SlackAgentResponse {
  text: string;
  blocks?: object[]; // Block Kit blocks for rich formatting
}
```

## Outputs

```ts
interface SlackResult {
  ok: boolean;
  ts?: string;   // message timestamp
  error?: string;
}
```

## Failure Modes

| Failure | Behaviour |
|---|---|
| botToken or appToken missing | `initSlackApp()` returns without starting (logs warning) |
| Agent handler throws | Error caught, "Sorry, I ran into an error" posted to thread |
| Channel not in handler map | Falls back to default handler if provided, or silently ignores |

## Constraints

- Socket Mode required — no public webhook URL
- Thread replies always posted in the same thread as the original message
- Channel name cache prevents repeated API calls for the same channel
- Bot ignores its own messages (prevents reply loops)
