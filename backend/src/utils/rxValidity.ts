/**
 * Prescription validity windows (H3).
 *
 * A prescription is dispensable for RX_VALIDITY_DAYS after its prescriptionDate.
 * Controlled medicines have a tighter per-line window: a controlled line may not
 * be dispensed once the prescription is older than RX_VALIDITY_DAYS_CONTROLLED,
 * even while the rest of the prescription remains valid.
 */
export const RX_VALIDITY_DAYS = 30;
export const RX_VALIDITY_DAYS_CONTROLLED = 7;

export function rxExpiresAt(prescriptionDate: Date, controlled = false): Date {
  const d = new Date(prescriptionDate);
  d.setDate(d.getDate() + (controlled ? RX_VALIDITY_DAYS_CONTROLLED : RX_VALIDITY_DAYS));
  return d;
}

export function isRxExpired(prescriptionDate: Date, controlled = false, now = new Date()): boolean {
  return now > rxExpiresAt(prescriptionDate, controlled);
}
