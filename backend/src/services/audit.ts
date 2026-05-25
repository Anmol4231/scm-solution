import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export async function logAudit(params: {
  facilityId?: string | null;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      facilityId: params.facilityId ?? undefined,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: (params.details as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
