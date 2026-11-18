import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";

interface AuditInput {
  actorType: "admin" | "system" | "regulator";
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Explicit call sites only — no Prisma middleware, matching this repo's manual style.
 * Called from rule creation, sweep recording, remittance create/patch, reconciliation
 * runs, and transaction reversal. */
export async function recordAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      afterJson: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
    },
  });
}
