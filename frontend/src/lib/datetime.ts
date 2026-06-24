/** Format a date+time, e.g. "Jun 09, 2026, 03:45 PM". Use for created/received timestamps. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a date only, e.g. "Jun 09, 2026". Use for expiry / calendar dates with no meaningful time. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

/** Earliest selectable year, application-wide: current year − 10. */
export function minYear(): number {
  return new Date().getFullYear() - 10;
}

/** Latest selectable year, application-wide: current year + 10. */
export function maxYear(): number {
  return new Date().getFullYear() + 10;
}

/** Returns YYYY-MM-DD for Jan 1 of (current year − 10) — default min on every date input. */
export function dateInputMin(): string {
  return `${minYear()}-01-01`;
}

/** Returns YYYY-MM-DD for Dec 31 of (current year + 10) — default max on every date input. */
export function dateInputMax(): string {
  return `${maxYear()}-12-31`;
}

/** Returns YYYY-MM-DD for the local current date. Use as max on inputs that must not accept future dates. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Clamp a YYYY-MM-DD string into [min, max]. Returns "" for empty/invalid input.
 * The single source of truth used by DateInput, calendars, and submit/filter guards.
 */
export function clampDateStr(value: string, min = dateInputMin(), max = dateInputMax()): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "";
  const [, y, mo, d] = m;
  // Reject non-real calendar dates (e.g. 2025-02-31).
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) {
    return "";
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Split a datetime into separate date and time strings for stacked display. */
export function formatDateTimeParts(value: string | Date | null | undefined): { date: string; time: string } {
  if (!value) return { date: "—", time: "" };
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return { date: "—", time: "" };
  return {
    date: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}
