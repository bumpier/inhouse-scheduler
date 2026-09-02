"use client";
import { useRef, useState } from "react";
import Link from "next/link";

type SetOpt = { id: string; name: string; postsPerDay: number; accounts: number };
type Item = { file: File; progress: number; status: "queued" | "uploading" | "done" | "error"; message?: string; slot?: string };

const ACCEPT = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/x-msvideo", "video/mpeg"];

export function Uploader({ sets, initialSet }: { sets: SetOpt[]; initialSet?: string }) {
  const [setId, setSetId] = useState(initialSet && sets.some((s) => s.id === initialSet) ? initialSet : sets[0].id);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = items.some((i) => i.status === "uploading" || i.status === "queued");
  const current = sets.find((s) => s.id === setId)!;

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => ACCEPT.includes(f.type) || /\.(mp4|mov|webm|m4v|avi|mpeg|mpg)$/i.test(f.name));
    const next = files.map<Item>((file) => ({ file, progress: 0, status: "queued" }));
    setItems((prev) => [...prev, ...next]);
    void run(next);
  }

  async function run(queue: Item[]) {
    // Upload sequentially so one big drop doesn't open 30 parallel streams.
    for (const it of queue) {
      await uploadOne(it);
    }
  }

  function patch(file: File, p: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.file === file ? { ...i, ...p } : i)));
  }

  function uploadOne(it: Item) {
    return new Promise<void>((resolve) => {
      patch(it.file, { status: "uploading" });
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload?set=${encodeURIComponent(setId)}&name=${encodeURIComponent(it.file.name)}`);
      xhr.setRequestHeader("Content-Type", it.file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) patch(it.file, { progress: Math.round((e.loaded / e.total) * 100) });
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) patch(it.file, { status: "done", progress: 100, slot: body.slot });
          else patch(it.file, { status: "error", message: body.error ?? `HTTP ${xhr.status}` });
        } catch {
          patch(it.file, { status: "error", message: `HTTP ${xhr.status}` });
        }
        resolve();
      };
      xhr.onerror = () => {
        patch(it.file, { status: "error", message: "Network error" });
        resolve();
      };
      xhr.send(it.file);
    });
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <div style={{ minWidth: 280 }}>
            <label>Account set</label>
            <select value={setId} onChange={(e) => setSetId(e.target.value)} disabled={busy}>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.postsPerDay}/day</option>
              ))}
            </select>
          </div>
          {current.accounts === 0 && <div className="alert warn" style={{ margin: 0 }}>This set has no connected accounts. Videos will queue but can't be posted until you connect some.</div>}
        </div>
      </div>

      <div
        className={`dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <div style={{ fontSize: 16, marginBottom: 4 }}>Drop videos here for <b>{current.name}</b></div>
        <div className="small">or click to choose · MP4 / MOV / WebM · each video gets a random slot in the set's window</div>
        <input ref={inputRef} type="file" accept="video/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>

      {items.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <table>
            <thead><tr><th>File</th><th style={{ width: 200 }}>Progress</th><th>Result</th></tr></thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx}>
                  <td>{i.file.name} <span className="muted small">{(i.file.size / 1048576).toFixed(1)} MB</span></td>
                  <td><div className="progress"><div style={{ width: `${i.progress}%` }} /></div></td>
                  <td>
                    {i.status === "queued" && <span className="badge">queued</span>}
                    {i.status === "uploading" && <span className="badge info">uploading</span>}
                    {i.status === "done" && <span className="badge ok">slot: {i.slot}</span>}
                    {i.status === "error" && <span className="badge danger">{i.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!busy && items.some((i) => i.status === "done") && (
            <p style={{ marginTop: 12 }}>Captions are being generated in the background. <Link href="/review">Go to Review →</Link></p>
          )}
        </div>
      )}
    </>
  );
}
