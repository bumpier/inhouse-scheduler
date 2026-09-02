import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { updateSet, deleteSet, connectAccount, refreshAccounts, toggleAccount, disconnectAccount, linkZernioProfile, reshuffleSet } from "@/app/actions";
import { ConfirmButton } from "../../confirm-button";

const TIMEZONES = ["Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Lisbon", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];
const PLATFORMS = ["instagram", "tiktok", "facebook"];

export default async function SetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ warn?: string; connected?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const set = await prisma.accountSet.findUnique({ where: { id }, include: { accounts: { orderBy: { platform: "asc" } } } });
  if (!set) notFound();

  const update = updateSet.bind(null, set.id);
  const del = deleteSet.bind(null, set.id);
  const refresh = refreshAccounts.bind(null, set.id);
  const link = linkZernioProfile.bind(null, set.id);
  const reshuffle = reshuffleSet.bind(null, set.id);

  return (
    <>
      <p className="small"><Link href="/sets">← Account sets</Link></p>
      <h1>{set.name}</h1>

      {sp.warn === "zernio" && <div className="alert warn">Set created, but the Zernio profile could not be created. Check the API key, then click “Link Zernio profile”.</div>}
      {sp.connected && <div className="alert ok">Connected {sp.connected}.</div>}
      {sp.error && <div className="alert danger">Connection failed: {sp.error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Connected accounts</h2>
        {!set.zernioProfileId ? (
          <form action={link}><button type="submit" className="primary">Link Zernio profile</button></form>
        ) : (
          <>
            <table>
              <thead><tr><th>Platform</th><th>Account</th><th>Status</th><th>Use</th><th></th></tr></thead>
              <tbody>
                {set.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.platform}</td>
                    <td>@{a.username} <span className="muted small">{a.displayName}</span></td>
                    <td>
                      {a.needsReconnect ? <span className="badge danger">needs reconnect</span> : a.isActive ? <span className="badge ok">connected</span> : <span className="badge danger">inactive</span>}
                    </td>
                    <td>
                      <form action={toggleAccount.bind(null, a.id, !a.enabled)}>
                        <button type="submit" className="sm">{a.enabled ? "Enabled" : "Disabled"}</button>
                      </form>
                    </td>
                    <td>
                      <ConfirmButton action={disconnectAccount.bind(null, a.id)} label="Disconnect" confirm={`Disconnect @${a.username} from Zernio?`} className="sm danger" />
                    </td>
                  </tr>
                ))}
                {set.accounts.length === 0 && <tr><td colSpan={5} className="muted">No accounts connected yet.</td></tr>}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 12 }}>
              {PLATFORMS.map((p) => (
                <form key={p} action={connectAccount.bind(null, set.id, p)}>
                  <button type="submit">+ Connect {p}</button>
                </form>
              ))}
              <form action={refresh} className="right"><button type="submit" className="sm">Refresh from Zernio</button></form>
            </div>
            <div className="hint">Instagram must be a Business or Creator account. Facebook must be a Page you admin. After authorising you'll be sent back here.</div>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Settings</h2>
        <form action={update}>
          <div className="grid2">
            <div className="field"><label>Name</label><input type="text" name="name" defaultValue={set.name} required /></div>
            <div className="field"><label>Timezone</label>
              <select name="timezone" defaultValue={set.timezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>
            </div>
            <div className="field"><label>Posting window start</label><input type="time" name="windowStart" defaultValue={set.windowStart} /></div>
            <div className="field"><label>Posting window end</label><input type="time" name="windowEnd" defaultValue={set.windowEnd} /></div>
            <div className="field"><label>Posts per day</label><input type="number" name="postsPerDay" min={1} max={20} defaultValue={set.postsPerDay} /></div>
            <div className="field"><label>TikTok privacy level</label>
              <select name="tiktokPrivacyLevel" defaultValue={set.tiktokPrivacyLevel}>
                {["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].map((v) => <option key={v}>{v}</option>)}
              </select>
              <div className="hint">If TikTok doesn't allow this level for the account, the first allowed level is used and logged.</div>
            </div>
          </div>
          <div className="field"><label>Caption guidance (what to talk about, tone, brand voice)</label>
            <textarea name="captionPrompt" defaultValue={set.captionPrompt} placeholder="e.g. Friendly, confident wellness brand. Talk about feeling energised, daily routines, self-care. British spelling. No emojis." />
          </div>
          <div className="field"><label>Default caption (used when AI caption fails or is blocked)</label>
            <textarea name="defaultCaption" defaultValue={set.defaultCaption} placeholder="Your new routine starts here.&#10;#wellness #selfcare #dailyroutine" />
          </div>
          <div className="field"><label>Extra banned words for this set (one per line)</label>
            <textarea name="extraBannedWords" defaultValue={set.extraBannedWords} />
          </div>
          <div className="field">
            <label><input type="checkbox" name="active" defaultChecked={set.active} /> Active (uncheck to pause submissions for this set)</label>
          </div>
          <div className="row">
            <button type="submit" className="primary">Save</button>
            <span className="muted small">Changes to window / rate only affect newly uploaded videos. Use “Reshuffle” to re-pick times for anything not yet sent to Zernio.</span>
          </div>
        </form>
      </div>

      <div className="card row">
        <form action={reshuffle}><button type="submit">Reshuffle unsent slots</button></form>
        <div className="right">
          <ConfirmButton action={del} label="Delete set" confirm={`Delete "${set.name}" and all its queued videos? Scheduled posts at Zernio will be cancelled.`} className="danger" />
        </div>
      </div>
    </>
  );
}
