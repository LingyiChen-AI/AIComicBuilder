import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  episodes,
  shots,
  characters,
  dialogues,
  storyboardVersions,
  episodeCharacters,
} from "@/lib/db/schema";
import { eq, asc, and, or, isNull, desc, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { markDownstreamStale } from "@/lib/staleness";
import { readExportSettings } from "@/lib/video/export-metadata";

async function resolveProjectAndEpisode(
  projectId: string,
  episodeId: string,
  userId: string
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  if (!project) return { project: null, episode: null };

  const [episode] = await db
    .select()
    .from(episodes)
    .where(
      and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId))
    );

  return { project, episode: episode ?? null };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const { project, episode } = await resolveProjectAndEpisode(
    id,
    episodeId,
    userId
  );

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const versionId = url.searchParams.get("versionId") ?? undefined;

  // Fetch versions for this episode
  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(
      and(
        eq(storyboardVersions.projectId, id),
        eq(storyboardVersions.episodeId, episodeId)
      )
    )
    .orderBy(desc(storyboardVersions.versionNum));

  const resolvedVersionId = versionId ?? allVersions[0]?.id;

  // Fetch characters linked to this episode via episode_characters table
  const linkedCharIds = await db
    .select({ characterId: episodeCharacters.characterId })
    .from(episodeCharacters)
    .where(eq(episodeCharacters.episodeId, episodeId));

  let epCharacters: typeof characters.$inferSelect[] = [];
  if (linkedCharIds.length > 0) {
    epCharacters = await db
      .select()
      .from(characters)
      .where(inArray(characters.id, linkedCharIds.map((r) => r.characterId)));
  }
  // No links = no characters for this episode (user needs to run character extraction)

  // Fetch shots for this episode + version
  const episodeShots = resolvedVersionId
    ? await db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, id),
            eq(shots.episodeId, episodeId),
            eq(shots.versionId, resolvedVersionId)
          )
        )
        .orderBy(asc(shots.sequence))
    : [];

  // Bulk-load ALL shot assets (all versions, not just active) so the UI
  // can render version history arrows and switch between historical fileUrls.
  const { shotAssets } = await import("@/lib/db/schema");
  const { desc: descOrder } = await import("drizzle-orm");
  const assetRows = episodeShots.length
    ? await db
        .select()
        .from(shotAssets)
        .where(inArray(shotAssets.shotId, episodeShots.map((s) => s.id)))
        .orderBy(shotAssets.type, shotAssets.sequenceInType, descOrder(shotAssets.assetVersion))
    : [];
  const assetsByShot = new Map<string, typeof assetRows>();
  for (const row of assetRows) {
    if (!assetsByShot.has(row.shotId)) assetsByShot.set(row.shotId, []);
    assetsByShot.get(row.shotId)!.push(row);
  }

  // Enrich each shot with its dialogues + active asset rows
  const enrichedShots = await Promise.all(
    episodeShots.map(async (shot) => {
      const shotDialogues = await db
        .select({
          id: dialogues.id,
          text: dialogues.text,
          characterId: dialogues.characterId,
          characterName: characters.name,
          sequence: dialogues.sequence,
        })
        .from(dialogues)
        .innerJoin(characters, eq(dialogues.characterId, characters.id))
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      const assets = (assetsByShot.get(shot.id) ?? []).map((a) => ({
        id: a.id,
        shotId: a.shotId,
        type: a.type,
        sequenceInType: a.sequenceInType,
        assetVersion: a.assetVersion,
        isActive: a.isActive,
        prompt: a.prompt,
        fileUrl: a.fileUrl,
        status: a.status,
        characters: a.characters ? JSON.parse(a.characters) : null,
        modelProvider: a.modelProvider,
        modelId: a.modelId,
        meta: a.meta ? JSON.parse(a.meta) : null,
      }));
      return { ...shot, dialogues: shotDialogues, assets };
    })
  );

  return NextResponse.json({
    ...episode,
    id: project.id,
    episodeId: episode.id,
    title: project.title,
    idea: episode.idea,
    script: episode.script,
    status: episode.status,
    finalVideoUrl: episode.finalVideoUrl,
    finalVideoSettings: readExportSettings(episode.finalVideoUrl),
    generationMode: episode.generationMode,
    characters: epCharacters,
    shots: enrichedShots,
    versions: allVersions.map((v) => ({
      id: v.id,
      label: v.label,
      versionNum: v.versionNum,
      createdAt:
        v.createdAt instanceof Date
          ? Math.floor(v.createdAt.getTime() / 1000)
          : v.createdAt,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const { project, episode } = await resolveProjectAndEpisode(
    id,
    episodeId,
    userId
  );

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as Partial<{
    title: string;
    description: string;
    keywords: string;
    idea: string;
    script: string;
    outline: string;
    status: "draft" | "processing" | "completed";
    generationMode: "keyframe" | "reference";
    targetDuration: number;
  }>;

  const { title, description, keywords, idea, script, outline, status, generationMode, targetDuration } = body;

  const [updated] = await db
    .update(episodes)
    .set({
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(keywords !== undefined && { keywords }),
      ...(idea !== undefined && { idea }),
      ...(script !== undefined && { script }),
      ...(outline !== undefined && { outline }),
      ...(status !== undefined && { status }),
      ...(generationMode !== undefined && { generationMode }),
      ...(targetDuration !== undefined && { targetDuration }),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, episodeId))
    .returning();

  if (script !== undefined) {
    await markDownstreamStale("episode", episodeId);
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> }
) {
  const { id, episodeId } = await params;
  const userId = getUserIdFromRequest(request);
  const { project, episode } = await resolveProjectAndEpisode(
    id,
    episodeId,
    userId
  );

  if (!project || !episode) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Refuse to delete the last episode
  const allEpisodes = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id));

  if (allEpisodes.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last episode" },
      { status: 400 }
    );
  }

  await db.delete(episodes).where(eq(episodes.id, episodeId));
  return new NextResponse(null, { status: 204 });
}
