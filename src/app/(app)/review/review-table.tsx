"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePosts, updateCaption, updateSlot, regenerateCaption, cancelPost } from "@/app/actions";
import { DateTime } from "luxon";

export type ReviewRow = {
  id: string;
  setId: string;
  setName: string;
  timezone: string;
  videoId: string;
  fileName: string;
  videoStatus: string;
  caption: string;
  captionSource: string | null;
  captionFlags: string[];
  transcriptFlags: string[];
  transcript: string;
  error: string | null;
  scheduledAtIso: string;
  scheduledLocal: string;
  scheduledPretty: string;
};

export function ReviewTable({ rows, sets, activeSet }: { rows: ReviewRow[]; sets: { id: string; name: string }[]; activeSet: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState<string | null>(null);

  const approvable = useMemo(() => rows.filter((r) => r.videoStatus === "ready" && r.caption && r.captionFlags.length === 0), [rows]);
  const processing = rows.filter((r) => r.videoStatus === "uploaded" || r.videoStatus === "processing").length;

  function approve(ids: string[]) {
    start(async () => {
      const r = await approvePosts(ids);
      setMsg(`Approved ${r?.approved ?? 0}${r?.skipped ? `, skipped ${r.skipped} (not ready or flagged)` : ""}.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <>
      <div className="card row">
        <select value={activeSet} onChange={(e) => router.push(e.target.value ? `/review?set=${e.target.value}` : "/review")} style={{ width: 260 }}>
          <option value="">All sets</option>
          {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {processing > 0 && <span className="badge info">{processing} still generating captions</span>}
        <button className="sm" onClick={() => router.refresh()}>Refresh</button>
        <div className="right row">
          <button disabled={pending || selected.size === 0} onClick={() => approve(Array.from(selected))}>Approve selected ({selected.size})</button>
          <button className="primary" disabled={pending || approvable.length === 0} onClick={() => approve(approvable.map((r) => r.id))}>Approve all clean ({approvable.length})</button>
        </div>
      </div>
      {msg && <div className="alert ok">{msg}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input type="checkbox" checked={selected.size > 0 && selected.size === approvable.length} onChange={(e) => setSelected(e.target.checked ? new Set(approvable.map((r) => r.id)) : new Set())} />
              </th>
              <th style={{ width: 90 }}>Video</th>
              <th style={{ width: 150 }}>Set</th>
              <th>Caption</th>
              <th style={{ width: 190 }}>Slot</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} r={r} checked={selected.has(r.id)} onCheck={(v) => setSelected((s) => { const n = new Set(s); v ? n.add(r.id) : n.delete(r.id); return n; })} onTranscript={() => setShowTranscript(r.transcript || "(no speech detected)")} />
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 24 }}>Nothing waiting for review.</td></tr>}
          </tbody>
        </table>
      </div>

      {showTranscript !== null && (
        <div className="card" style={{ position: "fixed", right: 24, bottom: 24, width: 420, maxHeight: "60vh", overflow: "auto", boxShadow: "0 8px 30px rgba(0,0,0,.15)" }}>
          <div className="row"><b>Transcript</b><button className="sm right" onClick={() => setShowTranscript(null)}>Close</button></div>
          <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }} className="small">{showTranscript}</p>
        </div>
      )}
    </>
  );
}

function Row({ r, checked, onCheck, onTranscript }: { r: ReviewRow; checked: boolean; onCheck: (v: boolean) => void; onTranscript: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [caption, setCaption] = useState(r.caption);
  const [slot, setSlot] = useState(r.scheduledLocal);
  const dirty = caption !== r.caption;
  const slotDirty = slot !== r.scheduledLocal;
  const ready = r.videoStatus === "ready";
  const cls = r.captionFlags.length ? "flagged" : r.transcriptFlags.length ? "warned" : "";

  function saveCaption() {
    start(async () => { await updateCaption(r.id, caption); router.refresh(); });
  }
  function saveSlot() {
    const iso = DateTime.fromFormat(slot, "yyyy-LL-dd'T'HH:mm", { zone: r.timezone }).toUTC().toISO();
    if (!iso) return;
    start(async () => { await updateSlot(r.id, iso); router.refresh(); });
  }

  return (
    <tr className={cls}>
      <td><input type="checkbox" checked={checked} disabled={!ready || r.captionFlags.length > 0 || !r.caption} onChange={(e) => onCheck(e.target.checked)} /></td>
      <td>
        <video className="thumb" src={`/api/video/${r.videoId}`} preload="metadata" muted controls={false} onClick={(e) => { const v = e.currentTarget; v.controls = true; v.play(); }} />
        <div className="small muted" style={{ maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.fileName}>{r.fileName}</div>
      </td>
      <td>
        <div><b>{r.setName}</b></div>
        {!ready && <span className="badge info">{r.videoStatus === "failed" ? "processing failed" : "generating…"}</span>}
        {r.captionSource === "default" && <span className="badge warn">default caption</span>}
        {r.captionSource === "manual" && <span className="badge">edited</span>}
        {r.transcriptFlags.length > 0 && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>audio mentions: {r.transcriptFlags.join(", ")}</div>}
        {r.captionFlags.length > 0 && <div className="small" style={{ color: "var(--danger)", marginTop: 4 }}>caption contains: {r.captionFlags.join(", ")}</div>}
        {r.error && <div className="small muted" style={{ marginTop: 4 }}>{r.error}</div>}
        <button className="sm" style={{ marginTop: 6 }} onClick={onTranscript}>Transcript</button>
      </td>
      <td>
        <textarea className="caption-edit" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!ready} />
        {dirty && <button className="sm primary" disabled={pending} onClick={saveCaption}>Save caption</button>}
      </td>
      <td>
        <input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />
        <div className="small muted">{r.timezone}</div>
        {slotDirty && <button className="sm primary" disabled={pending} onClick={saveSlot}>Save time</button>}
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          <button className="sm" disabled={pending || !ready} onClick={() => start(async () => { await regenerateCaption(r.id); router.refresh(); })}>Regenerate</button>
          <button className="sm danger" disabled={pending} onClick={() => { if (confirm("Remove this video from the queue?")) start(async () => { await cancelPost(r.id); router.refresh(); }); }}>Remove</button>
        </div>
      </td>
    </tr>
  );
}
