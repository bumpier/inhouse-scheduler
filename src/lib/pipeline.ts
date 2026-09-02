/**
 * Business logic shared by the web app (server actions) and the worker.
 */
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { env } from "./env";
import { findBanned } from "./blocklist";
import { getBlocklistForSet } from "./settings";
import { extractAudio, transcribe, generateCaption } from "./ai";
import * as zernio from "./zernio";
import { pickSlots } from "./scheduler";
import { safeUnlink } from "./files";
import type { AccountSet, Post, PostStatus, Video } from "@prisma/client";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[pipeline]", ...a);

// ---------------------------------------------------------------------------
// Slot assignment
// ---------------------------------------------------------------------------

/** Statuses that hold a slot on the calendar. */
const OCCUPYING: PostStatus[] = ["pending_review", "approved", "submitted", "scheduled", "publishing", "published", "partial"];

export async function existingSlots(setId: string): Promise<Date[]> {
  const posts = await prisma.post.findMany({
    where: { setId, status: { in: OCCUPYING } },
    select: { scheduledAt: true },
  });
  return posts.map((p) => p.scheduledAt);
}

export async function assignSlots(set: AccountSet, count: number): Promise<Date[]> {
  const existing = await existingSlots(set.id);
  return pickSlots(count, existing, {
    timezone: set.timezone,
    windowStart: set.windowStart,
    windowEnd: set.windowEnd,
    postsPerDay: set.postsPerDay,
    minGapMinutes: env.minGapMinutes,
  });
}

// ---------------------------------------------------------------------------
// Caption pipeline (worker)
// ---------------------------------------------------------------------------

export async function processVideo(videoId: string) {
  const video = await prisma.video.findUnique({ where: { id: videoId }, include: { set: true } });
  if (!video || video.status !== "uploaded") return;
  await prisma.video.update({ where: { id: videoId }, data: { status: "processing", error: null } });

  const blocklist = await getBlocklistForSet(video.set.extraBannedWords);
  const audioPath = path.join(os.tmpdir(), `${video.id}.mp3`);
  let transcript = "";
  let transcriptFlags: string[] = [];
  let caption = "";
  let captionSource: "ai" | "default" = "default";
  let captionFlags: string[] = [];
  let error: string | null = null;

  try {
    const hasAudio = await extractAudio(video.storedPath, audioPath);
    if (hasAudio) {
      try {
        transcript = await transcribe(audioPath);
      } catch (e: any) {
        log("transcribe failed", video.id, e?.message);
        error = `Transcription failed: ${e?.message ?? e}`;
      }
    }
    transcriptFlags = findBanned(transcript, blocklist);

    // Generate caption, up to 2 attempts
    let previous: { caption: string; flagged: string[] } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const c = await generateCaption({
          transcript,
          setName: video.set.name,
          captionPrompt: video.set.captionPrompt,
          avoidTerms: blocklist,
          previousAttempt: previous,
        });
        const flags = findBanned(c, blocklist);
        if (flags.length === 0 && c.length > 0) {
          caption = c;
          captionSource = "ai";
          break;
        }
        previous = { caption: c, flagged: flags };
      } catch (e: any) {
        log("caption failed", video.id, e?.message);
        error = `Caption generation failed: ${e?.message ?? e}`;
        break;
      }
    }

    if (!caption) {
      caption = video.set.defaultCaption;
      captionSource = "default";
      captionFlags = findBanned(caption, blocklist);
      if (!caption) error = (error ? error + "; " : "") + "No AI caption and no default caption set";
    }

    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: "ready",
        transcript: transcript || null,
        transcriptFlags,
        caption,
        captionSource,
        captionFlags,
        error,
      },
    });
    log("processed", video.id, captionSource, transcriptFlags.length ? `AUDIO FLAGS: ${transcriptFlags.join(",")}` : "");
  } catch (e: any) {
    log("processVideo error", video.id, e?.message);
    await prisma.video.update({
      where: { id: video.id },
      data: { status: "failed", error: String(e?.message ?? e) },
    });
  } finally {
    await safeUnlink(audioPath);
  }
}

