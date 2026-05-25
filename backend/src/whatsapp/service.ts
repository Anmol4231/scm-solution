import { AlertType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { whatsappClient } from "./client";
import { parseWhatsAppCommand } from "./commands";
import { WhatsAppAlertType } from "./types";

class WhatsAppService {
  async sendToFacilityPhones(facilityId: string, message: string) {
    const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
    const phones: string[] = [];
    if (facility?.phone) phones.push(facility.phone);

    const users = await prisma.user.findMany({
      where: { facilityId, isActive: true, phone: { not: null } },
    });
    users.forEach((u) => u.phone && phones.push(u.phone));

    const unique = [...new Set(phones)];
    for (const phone of unique) {
      await whatsappClient.sendMessage({ to: phone, type: "text", body: message });
    }
  }

  async sendAlertNotification(params: {
    type: AlertType;
    title: string;
    message: string;
    facilityId?: string;
  }) {
    if (!params.facilityId) return;
    const prefix = this.alertPrefix(params.type);
    await this.sendToFacilityPhones(
      params.facilityId,
      `${prefix} ${params.title}\n${params.message}`
    );
  }

  private alertPrefix(type: AlertType): string {
    const map: Partial<Record<AlertType, string>> = {
      EXPIRY_WARNING: "⚠️ EXPIRY",
      EXPIRY_CRITICAL: "🚨 EXPIRY",
      LOW_STOCK: "📉 LOW STOCK",
      STOCKOUT: "❌ STOCKOUT",
      SHORTFALL: "📦 SHORTFALL",
      NON_REPORTING: "📋 REPORTING",
      TRANSFER_PENDING: "🔄 TRANSFER",
    };
    return map[type] || "ℹ️ MEDFLOW";
  }

  async handleIncomingMessage(from: string, text: string) {
    const user = await prisma.user.findFirst({ where: { phone: from } });
    return parseWhatsAppCommand(text, user?.facilityId ?? undefined);
  }

  async sendScheduledReminder(type: WhatsAppAlertType, facilityId: string) {
    const messages: Record<WhatsAppAlertType, string> = {
      EXPIRY: "Reminder: Review near-expiry medicines. Reply EXPIRY for list.",
      LOW_STOCK: "Reminder: Check low stock levels. Reply LOWSTOCK for list.",
      STOCKOUT: "Alert: Review stockout items immediately.",
      TRANSFER: "Reminder: Pending transfers require action.",
      REPORTING: "Reminder: Submit consumption report if not done this period.",
      REFILL: "Reminder: Review patient refill schedules.",
    };
    await this.sendToFacilityPhones(facilityId, messages[type]);
  }
}

export const whatsappService = new WhatsAppService();
