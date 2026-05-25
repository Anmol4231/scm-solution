import { prisma } from "../lib/prisma";
import { getMedicineBalance, daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { WhatsAppCommandResult } from "./types";

export async function parseWhatsAppCommand(
  text: string,
  facilityId?: string
): Promise<WhatsAppCommandResult> {
  const cmd = text.trim().toUpperCase();

  if (cmd.startsWith("STOCK ")) {
    const code = cmd.replace("STOCK ", "").trim();
    const medicine = await prisma.medicine.findFirst({
      where: {
        OR: [
          { medicineName: { contains: code, mode: "insensitive" } },
          { genericName: { contains: code, mode: "insensitive" } },
        ],
      },
    });
    if (!medicine || !facilityId) {
      return { command: cmd, success: false, message: "Medicine or facility not found." };
    }
    const balance = await getMedicineBalance(medicine.id, facilityId);
    return {
      command: cmd,
      success: true,
      message: `${medicine.medicineName}: ${balance} ${medicine.unitType}`,
      data: { balance, medicine },
    };
  }

  if (cmd === "LOWSTOCK") {
    if (!facilityId) return { command: cmd, success: false, message: "Facility required." };
    const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
    const low: string[] = [];
    for (const m of medicines) {
      const bal = await getMedicineBalance(m.id, facilityId);
      if (bal <= m.reorderThreshold) low.push(`${m.medicineName}: ${bal}`);
    }
    return {
      command: cmd,
      success: true,
      message: low.length ? `Low stock:\n${low.join("\n")}` : "No low stock items.",
      data: low,
    };
  }

  if (cmd === "EXPIRY") {
    if (!facilityId) return { command: cmd, success: false, message: "Facility required." };
    const batches = await prisma.stockBatch.findMany({
      where: { facilityId, quantity: { gt: 0 } },
      include: { medicine: true },
      orderBy: { expiryDate: "asc" },
      take: 10,
    });
    const lines = batches
      .filter((b) => daysUntilExpiry(b.expiryDate) <= config.expiryWarningDays)
      .map(
        (b) =>
          `${b.medicine.medicineName} (${b.batchNumber}): ${daysUntilExpiry(b.expiryDate)}d`
      );
    return {
      command: cmd,
      success: true,
      message: lines.length ? `Expiring:\n${lines.join("\n")}` : "No near-expiry batches.",
      data: lines,
    };
  }

  if (cmd.startsWith("TRANSFER APPROVE")) {
    return {
      command: cmd,
      success: true,
      message: "Transfer approval recorded. Use the web app to complete authorization.",
    };
  }

  return {
    command: cmd,
    success: false,
    message: "Unknown command. Try: STOCK <name>, LOWSTOCK, EXPIRY, TRANSFER APPROVE",
  };
}
