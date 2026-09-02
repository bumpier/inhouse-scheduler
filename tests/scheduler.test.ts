import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { pickSlots, type SlotConfig } from "../src/lib/scheduler";

const cfg: SlotConfig = { timezone: "Europe/London", windowStart: "09:00", windowEnd: "21:00", postsPerDay: 2, minGapMinutes: 10 };

// deterministic RNG
function lcg(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function local(d: Date) {
  return DateTime.fromJSDate(d, { zone: cfg.timezone });
}

describe("pickSlots", () => {
  const now = new Date("2026-09-02T06:00:00Z"); // 07:00 London

  it("fills postsPerDay per day and walks forward", () => {
    const slots = pickSlots(14, [], cfg, now, lcg());
    expect(slots).toHaveLength(14);
    const byDay = new Map<string, number>();
    for (const s of slots) {
      const k = local(s).toISODate()!;
      byDay.set(k, (byDay.get(k) ?? 0) + 1);
    }
    expect(byDay.size).toBe(7);
    for (const n of byDay.values()) expect(n).toBe(2);
  });

  it("keeps every slot inside the window", () => {
    const slots = pickSlots(40, [], cfg, now, lcg(7));
    for (const s of slots) {
      const l = local(s);
      const mins = l.hour * 60 + l.minute;
      expect(mins).toBeGreaterThanOrEqual(9 * 60);
      expect(mins).toBeLessThan(21 * 60);
    }
  });

  it("respects the minimum gap, including against existing slots", () => {
    const existing = [new Date("2026-09-02T10:00:00Z"), new Date("2026-09-02T15:00:00Z")];
    const slots = pickSlots(10, existing, { ...cfg, postsPerDay: 6 }, now, lcg(3));
    const all = [...existing, ...slots].map((d) => d.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("counts existing slots toward the daily quota", () => {
    const existing = [new Date("2026-09-02T10:00:00Z"), new Date("2026-09-02T15:00:00Z")]; // today already full
    const slots = pickSlots(2, existing, cfg, now, lcg(5));
    for (const s of slots) expect(local(s).toISODate()).toBe("2026-09-03");
  });

  it("never schedules in the past", () => {
    const late = new Date("2026-09-02T19:30:00Z"); // 20:30 London, 30 min of window left
    const slots = pickSlots(3, [], cfg, late, lcg(9));
    for (const s of slots) expect(s.getTime()).toBeGreaterThan(late.getTime() + 19 * 60_000);
  });

  it("handles a window that crosses midnight", () => {
    const slots = pickSlots(4, [], { ...cfg, windowStart: "22:00", windowEnd: "02:00" }, now, lcg(11));
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      const h = local(s).hour;
      expect(h >= 22 || h < 2).toBe(true);
    }
  });

  it("returns sorted output", () => {
    const slots = pickSlots(9, [], cfg, now, lcg(13));
    for (let i = 1; i < slots.length; i++) expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
  });
});
