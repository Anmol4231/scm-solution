/**
 * Shared medicine search/matching helpers.
 *
 * Powers the MedicineCombobox (typeahead) and the OCR medicine-resolution
 * fallback. Supports:
 *   - substring search across name, generic name, and strengths ("500" finds
 *     Paracetamol 500mg)
 *   - common prescription abbreviations ("pcm" → Paracetamol)
 *   - multi-token queries ("para 500")
 *   - fuzzy fallback for typos ("paracetmol" → Paracetamol)
 */

export interface SearchableMedicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  strengths?: { strength: string }[];
}

/** Mirrors backend/src/utils/medicineMatcher.ts ABBREVIATIONS. */
export const MEDICINE_ABBREVIATIONS: Record<string, string> = {
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
  cotrim: "cotrimoxazole",
};

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

function haystack(m: SearchableMedicine): string {
  return `${m.medicineName} ${m.genericName ?? ""} ${(m.strengths ?? [])
    .map((s) => s.strength)
    .join(" ")}`.toLowerCase();
}

/**
 * Search the catalogue. Every query token must hit the medicine's name, generic
 * name, or a strength — tokens are abbreviation-expanded first. When nothing
 * matches literally, falls back to fuzzy name matching for typo tolerance.
 */
export function searchMedicines<T extends SearchableMedicine>(query: string, medicines: T[], limit = 60): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return medicines.slice(0, limit);

  const tokens = q.split(/\s+/).filter(Boolean);

  const tokenHits = (m: T): boolean => {
    const hay = haystack(m);
    return tokens.every((t) => {
      if (hay.includes(t)) return true;
      const expanded = MEDICINE_ABBREVIATIONS[t];
      return expanded ? hay.includes(expanded) : false;
    });
  };

  const literal = medicines.filter(tokenHits);
  if (literal.length) {
    // Prefix matches before mid-string matches, then alphabetical
    const first = tokens[0];
    const expandedFirst = MEDICINE_ABBREVIATIONS[first] ?? first;
    return literal
      .map((m) => {
        const name = m.medicineName.toLowerCase();
        const rank = name.startsWith(first) || name.startsWith(expandedFirst) ? 0 : 1;
        return { m, rank };
      })
      .sort((a, b) => a.rank - b.rank || a.m.medicineName.localeCompare(b.m.medicineName))
      .slice(0, limit)
      .map((x) => x.m);
  }

  // Fuzzy fallback: typo tolerance against the medicine name (strength stripped)
  const qNorm = q.replace(/[^a-z0-9]/g, "");
  return medicines
    .map((m) => {
      const name = m.medicineName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const base = name.replace(/\d+(?:\.\d+)?(?:mg|mcg|g|ml|iu)?/g, "");
      return { m, sim: Math.max(similarity(qNorm, name), similarity(qNorm, base)) };
    })
    .filter((x) => x.sim >= 0.55)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 10)
    .map((x) => x.m);
}
