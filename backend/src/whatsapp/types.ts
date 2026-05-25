export type WhatsAppMessageType = "text" | "template";

export interface WhatsAppSendPayload {
  to: string;
  type: WhatsAppMessageType;
  body: string;
  templateName?: string;
}

export interface WhatsAppCommandResult {
  command: string;
  success: boolean;
  message: string;
  data?: unknown;
}

export type WhatsAppAlertType =
  | "EXPIRY"
  | "LOW_STOCK"
  | "STOCKOUT"
  | "TRANSFER"
  | "REPORTING"
  | "REFILL";
