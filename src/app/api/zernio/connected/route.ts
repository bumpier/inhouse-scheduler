/** Zernio redirects here after OAuth: ?setId=..&connected=platform&accountId=..&username=.. or ?error=.. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncAccounts } from "@/lib/pipeline";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const setId = q.get("setId") ?? "";
  const set = await prisma.accountSet.findUnique({ where: { id: setId } });
  if (!set) return NextResponse.redirect(`${env.appUrl}/sets`);
  const error = q.get("error");
  if (!error) {
    try {
      await syncAccounts(set);
    } catch (e: any) {
      console.error("[connected] sync failed", e?.message);
    }
  }
  const dest = new URL(`${env.appUrl}/sets/${set.id}`);
  if (error) dest.searchParams.set("error", error);
  else dest.searchParams.set("connected", q.get("connected") ?? "account");
  return NextResponse.redirect(dest);
}
