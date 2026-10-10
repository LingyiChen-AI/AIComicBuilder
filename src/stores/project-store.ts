import { create } from "zustand";
import { apiFetch } from "@/lib/api-fetch";
import type { PreviewSettings } from "@/lib/video/preview-update";

interface Character {
  id: string;
  name: string;
  description: string;
  referenceImage: string | null;
  referenceImageHistory?: string | null;
  visualHint?: string | null;
  scope?: string;
  episodeId?: string | null;
}

interface Dialogue {
  id: string;
  text: string;
  characterId: string;
  characterName: string;
  sequence: number;
}

/**
 * One row from the unified `shot_assets` table, exposed to the frontend.
 * type discriminates the role:
 *   - 'first_frame' / 'last_frame'  → keyframe-mode image assets
 *   - 'reference'                   → reference-mode image assets (multi)
 *   - 'keyframe_video'              → keyframe-mode video output
 *   - 'reference_video'             → reference-mode video output
 */
export type ShotAssetType =
  | "first_frame"
  | "last_frame"
  | "reference"
  | "keyframe_video"
  | "reference_video";

export interface ShotAsset {
  id: string;
  shotId: string;
  type: ShotAssetType;
  sequenceInType: number;
  assetVersion: number;
  isActive: number;
  prompt: string;
  fileUrl: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  characters: string[] | null;
  modelProvider?: string | null;
  modelId?: string | null;
  meta?: { sceneName?: string } | null;
}

export interface Shot {
  id: string;
  sequence: number;
  prompt: string;
  videoScript: string | null;
  motionScript: string | null;
  cameraDirection: string;
  duration: number;
  sceneId?: string;
  transitionIn?: string;
  transitionOut?: string;
  videoPrompt: string | null;
  compositionGuide?: string;
  focalPoint?: string;
  depthOfField?: string;
  soundDesign?: string;
  musicCue?: string;
  qualityScore?: number;
  qualityIssues?: string[];
  isStale?: boolean;
  status: string;
  dialogues: Dialogue[];
  /** Active shot_assets rows for this shot, all types mixed. */
  assets: ShotAsset[];
}

// ─── Asset access helpers (use these in UI instead of legacy fields) ─────
// All helpers are null-safe — accept any object that may or may not have an
// `assets` field, falling back to empty array. Necessary because in-flight
// optimistic updates and partial fetches may produce shot objects without
// the assets field populated.

type ShotLike = { assets?: ShotAsset[] | null };

function safeAssets(shot: ShotLike): ShotAsset[] {
  return Array.isArray(shot?.assets) ? shot.assets : [];
}

/** Active assets only — `isActive === 1`. Use this for "current" reads. */
function activeAssets(shot: ShotLike): ShotAsset[] {
  return safeAssets(shot).filter((a) => a.isActive === 1);
}

/**
 * All version history rows for one slot (shot, type, sequenceInType),
 * sorted newest first by assetVersion. Use this to render history arrows.
 */
export function getAssetHistoryForSlot(
  shot: ShotLike,
  type: ShotAssetType,
  sequenceInType = 0
): ShotAsset[] {
  return safeAssets(shot)
    .filter((a) => a.type === type && a.sequenceInType === sequenceInType)
    .sort((a, b) => b.assetVersion - a.assetVersion);
}

/** Get the active first_frame image URL for a shot, or null. */
export function getFirstFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the active last_frame image URL for a shot, or null. */
export function getLastFrameUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the keyframe-mode video URL, or null. */
export function getKeyframeVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "keyframe_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get the reference-mode video URL, or null. */
export function getReferenceVideoUrl(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "reference_video" && a.sequenceInType === 0
    )?.fileUrl ?? null
  );
}

/** Get all active reference image assets ordered by sequence_in_type. */
export function getReferenceAssets(shot: ShotLike): ShotAsset[] {
  return activeAssets(shot)
    .filter((a) => a.type === "reference")
    .sort((a, b) => a.sequenceInType - b.sequenceInType);
}

/** First reference image URL (used as the "scene reference frame"). */
export function getSceneRefFrameUrl(shot: ShotLike): string | null {
  return getReferenceAssets(shot)[0]?.fileUrl ?? null;
}

/** First-frame prompt text (the LLM-generated description). */
export function getFirstFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "first_frame" && a.sequenceInType === 0
    )?.prompt ?? null
  );
}

/** Last-frame prompt text. */
export function getLastFramePrompt(shot: ShotLike): string | null {
  return (
    activeAssets(shot).find(
      (a) => a.type === "last_frame" && a.sequenceInType === 0
    )?.prompt ?? null
  );
}

/** Whether all reference images for a shot have been generated (have file_url). */
export function hasAllReferenceImages(shot: ShotLike): boolean {
  const refs = getReferenceAssets(shot);
  return refs.length > 0 && refs.every((r) => !!r.fileUrl);
}

/** Whether the shot has both first and last frame image URLs. */
export function hasKeyframePair(shot: ShotLike): boolean {
  return !!getFirstFrameUrl(shot) && !!getLastFrameUrl(shot);
}

export type StoryboardVersion = {
  id: string;
  label: string;
  versionNum: number;
  createdAt: number;
};

interface Project {
  id: string;
  title: string;
  idea: string;
  script: string;
  outline?: string;
  status: string;
  finalVideoUrl: string | null;
  finalVideoSettings?: PreviewSettings | null;
  generationMode: "keyframe" | "reference";
  characters: Character[];
  shots: Shot[];
  versions: StoryboardVersion[];
}

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  currentEpisodeId: string | null;
  fetchProject: (id: string, episodeId?: string, versionId?: string) => Promise<void>;
  updateIdea: (idea: string) => void;
  updateScript: (script: string) => void;
  setProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  loading: false,
  currentEpisodeId: null,

  fetchProject: async (id: string, episodeId?: string, versionId?: string) => {
    // Only show loading spinner on initial load (no project yet).
    // Version switches are background refreshes — don't unmount children.
    if (!get().project) set({ loading: true });

    let url: string;
    if (episodeId) {
      url = `/api/projects/${id}/episodes/${episodeId}${versionId ? `?versionId=${versionId}` : ""}`;
    } else {
      url = `/api/projects/${id}${versionId ? `?versionId=${versionId}` : ""}`;
    }

    const res = await apiFetch(url);
    const data = await res.json();
    set({ project: data, loading: false, currentEpisodeId: episodeId ?? null });
  },

  updateIdea: (idea: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, idea } : null,
    }));
  },

  updateScript: (script: string) => {
    set((state) => ({
      project: state.project ? { ...state.project, script } : null,
    }));
  },

  setProject: (project: Project) => {
    set({ project });
  },
}));
