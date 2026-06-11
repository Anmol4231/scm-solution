/**
 * Prescription text parser for OCR output.
 *
 * Handles real-world prescription formats, not just labeled lines:
 *
 *   Labeled:        "Doctor: Sharma", "Dr- Smith", "Diagnosis: Fever", "Dx: URTI"
 *   Inline:         "Paracetamol 500mg Qty 5", "Amoxicillin 250mg Quantity 10"
 *   Qty variants:   "Qty 5", "QTY:5", "Quantity 5", "5 tablets", "5 tabs",
 *                   "Dispense 5", "x5", "#5"
 *   Bare strength:  "PCM 500" (unitless trailing number → strength)
 *   Split lines:    "Paraceta mol" ⏎ "500 mg" ⏎ "QTY:5" (continuation attach)
 *   OCR confusions: "50Omg" (letter-O for zero) normalized via fixOcrDigits
 *
 * Output is *structural only* — matching raw names against the Medicine Master
 * (fuzzy, abbreviations, strength disambiguation) lives in medicineMatcher.ts.
 */

import { fixOcrDigits } from "./medicineMatcher";

export interface ParsedRxMedicine {
  medicineName: string;
  /** Normalized strength as written, e.g. "500mg" or bare "500". */
  strength?: string;
  dosage?: string;
  quantity?: number;
}

export interface OcrParseResult {
  doctorName?: string;
  diagnosisNotes?: string;
  department?: string;
  symptoms?: string;
  allergies?: string;
  /** ISO date (yyyy-mm-dd) when a parseable follow-up date was found. */
  followUpDate?: string;
  medicines: ParsedRxMedicine[];
  fieldsDetected: string[];
  warnings: string[];
}

const LABELS = {
  doctor: /^(?:doctor|dr|prescriber|physician|prescribed\s+by)\b\.?\s*[-:=]?\s*(.+)$/i,
  diagnosis: /^(?:diagnosis|diag|dx|condition|impression|assessment)\b\.?\s*[-:=]?\s*(.+)$/i,
  department: /^(?:department|dept|ward|clinic)\b\.?\s*[-:=]?\s*(.+)$/i,
  symptoms: /^(?:symptoms?|chief\s+complaints?|complaints?|c\/o)\b\.?\s*[-:=]?\s*(.+)$/i,
  allergies: /^(?:allerg(?:y|ies)|drug\s+allerg(?:y|ies)|allergic\s+to)\b\.?\s*[-:=]?\s*(.+)$/i,
  followUp: /^(?:follow[- ]?up|review|return)\b\.?\s*(?:date|on)?\s*[-:=]?\s*(.+)$/i,
  medicine: /^(?:medicines?|med|drug)\b\.?\s*[-:=]?\s*(.*)$/i,
  dosage: /^(?:dosage|dose|sig)\b\.?\s*[-:=]?\s*(.+)$/i,
};

