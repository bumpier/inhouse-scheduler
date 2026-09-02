import { prisma } from "@/lib/db";
import { ReviewTable, type ReviewRow } from "./review-table";
import { DateTime } from "luxon";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const { set: setFilter } = await searchParams;
  const sets = await prisma.accountSet.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const posts = await prisma.post.findMany({
    where: { status: "pending_review", ...(setFilter ? { setId: setFilter } : {}) },
    include: { video: true, set: { select: { id: true, name: true, timezone: true, defaultCaption: true } } },
    orderBy: [{ set: { name: "asc" } }, { scheduledAt: "asc" }],
  });

  const rows: ReviewRow[] = posts.map((p) => ({
    id: p.id,
    setId: p.set.id,
    setName: p.set.name,
    timezone: p.set.timezone,
    videoId: p.video.id,
    fileName: p.video.originalName,
    videoStatus: p.video.status,
    caption: p.video.caption ?? "",
    captionSource: p.video.captionSource,
    captionFlags: p.video.captionFlags,
    transcriptFlags: p.video.transcriptFlags,
    transcript: p.video.transcript ?? "",
    error: p.video.error,
    scheduledAtIso: p.scheduledAt.toISOString(),
    scheduledLocal: DateTime.fromJSDate(p.scheduledAt, { zone: p.set.timezone }).toFormat("yyyy-LL-dd'T'HH:mm"),
    scheduledPretty: DateTime.fromJSDate(p.scheduledAt, { zone: p.set.timezone }).toFormat("ccc d LLL HH:mm"),
  }));

  return (
    <>
      <h1>Review</h1>
      <p className="muted">Everything here is waiting for approval. Approved posts are handed to Zernio a few days before their slot. Rows in red have a caption that hit the banned list and must be edited. Yellow means the video's <em>audio</em> mentioned a banned term — the caption is clean but the video itself may be the risk.</p>
      <ReviewTable rows={rows} sets={sets} activeSet={setFilter ?? ""} />
    </>
  );
}
