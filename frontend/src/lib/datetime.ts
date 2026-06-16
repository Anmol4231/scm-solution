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
