/**
 * Raw-body upload: POST /api/upload?set=<id>&name=<filename>
 * Body is the video bytes. Streamed to disk while hashing; never buffered in memory.
 */
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { setDir, safeName, safeUnlink } from "@/lib/files";
import { assignSlots } from "@/lib/pipeline";
import { formatLocal } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB (Instagram caps reels at 300 MB anyway)

export async function POST(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const setId = req.nextUrl.searchParams.get("set") ?? "";
  const originalName = req.nextUrl.searchParams.get("name") ?? "video.mp4";
  const mime = req.headers.get("content-type") ?? "application/octet-stream";
  if (!mime.startsWith("video/") && mime !== "application/octet-stream") return NextResponse.json({ error: "Not a video" }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const set = await prisma.accountSet.findUnique({ where: { id: setId } });
  if (!set) return NextResponse.json({ error: "Unknown set" }, { status: 404 });

  const dir = await setDir(set.id);
  const ext = path.extname(originalName) || ".mp4";
  const storedPath = path.join(dir, `${randomUUID()}${ext}`);
  const hash = createHash("sha256");
  let size = 0;

  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(new Error("File too large"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as any), counter, createWriteStream(storedPath));
  } catch (e: any) {
    await safeUnlink(storedPath);
    return NextResponse.json({ error: e?.message ?? "Upload failed" }, { status: 400 });
  }
  if (size === 0) {
    await safeUnlink(storedPath);
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  const sha256 = hash.digest("hex");
  const dupe = await prisma.video.findUnique({ where: { setId_sha256: { setId: set.id, sha256 } } });
  if (dupe) {
    await safeUnlink(storedPath);
    return NextResponse.json({ error: "Already uploaded to this set" }, { status: 409 });
  }

  const [slot] = await assignSlots(set, 1);
  const video = await prisma.video.create({
    data: {
      setId: set.id,
      originalName: safeName(originalName),
      storedPath,
      mimeType: mime === "application/octet-stream" ? "video/mp4" : mime,
      sizeBytes: size,
      sha256,
      post: { create: { setId: set.id, scheduledAt: slot } },
    },
  });

  return NextResponse.json({ id: video.id, slot: formatLocal(slot, set.timezone) });
}
