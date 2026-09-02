import { prisma } from "@/lib/db";
import { DateTime } from "luxon";
import { cancelPost, retryPost } from "@/app/actions";
import { ConfirmButton } from "../confirm-button";
import Link from "next/link";

const BADGE: Record<string, string> = {
  pending_review: "",
  approved: "info",
  submitted: "info",
  scheduled: "ok",
  publishing: "info",
  published: "ok",
  partial: "warn",
  failed: "danger",
  cancelled: "",
};

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ set?: string; show?: string }> }) {
  const { set: setFilter, show } = await searchParams;
  const showAll = show === "all";
  const sets = await prisma.accountSet.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const posts = await prisma.post.findMany({
    where: {
      ...(setFilter ? { setId: setFilter } : {}),
      ...(showAll ? {} : { status: { notIn: ["cancelled"] }, OR: [{ status: { not: "published" } }, { publishedAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }] }),
    },
    include: { video: { select: { originalName: true, caption: true } }, set: { select: { name: true, timezone: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });

  const counts = posts.reduce<Record<string, number>>((acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc), {});

  return (
    <>
      <h1>Schedule</h1>
      <div className="card row">
        <form className="row" method="get">
          <select name="set" defaultValue={setFilter ?? ""} style={{ width: 240 }}>
            <option value="">All sets</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label style={{ margin: 0 }}><input type="checkbox" name="show" value="all" defaultChecked={showAll} /> include old published + cancelled</label>
          <button type="submit" className="sm">Filter</button>
        </form>
        <div className="right row small">
          {Object.entries(counts).map(([k, v]) => <span key={k} className={`badge ${BADGE[k]}`}>{k.replace("_", " ")}: {v}</span>)}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>When</th><th>Set</th><th>Video</th><th>Caption</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {posts.map((p) => {
              const results = Array.isArray(p.platformResults) ? (p.platformResults as any[]) : [];
              return (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {DateTime.fromJSDate(p.scheduledAt, { zone: p.set.timezone }).toFormat("ccc d LLL HH:mm")}
                    <div className="small muted">{p.set.timezone}</div>
                  </td>
                  <td>{p.set.name}</td>
                  <td className="small" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.video.originalName}>{p.video.originalName}</td>
                  <td className="small" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{p.video.caption}</td>
                  <td>
                    <span className={`badge ${BADGE[p.status] ?? ""}`}>{p.status.replace("_", " ")}</span>
                    {results.map((r, i) => (
                      <div key={i} className="small" style={{ marginTop: 2 }}>
                        {r.platform}: {r.status}
                        {(r.platformPostUrl || r.publishedUrl) && <> · <a href={r.platformPostUrl ?? r.publishedUrl} target="_blank" rel="noreferrer">view</a></>}
                      </div>
                    ))}
                    {p.error && <div className="small" style={{ color: "var(--danger)", marginTop: 4, maxWidth: 300 }}>{p.error}</div>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {p.status === "pending_review" && <Link href={`/review?set=${p.setId}`} className="btn sm">Review</Link>}
                      {["failed", "partial"].includes(p.status) && (
                        <form action={retryPost.bind(null, p.id)}><button className="sm" type="submit">Retry</button></form>
                      )}
                      {!["published", "cancelled", "publishing"].includes(p.status) && (
                        <ConfirmButton action={cancelPost.bind(null, p.id)} label="Cancel" confirm="Cancel this post? If it's already at Zernio it will be removed there too." className="sm danger" />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {posts.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 24 }}>Nothing scheduled.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
