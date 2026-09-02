/** Streams a stored video to the browser for preview (supports range requests). */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new NextResponse("Unauthorised", { status: 401 });
  const { id } = await params;
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.fileDeleted) return new NextResponse("Not found", { status: 404 });
  let size: number;
  try {
    size = (await stat(video.storedPath)).size;
  } catch {
    return new NextResponse("File missing", { status: 404 });
  }
  const range = req.headers.get("range");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Number(m[2]);
      end = Math.min(end, size - 1);
      status = 206;
    }
  }
  const stream = createReadStream(video.storedPath, { start, end });
  return new NextResponse(Readable.toWeb(stream) as any, {
    status,
    headers: {
      "Content-Type": video.mimeType,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
