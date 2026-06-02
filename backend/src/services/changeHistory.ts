import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type ChangeHistoryAction = "CREATE" | "UPDATE" | "SOFT_DELETE" | "RESTORE";

export interface ChangeHistoryParams {
  facilityId?: string | null;
  userId?: string;
  action: ChangeHistoryAction;
  entityType: string; // "Medicine", "MedicineCategory", "Category"
  entityId: string;
  entityName: string; // The name of the medicine/category
  previousValues?: Record<string, unknown>;
  currentValues?: Record<string, unknown>;
  changeDetails?: string; // Human-readable description of changes
}

/**
 * Log a change to the audit trail with before/after values
 */
export async function logChangeHistory(params: ChangeHistoryParams) {
  const auditDetails: Record<string, unknown> = {
    name: params.entityName,
    action: params.action,
  };

  if (params.previousValues) {
    auditDetails.previousValues = params.previousValues;
  }
  if (params.currentValues) {
    auditDetails.currentValues = params.currentValues;
  }
  if (params.changeDetails) {
    auditDetails.changeDetails = params.changeDetails;
  }

  // Store in main audit log
  await prisma.auditLog.create({
    data: {
      facilityId: params.facilityId ?? undefined,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: (auditDetails as Prisma.InputJsonValue) ?? undefined,
    },
  });
}

/**
 * Get all changes for an entity (all versions over time)
 */
export async function getEntityChangeHistory(entityId: string, entityType: string) {
  return prisma.auditLog.findMany({
    where: {
      entityId,
      entityType,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get recent changes across all entities
 */
export async function getRecentChanges(
  entityTypes: string[] = ["Medicine", "MedicineCategory"],
  limit: number = 100
) {
  return prisma.auditLog.findMany({
    where: {
      entityType: { in: entityTypes },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      facility: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Get previous version before a specific timestamp
 */
export async function getPreviousVersion(
  entityId: string,
  entityType: string,
  beforeTimestamp: Date
) {
  const previousChange = await prisma.auditLog.findFirst({
    where: {
      entityId,
      entityType,
      createdAt: { lt: beforeTimestamp },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return previousChange;
}

/**
 * Format change history for display
 */
export function formatChangeForDisplay(auditLog: {
  id: string;
  entityType: string;
  action: string;
  details: unknown;
  createdAt: Date;
  user?: { id: string; firstName: string; lastName: string; email: string } | null;
}) {
  const details = auditLog.details as {
    name?: string;
    previousValues?: Record<string, unknown>;
    currentValues?: Record<string, unknown>;
    changeDetails?: string;
  } | null;

  const getChangedFields = (): string[] => {
    if (!details?.previousValues || !details?.currentValues) return [];
    const fields: string[] = [];
    const prev = details.previousValues as Record<string, unknown>;
    const curr = details.currentValues as Record<string, unknown>;

    for (const key in curr) {
      if (prev[key] !== curr[key]) {
        fields.push(key);
      }
    }
    return fields;
  };

  return {
    id: auditLog.id,
    entityType: auditLog.entityType,
    recordName: details?.name ?? "Record",
    action: auditLog.action,
    actionLabel:
      auditLog.action === "CREATE"
        ? "Created"
        : auditLog.action === "UPDATE"
          ? "Updated"
          : auditLog.action === "SOFT_DELETE"
            ? "Deleted"
            : auditLog.action === "RESTORE"
              ? "Restored"
              : auditLog.action,
    changedFields: getChangedFields(),
    changedBy: auditLog.user
      ? `${auditLog.user.firstName} ${auditLog.user.lastName}`.trim() || auditLog.user.email
      : "System",
    changedByEmail: auditLog.user?.email,
    timestamp: auditLog.createdAt,
    previousValues: details?.previousValues,
    currentValues: details?.currentValues,
    changeDetails: details?.changeDetails,
  };
}

/**
 * Get change diff summary for display
 */
export function getChangeDiffSummary(
  previousValues?: Record<string, unknown>,
  currentValues?: Record<string, unknown>
): Array<{ field: string; from: unknown; to: unknown }> {
  if (!previousValues || !currentValues) return [];

  const diffs: Array<{ field: string; from: unknown; to: unknown }> = [];

  for (const key in currentValues) {
    if (previousValues[key] !== currentValues[key]) {
      diffs.push({
        field: key,
        from: previousValues[key],
        to: currentValues[key],
      });
    }
  }

  return diffs;
}