// ---------------------------------------------------------------------------
// Submit to Zernio (worker)
// ---------------------------------------------------------------------------

function tiktokData(privacyLevel: string) {
  return {
    privacyLevel,
    allowComment: true,
    allowDuet: true,
    allowStitch: true,
    commercialContentType: "none",
    contentPreviewConfirmed: true,
    expressConsentGiven: true,
    mediaType: "video",
  };
}

export async function submitPost(postId: string) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { video: true, set: { include: { accounts: true } } },
  });
  if (!post || post.status !== "approved") return;
  const { video, set } = post;

  const accounts = set.accounts.filter((a) => a.enabled && a.isActive && !a.needsReconnect);
  if (accounts.length === 0) {
    await fail(post.id, "No enabled, connected accounts on this set");
    return;
  }
  if (!video.caption) {
    await fail(post.id, "No caption");
    return;
  }
  if (video.fileDeleted) {
    await fail(post.id, "Video file no longer on disk");
    return;
  }

  await prisma.post.update({ where: { id: post.id }, data: { status: "submitted", error: null, submittedAt: new Date() } });

  try {
    // 1. Upload media (reuse if we already did and it's < 6 days old)
    let mediaUrl = post.zernioMediaUrl;
    const uploadedRecently = post.submittedAt && Date.now() - post.submittedAt.getTime() < 6 * 86_400_000;
    if (!mediaUrl || !uploadedRecently) {
      const mime = zernio.normaliseVideoMime(video.mimeType, video.originalName);
      mediaUrl = await zernio.uploadFile(video.storedPath, path.basename(video.storedPath), mime, video.sizeBytes);
      await prisma.post.update({ where: { id: post.id }, data: { zernioMediaUrl: mediaUrl } });
    }

    // 2. Build targets
    const platforms: zernio.ZPlatformTarget[] = [];
    for (const a of accounts) {
      if (a.platform === "tiktok") {
        let privacy = set.tiktokPrivacyLevel;
        try {
          const info = await zernio.tiktokCreatorInfo(a.zernioAccountId);
          const allowed = info.privacyLevels?.map((p) => p.value) ?? [];
          if (allowed.length && !allowed.includes(privacy)) {
            log(`tiktok ${a.username}: ${privacy} not allowed, using ${allowed[0]}`);
            privacy = allowed[0];
          }
        } catch (e: any) {
          log("creator-info failed", e?.message);
        }
        platforms.push({ platform: "tiktok", accountId: a.zernioAccountId, platformSpecificData: tiktokData(privacy) });
      } else if (a.platform === "facebook") {
        platforms.push({ platform: "facebook", accountId: a.zernioAccountId, platformSpecificData: { contentType: "reel" } });
      } else if (a.platform === "instagram") {
        platforms.push({ platform: "instagram", accountId: a.zernioAccountId, platformSpecificData: { shareToFeed: true } });
      } else {
        platforms.push({ platform: a.platform, accountId: a.zernioAccountId });
      }
    }

    // 3. Create post
    const res = await zernio.createPost(
      {
        content: video.caption,
        mediaItems: [{ type: "video", url: mediaUrl, filename: video.originalName }],
        platforms,
        scheduledFor: post.scheduledAt.toISOString(),
        timezone: "UTC",
        metadata: { localPostId: post.id, setId: set.id },
      },
      randomUUID(),
    );

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "scheduled",
        zernioPostId: res.post._id,
        platformResults: res.post.platforms as any,
        error: res.warnings?.length ? `Warnings: ${res.warnings.join("; ")}` : null,
      },
    });
    log("submitted", post.id, "->", res.post._id);
  } catch (e: any) {
    const msg = e instanceof zernio.ZernioError ? `${e.message} ${JSON.stringify(e.body?.details ?? "")}` : String(e?.message ?? e);
    // 409 = Zernio already has an identical post in the last 24h; treat as scheduled if we can find the id
    if (e instanceof zernio.ZernioError && e.status === 409 && e.body?.details?.existingPostId) {
      await prisma.post.update({
        where: { id: post.id },
        data: { status: "scheduled", zernioPostId: e.body.details.existingPostId, error: "Duplicate detected by Zernio; linked to existing post" },
      });
      return;
    }
    await fail(post.id, msg);
  }
}

