import { z } from "zod";

/**
 * Single source of truth for input validation rules, mirrored on the frontend
 * (`frontend/src/lib/validation.ts`). Keep the two in sync — same patterns,
 * same messages where practical.
 *
 * Rules (business-mandated):
 *  - Names cannot be numeric; letters required. Allow spaces, hyphen, apostrophe, period.
 *  - Email must be a proper address.
 *  - Phone must be numeric (optional single leading +), 7–15 digits.
 *  - Numeric fields reject text; integers reject decimals/negatives/scientific notation.
 *  - Required fields are enforced (no empty/whitespace-only).
 */

// ─── Patterns ─────────────────────────────────────────────────────────────────
/** A person/free-text name: must contain at least one letter; allows letters, spaces, - ' . */
export const personNamePattern = /^(?=.*[A-Za-z])[A-Za-z][A-Za-z .'-]*$/;
/** Phone: optional leading +, then 7–15 digits (spaces/dashes stripped before testing). */
export const phonePattern = /^\+?\d{7,15}$/;
/** Facility / role code: uppercase letters, digits, hyphen; starts alphanumeric. */
export const codePattern = /^[A-Z0-9][A-Z0-9-]*$/;
/** Medicine names: must contain at least one letter; allows letters, numbers, spaces, hyphen and slash. */
export const medicineNamePattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 \-/]*$/;
/** Category names: must contain at least one letter; allows letters, numbers, spaces and hyphen. */
export const categoryNamePattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 -]*$/;
/** Dosage form (custom): must contain at least one letter; allows letters, numbers, spaces and hyphens. */
export const dosageFormPattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 -]*$/;

/** Strip everything that isn't a digit or a single leading +. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

// ─── Reusable zod schemas ───────────────────────────────────────────────────
/** Required person name: non-numeric, letters required. */
export const personName = z
  .string()
  .trim()
  .min(1, "This field is required")
  .max(60, "Must be 60 characters or fewer")
  .regex(personNamePattern, "Must contain letters and cannot be only numbers");

/** Required email. */
export const email = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .transform((v) => v.toLowerCase());

/** Optional phone — accepts "" and undefined; validates format when present. */
export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || phonePattern.test(normalizePhone(v)), {
    message: "Phone must be 7–15 digits (an optional leading + is allowed)",
  })
  .transform((v) => (v ? normalizePhone(v) : v));

/** Required phone. */
export const requiredPhone = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .refine((v) => phonePattern.test(normalizePhone(v)), {
    message: "Phone must be 7–15 digits (an optional leading + is allowed)",
  })
  .transform((v) => normalizePhone(v));

/** A uniquely-coded master record code (facility, role). */
export const masterCode = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters")
  .max(20, "Code must be 20 characters or fewer")
  .transform((v) => v.toUpperCase())
  .refine((v) => codePattern.test(v), {
    message: "Code may contain uppercase letters, digits and hyphens only",
  });

/** Positive whole number (rejects text, decimals, negatives, scientific notation). */
export const positiveInt = z
  .number({ invalid_type_error: "Must be a number" })
  .int("Must be a whole number")
  .positive("Must be greater than zero");

/** Non-negative whole number. */
export const nonNegativeInt = z
  .number({ invalid_type_error: "Must be a number" })
  .int("Must be a whole number")
  .min(0, "Cannot be negative");

/** Human age 0–120. */
export const age = z
  .number({ invalid_type_error: "Age must be a number" })
  .int("Age must be a whole number")
  .min(0, "Age cannot be negative")
  .max(120, "Enter a valid age");

/** Required free-text (e.g. address, description) with a sane max. */
export const requiredText = (max = 200) =>
  z.string().trim().min(1, "This field is required").max(max);

/** Optional free-text that normalizes "" → undefined. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : undefined));
