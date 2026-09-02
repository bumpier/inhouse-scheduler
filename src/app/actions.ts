"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession, hashPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import * as zernio from "@/lib/zernio";
import { syncAccounts, assignSlots, existingSlots } from "@/lib/pipeline";
import { setSetting, KEYS, getBlocklistForSet } from "@/lib/settings";
import { findBanned } from "@/lib/blocklist";
import { pickSlots } from "@/lib/scheduler";
import { safeUnlink } from "@/lib/files";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, d: number) => {
  const n = Number(fd.get(k));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

// ---------------------------------------------------------------------------
// Account sets
// ---------------------------------------------------------------------------

export async function createSet(fd: FormData) {
  await requireSession();
  const name = str(fd, "name");
  if (!name) return;
  let zernioProfileId: string | null = null;
  try {
    const { profile } = await zernio.createProfile(name);
    zernioProfileId = profile._id;
  } catch (e: any) {
    console.error("[sets] zernio profile create failed", e?.message);
  }
  const set = await prisma.accountSet.create({ data: { name, zernioProfileId } });
  redirect(`/sets/${set.id}${zernioProfileId ? "" : "?warn=zernio"}`);
}

export async function updateSet(id: string, fd: FormData) {
  await requireSession();
  await prisma.accountSet.update({
    where: { id },
    data: {
      name: str(fd, "name") || undefined,
      timezone: str(fd, "timezone") || "Europe/London",
      windowStart: str(fd, "windowStart") || "09:00",
      windowEnd: str(fd, "windowEnd") || "21:00",
      postsPerDay: num(fd, "postsPerDay", 2),
      captionPrompt: str(fd, "captionPrompt"),
      defaultCaption: str(fd, "defaultCaption"),
      extraBannedWords: str(fd, "extraBannedWords"),
      tiktokPrivacyLevel: str(fd, "tiktokPrivacyLevel") || "PUBLIC_TO_EVERYONE",
      active: fd.get("active") === "on",
    },
  });
  revalidatePath(`/sets/${id}`);
  revalidatePath("/sets");
}

export async function deleteSet(id: string) {
  await requireSession();
  const set = await prisma.accountSet.findUnique({ where: { id }, include: { videos: true, posts: true } });
  if (!set) return;
  // Cancel anything already at Zernio
  for (const p of set.posts) {
    if (p.zernioPostId && ["scheduled", "submitted"].includes(p.status)) {
      try {
        await zernio.deletePost(p.zernioPostId);
      } catch {}
    }
  }
  for (const v of set.videos) if (!v.fileDeleted) await safeUnlink(v.storedPath);
  await prisma.accountSet.delete({ where: { id } });
  redirect("/sets");
}

export async function linkZernioProfile(id: string) {
  await requireSession();
  const set = await prisma.accountSet.findUnique({ where: { id } });
  if (!set || set.zernioProfileId) return;
  const { profile } = await zernio.createProfile(set.name);
  await prisma.accountSet.update({ where: { id }, data: { zernioProfileId: profile._id } });
  revalidatePath(`/sets/${id}`);
}

export async function connectAccount(setId: string, platform: string) {
  await requireSession();
  const set = await prisma.accountSet.findUnique({ where: { id: setId } });
  if (!set?.zernioProfileId) return;
  const redirectUrl = `${env.appUrl}/api/zernio/connected?setId=${setId}`;
  const { authUrl } = await zernio.getConnectUrl(platform, set.zernioProfileId, redirectUrl);
  redirect(authUrl);
}

export async function refreshAccounts(setId: string) {
  await requireSession();
  const set = await prisma.accountSet.findUnique({ where: { id: setId } });
  if (!set) return;
  await syncAccounts(set);
  revalidatePath(`/sets/${setId}`);
}

export async function toggleAccount(accountId: string, enabled: boolean) {
  await requireSession();
  const a = await prisma.socialAccount.update({ where: { id: accountId }, data: { enabled } });
  revalidatePath(`/sets/${a.setId}`);
}

export async function disconnectAccount(accountId: string) {
  await requireSession();
  const a = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!a) return;
  try {
    await zernio.deleteAccount(a.zernioAccountId);
  } catch (e: any) {
    console.error("[accounts] zernio delete failed", e?.message);
  }
  await prisma.socialAccount.delete({ where: { id: accountId } });
  revalidatePath(`/sets/${a.setId}`);
}

// ---------------------------------------------------------------------------
// Review / posts
// ---------------------------------------------------------------------------

