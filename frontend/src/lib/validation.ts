export const namePattern = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

export function sanitizeNameInput(value: string) {
  return value.replace(/[^A-Za-z0-9 -]/g, "");
}

export function sanitizeWholeNumberInput(value: string) {
  return value.replace(/\D/g, "");
}

export function toWholeNumber(value: string, fallback = 0) {
  if (!value) return fallback;
  return Number.parseInt(value, 10);
}

export function isWholeNumberValue(value: string | number, min = 0) {
  const text = String(value);
  if (!/^\d+$/.test(text)) return false;
  return Number(text) >= min;
}
