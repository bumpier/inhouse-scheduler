/**
 * Background worker. Runs forever, looping every 30s:
 *  - captions newly uploaded videos
 *  - hands approved posts to Zernio once they're within SUBMIT_LEAD_DAYS of their slot
 *  - polls Zernio for status (fallback if webhooks aren't configured)
 *  - deletes video files once published
 */
import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { processVideo, submitPost, pollZernioStatuses, cleanupPublished } from "../lib/pipeline";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...a);
const INTERVAL_MS = 30_000;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    // 1. Captions — process a few at a time so one big batch doesn't starve submissions
    const pending = await prisma.video.findMany({ where: { status: "uploaded" }, orderBy: { createdAt: "asc" }, take: 5 });
    for (const v of pending) await processVideo(v.id);

    // 2. Submit approved posts that are due to go to Zernio
    const cutoff = new Date(Date.now() + env.submitLeadDays * 86_400_000);
    const due = await prisma.post.findMany({
      where: { status: "approved", scheduledAt: { lte: cutoff }, video: { status: "ready" } },
      orderBy: { scheduledAt: "asc" },
      take: 20,
    });
    for (const p of due) await submitPost(p.id);

    // 3. Status polling fallback
    await pollZernioStatuses();

    // 4. Cleanup
    await cleanupPublished();
  } catch (e: any) {
    log("tick error", e?.message ?? e);
  } finally {
    running = false;
  }
}

async function main() {
  log("starting; submit lead days =", env.submitLeadDays);
  await tick();
  setInterval(tick, INTERVAL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
