import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export async function createVideoArchive(clips: { sequence: number; source?: string | null }[], title: string, signal?: AbortSignal) {
  if (!clips.length) throw new Error("No shots to download");
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const files = clips.map(clip => {
    if (!clip.source) throw new Error("Missing video for shot " + clip.sequence);
    const absolute = fs.realpathSync(path.resolve(clip.source));
    const relative = path.relative(fs.realpathSync(uploadRoot), absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(absolute).isFile()) throw new Error("Invalid video file");
    return { absolute, name: "shot-" + String(clip.sequence).padStart(3, "0") + path.extname(absolute) };
  });
  const archive = archiver("zip", { store: true });
  const stream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  archive.on("warning", error => archive.destroy(error));
  const abort = () => archive.destroy(new Error("Download cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  archive.on("close", () => signal?.removeEventListener("abort", abort));
  for (const file of files) archive.append(fs.createReadStream(file.absolute), { name: file.name });
  void archive.finalize().catch(error => archive.destroy(error));
  const name = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_") + "-videos.zip";
  return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=clips.zip; filename*=UTF-8''" + encodeURIComponent(name) } });
}
