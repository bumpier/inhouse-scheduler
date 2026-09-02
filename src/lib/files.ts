import { mkdir, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

export async function setDir(setId: string) {
  const dir = path.join(env.uploadDir, setId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function safeUnlink(p: string) {
  try {
    await unlink(p);
    return true;
  } catch (e: any) {
    if (e?.code === "ENOENT") return true;
    console.error("[files] unlink failed", p, e?.message);
    return false;
  }
}

export async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}
