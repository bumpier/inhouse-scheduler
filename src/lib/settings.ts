import { prisma } from "./db";
import { DEFAULT_BLOCKLIST, parseWordList } from "./blocklist";

export const KEYS = {
  blocklist: "blocklist",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getGlobalBlocklistRaw(): Promise<string> {
  const v = await getSetting(KEYS.blocklist);
  return v ?? DEFAULT_BLOCKLIST.join("\n");
}

export async function getBlocklistForSet(extra: string): Promise<string[]> {
  const global = parseWordList(await getGlobalBlocklistRaw());
  return Array.from(new Set([...global, ...parseWordList(extra)]));
}
