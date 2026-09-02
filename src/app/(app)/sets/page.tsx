import Link from "next/link";
import { prisma } from "@/lib/db";
import { createSet } from "@/app/actions";

export default async function SetsPage() {
  const sets = await prisma.accountSet.findMany({
    orderBy: { name: "asc" },
    include: {
      accounts: true,
      _count: { select: { posts: { where: { status: { in: ["pending_review", "approved", "scheduled", "submitted"] } } } } },
    },
  });
  return (
    <>
      <h1>Account sets</h1>
      <div className="card">
        <form action={createSet} className="row">
          <div style={{ flex: 1 }}>
            <input type="text" name="name" placeholder="New set name, e.g. Shifa Global" required />
          </div>
          <button className="primary" type="submit">Create set</button>
        </form>
        <div className="hint">Creates a matching profile in Zernio. Connect Instagram / TikTok / Facebook on the next screen.</div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Accounts</th>
              <th>Rate</th>
              <th>Window</th>
              <th>Queued</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sets.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/sets/${s.id}`}><b>{s.name}</b></Link>
                  {!s.active && <span className="badge" style={{ marginLeft: 8 }}>paused</span>}
                </td>
                <td>
                  {s.accounts.length === 0 && <span className="badge warn">none connected</span>}
                  {s.accounts.map((a) => (
                    <span key={a.id} className={`badge ${a.needsReconnect || !a.isActive ? "danger" : a.enabled ? "ok" : ""}`} style={{ marginRight: 4 }}>
                      {a.platform}
                    </span>
                  ))}
                </td>
                <td>{s.postsPerDay}/day</td>
                <td>{s.windowStart}–{s.windowEnd} <span className="muted small">{s.timezone}</span></td>
                <td>{s._count.posts}</td>
                <td><Link href={`/upload?set=${s.id}`}>Upload</Link></td>
              </tr>
            ))}
            {sets.length === 0 && (
              <tr><td colSpan={6} className="muted">No sets yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