/** "12/07/2026", "12-07-26" (day-first) or "2026-07-12" → ISO yyyy-mm-dd. */
function parseFollowUpDate(raw: string): string | undefined {
  let m = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/.exec(raw);
  if (m) {
    const d = new Date(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  m = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(raw);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(`${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

/** Section headers / letterhead noise that should never become a medicine. */
const SKIP_LINE = /^(?:rx|℞|prescription|prescribed|medicines?|drugs?)\s*[:.\-—]*$/i;
const SKIP_LABELED = /^(?:patient|name|age|sex|gender|date|address|phone|tel|mrn|id|reg(?:istration)?\s*no)\b\s*[-:=.]/i;

/** Quantity, wherever it appears in a line. Ordered: explicit markers first. */
const QTY_PATTERNS: RegExp[] = [
  /\b(?:qty|qtv|aty|quantity|disp(?:ense)?d?)\s*[-:=#.]?\s*([0-9OoIl|]+)\b/i,
  /\b([0-9OoIl|]+)\s*(?:tablets?|tabs?|capsules?|caps?|pieces?|pcs|units?|sachets?|strips?|vials?|ampoules?|amps?)\b/i,
  /(?:^|\s)[x#]\s?([0-9]+)\b/i,
];

/** Strength with an explicit unit, wherever it appears. */
const STRENGTH_RE = /\b([0-9OoIl|]+(?:\.[0-9]+)?)\s*(mg|mcg|µg|g|ml|iu|%)\b/i;
/** Trailing bare number with no unit ("PCM 500") — treated as strength. */
const TRAILING_NUMBER_RE = /\s([0-9OoIl|]{2,4})\s*$/;

function parseQuantity(raw: string): number | undefined {
  const n = parseInt(fixOcrDigits(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

interface LineExtraction {
  name: string;
  strength?: string;
  quantity?: number;
}

/** Pull qty + strength out of a line; whatever is left is the medicine name. */
function extractMedicineLine(line: string): LineExtraction {
  let rest = line;
  let quantity: number | undefined;
  let strength: string | undefined;

  for (const re of QTY_PATTERNS) {
    const m = re.exec(rest);
    if (m) {
      const q = parseQuantity(m[1]);
      if (q !== undefined) {
        quantity = q;
        rest = (rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length)).trim();
        break;
      }
    }
  }

  const sm = STRENGTH_RE.exec(rest);
  if (sm) {
    strength = `${fixOcrDigits(sm[1])}${sm[2].toLowerCase()}`;
    rest = (rest.slice(0, sm.index) + " " + rest.slice(sm.index + sm[0].length)).trim();
  } else {
    // "PCM 500" — bare trailing number is a strength, not a quantity
    const tm = TRAILING_NUMBER_RE.exec(" " + rest);
    if (tm && /[a-z]{2,}/i.test(rest.slice(0, rest.length - tm[1].length))) {
      const digits = fixOcrDigits(tm[1]);
      if (/^\d+$/.test(digits) && parseInt(digits, 10) >= 10) {
        strength = digits;
        rest = rest.slice(0, rest.lastIndexOf(tm[1])).trim();
      }
    }
  }

  const name = rest.replace(/^[\s\-:=.,;]+|[\s\-:=.,;]+$/g, "").replace(/\s{2,}/g, " ");
  return { name, strength, quantity };
}

/** Letters present (≥2) → can be a medicine name; guards against number/punct noise. */
function looksLikeName(s: string): boolean {
  return (s.match(/[a-z]/gi) ?? []).length >= 2;
}

export function parsePrescriptionText(rawText: string): OcrParseResult {
  const result: OcrParseResult = { medicines: [], fieldsDetected: [], warnings: [] };
  const seen = new Set<string>();
  const flag = (f: string) => { if (!seen.has(f)) { seen.add(f); result.fieldsDetected.push(f); } };
  const last = () => result.medicines[result.medicines.length - 1];

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // ── Labeled fields ──
    let m = LABELS.doctor.exec(line);
    if (m) {
      result.doctorName = m[1].replace(/^[.\s]+/, "").trim();
      flag("doctor");
      continue;
    }
    m = LABELS.diagnosis.exec(line);
    if (m) { result.diagnosisNotes = m[1].trim(); flag("diagnosis"); continue; }

    m = LABELS.department.exec(line);
    if (m) { result.department = m[1].trim(); flag("department"); continue; }

    m = LABELS.symptoms.exec(line);
    if (m) { result.symptoms = m[1].trim(); flag("symptoms"); continue; }

    m = LABELS.allergies.exec(line);
    if (m) { result.allergies = m[1].trim(); flag("allergies"); continue; }
    if (/\bNKDA\b|\bno\s+known\s+(?:drug\s+)?allerg/i.test(line)) {
      result.allergies = "NKDA"; flag("allergies"); continue;
    }

    m = LABELS.followUp.exec(line);
    if (m) {
      const iso = parseFollowUpDate(m[1]);
      // Only consume the line when it actually carries a date — "Review the
      // dosage" must not be eaten by the follow-up label.
      if (iso) { result.followUpDate = iso; flag("followUpDate"); continue; }
    }

    m = LABELS.dosage.exec(line);
    if (m) {
      if (last()) { last().dosage = m[1].trim(); flag("dosage"); }
      continue;
    }

    if (SKIP_LINE.test(line) || SKIP_LABELED.test(line)) continue;

    // ── "Medicine: <value>" — parse the value as an inline medicine line ──
    const labeled = LABELS.medicine.exec(line);
    const content = labeled ? labeled[1].trim() : line;
    if (labeled && !content) continue;

    const { name, strength, quantity } = extractMedicineLine(content);

    if (looksLikeName(name)) {
      // New medicine line
      result.medicines.push({ medicineName: name, strength, quantity });
      flag("medicine");
      if (quantity !== undefined) flag("quantity");
      if (strength) flag("strength");
    } else {
      // Continuation line: qty-only ("QTY:5", "5 tabs") or strength-only ("500 mg")
      const target = last();
      if (!target) {
        if (quantity !== undefined) {
          result.warnings.push(`Quantity ${quantity} found but no medicine to associate with it`);
        }
        continue;
      }
      if (quantity !== undefined && target.quantity === undefined) {
        target.quantity = quantity;
        flag("quantity");
      }
      if (strength && !target.strength) {
        target.strength = strength;
        flag("strength");
      }
    }
  }

  return result;
}
