import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function normalizeGrokBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Grok Base URL must be an HTTP(S) URL without credentials, query, or fragment");
  }
  const base = url.href.replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function imageInput(source: string): { url: string } {
  if (/^https?:\/\//i.test(source) || /^data:image\/(png|jpeg|webp);base64,/i.test(source)) {
    return { url: source };
  }
  const ext = path.extname(source).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  if (!mime) throw new Error("Grok frame images must be PNG, JPEG, or WebP");
  return { url: `data:${mime};base64,${fs.readFileSync(source).toString("base64")}` };
}

interface GrokVideoOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  uploadDir?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface VideoResponse {
  request_id?: string;
  status?: string;
  video?: { url?: string; respect_moderation?: boolean };
  error?: { message?: string } | string;
}

/** xAI REST video API; also supports gateways implementing the same contract. */
export class GrokVideoProvider implements VideoProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly uploadDir: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(options: GrokVideoOptions = {}) {
    this.apiKey = options.apiKey || process.env.XAI_API_KEY || "";
    this.baseUrl = normalizeGrokBaseUrl(options.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai");
    this.model = options.model || "grok-imagine-video-1.5";
    this.uploadDir = options.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 600_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    for (const value of [this.pollIntervalMs, this.pollTimeoutMs, this.requestTimeoutMs]) {
      if (!Number.isFinite(value) || value <= 0) throw new Error("Grok timeouts must be positive finite numbers");
    }
  }

  private redact(text: string): string {
    const withoutKey = this.apiKey ? text.split(this.apiKey).join("[REDACTED]") : text;
    return withoutKey.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 500);
  }

  private async jsonRequest(endpoint: string, init: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<VideoResponse> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
        redirect: "error",
      });
      if (!response.ok) {
        const detail = this.redact(await response.text());
        throw new Error(`Grok API ${response.status}: ${detail}`);
      }
      return await response.json() as VideoResponse;
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error("Grok API request timed out");
      }
      throw new Error(this.redact(error instanceof Error ? error.message : String(error)));
    }
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    if (!this.apiKey) throw new Error("Grok API Key is required");
    if (!params.prompt.trim()) throw new Error("Grok video prompt is required");
    if (!Number.isInteger(params.duration) || params.duration < 1 || params.duration > 15) {
      throw new Error("Grok video duration must be an integer from 1 to 15 seconds");
    }
    const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"];
    if (params.ratio !== "auto" && !ratios.includes(params.ratio)) throw new Error("Unsupported Grok video aspect ratio");
    const keyframe = !!params.firstFrame;
    const refs = params.referenceImages ?? [];
    // Older Grok models cannot pin a last frame or combine image + references.
    if ((keyframe || refs.length > 0) && !this.model.includes("video-1.5")) {
      throw new Error("Grok keyframes and combined references require grok-imagine-video-1.5; use reference mode without extra references for older models");
    }
    if (refs.length > 14) throw new Error("Grok supports at most 14 reference images");
    const source = keyframe ? params.firstFrame : params.initialImage;
    if (!source || (keyframe && !params.lastFrame)) throw new Error("Grok requires an initial image and both frames in keyframe mode");
    const body = {
      model: this.model, prompt: params.prompt, duration: params.duration, resolution: "720p",
      ...(params.ratio !== "auto" && { aspect_ratio: params.ratio }),
      image: imageInput(source),
      ...(keyframe && { last_frame: imageInput(params.lastFrame!) }),
      ...(refs.length > 0 && { reference_images: refs.map(imageInput) }),
    };
    // Never automatically retry submission: a retry may create a second billable task.
    const submitted = await this.jsonRequest("/videos/generations", { method: "POST", body: JSON.stringify(body) });
    if (!submitted.request_id || typeof submitted.request_id !== "string") throw new Error("Grok submit response is missing request_id");
    const result = await this.poll(submitted.request_id);
    return this.download(result.video!.url!);
  }

  private async poll(requestId: string): Promise<VideoResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      let result: VideoResponse;
      try {
        result = await this.jsonRequest(`/videos/${encodeURIComponent(requestId)}`, { method: "GET" }, Math.min(this.requestTimeoutMs, deadline - Date.now()));
      } catch (error) {
        // Retry only transient status reads, never permission errors or submissions.
        if (!(error instanceof Error) || !/^Grok API (429|5\d\d):/.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now()))));
        continue;
      }
      if (result.status === "done") {
        if (result.video?.respect_moderation === false) throw new Error("Grok video was filtered by moderation");
        if (!result.video?.url) throw new Error("Grok completed response is missing video.url");
        return result;
      }
      if (result.status === "failed" || result.status === "expired") {
        const detail = typeof result.error === "string" ? result.error : result.error?.message;
        throw new Error(`Grok video ${result.status}: ${this.redact(detail || "no error details")}`);
      }
      if (result.status !== "pending") throw new Error(`Unexpected Grok video status: ${this.redact(String(result.status))}`);
      await new Promise(resolve => setTimeout(resolve, Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now()))));
    }
    throw new Error("Grok video generation timed out");
  }

  private async download(videoUrl: string): Promise<VideoGenerateResult> {
    const url = new URL(videoUrl, `${this.baseUrl}/`);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Grok returned an invalid video URL");
    // A gateway may serve protected content; do not send its Key to a media CDN.
    const sameOrigin = url.origin === new URL(this.baseUrl).origin;
    try {
      const response = await fetch(url, {
        headers: sameOrigin ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`Grok video download failed: HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "";
      if (!contentType.startsWith("video/") && contentType !== "application/octet-stream") throw new Error("Grok video download returned non-video content");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error("Grok video download was empty");
      const dir = path.join(this.uploadDir, "videos");
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${randomUUID()}.mp4`);
      fs.writeFileSync(filePath, buffer);
      return { filePath };
    } catch (error) {
      throw new Error(this.redact(error instanceof Error ? error.message : String(error)));
    }
  }
}
