/** Zernio webhook receiver. Verifies X-Zernio-Signature (HMAC-SHA256 of raw body). */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { applyZernioStatus } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = env.zernioWebhookSecret;
  if (secret) {
    const sig = req.headers.get("x-zernio-signature") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const event: string = body?.event ?? "";
  const post = body?.post;
  if (event.startsWith("post.") && post?.id) {
    // For per-platform events, the post-level status may be unchanged; still record platform results.
    await applyZernioStatus(post.id, post.status, post.platforms, post.publishedAt ?? null).catch((e) => console.error("[webhook]", e?.message));
  }
  return NextResponse.json({ ok: true });
}