async function fail(postId: string, error: string) {
  log("FAILED", postId, error);
  await prisma.post.update({ where: { id: postId }, data: { status: "failed", error } });
}

// ---------------------------------------------------------------------------
// Status sync (webhook + polling fallback)
// ---------------------------------------------------------------------------

const ZSTATUS: Record<string, PostStatus> = {
  scheduled: "scheduled",
  publishing: "publishing",
  published: "published",
  partial: "partial",
  failed: "failed",
  cancelled: "cancelled",
};

export async function applyZernioStatus(zernioPostId: string, status: string, platforms?: unknown, publishedAt?: string | null) {
  const mapped = ZSTATUS[status];
  if (!mapped) return;
  const post = await prisma.post.findUnique({ where: { zernioPostId } });
  if (!post) return;
  // Don't regress a terminal state
  if (post.status === "published" && mapped !== "published") return;
  const errors: string[] = [];
  if (Array.isArray(platforms)) {
    for (const p of platforms as any[]) {
      const err = p?.error ?? p?.errorMessage;
      if (err) errors.push(`${p.platform ?? p.name}: ${typeof err === "string" ? err : JSON.stringify(err)}`);
    }
  }
  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: mapped,
      platformResults: (platforms as any) ?? undefined,
      publishedAt: mapped === "published" ? (publishedAt ? new Date(publishedAt) : new Date()) : undefined,
      error: errors.length ? errors.join(" | ") : mapped === "failed" ? post.error ?? "Publish failed" : null,
    },
  });
}

export async function pollZernioStatuses() {
  const posts = await prisma.post.findMany({
    where: {
      status: { in: ["scheduled", "publishing", "partial"] },
      zernioPostId: { not: null },
      scheduledAt: { lt: new Date(Date.now() + 5 * 60_000) },
    },
    take: 50,
  });
  for (const p of posts) {
    try {
      const { post } = await zernio.getPost(p.zernioPostId!);
      await applyZernioStatus(post._id, post.status, post.platforms, post.platforms.find((x) => x.publishedAt)?.publishedAt ?? null);
    } catch (e: any) {
      log("poll failed", p.id, e?.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function cleanupPublished() {
  const videos = await prisma.video.findMany({
    where: { fileDeleted: false, post: { status: "published" } },
    take: 100,
  });
  for (const v of videos) {
    if (await safeUnlink(v.storedPath)) {
      await prisma.video.update({ where: { id: v.id }, data: { fileDeleted: true } });
      log("deleted file", v.storedPath);
    }
  }
  // Also drop files for cancelled posts
  const cancelled = await prisma.video.findMany({ where: { fileDeleted: false, post: { status: "cancelled" } }, take: 100 });
  for (const v of cancelled) {
    if (await safeUnlink(v.storedPath)) await prisma.video.update({ where: { id: v.id }, data: { fileDeleted: true } });
  }
}

// ---------------------------------------------------------------------------
// Account sync
// ---------------------------------------------------------------------------

export async function syncAccounts(set: AccountSet) {
  if (!set.zernioProfileId) return;
  const { accounts } = await zernio.listAccounts(set.zernioProfileId);
  const seen = new Set<string>();
  for (const a of accounts) {
    seen.add(a._id);
    await prisma.socialAccount.upsert({
      where: { zernioAccountId: a._id },
      update: {
        setId: set.id,
        platform: a.platform,
        username: a.username ?? "",
        displayName: a.displayName ?? "",
        isActive: a.isActive !== false,
        needsReconnect: !!a.needsReconnection,
      },
      create: {
        setId: set.id,
        zernioAccountId: a._id,
        platform: a.platform,
        username: a.username ?? "",
        displayName: a.displayName ?? "",
        isActive: a.isActive !== false,
        needsReconnect: !!a.needsReconnection,
      },
    });
  }
  await prisma.socialAccount.deleteMany({ where: { setId: set.id, zernioAccountId: { notIn: Array.from(seen) } } });
}

export type { Post, Video };
