import { prisma } from "@/lib/db";
import { getGlobalBlocklistRaw } from "@/lib/settings";
import { saveBlocklist, createUser, deleteUser } from "@/app/actions";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { ConfirmButton } from "../confirm-button";

export default async function SettingsPage() {
  const session = await requireSession();
  const [blocklist, users] = await Promise.all([getGlobalBlocklistRaw(), prisma.user.findMany({ orderBy: { email: "asc" } })]);
  const zernioOk = !!process.env.ZERNIO_API_KEY;
  const openaiOk = !!process.env.OPENAI_API_KEY;
  const webhookOk = !!process.env.ZERNIO_WEBHOOK_SECRET;

  return (
    <>
      <h1>Settings</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Integration status</h2>
        <div className="kv">
          <span>Zernio API key</span><span>{zernioOk ? <span className="badge ok">set</span> : <span className="badge danger">missing</span>}</span>
          <span>OpenAI API key</span><span>{openaiOk ? <span className="badge ok">set</span> : <span className="badge danger">missing</span>}</span>
          <span>Webhook secret</span><span>{webhookOk ? <span className="badge ok">set</span> : <span className="badge warn">not set — status will be polled instead</span>}</span>
          <span>Webhook URL</span><span><code>{env.appUrl}/api/zernio/webhook</code> <span className="muted small">(add this in Zernio → Webhooks, events: post.*)</span></span>
          <span>Submit lead</span><span>{env.submitLeadDays} days before slot</span>
          <span>Min gap</span><span>{env.minGapMinutes} minutes</span>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>Keys live in the server's <code>.env</code> file, not here.</div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Global banned words</h2>
        <form action={saveBlocklist}>
          <textarea name="blocklist" defaultValue={blocklist} style={{ minHeight: 220, fontFamily: "monospace" }} />
          <div className="hint">One per line. Matching is case-insensitive and catches spacing, punctuation and number-for-letter tricks. Applied to generated captions (hard block) and to video audio (warning).</div>
          <button type="submit" className="primary" style={{ marginTop: 8 }}>Save</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Users</h2>
        <table>
          <thead><tr><th>Email</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === session.uid && <span className="muted small"> (you)</span>}</td>
                <td>{u.id !== session.uid && users.length > 1 && <ConfirmButton action={deleteUser.bind(null, u.id)} label="Remove" confirm={`Remove ${u.email}?`} className="sm danger" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={createUser} className="row" style={{ marginTop: 12 }}>
          <div style={{ flex: 1 }}><input type="email" name="email" placeholder="email" required /></div>
          <div style={{ flex: 1 }}><input type="password" name="password" placeholder="password (min 8)" minLength={8} required /></div>
          <button type="submit">Add / reset password</button>
        </form>
      </div>
    </>
  );
}
