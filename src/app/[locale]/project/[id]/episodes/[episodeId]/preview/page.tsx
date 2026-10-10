"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useParams } from "next/navigation";
import {
  useProjectStore,
  getKeyframeVideoUrl,
  getReferenceVideoUrl,
  getSceneRefFrameUrl,
  getFirstFrameUrl,
} from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { uploadUrl } from "@/lib/utils/upload-url";
import {
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Play,
  Monitor,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { TRANSITIONS } from "@/lib/video/export-options";
import { confirmPreview } from "@/lib/video/preview-update";

export default function EpisodePreviewPage() {
  const t = useTranslations();
  const { project, fetchProject, setProject } = useProjectStore();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string; episodeId: string }>();
  const versionId = searchParams.get("versionId");

  useEffect(() => {
    if (versionId && params?.id) {
      fetchProject(params.id, params.episodeId, versionId);
    }
  }, [versionId, params?.id, params?.episodeId, fetchProject]);

  const [assembling, setAssembling] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [transition, setTransition] = useState("shot");
  const [downloading, setDownloading] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [playerRevision, setPlayerRevision] = useState(0);
  const hydratedScope = useRef("");
  const [selectedShot, setSelectedShot] = useState(0);
  const [videoValid, setVideoValid] = useState<boolean | null>(null);
  const checkedUrl = useRef<string | null>(null);

  const finalVideoUrl = project?.finalVideoUrl ?? null;
  const generationMode = project?.generationMode ?? "keyframe";

  // Which mode's videos to preview — default to the project's generationMode
  const hasKeyframeVideos = project?.shots.some((s) => getKeyframeVideoUrl(s)) ?? false;
  const hasReferenceVideos = project?.shots.some((s) => getReferenceVideoUrl(s)) ?? false;
  const hasBothModes = hasKeyframeVideos && hasReferenceVideos;

  const [previewMode, setPreviewMode] = useState<"keyframe" | "reference">(generationMode);
  const settingsStorageKey = `video-preview:${params.id}:${params.episodeId}:${versionId || "latest"}`;
  useEffect(() => {
    const scope = `${settingsStorageKey}:${finalVideoUrl || ""}`;
    if (!project || hydratedScope.current === scope) return;
    hydratedScope.current = scope;
    setPreviewPending(false);
    setSubtitlesEnabled(true);
    setTransition("shot");
    setPreviewMode(project.generationMode ?? "keyframe");
    if (project.finalVideoSettings) {
      setSubtitlesEnabled(project.finalVideoSettings.subtitlesEnabled);
      setTransition(project.finalVideoSettings.transition);
      setPreviewMode(project.finalVideoSettings.mode);
    }
  }, [project, settingsStorageKey, finalVideoUrl]);

  // Check if final video file actually exists
  useEffect(() => {
    if (!finalVideoUrl) { setVideoValid(null); return; }
    if (checkedUrl.current === finalVideoUrl) return;
    checkedUrl.current = finalVideoUrl;
    fetch(uploadUrl(finalVideoUrl), { method: "HEAD" })
      .then((res) => setVideoValid(res.ok))
      .catch(() => setVideoValid(false));
  }, [finalVideoUrl]);

  if (!project) return null;

  const getVideoUrl = (shot: typeof project.shots[0]) =>
    previewMode === "reference" ? getReferenceVideoUrl(shot) : getKeyframeVideoUrl(shot);

  const getThumbnail = (shot: typeof project.shots[0]) =>
    previewMode === "reference" ? getSceneRefFrameUrl(shot) : getFirstFrameUrl(shot);

  const shotsWithVideo = project.shots.filter((s) => getVideoUrl(s));
  const allShotsHaveVideo = project.shots.length > 0 && project.shots.every((s) => getVideoUrl(s));
  const completedVideos = shotsWithVideo.length;
  const currentShot = shotsWithVideo[selectedShot];
  const hasValidVideo = finalVideoUrl && videoValid === true && !previewPending && !assembling;

  async function handleAssemble() {
    if (!project) return;
    setAssembling(true);
    try {
      const record = await confirmPreview({ versionId: versionId || undefined, subtitlesEnabled, transition, mode: previewMode }, async settings => {
        const res = await apiFetch(`/api/projects/${project.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "video_assemble", payload: settings, episodeId: params.episodeId }) });
        return res.json();
      }, async outputPath => (await fetch(uploadUrl(outputPath), { method: "HEAD", cache: "no-store" })).ok);
      setProject({ ...project, finalVideoUrl: record.outputPath, finalVideoSettings: record.settings });
      checkedUrl.current = record.outputPath;
      setVideoValid(true);
      setPlayerRevision(value => value + 1);
      setPreviewPending(false);
      toast.success(t("project.previewUpdated"));
    } catch (err) {
      console.error("Video assemble error:", err);
      toast.error(err instanceof Error ? err.message : t("common.generationFailed"));
    }
    finally { setAssembling(false); }
  }

  function handleDownload() {
    if (!hasValidVideo) return;
    const a = document.createElement("a");
    a.href = uploadUrl(finalVideoUrl!);
    a.download = `${project!.title || "video"}-final.mp4`;
    a.click();
  }

  async function handleDownloadClips() {
    if (!project) return;
    setDownloading(true);
    try {
      const query = new URLSearchParams({ mode: previewMode });
      if (versionId) query.set("versionId", versionId);
      const response = await apiFetch(`/api/projects/${project.id}/episodes/${params.episodeId}/download-videos?${query}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.title || "video"}-clips.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.generationFailed"));
    } finally { setDownloading(false); }
  }

  function handleModeSwitch(mode: "keyframe" | "reference") {
    setPreviewMode(mode);
    setPreviewPending(true);
    setSelectedShot(0);
  }

  return (
    <div className="animate-page-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Monitor className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[--text-primary]">
              {t("project.preview")}
            </h2>
            <p className="text-xs text-[--text-muted]">
              {t("project.shotsCompleted", {
                completed: completedVideos,
                total: project.shots.length,
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleDownloadClips} disabled={downloading || !allShotsHaveVideo} size="sm" variant="outline">
            <Download className="h-3.5 w-3.5" />
            {downloading ? t("common.generating") : t("project.downloadClips", { count: completedVideos })}
          </Button>
          {hasValidVideo && (
            <Button onClick={handleDownload} size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-100">
              <Download className="h-3.5 w-3.5" />
              {t("project.downloadVideo")}
            </Button>
          )}
          <Button
            onClick={handleAssemble}
            disabled={assembling || !allShotsHaveVideo}
            size="sm"
          >
            {assembling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {assembling ? t("common.generating") : t("project.assembleVideo")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-[--border-subtle] bg-white p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={subtitlesEnabled} disabled={assembling} onChange={event => { setSubtitlesEnabled(event.target.checked); setPreviewPending(true); }} />
          {t("project.addSubtitles")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t("project.exportTransition")}
          <select className="rounded-lg border p-2" value={transition} disabled={assembling} onChange={event => { setTransition(event.target.value); setPreviewPending(true); }}>
            <option value="shot">{t("project.transitionShot")}</option>
            {TRANSITIONS.map(value => <option key={value} value={value}>{t(`project.exportTransitions.${value}`)}</option>)}
          </select>
        </label>
        <p className="text-xs text-[--text-muted]">{t("project.exportHint")}</p>
        <Button onClick={handleAssemble} disabled={assembling || !allShotsHaveVideo} size="sm">
          {assembling ? t("project.previewUpdating") : t("project.confirmPreview")}
        </Button>
      </div>
      {(previewPending || assembling) && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{assembling ? t("project.previewUpdating") : t("project.previewPending")}</div>}

      {/* Mode switcher — only shown when both modes have videos */}
      {hasBothModes && (
        <div className="flex items-center gap-1 rounded-xl border border-[--border-subtle] bg-[--surface] p-1 w-fit">
          <button
            onClick={() => handleModeSwitch("keyframe")}
            disabled={assembling}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              previewMode === "keyframe"
                ? "bg-white text-primary shadow ring-1 ring-primary/20"
                : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
            )}
          >
            {t("project.generationModeKeyframe")}
          </button>
          <button
            onClick={() => handleModeSwitch("reference")}
            disabled={assembling}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150",
              previewMode === "reference"
                ? "bg-white text-primary shadow ring-1 ring-primary/20"
                : "text-[--text-muted] hover:bg-white/60 hover:text-[--text-secondary]"
            )}
          >
            {t("project.generationModeReference")}
          </button>
        </div>
      )}

      {/* Final video player */}
      {hasValidVideo && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-black shadow-2xl shadow-black/40">
            <video
              key={`${finalVideoUrl}:${playerRevision}`}
              aria-label={t("project.finalVideo")}
              controls
              autoPlay
              className="aspect-video w-full"
              src={uploadUrl(finalVideoUrl!)}
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5">
            <span className="text-sm font-medium text-emerald-700">{t("project.finalVideo")}</span>
            <span className="text-xs text-emerald-600/70">{t("project.finalVideoHint")}</span>
          </div>
        </div>
      )}

      {/* Shot clips player */}
      {shotsWithVideo.length > 0 && currentShot ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-[--border-subtle] bg-black shadow-2xl shadow-black/40">
            <video
              key={currentShot.id + previewMode}
              controls
              autoPlay={!finalVideoUrl && !previewPending && !assembling}
              className="aspect-video w-full"
              src={uploadUrl(getVideoUrl(currentShot)!)}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setSelectedShot(Math.max(0, selectedShot - 1))}
              disabled={selectedShot === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface-hover] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-sm font-medium text-[--text-secondary]">
              {selectedShot + 1} / {shotsWithVideo.length}
            </span>
            <button
              onClick={() =>
                setSelectedShot(Math.min(shotsWithVideo.length - 1, selectedShot + 1))
              }
              disabled={selectedShot === shotsWithVideo.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[--text-muted] transition-all hover:bg-[--surface-hover] hover:text-[--text-primary] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Thumbnail timeline */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {shotsWithVideo.map((shot, i) => {
              const thumb = getThumbnail(shot);
              return (
                <button
                  key={shot.id}
                  onClick={() => setSelectedShot(i)}
                  className={cn(
                    "flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-200",
                    i === selectedShot
                      ? "border-primary shadow-lg shadow-primary/20 scale-[1.03]"
                      : "border-[--border-subtle] hover:border-[--border-hover] opacity-70 hover:opacity-100"
                  )}
                >
                  <div className="relative h-14 w-22">
                    {thumb ? (
                      <img
                        src={uploadUrl(thumb)}
                        alt={`Shot ${shot.sequence}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[--surface]">
                        <Play className="h-3 w-3 text-[--text-muted]" />
                      </div>
                    )}
                    <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white backdrop-blur-sm">
                      {shot.sequence}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[--border-subtle] bg-[--surface]/50 py-24">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10">
            <Play className="h-7 w-7 text-primary" />
          </div>
          <p className="max-w-sm text-center text-sm text-[--text-secondary]">
            {t("shot.noShots")}
          </p>
        </div>
      )}
    </div>
  );
}
