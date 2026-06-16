export function generatePatientId(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `PAT-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generatePrescriptionId(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `RX-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generateOrderCode(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `ORD-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generateReceiptCode(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `RCP-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generateVoucherCode(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `IVN-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generateRequisitionCode(sequence: number): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `REQ-${year}-${String(sequence).padStart(5, "0")}`;
}

export function generateTransferCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TRF-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
