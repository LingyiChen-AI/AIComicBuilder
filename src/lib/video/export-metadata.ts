import fs from "node:fs";
import path from "node:path";
import { parseExportOptions } from "./export-options";
import type { PreviewSettings } from "./preview-update";
export function writeExportSettings(videoPath: string, settings: PreviewSettings) {
  fs.writeFileSync(path.resolve(videoPath) + ".export.json", JSON.stringify(settings));
}
export function readExportSettings(videoPath: string | null): PreviewSettings | null {
  if (!videoPath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(videoPath) + ".export.json", "utf8"));
    const parsed = parseExportOptions(raw);
    if (!parsed.mode) return null;
    return { ...parsed, mode: parsed.mode, versionId: typeof raw.versionId === "string" ? raw.versionId : undefined };
  } catch { return null; }
}
