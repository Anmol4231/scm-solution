/**
 * Medicine Master matcher for OCR-extracted prescription text.
 *
 * Resolves a raw OCR'd medicine name (possibly misspelled, abbreviated, split
 * across tokens, or carrying a strength) to a medicine in the master catalogue.
 *
 * Matching tiers (highest wins):
 *   1. Exact normalized match (name, name+strength, generic)
 *   2. Strength-stripped exact match
 *   3. Prefix / containment matches
 *   4. Levenshtein fuzzy similarity (handles OCR typos: "Paracetmol", "Paracitamol")
 *
 * Strength disambiguation: when the OCR text carries a strength ("500mg",
 * "50Omg" with letter-O, bare "500"), candidates whose own strength matches are
 * boosted and candidates with a *different* explicit strength are penalized, so
 * "Paracetamol 500mg" beats "Paracetamol 650mg".
 */

export interface MatcherMedicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  strengths?: { strength: string }[];
}

export interface MatchCandidate {
  id: string;
  medicineName: string;
  score: number;
}

export interface MatchResult {
  /** Set when the match is confident enough to auto-select. */
  medicineId: string | null;
  matchedName: string | null;
  confidence: number;
  /** Ranked alternatives for user disambiguation (includes the top match). */
  candidates: MatchCandidate[];
}

/** Common prescription abbreviations → canonical (generic) name fragments. */
const ABBREVIATIONS: Record<string, string> = {
  pcm: "paracetamol",
  dolo: "paracetamol",
  amox: "amoxicillin",
  amoxy: "amoxicillin",
  azithro: "azithromycin",
  cipro: "ciprofloxacin",
  metro: "metronidazole",
  ors: "oral rehydration salts",
  cpm: "chlorpheniramine",
  inh: "isoniazid",
  ibu: "ibuprofen",
  dicl: "diclofenac",
  omz: "omeprazole",
  rtv: "ritonavir",
  cotrim: "cotrimoxazole",
};

/** OCR digit confusions: letter-O → 0, l/I/| → 1 (numeric contexts only). */
export function fixOcrDigits(s: string): string {
  return s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
}

/** Lowercase and strip everything except letters+digits ("Paraceta mol" → "paracetamol"). */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const STRENGTH_UNIT = "(?:mg|mcg|µg|g|ml|iu|%)";
const STRENGTH_IN_NAME = new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*${STRENGTH_UNIT}\\b`, "gi");

/** Digits of a strength string: "500mg" → "500", "50Omg" → "500", "500" → "500". */
export function strengthDigits(strength: string): string {
  const fixed = fixOcrDigits(strength);
  const m = /(\d+(?:\.\d+)?)/.exec(fixed);
  return m ? m[1] : "";
}

/** Medicine name with any embedded strength removed: "Paracetamol 500mg" → "Paracetamol". */
function stripStrength(name: string): string {
  return name.replace(STRENGTH_IN_NAME, "").replace(/\s+/g, " ").trim();
}

/** All strength digit-strings a medicine is known under (from name + strengths list). */
function medicineStrengthDigits(m: MatcherMedicine): string[] {
  const out = new Set<string>();
  for (const sm of m.medicineName.match(STRENGTH_IN_NAME) ?? []) {
    const d = strengthDigits(sm);
    if (d) out.add(d);
  }
  for (const s of m.strengths ?? []) {
    const d = strengthDigits(s.strength);
    if (d) out.add(d);
  }
  return [...out];
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = [...curr];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Match an OCR'd medicine name (+ optional strength) against the master list.
 * Auto-selects only when confident; otherwise returns ranked candidates.
 */
export function matchMedicine(
  rawName: string,
  strength: string | undefined,
  medicines: MatcherMedicine[]
): MatchResult {
  const qName = normalizeKey(rawName);
  if (!qName) return { medicineId: null, matchedName: null, confidence: 0, candidates: [] };

  // Query variants: as-written, abbreviation-expanded
  const variants = new Set<string>([qName]);
  const abbrev = ABBREVIATIONS[qName];
  if (abbrev) variants.add(normalizeKey(abbrev));

  const qStrength = strength ? strengthDigits(strength) : "";
  // The OCR name may itself carry the strength ("paracetamol500mg")
  const qNameWithStrength = qStrength ? qName + normalizeKey(strength ?? "") : "";

  const scored = medicines.map((m) => {
    const normName = normalizeKey(m.medicineName);
    const normStripped = normalizeKey(stripStrength(m.medicineName));
    const normGeneric = m.genericName ? normalizeKey(m.genericName) : "";
    let best = 0;

    for (const v of variants) {
      if (!v) continue;
      if (normName === v || (qNameWithStrength && normName === qNameWithStrength)) best = Math.max(best, 1.0);
      else if (normStripped && normStripped === v) best = Math.max(best, 0.97);
      else if (normGeneric && normGeneric === v) best = Math.max(best, 0.95);
      else if (v.length >= 3 && normName.startsWith(v)) best = Math.max(best, 0.9);
      else if (v.length >= 3 && normStripped.startsWith(v)) best = Math.max(best, 0.9);
      else if (normGeneric && v.length >= 3 && normGeneric.startsWith(v)) best = Math.max(best, 0.85);
      else if (v.length >= 4 && normName.includes(v)) best = Math.max(best, 0.8);
      else if (normStripped.length >= 4 && v.includes(normStripped)) best = Math.max(best, 0.8);
      else {
        // Fuzzy: OCR typos ("paracetmol", "paracitamol")
        const sim = Math.max(
          similarity(v, normName),
          similarity(v, normStripped),
          normGeneric ? similarity(v, normGeneric) : 0
        );
        if (sim >= 0.6) best = Math.max(best, sim * 0.92); // cap fuzzy below exact tiers
      }
    }

    // Strength disambiguation. An explicit matching strength is decisive — it
    // must outrank even an exact name match on a strength-less sibling entry
    // (e.g. "Amoxicillin 250mg" must beat plain "Amoxicillin" for "amoxicillin 250mg").
    if (best > 0 && qStrength) {
      const mDigits = medicineStrengthDigits(m);
      if (mDigits.includes(qStrength)) best += 0.25;
      else if (mDigits.length > 0) best = Math.max(0, best - 0.2); // explicit *different* strength
    }

    return { id: m.id, medicineName: m.medicineName, score: Math.round(best * 1000) / 1000 };
  });

  const ranked = scored.filter((s) => s.score >= 0.5).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { medicineId: null, matchedName: null, confidence: 0, candidates: [] };

  const top = ranked[0];
  const second = ranked[1];
  const confident =
    top.score >= 0.72 && (!second || top.score - second.score >= 0.08 || second.score < 0.6);

  return {
    medicineId: confident ? top.id : null,
    matchedName: confident ? top.medicineName : null,
    confidence: top.score,
    candidates: ranked.slice(0, 5),
  };
}
