import { DateTime } from "luxon";

export interface SlotConfig {
  timezone: string; // IANA
  windowStart: string; // "HH:mm"
  windowEnd: string; // "HH:mm"
  postsPerDay: number;
  minGapMinutes: number;
}

function parseHM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * Pick `count` new slots for a set, given slots already taken.
 * Walks forward day by day from `now`; fills each day up to postsPerDay with random
 * times inside the window, never closer than minGapMinutes to any other slot on that set.
 * Never returns a slot earlier than now + 20 minutes.
 */
export function pickSlots(
  count: number,
  existing: Date[],
  cfg: SlotConfig,
  now: Date = new Date(),
  rng: () => number = Math.random,
): Date[] {
  const zone = cfg.timezone || "UTC";
  const gapMs = Math.max(1, cfg.minGapMinutes) * 60_000;
  const perDay = Math.max(1, cfg.postsPerDay);
  const ws = parseHM(cfg.windowStart);
  const we = parseHM(cfg.windowEnd);
  const earliest = now.getTime() + 20 * 60_000;

  const taken = existing.map((d) => d.getTime()).sort((a, b) => a - b);
  const result: Date[] = [];

  let day = DateTime.fromJSDate(now, { zone }).startOf("day");
  let guard = 0;

  while (result.length < count && guard++ < 3650) {
    const start = day.set({ hour: ws.h, minute: ws.m, second: 0, millisecond: 0 });
    let end = day.set({ hour: we.h, minute: we.m, second: 0, millisecond: 0 });
    if (end <= start) end = end.plus({ days: 1 }); // window crosses midnight

    const dayStartMs = day.toMillis();
    const dayEndMs = day.plus({ days: 1 }).toMillis();
    const alreadyToday = taken.filter((t) => t >= dayStartMs && t < dayEndMs).length;
    let need = Math.min(perDay - alreadyToday, count - result.length);

    const lo = Math.max(start.toMillis(), earliest);
    const hi = end.toMillis();

    let attempts = 0;
    while (need > 0 && lo < hi && attempts++ < 500) {
      const candidate = lo + Math.floor(rng() * (hi - lo));
      const ok = taken.every((t) => Math.abs(t - candidate) >= gapMs);
      if (ok) {
        taken.push(candidate);
        taken.sort((a, b) => a - b);
        result.push(new Date(candidate));
        need--;
      }
    }
    day = day.plus({ days: 1 });
  }
  return result.sort((a, b) => a.getTime() - b.getTime());
}

export function formatLocal(d: Date, zone: string) {
  return DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL, HH:mm");
}
