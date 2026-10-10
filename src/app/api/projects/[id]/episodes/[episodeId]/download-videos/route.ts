import { db } from "@/lib/db";
import { projects, episodes, shots, storyboardVersions } from "@/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { createVideoArchive } from "@/lib/video/clip-archive";
import { loadShotLegacyViewsBatch } from "@/lib/shot-asset-utils";
import { getUserIdFromRequest } from "@/lib/get-user-id";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; episodeId: string }> }) {
  const { id: projectId, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  if (!userId) return Response.json({ error: "Project not found" }, { status: 404 });
  const [project] = await db.select({ title: projects.title }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const [episode] = await db.select({ title: episodes.title, generationMode: episodes.generationMode }).from(episodes).where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)));
  if (!episode) return Response.json({ error: "Episode not found" }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const mode = query.get("mode") ?? episode.generationMode;
  if (mode !== "keyframe" && mode !== "reference") return Response.json({ error: "Unsupported video mode" }, { status: 400 });
  const versions = await db.select().from(storyboardVersions).where(and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))).orderBy(desc(storyboardVersions.versionNum));
  const version = query.get("versionId") ? versions.find(v => v.id === query.get("versionId")) : versions[0];
  if (query.get("versionId") && !version) return Response.json({ error: "Version not found" }, { status: 404 });
  const conditions = [eq(shots.projectId, projectId), eq(shots.episodeId, episodeId)];
  if (version) conditions.push(eq(shots.versionId, version.id));
  const episodeShots = await db.select().from(shots).where(and(...conditions)).orderBy(asc(shots.sequence));
  const legacy = await loadShotLegacyViewsBatch(episodeShots.map(s => s.id));
  const clips = episodeShots.map(shot => ({ sequence: shot.sequence, source: mode === "reference" ? legacy.get(shot.id)?.referenceVideoUrl : legacy.get(shot.id)?.videoUrl }));
  try {
    return await createVideoArchive(clips, project.title + "-" + episode.title, request.signal);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
