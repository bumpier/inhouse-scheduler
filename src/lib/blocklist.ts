/**
 * Banned-word detection. Normalises text to catch common evasions:
 * leetspeak (pept1des), spaced letters (p e p t i d e s), punctuation (pep.tides),
 * and simple plurals.
 */

export const DEFAULT_BLOCKLIST = [
  "peptide",
  "peptides",
  "retatrutide",
  "semaglutide",
  "tirzepatide",
  "liraglutide",
  "cagrilintide",
  "glp-1",
  "glp1",
  "bpc-157",
  "bpc157",
  "tb-500",
  "tb500",
  "ozempic",
  "wegovy",
  "mounjaro",
  "zepbound",
  "weight loss injection",
  "weight loss injections",
  "fat loss shot",
  "fat loss shots",
  "skinny jab",
  "skinny jabs",
  "guaranteed results",
  "guaranteed",
  "cure",
  "cures",
  "before and after",
  "before/after",
  "lose weight fast",
  "miracle",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
};

/** Lowercase, de-leet, strip everything that isn't a letter/digit/space, collapse spaces. */
export function normalise(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c);
  t = t.replace(/[^a-z0-9\s]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/** Also produce a version with all spaces removed to catch "p e p t i d e s". */
function squash(text: string): string {
  return normalise(text).replace(/\s+/g, "");
}

export function parseWordList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the list of banned terms found in `text` (deduped, in list order).
 */
export function findBanned(text: string, blocklist: string[]): string[] {
  if (!text) return [];
  const norm = normalise(text);
  const sq = squash(text);
  const hits: string[] = [];
  for (const raw of blocklist) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    const nTerm = normalise(term);
    const sqTerm = nTerm.replace(/\s+/g, "");
    if (!sqTerm) continue;
    // Word-boundary match on normalised text for short terms; substring on squashed for evasion.
    const wordRe = new RegExp(`(^|\\s)${escapeRe(nTerm)}(s|es)?(?=\\s|$)`);
    const found = wordRe.test(norm) || (sqTerm.length >= 6 && sq.includes(sqTerm));
    if (found && !hits.includes(term)) hits.push(term);
  }
  return hits;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