export async function updateCaption(postId: string, caption: string) {
  await requireSession();
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { video: true, set: true } });
  if (!post) return;
  const blocklist = await getBlocklistForSet(post.set.extraBannedWords);
  await prisma.video.update({
    where: { id: post.videoId },
    data: { caption: caption.trim(), captionSource: "manual", captionFlags: findBanned(caption, blocklist) },
  });
  revalidatePath("/review");
}

export async function updateSlot(postId: string, isoLocal: string) {
  await requireSession();
  const d = new Date(isoLocal);
  if (Number.isNaN(d.getTime())) return;
  await prisma.post.update({ where: { id: postId }, data: { scheduledAt: d } });
  revalidatePath("/review");
  revalidatePath("/schedule");
}

export async function approvePosts(postIds: string[]) {
  await requireSession();
  // Only approve rows that are ready and whose caption is clean
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds }, status: "pending_review" },
    include: { video: true },
  });
  const ok = posts.filter((p) => p.video.status === "ready" && p.video.caption && p.video.captionFlags.length === 0).map((p) => p.id);
  if (ok.length) await prisma.post.updateMany({ where: { id: { in: ok } }, data: { status: "approved" } });
  revalidatePath("/review");
  revalidatePath("/schedule");
  return { approved: ok.length, skipped: postIds.length - ok.length };
}

export async function regenerateCaption(postId: string) {
  await requireSession();
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return;
  await prisma.video.update({ where: { id: post.videoId }, data: { status: "uploaded", caption: null, captionFlags: [], error: null } });
  revalidatePath("/review");
}

export async function cancelPost(postId: string) {
  await requireSession();
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return;
  if (post.zernioPostId && ["scheduled", "submitted", "publishing"].includes(post.status)) {
    try {
      await zernio.deletePost(post.zernioPostId);
    } catch (e: any) {
      console.error("[posts] zernio delete failed", e?.message);
    }
  }
  await prisma.post.update({ where: { id: postId }, data: { status: "cancelled" } });
  revalidatePath("/review");
  revalidatePath("/schedule");
}

export async function retryPost(postId: string) {
  await requireSession();
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { video: true, set: true } });
  if (!post) return;
  // If the slot is in the past, give it a fresh one
  let scheduledAt = post.scheduledAt;
  if (scheduledAt.getTime() < Date.now() + 15 * 60_000) {
    const [slot] = await assignSlots(post.set, 1);
    if (slot) scheduledAt = slot;
  }
  if (post.zernioPostId) {
    try {
      await zernio.retryPost(post.zernioPostId);
      await prisma.post.update({ where: { id: postId }, data: { status: "scheduled", error: null, scheduledAt } });
      revalidatePath("/schedule");
      return;
    } catch {
      /* fall through to a fresh submission */
    }
  }
  await prisma.post.update({ where: { id: postId }, data: { status: "approved", error: null, zernioPostId: null, scheduledAt } });
  revalidatePath("/schedule");
}

/** Re-pick random slots for every post in a set that hasn't gone to Zernio yet. */
export async function reshuffleSet(setId: string) {
  await requireSession();
  const set = await prisma.accountSet.findUnique({ where: { id: setId } });
  if (!set) return;
  const posts = await prisma.post.findMany({
    where: { setId, status: { in: ["pending_review", "approved"] } },
    orderBy: { createdAt: "asc" },
  });
  const locked = (await prisma.post.findMany({
    where: { setId, status: { in: ["submitted", "scheduled", "publishing", "published", "partial"] } },
    select: { scheduledAt: true },
  })).map((p) => p.scheduledAt);
  const slots = pickSlots(posts.length, locked, {
    timezone: set.timezone,
    windowStart: set.windowStart,
    windowEnd: set.windowEnd,
    postsPerDay: set.postsPerDay,
    minGapMinutes: env.minGapMinutes,
  });
  await prisma.$transaction(posts.map((p, i) => prisma.post.update({ where: { id: p.id }, data: { scheduledAt: slots[i] } })));
  revalidatePath("/review");
  revalidatePath("/schedule");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function saveBlocklist(fd: FormData) {
  await requireSession();
  await setSetting(KEYS.blocklist, str(fd, "blocklist"));
  revalidatePath("/settings");
}

export async function createUser(fd: FormData) {
  await requireSession();
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  if (!email || password.length < 8) return;
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await hashPassword(password) },
    create: { email, passwordHash: await hashPassword(password) },
  });
  revalidatePath("/settings");
}

export async function deleteUser(id: string) {
  const s = await requireSession();
  if (s.uid === id) return;
  if ((await prisma.user.count()) <= 1) return;
  await prisma.user.delete({ where: { id } });
  revalidatePath("/settings");
}

export async function slotPreview(setId: string) {
  await requireSession();
  return existingSlots(setId);
}
