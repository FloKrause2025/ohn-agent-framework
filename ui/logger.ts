/**
 * ui/logger.ts
 *
 * Per-request structured logger. Collects log entries in memory during a
 * request so they can be returned to the client alongside the agent result.
 * Also writes to console so they appear in Vercel function logs.
 *
 * Usage:
 *   const logger = new RequestLogger();
 *   logger.info("reddit", "Fetched 47 posts", { posts });
 *   // at end of request: return logger.entries
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  step: string;
  message: string;
  data?: unknown;
}

export class RequestLogger {
  readonly entries: LogEntry[] = [];

  info(step: string, message: string, data?: unknown): void {
    this._push("info", step, message, data);
  }

  warn(step: string, message: string, data?: unknown): void {
    this._push("warn", step, message, data);
  }

  error(step: string, message: string, data?: unknown): void {
    this._push("error", step, message, data);
  }

  debug(step: string, message: string, data?: unknown): void {
    this._push("debug", step, message, data);
  }

  private _push(level: LogLevel, step: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      step,
      message,
      ...(data !== undefined ? { data } : {}),
    };
    this.entries.push(entry);

    // Mirror to console so Vercel function logs capture everything
    const tag = `[${level.toUpperCase()}][${step}]`;
    if (data !== undefined) {
      console.log(tag, message, JSON.stringify(data, null, 2).slice(0, 2000));
    } else {
      console.log(tag, message);
    }
  }
}
