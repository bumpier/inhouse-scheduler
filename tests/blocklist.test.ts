import { describe, it, expect } from "vitest";
import { findBanned, DEFAULT_BLOCKLIST, parseWordList } from "../src/lib/blocklist";

describe("blocklist", () => {
  it("catches plain words", () => {
    expect(findBanned("Try our new peptides today", DEFAULT_BLOCKLIST)).toContain("peptide");
  });
  it("catches leetspeak", () => {
    expect(findBanned("r3tatrut1de results", DEFAULT_BLOCKLIST)).toContain("retatrutide");
  });
  it("catches spaced letters", () => {
    expect(findBanned("s e m a g l u t i d e is here", DEFAULT_BLOCKLIST)).toContain("semaglutide");
  });
  it("catches punctuation splits", () => {
    expect(findBanned("pep.ti.des for days", DEFAULT_BLOCKLIST)).toContain("peptide");
  });
  it("catches multi-word terms", () => {
    expect(findBanned("Weight-loss injections available", DEFAULT_BLOCKLIST)).toContain("weight loss injection");
  });
  it("catches GLP-1 variants", () => {
    expect(findBanned("glp1 journey", DEFAULT_BLOCKLIST).length).toBeGreaterThan(0);
    expect(findBanned("GLP-1 journey", DEFAULT_BLOCKLIST).length).toBeGreaterThan(0);
  });
  it("does not flag clean text", () => {
    expect(findBanned("Morning routine done. Feeling energised and ready. #wellness #selfcare", DEFAULT_BLOCKLIST)).toEqual([]);
  });
  it("does not false-positive on short words inside others", () => {
    // "cure" must not match "secure" or "curate"
    expect(findBanned("Secure your spot. We curate the best.", ["cure"])).toEqual([]);
  });
  it("parses newline and comma lists", () => {
    expect(parseWordList("a\nb, c\n\n d ")).toEqual(["a", "b", "c", "d"]);
  });
  it("handles empty input", () => {
    expect(findBanned("", DEFAULT_BLOCKLIST)).toEqual([]);
  });
});
