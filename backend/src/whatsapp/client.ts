import { config } from "../utils/config";
import { WhatsAppSendPayload } from "./types";

/**
 * Meta WhatsApp Cloud API client (placeholder-ready).
 * Does not send real messages without WHATSAPP_ACCESS_TOKEN configured.
 */
export class WhatsAppClient {
  private baseUrl: string;
  private phoneNumberId: string;
  private accessToken: string;

  constructor() {
    this.baseUrl = config.whatsapp.apiUrl;
    this.phoneNumberId = config.whatsapp.phoneNumberId;
    this.accessToken = config.whatsapp.accessToken;
  }

  isConfigured(): boolean {
    return Boolean(this.phoneNumberId && this.accessToken);
  }

  async sendMessage(payload: WhatsAppSendPayload): Promise<{ success: boolean; messageId?: string; simulated?: boolean }> {
    if (!this.isConfigured()) {
      console.log("[WhatsApp SIMULATED]", payload.to, payload.body);
      return { success: true, messageId: `sim_${Date.now()}`, simulated: true };
    }

    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: payload.to.replace(/\D/g, ""),
      type: "text",
      text: { body: payload.body },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp API error: ${err}`);
    }

    const data = (await res.json()) as { messages?: { id: string }[] };
    return { success: true, messageId: data.messages?.[0]?.id };
  }
}

export const whatsappClient = new WhatsAppClient();
