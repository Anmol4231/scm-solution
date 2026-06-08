// ─── Name patterns ──────────────────────────────────────────────────────────
// Medicine names: must contain at least one letter; allows letters, numbers, spaces, hyphen and slash.
export const medicineNamePattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 \-/]*$/;
// Category names: must contain at least one letter; allows letters, numbers, spaces and hyphen.
export const categoryNamePattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 -]*$/;
// Custom dosage form: must contain at least one letter; letters, numbers, spaces and hyphens only.
export const dosageFormPattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 -]*$/;
// Back-compat: original generic name pattern was category-style.
export const namePattern = categoryNamePattern;

/** Medicine names: letters, numbers, spaces, hyphen, slash. */
export function sanitizeMedicineName(value: string) {
  return value.replace(/[^A-Za-z0-9 \-/]/g, "");
}

/** Category names: letters, numbers, spaces, hyphen (no slash). */
export function sanitizeCategoryName(value: string) {
  return value.replace(/[^A-Za-z0-9 -]/g, "");
}

/** Custom dosage form: letters, numbers, spaces, hyphens only. */
export function sanitizeDosageForm(value: string) {
  return value.replace(/[^A-Za-z0-9 -]/g, "");
}

/** Province / district / city names: letters, digits, spaces, hyphens, commas, periods, apostrophes. */
export function sanitizeLocationName(value: string) {
  return value.replace(/[^A-Za-z0-9 ,.\-']/g, "");
}

/** Street address: letters, digits, spaces, commas, periods, hyphens, slashes, #, parentheses. */
export function sanitizeAddress(value: string) {
  return value.replace(/[^A-Za-z0-9 ,.\-\/&#()]/g, "");
}

/** Free-text description / notes: strip only angle brackets to prevent tag injection. */
export function sanitizeDescription(value: string) {
  return value.replace(/[<>]/g, "");
}

/** Back-compat alias — category-style sanitizer. */
export const sanitizeNameInput = sanitizeCategoryName;

// ─── Whole-number (integer) input ───────────────────────────────────────────
/** Strip everything except digits — blocks decimals, negatives and scientific notation. */
export function sanitizeWholeNumberInput(value: string) {
  return value.replace(/\D/g, "");
}

/** Alias used throughout the medicines/stock forms. */
export const toDigitsOnly = sanitizeWholeNumberInput;

export function toWholeNumber(value: string, fallback = 0) {
  if (!value) return fallback;
  return Number.parseInt(value, 10);
}

export function isWholeNumberValue(value: string | number, min = 0) {
  const text = String(value);
  if (!/^\d+$/.test(text)) return false;
  return Number(text) >= min;
}

// ─── Shared validation framework ──────────────────────────────────────────────
// Mirrors backend/src/utils/validators.ts. Keep patterns and messages in sync.

/** A person/free-text name: must contain a letter; allows letters, spaces, - ' . */
export const personNamePattern = /^(?=.*[A-Za-z])[A-Za-z][A-Za-z .'-]*$/;
/** Phone: optional leading +, then 7–15 digits (after stripping spaces/dashes). */
export const phonePattern = /^\+?\d{7,15}$/;
/** Email format (pragmatic, matches typical backend acceptance). */
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Facility / role code: uppercase letters, digits, hyphen. */
export const codePattern = /^[A-Z0-9][A-Z0-9-]*$/;

/** Names: strip leading digits/symbols as the user types (letters, spaces, - ' .). */
export function sanitizePersonName(value: string) {
  return value.replace(/[^A-Za-z .'-]/g, "");
}

/** Phone: keep digits and a single leading +. */
export function sanitizePhone(value: string) {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

/** Code: uppercase, allow A–Z, 0–9, hyphen. */
export function sanitizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/** Returns an error message or "" if valid. Centralizes field-level checks. */
export const validators = {
  personName(value: string, label = "Name"): string {
    const v = value.trim();
    if (!v) return `${label} is required`;
    if (/^\d+$/.test(v)) return `${label} cannot be only numbers`;
    if (!personNamePattern.test(v)) return `${label} contains invalid characters`;
    return "";
  },
  email(value: string): string {
    const v = value.trim();
    if (!v) return "Email is required";
    if (!emailPattern.test(v)) return "Enter a valid email address";
    return "";
  },
  phone(value: string, required = false): string {
    const v = value.trim();
    if (!v) return required ? "Phone is required" : "";
    if (!phonePattern.test(sanitizePhone(v)))
      return "Phone must be 7–15 digits (an optional leading + is allowed)";
    return "";
  },
  age(value: string | number): string {
    const text = String(value).trim();
    if (!text) return "Age is required";
    if (!/^\d+$/.test(text)) return "Age must be a whole number";
    const n = Number(text);
    if (n < 0 || n > 120) return "Enter a valid age";
    return "";
  },
  required(value: string, label = "This field"): string {
    return value.trim() ? "" : `${label} is required`;
  },
  code(value: string, label = "Code"): string {
    const v = value.trim();
    if (!v) return `${label} is required`;
    if (v.length < 2) return `${label} must be at least 2 characters`;
    if (!codePattern.test(v.toUpperCase()))
      return `${label} may contain letters, digits and hyphens only`;
    return "";
  },
};
