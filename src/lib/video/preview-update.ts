export interface PreviewSettings { subtitlesEnabled: boolean; transition: string; mode: "keyframe" | "reference"; versionId?: string }
export interface PreviewRecord { outputPath: string; settings: PreviewSettings }
// Do not publish settings or change the player until the new media is readable.
export async function confirmPreview(settings: PreviewSettings, render: (settings: PreviewSettings) => Promise<unknown>, verify: (path: string) => Promise<boolean>): Promise<PreviewRecord> {
  const result = await render({ ...settings }) as { status?: string; outputPath?: unknown };
  if (result?.status !== "ok" || typeof result.outputPath !== "string" || !result.outputPath) throw new Error("Invalid assembly response");
  if (!await verify(result.outputPath)) throw new Error("Generated preview video is unavailable");
  return { outputPath: result.outputPath, settings: { ...settings } };
}
