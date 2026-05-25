import { AlertSeverity, AlertType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { config } from "../utils/config";
import { getMedicineBalance, daysUntilExpiry } from "../utils/stock";
import { whatsappService } from "../whatsapp/service";

export async function createAlert(data: {
  facilityId?: string;
  type: AlertType;
  severity?: AlertSeverity;
  title: string;
  message: string;
  medicineId?: string;
  batchId?: string;
  metadata?: Prisma.InputJsonValue;
  notifyWhatsApp?: boolean;
}) {
  const alert = await prisma.alert.create({
    data: {
      facilityId: data.facilityId,
      type: data.type,
      severity: data.severity ?? AlertSeverity.WARNING,
      title: data.title,
      message: data.message,
      medicineId: data.medicineId,
      batchId: data.batchId,
      metadata: data.metadata,
    },
  });

  if (data.notifyWhatsApp !== false) {
    await whatsappService.sendAlertNotification({
      type: data.type,
      title: data.title,
      message: data.message,
      facilityId: data.facilityId,
    });
  }

  return alert;
}

export async function checkLowStockAndStockout(facilityId: string) {
  const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
  for (const med of medicines) {
    const balance = await getMedicineBalance(med.id, facilityId);
    if (balance <= 0) {
      await createAlert({
        facilityId,
        type: AlertType.STOCKOUT,
        severity: AlertSeverity.CRITICAL,
        title: `Stockout: ${med.medicineName}`,
        message: `${med.medicineName} is out of stock at this facility.`,
        medicineId: med.id,
      });
    } else if (balance <= med.reorderThreshold) {
      await createAlert({
        facilityId,
        type: AlertType.LOW_STOCK,
        severity: AlertSeverity.WARNING,
        title: `Low stock: ${med.medicineName}`,
        message: `${med.medicineName} balance (${balance}) is at or below reorder threshold (${med.reorderThreshold}).`,
        medicineId: med.id,
      });
    }
  }
}

export async function checkExpiryAlerts(facilityId: string) {
  const batches = await prisma.stockBatch.findMany({
    where: { facilityId, quantity: { gt: 0 } },
    include: { medicine: true },
  });

  for (const batch of batches) {
    const days = daysUntilExpiry(batch.expiryDate);
    const severity = getExpirySeverity(days);
    if (severity === "critical") {
      await createAlert({
        facilityId,
        type: AlertType.EXPIRY_CRITICAL,
        severity: AlertSeverity.CRITICAL,
        title: `Critical expiry: ${batch.medicine.medicineName}`,
        message: `Batch ${batch.batchNumber} expires in ${days} days.`,
        medicineId: batch.medicineId,
        batchId: batch.id,
      });
    } else if (severity === "warning") {
      await createAlert({
        facilityId,
        type: AlertType.EXPIRY_WARNING,
        severity: AlertSeverity.WARNING,
        title: `Near expiry: ${batch.medicine.medicineName}`,
        message: `Batch ${batch.batchNumber} expires in ${days} days.`,
        medicineId: batch.medicineId,
        batchId: batch.id,
      });
    }
  }
}

function getExpirySeverity(days: number): "ok" | "warning" | "critical" | "expired" {
  if (days < 0) return "expired";
  if (days <= config.expiryCriticalDays) return "critical";
  if (days <= config.expiryWarningDays) return "warning";
  return "ok";
}
