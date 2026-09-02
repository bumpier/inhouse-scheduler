/**
 * Minimal Zernio REST client. Docs: https://docs.zernio.com
 */
import { env } from "./env";
import { readFile } from "node:fs/promises";

const BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";

export class ZernioError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(`Zernio ${status}: ${body?.error ?? JSON.stringify(body)}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.zernioApiKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (!res.ok) throw new ZernioError(res.status, json);
  return json as T;
}

// ---- Profiles ----
export interface ZProfile {
  _id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
}
export const listProfiles = () => call<{ profiles: ZProfile[] }>("GET", "/profiles?limit=1000");
export const createProfile = (name: string) =>
  call<{ profile: ZProfile }>("POST", "/profiles", { name }).catch(async (e) => {
    // 409 = already exists; find it
    if (e instanceof ZernioError && e.status === 409) {
      const { profiles } = await listProfiles();
      const p = profiles.find((x) => x.name === name);
      if (p) return { profile: p };
    }
    throw e;
  });
export const deleteProfile = (id: string) => call("DELETE", `/profiles/${id}`);

// ---- Accounts ----
export interface ZAccount {
  _id: string;
  platform: string;
  profileId: { _id: string; name: string } | string;
  username: string;
  displayName?: string;
  profilePicture?: string;
  isActive: boolean;
  needsReconnection?: boolean;
  enabled?: boolean;
}
export const listAccounts = (profileId?: string) =>
  call<{ accounts: ZAccount[] }>("GET", `/accounts${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`);
export const deleteAccount = (id: string) => call("DELETE", `/accounts/${id}`);

export const getConnectUrl = (platform: string, profileId: string, redirectUrl: string) =>
  call<{ authUrl: string; state: string }>(
    "GET",
    `/connect/${platform}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`,
  );

export interface TikTokCreatorInfo {
  creator?: { canPostMore?: boolean; [k: string]: unknown };
  privacyLevels?: { value: string; label: string }[];
  postingLimits?: { maxVideoDurationSec?: number; [k: string]: unknown };
  commercialContentTypes?: unknown;
}
export const tiktokCreatorInfo = (accountId: string) =>
  call<TikTokCreatorInfo>("GET", `/accounts/${accountId}/tiktok/creator-info?mediaType=video`);

// ---- Media ----
export async function uploadFile(localPath: string, filename: string, contentType: string, size: number): Promise<string> {
  const presign = await call<{ uploadUrl: string; publicUrl: string; key: string; expiresIn: number }>(
    "POST",
    "/media/presign",
    { filename, contentType, size },
  );
  const bytes = await readFile(localPath);
  const put = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Media PUT failed: ${put.status} ${await put.text()}`);
  return presign.publicUrl;
}

// ---- Posts ----
export interface ZPlatformTarget {
  platform: string;
  accountId: string;
  customContent?: string;
  platformSpecificData?: Record<string, unknown>;
}
export interface ZCreatePost {
  content: string;
  mediaItems: { type: "video" | "image"; url: string; filename?: string; mimeType?: string }[];
  platforms: ZPlatformTarget[];
  scheduledFor: string; // ISO UTC
  timezone?: string;
  metadata?: Record<string, unknown>;
}
export interface ZPost {
  _id: string;
  status: string;
  scheduledFor?: string;
  platforms: {
    platform: string;
    accountId: string | { _id: string };
    status: string;
    platformPostUrl?: string;
    errorMessage?: string;
    publishedAt?: string;
  }[];
}
export const createPost = (body: ZCreatePost, requestId: string) =>
  call<{ post: ZPost; warnings?: string[] }>("POST", "/posts", body, { "x-request-id": requestId });
export const getPost = (id: string) => call<{ post: ZPost }>("GET", `/posts/${id}`);
export const deletePost = (id: string) => call("DELETE", `/posts/${id}`);
export const retryPost = (id: string) => call("POST", `/posts/${id}/retry`);

/** Zernio requires a strict contentType. Map common video mimes. */
export function normaliseVideoMime(mime: string, filename: string): string {
  const allowed = ["video/mp4", "video/mpeg", "video/quicktime", "video/avi", "video/x-msvideo", "video/webm", "video/x-m4v"];
  if (allowed.includes(mime)) return mime;
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "m4v":
      return "video/x-m4v";
    case "avi":
      return "video/x-msvideo";
    default:
      return "video/mp4";
  }
}
