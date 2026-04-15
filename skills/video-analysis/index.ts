/**
 * video-analysis/index.ts
 *
 * Makes videos "watchable" by agents — extracts 10 timed frames and
 * a full audio transcript from any video file or Instagram reel.
 *
 * CHANGES FROM ORIGINAL (server/skills/video-analysis/scripts/videoWatcher.ts):
 * - ARCHITECTURE FIX: Removed all direct imports (ENV, storagePut, transcribeAudio,
 *   getDb, drizzle schema). All external dependencies injected via VideoAnalysisDeps.
 * - Skill is now framework-agnostic — works with any storage, transcription, and cache layer.
 * - All core logic (ffmpeg extraction, frame calculation, duration detection) unchanged.
 * - buildVideoContext() helper kept and exported.
 *
 * ORIGINAL: server/skills/video-analysis/scripts/videoWatcher.ts (working — do not modify)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Requires ffmpeg-static in the host environment
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const FFMPEG_BIN: string = _require("ffmpeg-static") as string;

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface VideoFrame {
  index: number;
  percentThrough: number;
  timestampSeconds: number;
  url: string;
}

export interface VideoIntelligence {
  mediaId: string;
  caption: string;
  captionLine: string;
  durationSeconds: number;
  frames: VideoFrame[];
  transcript: string;
  language: string;
  thumbnailUrl: string;
  postedAt: string;
  analysedAt: string;
}

export interface VideoAnalysisDeps {
  /** Instagram access token — required for watchVideo(), not needed for watchUploadedVideo() */
  igToken?: string;

  /** Storage adapter for uploading extracted frames and audio */
  storage: {
    put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  };

  /** Transcription adapter — wraps Whisper or equivalent */
  transcribe: {
    audio(audioUrl: string): Promise<{ text: string; language: string } | { error: string }>;
  };

  /** Cache adapter — stores and retrieves VideoIntelligence by mediaId */
  cache: {
    get(mediaId: string): Promise<VideoIntelligence | null>;
    set(intelligence: VideoIntelligence): Promise<void>;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IG_API_BASE = "https://graph.facebook.com/v21.0";
const FRAME_PERCENTAGES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `ohn-video-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    for (const file of readdirSync(dir)) {
      try { unlinkSync(join(dir, file)); } catch {}
    }
  } catch {}
}

async function fetchIgMediaUrl(
  mediaId: string,
  token: string
): Promise<{ mediaUrl: string; thumbnailUrl: string; caption: string; timestamp: string }> {
  const url = `${IG_API_BASE}/${mediaId}?fields=media_url,thumbnail_url,caption,timestamp&access_token=${token}`;
  const res = await fetch(url);
  const data = (await res.json()) as { error?: { message: string }; media_url?: string; thumbnail_url?: string; caption?: string; timestamp?: string };
  if (data.error) throw new Error(`Instagram API error: ${data.error.message}`);
  if (!data.media_url) throw new Error(`No media_url returned for media ID ${mediaId}`);
  return {
    mediaUrl: data.media_url,
    thumbnailUrl: data.thumbnail_url ?? "",
    caption: data.caption ?? "",
    timestamp: data.timestamp ?? new Date().toISOString(),
  };
}

async function downloadVideo(mediaUrl: string, outputPath: string): Promise<void> {
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);
  const { writeFileSync } = await import("fs");
  writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
}

function getVideoDuration(videoPath: string): number {
  try {
    const output = execSync(
      `"${FFMPEG_BIN}" -v quiet -print_format json -show_format "${videoPath}"`,
      { stdio: "pipe", timeout: 15_000 }
    ).toString();
    const duration = parseFloat((JSON.parse(output) as { format?: { duration?: string } }).format?.duration ?? "0");
    return duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

function extractFrame(videoPath: string, timestampSeconds: number, outputPath: string): void {
  execSync(
    `"${FFMPEG_BIN}" -y -ss ${Math.max(0, timestampSeconds - 2).toFixed(3)} -i "${videoPath}" -ss 2 -frames:v 1 -q:v 2 "${outputPath}"`,
    { stdio: "pipe", timeout: 30_000 }
  );
}

function extractAudio(videoPath: string, outputPath: string): void {
  execSync(
    `"${FFMPEG_BIN}" -y -i "${videoPath}" -vn -acodec libmp3lame -ar 16000 -ac 1 -q:a 6 "${outputPath}"`,
    { stdio: "pipe", timeout: 180_000 }
  );
}

async function extractFrames(
  videoPath: string,
  durationSeconds: number,
  mediaId: string,
  tempDir: string,
  storage: VideoAnalysisDeps["storage"]
): Promise<VideoFrame[]> {
  const frames: VideoFrame[] = [];
  for (let i = 0; i < FRAME_PERCENTAGES.length; i++) {
    const pct = FRAME_PERCENTAGES[i];
    const effectivePct = pct === 100 ? 98 : pct;
    const timestampSeconds = (effectivePct / 100) * durationSeconds;
    const framePath = join(tempDir, `frame-${String(i + 1).padStart(2, "0")}.jpg`);
    try {
      extractFrame(videoPath, timestampSeconds, framePath);
      if (existsSync(framePath)) {
        const buffer = readFileSync(framePath);
        const key = `video-frames/${mediaId}/frame-${String(i + 1).padStart(2, "0")}.jpg`;
        const { url } = await storage.put(key, buffer, "image/jpeg");
        frames.push({ index: i + 1, percentThrough: pct, timestampSeconds: parseFloat(timestampSeconds.toFixed(2)), url });
      }
    } catch {
      // Skip this frame, continue with others
    }
  }
  return frames;
}

async function extractAndTranscribe(
  videoPath: string,
  mediaId: string,
  tempDir: string,
  storage: VideoAnalysisDeps["storage"],
  transcribe: VideoAnalysisDeps["transcribe"]
): Promise<{ transcript: string; language: string }> {
  const audioPath = join(tempDir, "audio.mp3");
  try {
    extractAudio(videoPath, audioPath);
    if (!existsSync(audioPath)) return { transcript: "[Audio extraction produced no output]", language: "en" };

    const buffer = readFileSync(audioPath);
    const { url: audioUrl } = await storage.put(`video-audio/${mediaId}/audio.mp3`, buffer, "audio/mpeg");
    const result = await transcribe.audio(audioUrl);

    if ("text" in result) {
      return { transcript: result.text ?? "", language: result.language ?? "en" };
    }
    return { transcript: `[Transcription failed: ${result.error}]`, language: "en" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { transcript: `[Transcription unavailable: ${msg.slice(0, 200)}]`, language: "en" };
  }
}

// ─── Main Exports ─────────────────────────────────────────────────────────────

/**
 * Analyse an Instagram reel by media ID.
 * Requires deps.igToken to fetch the video URL from the Graph API.
 */
export async function watchVideo(
  mediaId: string,
  deps: VideoAnalysisDeps,
  forceRefresh = false
): Promise<VideoIntelligence & { fromCache: boolean }> {
  if (!forceRefresh) {
    const cached = await deps.cache.get(mediaId);
    if (cached) return { ...cached, fromCache: true };
  }

  if (!deps.igToken) throw new Error("igToken is required in VideoAnalysisDeps for watchVideo()");

  const tempDir = makeTempDir();
  const videoPath = join(tempDir, "video.mp4");

  try {
    const { mediaUrl, thumbnailUrl, caption, timestamp } = await fetchIgMediaUrl(mediaId, deps.igToken);
    await downloadVideo(mediaUrl, videoPath);

    const durationSeconds = getVideoDuration(videoPath);
    const frames = await extractFrames(videoPath, durationSeconds, mediaId, tempDir, deps.storage);
    const { transcript, language } = await extractAndTranscribe(videoPath, mediaId, tempDir, deps.storage, deps.transcribe);

    const intelligence: VideoIntelligence = {
      mediaId,
      caption,
      captionLine: caption.split("\n")[0]?.trim() ?? caption.slice(0, 100),
      durationSeconds: parseFloat(durationSeconds.toFixed(2)),
      frames,
      transcript,
      language,
      thumbnailUrl,
      postedAt: timestamp,
      analysedAt: new Date().toISOString(),
    };

    await deps.cache.set(intelligence);
    return { ...intelligence, fromCache: false };
  } finally {
    cleanupDir(tempDir);
  }
}

/**
 * Analyse an uploaded video file from a storage URL.
 * Does not require an Instagram token.
 */
export async function watchUploadedVideo(
  params: { videoUrl: string; audioUrl: string; fileName?: string },
  deps: VideoAnalysisDeps
): Promise<VideoIntelligence & { fromCache: boolean }> {
  const tempDir = makeTempDir();
  const videoPath = join(tempDir, "uploaded-video.mp4");
  const pseudoMediaId = `uploaded-${Date.now()}`;

  try {
    await downloadVideo(params.videoUrl, videoPath);
    const durationSeconds = getVideoDuration(videoPath);
    const frames = await extractFrames(videoPath, durationSeconds, pseudoMediaId, tempDir, deps.storage);

    let transcript = "";
    let language = "en";
    try {
      const result = await deps.transcribe.audio(params.audioUrl);
      if ("text" in result) {
        transcript = result.text ?? "";
        language = result.language ?? "en";
      } else {
        transcript = `[Transcription failed: ${result.error}]`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      transcript = `[Transcription unavailable: ${msg.slice(0, 200)}]`;
    }

    const displayName = params.fileName ?? "Uploaded Video";
    const intelligence: VideoIntelligence = {
      mediaId: pseudoMediaId,
      caption: displayName,
      captionLine: displayName,
      durationSeconds: parseFloat(durationSeconds.toFixed(2)),
      frames,
      transcript,
      language,
      thumbnailUrl: frames[0]?.url ?? "",
      postedAt: new Date().toISOString(),
      analysedAt: new Date().toISOString(),
    };

    return { ...intelligence, fromCache: false };
  } finally {
    cleanupDir(tempDir);
  }
}

/**
 * Format VideoIntelligence as a text block for LLM injection.
 * Identical to original buildVideoContext() — kept for backward compatibility.
 */
export function buildVideoContext(vi: VideoIntelligence): string {
  return `
## VIDEO ANALYSIS — ${vi.captionLine}
**Media ID:** ${vi.mediaId}
**Posted:** ${new Date(vi.postedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
**Duration:** ${vi.durationSeconds}s
**Caption:** ${vi.caption}

### Audio Transcript
${vi.transcript || "[No speech detected]"}

### Visual Frames (${vi.frames.length} frames extracted at 10% intervals)
${vi.frames.map((f) => `- Frame ${f.index} (${f.percentThrough}% through, ${f.timestampSeconds}s): ${f.url}`).join("\n")}
`.trim();
}
