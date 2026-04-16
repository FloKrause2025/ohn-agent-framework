---
name: analyzing-video
version: 1.0
used_by: [content-strategist, addy]
inputs: [mediaId or videoUrl+audioUrl, deps]
outputs: [VideoIntelligence]
---

## What This Skill Does

Downloads a video (Instagram reel or uploaded file), extracts 10 visual frames at timed intervals, transcribes the audio via Whisper, and returns structured visual + audio data. Does not interpret, score, or recommend — that is the consuming agent's job.

## Why It Exists

Statistics tell you *what* happened (viewers dropped at 8s). This skill tells you *why* (what was on screen at 8s, what was being said). Combined with InstiStati's metrics, agents can connect specific creative choices to specific performance outcomes.

## Architecture Fix (vs Original)

**Original flaw:** Hard-coded imports to `storagePut`, `transcribeAudio`, `getDb`, and the ORM schema made the skill completely coupled to the original framework.

**This version:** All external dependencies are injected via `VideoAnalysisDeps`. The skill's logic is framework-agnostic — any framework can provide the storage, transcription, and cache layers.

## How It Works

1. **Cache check** — if this `mediaId` was analysed and result is cached, return it instantly
2. **Fetch video** — from Instagram Graph API (using injected IG token) or from S3 URL directly
3. **Extract 10 frames** — ffmpeg at 10%, 20%, ..., 98% through the video
4. **Upload frames** — to storage (S3 or equivalent) via injected storage adapter
5. **Extract + transcribe audio** — ffmpeg to MP3, then Whisper via injected transcription adapter
6. **Cache result** — store via injected cache adapter
7. **Return VideoIntelligence** — frames + transcript + metadata

## Inputs

### Mode 1 — Instagram reel
```ts
watchVideo(mediaId: string, deps: VideoAnalysisDeps, forceRefresh?: boolean)
```

### Mode 2 — Uploaded file
```ts
watchUploadedVideo(params: { videoUrl: string; audioUrl: string; fileName?: string }, deps: VideoAnalysisDeps)
```

### Dependency injection interface
```ts
interface VideoAnalysisDeps {
  igToken?: string;  // required for watchVideo, not needed for watchUploadedVideo
  storage: {
    put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  };
  transcribe: {
    audio(audioUrl: string): Promise<{ text: string; language: string } | { error: string }>;
  };
  cache: {
    get(mediaId: string): Promise<VideoIntelligence | null>;
    set(intelligence: VideoIntelligence): Promise<void>;
  };
}
```

## Outputs

```ts
interface VideoIntelligence {
  mediaId: string;
  caption: string;
  captionLine: string;       // first line of caption
  durationSeconds: number;
  frames: VideoFrame[];      // 10 frames
  transcript: string;
  language: string;
  thumbnailUrl: string;
  postedAt: string;
  analysedAt: string;
}

interface VideoFrame {
  index: number;             // 1–10
  percentThrough: number;    // 10, 20, ..., 100
  timestampSeconds: number;
  url: string;               // storage URL
}
```

## Failure Modes

| Failure | Behaviour |
|---|---|
| Frame extraction fails | That frame skipped; others continue |
| Audio extraction fails | Transcript = "[Transcription unavailable]"; frames still returned |
| Whisper fails | Transcript = "[Transcription failed]"; frames still returned |
| Cache write fails | Result still returned; next call re-analyses |
| IG token missing | Throws — required for watchVideo |

## Constraints

- Max 10 frames per video (at 10% intervals)
- Frame at 100% uses 98% to avoid final black/fade frames
- Audio extracted as mono MP3 at 16kHz (speech-optimised)
- Requires ffmpeg-static in the host environment
