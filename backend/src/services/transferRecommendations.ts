import { prisma } from "../lib/prisma";
import { getMedicineBalance } from "../utils/stock";

export interface TransferRecommendation {
  medicineId: string;
  medicineName: string;
  fromFacility: { id: string; name: string; code: string; balance: number };
  toFacility: { id: string; name: string; code: string; balance: number };
  recommendedQuantity: number;
  reason: string;
  priority: "high" | "medium";
}

export async function buildTransferRecommendations(
  facilityIdFilter?: string
): Promise<TransferRecommendation[]> {
  const facilities = await prisma.facility.findMany({
    where: {
      isActive: true,
      ...(facilityIdFilter ? { id: facilityIdFilter } : {}),
    },
  });
  const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
  const recommendations: TransferRecommendation[] = [];

  for (const medicine of medicines) {
    const balances: { facility: (typeof facilities)[0]; balance: number }[] = [];
    for (const f of facilities) {
      const balance = await getMedicineBalance(medicine.id, f.id);
      balances.push({ facility: f, balance });
    }

    const surplus = balances.filter((b) => b.balance > medicine.reorderThreshold * 2);
    const deficit = balances.filter(
      (b) => b.balance <= medicine.reorderThreshold && b.balance >= 0
    );
    const stockouts = balances.filter((b) => b.balance <= 0);

    const needy = [...stockouts, ...deficit.filter((d) => !stockouts.some((s) => s.facility.id === d.facility.id))];

    for (const need of needy) {
      const donors = surplus
        .filter((s) => s.facility.id !== need.facility.id)
        .sort((a, b) => b.balance - a.balance);
      if (!donors.length) continue;

      const donor = donors[0];
      const targetLevel = medicine.reorderThreshold * 1.5;
      const qtyNeeded = Math.max(
        medicine.reorderThreshold - need.balance,
        targetLevel - need.balance
      );
      const transferable = Math.floor((donor.balance - medicine.reorderThreshold) * 0.5);
      const recommendedQuantity = Math.min(
        Math.max(1, Math.round(qtyNeeded)),
        Math.max(1, transferable)
      );

      if (recommendedQuantity < 1) continue;

      recommendations.push({
        medicineId: medicine.id,
        medicineName: medicine.medicineName,
        fromFacility: {
          id: donor.facility.id,
          name: donor.facility.name,
          code: donor.facility.code,
          balance: donor.balance,
        },
        toFacility: {
          id: need.facility.id,
          name: need.facility.name,
          code: need.facility.code,
          balance: need.balance,
        },
        recommendedQuantity,
        reason: `Transfer ${recommendedQuantity} units of ${medicine.medicineName} from ${donor.facility.name} (${Math.round(donor.balance)} on hand) to ${need.facility.name} (${Math.round(need.balance)} on hand).`,
        priority: need.balance <= 0 ? "high" : "medium",
      });
    }
  }

  return recommendations
    .sort((a, b) => (a.priority === "high" ? -1 : 1) - (b.priority === "high" ? -1 : 1))
    .slice(0, 50);
}
