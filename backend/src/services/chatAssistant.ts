import { DispensingRecipientType, StockTransactionType, TransferStatus, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getMedicineBalance, daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { isCrossFacilityRole } from "../utils/roles";

export const ASSISTANT_PROFILE = {
  name: "SCM Assistant",
  subtitle: "Healthcare Inventory & Workflow Assistant",
  avatar: "healthcare-assistant",
  role: "assistant" as const,
};

export interface ChatMessagePayload {
  sender: string;
  message: string;
  timestamp: string;
  avatar: string;
  role: "user" | "assistant";
}

export interface ChatResponse {
  reply: string;
  intent: string;
  assistant: typeof ASSISTANT_PROFILE;
  messages: ChatMessagePayload[];
  suggestions?: string[];
  data?: unknown;
}

export const WELCOME_MESSAGE =
  "Hello. I'm SCM Assistant. I can help with inventory, stock levels, expiry alerts, patients, dispensing, orders, reports, transfers, returns, and workflow guidance.";

const NOT_FOUND_REPLY =
  "I could not find that information. Try asking about stock, expiry, patients, dispensing, reports, or orders.";

type Intent =
  | "expiry"
  | "batch_expires_first"
  | "low_stock"
  | "stock_lookup"
  | "stock_received_today"
  | "consumption_today"
  | "inventory_summary"
  | "dispensing_summary"
  | "most_dispensed"
  | "healthcare_worker_dispensing"
  | "patients_today"
  | "recent_patients"
  | "patient_find"
  | "patient_history"
  | "patient_medicine"
  | "patient_visit_summary"
  | "transfer_status"
  | "shipment_status"
  | "returns_summary"
  | "report"
  | "workflow_help"
  | "recent_orders"
  | "greeting"
  | "general";

type ChatScope = {
  facilityId: string | null;
  showFacilityNames: boolean;
};

const INTENT_LABELS: Partial<Record<Intent, string>> = {
  expiry: "Expiry alerts",
  batch_expires_first: "Earliest expiry",
  low_stock: "Low stock",
  stock_lookup: "Stock lookup",
  stock_received_today: "Stock received today",
  consumption_today: "Consumption today",
  inventory_summary: "Inventory summary",
  dispensing_summary: "Dispensing summary",
  most_dispensed: "Most dispensed medicines",
  healthcare_worker_dispensing: "Healthcare worker dispensing",
  patients_today: "Today's patients",
  recent_patients: "Recent patients",
  patient_find: "Patients",
  patient_history: "Patient dispensing history",
  patient_medicine: "Patient medicine lookup",
  patient_visit_summary: "Patient visit summary",
  transfer_status: "Transfers",
  shipment_status: "Orders",
  returns_summary: "Returns",
  report: "Reports",
  recent_orders: "Recent orders",
};

const DEFAULT_SUGGESTIONS = [
  "Low stock",
  "Expiry",
  "Patients",
  "Dispensing",
  "Transfers",
  "Orders",
  "Reports",
  "Recent activity",
  "Inventory summary",
];

function detectIntent(message: string): Intent {
  const m = message.toLowerCase().trim();
  if (/^(hi|hello|hey)\b/.test(m)) return "greeting";
  if (/^help\b/.test(m) && m.length < 12) return "greeting";
  if (/how do i|how to|register|workflow|guide|steps|upload prescription|transfer stock|dispense medicine/.test(m)) {
    return "workflow_help";
  }
  if (/return|returned|stock returned|why was stock returned/.test(m)) return "returns_summary";
  if (/delivery/.test(m)) return "shipment_status";
  if (/transfer|redistribution|delayed/.test(m)) return "transfer_status";
  if (/which batch expires first|batch expires first|earliest expir|first expir/.test(m)) return "batch_expires_first";
  if (/expir|expiring|expiry|near.?expir/.test(m)) return "expiry";
  if (/low stock|stockout|shortage|running low|below reorder|below minimum/.test(m)) return "low_stock";
  if (/recent order|order|latest order/.test(m)) return "recent_orders";
  if (/stock received today|received today|receipts today/.test(m)) return "stock_received_today";
  if (/consumption today|used today|stock consumed today/.test(m)) return "consumption_today";
  if (/inventory summary|current inventory summary|stock summary/.test(m)) return "inventory_summary";
  if (/most dispensed|top dispensed/.test(m)) return "most_dispensed";
  if (/healthcare worker|health worker|dispensed to healthcare/.test(m) && /dispens/.test(m)) return "healthcare_worker_dispensing";
  if (/dispens|dispensed today|today.*dispens/.test(m)) return "dispensing_summary";
  if (/which patient received|who received|patient received/.test(m)) return "patient_medicine";
  if (/patient dispensing history|dispensing history/.test(m)) return "patient_history";
  if (/patient visit summary|visit summary/.test(m)) return "patient_visit_summary";
  if (/today.*patient|patients today|how many patients today/.test(m)) return "patients_today";
  if (/recent patients|latest patients/.test(m)) return "recent_patients";
  if (/search patient|find patient|lookup patient|patient\b/.test(m)) return "patient_find";
  if (/current stock|stock of|how much|remain|availability|balance|do we have/.test(m)) return "stock_lookup";
  if (/report|daily|weekly|monthly|facility performance|performance/.test(m)) return "report";
  return "general";
}

function scopedWhere(scope: ChatScope) {
  return scope.facilityId ? { facilityId: scope.facilityId } : {};
}

function todayStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function sinceDays(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(value?: Date | string | null) {
  if (!value) return "not recorded";
  return new Date(value).toLocaleDateString();
}

function scopedLine(scope: ChatScope, label: string, facilityName: string | null | undefined, value: string) {
  return scope.showFacilityNames && facilityName
    ? `- ${label} @ ${facilityName}: ${value}`
    : `- ${label}: ${value}`;
}

function formatRoute(scope: ChatScope, from?: string | null, to?: string | null, directionFallback = "facility route") {
  if (scope.showFacilityNames) {
    return `${from || "Source"} -> ${to || "Destination"}`;
  }
  return directionFallback;
}

function extractPatientQuery(message: string): string | null {
  const direct = message.match(/(?:search|find|lookup)\s+patient\s+([a-z0-9\s-]+)/i);
  if (direct) return direct[1].trim();
  const id = message.match(/patient[:\s#-]*([A-Z0-9-]+)/i);
  if (id) return id[1];
  const name = message.match(/(?:named?|called)\s+([a-z\s]+)/i);
  if (name) return name[1].trim();
  return null;
}

async function findMedicineFromMessage(message: string) {
  const medicines = await prisma.medicine.findMany({
    where: { isActive: true },
    select: { id: true, medicineName: true, reorderThreshold: true, unitType: true },
    take: 500,
  });
  const normalized = message.toLowerCase();
  const exact = medicines.find((m) => normalized.includes(m.medicineName.toLowerCase()));
  if (exact) return exact;

  const cleaned = message
    .replace(/current stock of|stock of|stock|medicine|which patient received|who received|patient received|current|of|for|do we have|available|availability|balance/gi, " ")
    .replace(/\b(today|please|show|how much|remain|remaining)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return medicines.find((m) =>
    cleaned
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .some((token) => m.medicineName.toLowerCase().includes(token))
  );
}

function buildPayload(
  role: "user" | "assistant",
  message: string,
  sender?: string
): ChatMessagePayload {
  const isUser = role === "user";
  return {
    sender: sender || (isUser ? "You" : ASSISTANT_PROFILE.name),
    message: message || "",
    timestamp: new Date().toISOString(),
    avatar: isUser ? "user" : ASSISTANT_PROFILE.avatar,
    role,
  };
}

async function ruleBasedHandler(
  intent: Intent,
  message: string,
  scope: ChatScope
): Promise<{ facts: string; data?: unknown }> {
  switch (intent) {
    case "greeting":
      return { facts: WELCOME_MESSAGE };

    case "expiry": {
      const daysMatch = message.match(/(\d+)\s*days?/);
      const maxDays = daysMatch ? parseInt(daysMatch[1], 10) : config.expiryWarningDays;
      const batches = await prisma.stockBatch.findMany({
        where: { quantity: { gt: 0 }, ...scopedWhere(scope) },
        include: { medicine: true, facility: true },
        take: 250,
      });
      const expiring = batches
        .map((b) => ({ ...b, days: daysUntilExpiry(b.expiryDate) }))
        .filter((b) => b.days >= 0 && b.days <= maxDays)
        .sort((a, b) => a.days - b.days)
        .slice(0, 15);
      const lines = expiring.map((b) =>
        scopedLine(
          scope,
          `${b.medicine.medicineName} (${b.batchNumber})`,
          b.facility.name,
          `${formatNumber(b.quantity)} units, ${b.days} days left`
        )
      );
      return {
        facts:
          lines.length > 0
            ? `Found ${expiring.length} batch(es) expiring within ${maxDays} days:\n${lines.join("\n")}`
            : `No batches expiring within ${maxDays} days${scope.facilityId ? " at this facility" : ""}.`,
        data: expiring,
      };
    }

    case "batch_expires_first": {
      const batch = await prisma.stockBatch.findFirst({
        where: { quantity: { gt: 0 }, expiryDate: { gte: new Date() }, ...scopedWhere(scope) },
        include: { medicine: true, facility: true },
        orderBy: { expiryDate: "asc" },
      });
      if (!batch) return { facts: "No active batches with future expiry dates were found in scope." };
      return {
        facts: scopedLine(
          scope,
          `${batch.medicine.medicineName} (${batch.batchNumber})`,
          batch.facility.name,
          `${formatNumber(batch.quantity)} units, expires ${formatDate(batch.expiryDate)}`
        ),
        data: batch,
      };
    }

    case "low_stock": {
      const medicines = await prisma.medicine.findMany({ where: { isActive: true }, take: 250 });
      const facilityList = scope.facilityId
        ? await prisma.facility.findMany({ where: { id: scope.facilityId } })
        : await prisma.facility.findMany({ where: { isActive: true } });
      const low: { name: string; balance: number; facility?: string }[] = [];
      for (const facility of facilityList) {
        for (const med of medicines) {
          const balance = await getMedicineBalance(med.id, facility.id);
          if (balance <= med.reorderThreshold) {
            low.push({ name: med.medicineName, balance, facility: facility.name });
          }
        }
      }
      const top = low.slice(0, 15);
      return {
        facts:
          top.length > 0
            ? `Low stock / stockout items:\n${top
                .map((l) => scopedLine(scope, l.name, l.facility, formatNumber(l.balance)))
                .join("\n")}`
            : "No low stock items detected in scope.",
        data: top,
      };
    }

    case "stock_lookup": {
      const med = await findMedicineFromMessage(message);
      if (!med) return { facts: "Please specify a medicine name, e.g. Current stock of Paracetamol." };
      if (scope.facilityId) {
        const balance = await getMedicineBalance(med.id, scope.facilityId);
        const facility = await prisma.facility.findUnique({ where: { id: scope.facilityId } });
        return {
          facts: scopedLine(
            scope,
            med.medicineName,
            facility?.name,
            `${formatNumber(balance)} ${med.unitType}. Reorder threshold: ${formatNumber(med.reorderThreshold)}`
          ),
        };
      }
      const facilities = await prisma.facility.findMany({ where: { isActive: true } });
      const lines: string[] = [];
      let total = 0;
      for (const facility of facilities) {
        const balance = await getMedicineBalance(med.id, facility.id);
        total += balance;
        if (balance > 0) lines.push(scopedLine(scope, med.medicineName, facility.name, formatNumber(balance)));
      }
      return {
        facts: `${med.medicineName} total: ${formatNumber(total)} units across facilities.\n${lines.join("\n") || "No stock on hand."}`,
      };
    }

    case "stock_received_today":
    case "consumption_today": {
      const type = intent === "stock_received_today" ? StockTransactionType.RECEIPT : StockTransactionType.CONSUMPTION;
      const transactions = await prisma.stockTransaction.findMany({
        where: { type, createdAt: { gte: todayStart() }, ...scopedWhere(scope) },
        include: { medicine: true, facility: true },
        orderBy: { createdAt: "desc" },
        take: 15,
      });
      if (!transactions.length) {
        return { facts: intent === "stock_received_today" ? "No stock receipts recorded today." : "No consumption recorded today." };
      }
      return {
        facts: transactions
          .map((t) =>
            scopedLine(scope, t.medicine.medicineName, t.facility.name, `${formatNumber(t.quantity)} units`)
          )
          .join("\n"),
        data: transactions,
      };
    }

    case "inventory_summary": {
      const [batchCount, medicineCount, total, alerts] = await Promise.all([
        prisma.stockBatch.count({ where: { quantity: { gt: 0 }, ...scopedWhere(scope) } }),
        prisma.medicine.count({ where: { isActive: true } }),
        prisma.stockBatch.aggregate({
          where: { quantity: { gt: 0 }, ...scopedWhere(scope) },
          _sum: { quantity: true },
        }),
        prisma.alert.count({ where: { resolvedAt: null, ...scopedWhere(scope) } }),
      ]);
      return {
        facts: `Current inventory summary:\n- Active medicines: ${medicineCount}\n- Stocked batches: ${batchCount}\n- Units on hand: ${formatNumber(total._sum.quantity)}\n- Open alerts: ${alerts}`,
      };
    }

    case "dispensing_summary": {
      const records = await prisma.dispensingRecord.findMany({
        where: { dispensedAt: { gte: todayStart() }, ...scopedWhere(scope) },
        include: { medicine: true, facility: true, patient: true, healthcareWorker: true },
        orderBy: { dispensedAt: "desc" },
        take: 15,
      });
      const units = records.reduce((sum, record) => sum + record.quantity, 0);
      const lines = records.slice(0, 8).map((r) => {
        const recipient =
          r.recipientType === DispensingRecipientType.HEALTHCARE_WORKER
            ? `${r.healthcareWorker?.firstName ?? ""} ${r.healthcareWorker?.lastName ?? ""}`.trim() || "healthcare worker"
            : `${r.patient?.firstName ?? ""} ${r.patient?.lastName ?? ""}`.trim() || "patient";
        return scopedLine(scope, r.medicine.medicineName, r.facility.name, `${formatNumber(r.quantity)} units to ${recipient}`);
      });
      return {
        facts: `Today's dispensing: ${records.length} record(s), ${formatNumber(units)} units dispensed.${lines.length ? `\n${lines.join("\n")}` : ""}`,
        data: records,
      };
    }

    case "most_dispensed": {
      const records = await prisma.dispensingRecord.findMany({
        where: { dispensedAt: { gte: sinceDays(30) }, ...scopedWhere(scope) },
        include: { medicine: true, facility: true },
        take: 500,
      });
      const grouped = new Map<string, { medicine: string; quantity: number; facility?: string }>();
      for (const record of records) {
        const key = scope.showFacilityNames ? `${record.medicineId}:${record.facilityId}` : record.medicineId;
        const current = grouped.get(key) ?? {
          medicine: record.medicine.medicineName,
          quantity: 0,
          facility: record.facility.name,
        };
        current.quantity += record.quantity;
        grouped.set(key, current);
      }
      const top = [...grouped.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8);
      return {
        facts: top.length
          ? top.map((item) => scopedLine(scope, item.medicine, item.facility, `${formatNumber(item.quantity)} units`)).join("\n")
          : "No dispensing records found in the last 30 days.",
        data: top,
      };
    }

    case "healthcare_worker_dispensing": {
      const records = await prisma.dispensingRecord.findMany({
        where: {
          recipientType: DispensingRecipientType.HEALTHCARE_WORKER,
          dispensedAt: { gte: sinceDays(30) },
          ...scopedWhere(scope),
        },
        include: { medicine: true, facility: true, healthcareWorker: true },
        orderBy: { dispensedAt: "desc" },
        take: 15,
      });
      return {
        facts: records.length
          ? records
              .map((r) =>
                scopedLine(
                  scope,
                  r.medicine.medicineName,
                  r.facility.name,
                  `${formatNumber(r.quantity)} units to ${r.healthcareWorker?.firstName ?? "healthcare"} ${r.healthcareWorker?.lastName ?? "worker"}`
                )
              )
              .join("\n")
          : "No healthcare worker dispensing records found in scope.",
        data: records,
      };
    }

    case "patients_today": {
      const count = await prisma.patient.count({
        where: { registrationDate: { gte: todayStart() }, ...scopedWhere(scope) },
      });
      return { facts: `Patients registered today: ${count}.` };
    }

    case "recent_patients": {
      const patients = await prisma.patient.findMany({
        where: scopedWhere(scope),
        include: { facility: true },
        orderBy: { registrationDate: "desc" },
        take: 8,
      });
      return {
        facts: patients.length
          ? patients
              .map((p) => scopedLine(scope, `${p.firstName} ${p.lastName} (${p.patientId})`, p.facility.name, `registered ${formatDate(p.registrationDate)}`))
              .join("\n")
          : "No recent patients found.",
        data: patients,
      };
    }

    case "patient_find": {
      const q = extractPatientQuery(message) ?? message.replace(/patient|search|find|lookup/gi, "").trim();
      if (!q || q.length < 2) return { facts: "Provide a patient ID or name, e.g. Search patient John." };
      const patients = await prisma.patient.findMany({
        where: {
          OR: [
            { patientId: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
          ...scopedWhere(scope),
        },
        include: { facility: true },
        take: 8,
      });
      if (!patients.length) return { facts: `No patients found matching "${q}".` };
      return {
        facts: patients
          .map((p) => scopedLine(scope, `${p.firstName} ${p.lastName} (${p.patientId})`, p.facility.name, `age ${p.age}, ${p.gender}`))
          .join("\n"),
        data: patients,
      };
    }

    case "patient_history":
    case "patient_visit_summary": {
      const q = extractPatientQuery(message);
      const patient = q
        ? await prisma.patient.findFirst({
            where: {
              OR: [
                { patientId: { contains: q, mode: "insensitive" } },
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
              ],
              ...scopedWhere(scope),
            },
          })
        : null;
      if (!patient) return { facts: "Please provide a patient name or ID, e.g. Patient dispensing history John." };
      const records = await prisma.dispensingRecord.findMany({
        where: { patientId: patient.id, ...scopedWhere(scope) },
        include: { medicine: true, facility: true },
        orderBy: { dispensedAt: "desc" },
        take: 10,
      });
      return {
        facts: records.length
          ? `${patient.firstName} ${patient.lastName} (${patient.patientId}) history:\n${records
              .map((r) => scopedLine(scope, r.medicine.medicineName, r.facility.name, `${formatNumber(r.quantity)} units on ${formatDate(r.dispensedAt)}`))
              .join("\n")}`
          : `No dispensing history found for ${patient.firstName} ${patient.lastName}.`,
        data: records,
      };
    }

    case "patient_medicine": {
      const med = await findMedicineFromMessage(message);
      if (!med) return { facts: "Please include the medicine name, e.g. Which patient received Paracetamol?" };
      const records = await prisma.dispensingRecord.findMany({
        where: { medicineId: med.id, ...scopedWhere(scope) },
        include: { patient: true, healthcareWorker: true, facility: true },
        orderBy: { dispensedAt: "desc" },
        take: 12,
      });
      return {
        facts: records.length
          ? records
              .map((r) => {
                const recipient =
                  r.patient
                    ? `${r.patient.firstName} ${r.patient.lastName} (${r.patient.patientId})`
                    : `${r.healthcareWorker?.firstName ?? "Healthcare"} ${r.healthcareWorker?.lastName ?? "worker"}`;
                return scopedLine(scope, recipient, r.facility.name, `${formatNumber(r.quantity)} ${med.unitType} on ${formatDate(r.dispensedAt)}`);
              })
              .join("\n")
          : `No dispensing recipients found for ${med.medicineName}.`,
        data: records,
      };
    }

    case "transfer_status": {
      const delayedOnly = /delayed|late|overdue/.test(message.toLowerCase());
      const transfers = await prisma.transfer.findMany({
        where: {
          ...(scope.facilityId ? { OR: [{ fromFacilityId: scope.facilityId }, { toFacilityId: scope.facilityId }] } : {}),
          ...(delayedOnly ? { status: { in: [TransferStatus.PENDING, TransferStatus.IN_TRANSIT] } } : {}),
        },
        include: { fromFacility: true, toFacility: true, medicine: true },
        orderBy: { updatedAt: "desc" },
        take: 12,
      });
      const filtered = delayedOnly
        ? transfers.filter((t) => t.updatedAt < sinceDays(7))
        : transfers.filter((t) => /pending/.test(message.toLowerCase()) ? t.status === TransferStatus.PENDING : true);
      return {
        facts: filtered.length
          ? filtered
              .map((t) => {
                const direction = t.toFacilityId === scope.facilityId ? "inbound transfer" : t.fromFacilityId === scope.facilityId ? "outbound transfer" : "transfer";
                return `- ${t.transferCode}: ${t.medicine?.medicineName ?? "multi-item"}, ${formatNumber(t.quantity ?? 0)} units, ${formatRoute(scope, t.fromFacility.name, t.toFacility.name, direction)}, ${t.status.replace(/_/g, " ")}`;
              })
              .join("\n")
          : delayedOnly
            ? "No delayed transfers found in scope."
            : "No transfers found in scope.",
        data: filtered,
      };
    }

    case "shipment_status": {
      const shipments = await prisma.shipment.findMany({
        where: scope.facilityId
          ? { OR: [{ destinationFacilityId: scope.facilityId }, { sourceFacilityId: scope.facilityId }] }
          : undefined,
        include: { destinationFacility: true, sourceFacility: true, transfer: true, stockOrder: true },
        orderBy: { updatedAt: "desc" },
        take: 12,
      });
      return {
        facts: shipments.length
          ? shipments
              .map((s) => {
                const direction = s.destinationFacilityId === scope.facilityId ? "incoming delivery" : s.sourceFacilityId === scope.facilityId ? "outgoing delivery" : "delivery route";
                return `- ${s.shipmentCode}: ${formatRoute(scope, s.sourceFacility?.name ?? "Vendor", s.destinationFacility.name, direction)}, ${s.status.replace(/_/g, " ")}`;
              })
              .join("\n")
          : "No order deliveries found.",
        data: shipments,
      };
    }

    case "returns_summary": {
      const todayOnly = /today/.test(message.toLowerCase());
      const returns = await prisma.medicineReturn.findMany({
        where: {
          ...(todayOnly ? { createdAt: { gte: todayStart() } } : { createdAt: { gte: sinceDays(30) } }),
          ...scopedWhere(scope),
        },
        include: { medicine: true, facility: true, patient: true },
        orderBy: { createdAt: "desc" },
        take: 15,
      });
      return {
        facts: returns.length
          ? returns
              .map((r) =>
                scopedLine(
                  scope,
                  r.medicine.medicineName,
                  r.facility.name,
                  `${formatNumber(r.quantity)} units returned for ${r.returnReason}`
                )
              )
              .join("\n")
          : todayOnly
            ? "No returned medicines recorded today."
            : "No medicine returns found in the last 30 days.",
        data: returns,
      };
    }

    case "recent_orders": {
      const orders = await prisma.stockOrder.findMany({
        where: scope.facilityId ? { facilityId: scope.facilityId } : undefined,
        include: { vendor: true, facility: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      if (!orders.length) return { facts: "No recent orders found." };
      return {
        facts: orders
          .map((o) => scopedLine(scope, o.orderCode, o.facility.name, `${o.vendor.name}, ${o.status}`))
          .join("\n"),
        data: orders,
      };
    }

    case "report": {
      const m = message.toLowerCase();
      const days = m.includes("monthly") ? 30 : m.includes("weekly") ? 7 : 1;
      const since = sinceDays(days);
      const [dispensing, receipts, returns, alerts, transfers, shipments] = await Promise.all([
        prisma.dispensingRecord.count({ where: { dispensedAt: { gte: since }, ...scopedWhere(scope) } }),
        prisma.stockTransaction.count({ where: { type: StockTransactionType.RECEIPT, createdAt: { gte: since }, ...scopedWhere(scope) } }),
        prisma.medicineReturn.count({ where: { createdAt: { gte: since }, ...scopedWhere(scope) } }),
        prisma.alert.count({ where: { createdAt: { gte: since }, resolvedAt: null, ...scopedWhere(scope) } }),
        prisma.transfer.count({
          where: {
            createdAt: { gte: since },
            ...(scope.facilityId ? { OR: [{ fromFacilityId: scope.facilityId }, { toFacilityId: scope.facilityId }] } : {}),
          },
        }),
        prisma.shipment.count({
          where: {
            createdAt: { gte: since },
            ...(scope.facilityId ? { OR: [{ sourceFacilityId: scope.facilityId }, { destinationFacilityId: scope.facilityId }] } : {}),
          },
        }),
      ]);
      const label = days === 30 ? "Monthly" : days === 7 ? "Weekly" : "Daily";
      return {
        facts: `${label} summary (last ${days} day(s)):\n- Dispensing events: ${dispensing}\n- Stock receipts: ${receipts}\n- Returns: ${returns}\n- Transfers: ${transfers}\n- Order deliveries: ${shipments}\n- Open alerts: ${alerts}`,
      };
    }

    case "workflow_help": {
      const m = message.toLowerCase();
      if (/register.*patient|new patient/.test(m)) {
        return { facts: "To register a patient: open Patients, choose Add Patient, enter demographics and facility details, then save." };
      }
      if (/dispens/.test(m)) {
        return { facts: "To dispense medicine: open Patient Dispense, select a patient or healthcare worker, choose medicine and FEFO batch, enter quantity, then confirm." };
      }
      if (/transfer/.test(m)) {
        return { facts: "To transfer stock: open Transfers, choose Send Transfer, select destination, medicine, batch, and quantity, then submit. Use Receive Transfer when stock arrives." };
      }
      if (/upload.*prescription|prescription/.test(m)) {
        return { facts: "To upload a prescription: open Prescriptions, select Upload Prescription, attach the image or file, link it to the patient, then submit for review." };
      }
      if (/delivery/.test(m)) {
        return { facts: "To review deliveries: open Orders, select the order, and update the delivery status from its workflow." };
      }
      if (/vendor|order/.test(m)) {
        return { facts: "Orders: open Stock, choose Orders, add order lines, submit, then follow the delivery status from the order workflow." };
      }
      return { facts: "Workflow help is available for registering patients, dispensing medicine, uploading prescriptions, transferring stock, and orders." };
    }

    default:
      return { facts: NOT_FOUND_REPLY };
  }
}

function formatReply(intent: Intent, facts: string): string {
  if (intent === "greeting" || intent === "workflow_help" || intent === "general") {
    return facts;
  }
  const label = INTENT_LABELS[intent];
  return label ? `${label}\n\n${facts}` : facts;
}

export function getWelcomeMessages(): ChatMessagePayload[] {
  return [buildPayload("assistant", WELCOME_MESSAGE)];
}

export async function processChatMessage(
  userMessage: string,
  facilityId?: string | null,
  userDisplayName?: string,
  userRole?: UserRole
): Promise<ChatResponse> {
  const intent = detectIntent(userMessage);
  const scope: ChatScope = {
    facilityId: facilityId ?? null,
    showFacilityNames: userRole ? isCrossFacilityRole(userRole) : !facilityId,
  };
  const { facts, data } = await ruleBasedHandler(intent, userMessage, scope);
  const reply = formatReply(intent, facts);

  const messages: ChatMessagePayload[] = [
    buildPayload("user", userMessage, userDisplayName || "You"),
    buildPayload("assistant", reply),
  ];

  return {
    reply,
    intent: intent === "general" ? "assistant" : intent,
    assistant: ASSISTANT_PROFILE,
    messages,
    suggestions: DEFAULT_SUGGESTIONS,
    data,
  };
}
