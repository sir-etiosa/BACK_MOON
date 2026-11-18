import type { AssetCategory, CollectIn, FeeChargeType, RuleBase, TaxEventType, TaxType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { recordAudit } from "./audit.service.js";

/**
 * Every rate, threshold, and applicability rule is configuration with effective dates —
 * never hardcoded. Rules are versioned and never edited in place: a "change" is always a
 * new row plus closing the superseded row's `effectiveTo`. Exact category match wins over
 * a category-agnostic rule (assetCategory: null) for the same taxType+eventType.
 */
export async function getActiveTaxRule(
  taxType: TaxType,
  eventType: TaxEventType,
  assetCategory: AssetCategory,
  at: Date = new Date(),
) {
  const exact = await prisma.taxRule.findFirst({
    where: {
      taxType,
      eventType,
      assetCategory,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (exact) return exact;

  return prisma.taxRule.findFirst({
    where: {
      taxType,
      eventType,
      assetCategory: null,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

/** Exact asset match wins over an asset-agnostic rule (assetId: null) for the event type. */
export async function getActiveFeeRule(eventType: TaxEventType, assetId: string, at: Date = new Date()) {
  const exact = await prisma.feeRule.findFirst({
    where: {
      eventType,
      assetId,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (exact) return exact;

  return prisma.feeRule.findFirst({
    where: {
      eventType,
      assetId: null,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

interface CreateTaxRuleInput {
  taxType: TaxType;
  eventType: TaxEventType;
  assetCategory?: AssetCategory | null;
  rateBps?: number;
  flatAmountMinor?: string;
  flatCurrencyAssetId?: string;
  base: RuleBase;
  collectIn: CollectIn;
  thresholdMinor?: string;
  effectiveFrom: Date;
  createdByAdminId: string;
}

/** Creates a new rule version and closes out whatever rule it supersedes for the same
 * (taxType, eventType, assetCategory) tuple — rules are never edited in place. */
export async function createTaxRule(input: CreateTaxRuleInput) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.taxRule.findFirst({
      where: {
        taxType: input.taxType,
        eventType: input.eventType,
        assetCategory: input.assetCategory ?? null,
        effectiveTo: null,
      },
      orderBy: { version: "desc" },
    });

    if (previous) {
      await tx.taxRule.update({ where: { id: previous.id }, data: { effectiveTo: input.effectiveFrom } });
    }

    const created = await tx.taxRule.create({
      data: {
        version: (previous?.version ?? 0) + 1,
        taxType: input.taxType,
        eventType: input.eventType,
        assetCategory: input.assetCategory ?? null,
        rateBps: input.rateBps,
        flatAmountMinor: input.flatAmountMinor,
        flatCurrencyAssetId: input.flatCurrencyAssetId,
        base: input.base,
        collectIn: input.collectIn,
        thresholdMinor: input.thresholdMinor,
        effectiveFrom: input.effectiveFrom,
        createdByAdminId: input.createdByAdminId,
      },
    });

    await recordAudit({
      actorType: input.createdByAdminId === "system-seed" ? "system" : "admin",
      actorId: input.createdByAdminId,
      action: "tax_rule.create",
      entityType: "TaxRule",
      entityId: created.id,
      before: previous ? { id: previous.id, effectiveTo: previous.effectiveTo } : null,
      after: created,
    });

    return created;
  });
}

interface CreateFeeRuleInput {
  eventType: TaxEventType;
  assetId?: string | null;
  type: FeeChargeType;
  rateBps?: number;
  flatAmountMinor?: string;
  chargeIn: CollectIn;
  base: RuleBase;
  effectiveFrom: Date;
  createdByAdminId: string;
}

export async function createFeeRule(input: CreateFeeRuleInput) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.feeRule.findFirst({
      where: { eventType: input.eventType, assetId: input.assetId ?? null, effectiveTo: null },
      orderBy: { version: "desc" },
    });

    if (previous) {
      await tx.feeRule.update({ where: { id: previous.id }, data: { effectiveTo: input.effectiveFrom } });
    }

    const created = await tx.feeRule.create({
      data: {
        version: (previous?.version ?? 0) + 1,
        eventType: input.eventType,
        assetId: input.assetId ?? null,
        type: input.type,
        rateBps: input.rateBps,
        flatAmountMinor: input.flatAmountMinor,
        chargeIn: input.chargeIn,
        base: input.base,
        effectiveFrom: input.effectiveFrom,
        createdByAdminId: input.createdByAdminId,
      },
    });

    await recordAudit({
      actorType: input.createdByAdminId === "system-seed" ? "system" : "admin",
      actorId: input.createdByAdminId,
      action: "fee_rule.create",
      entityType: "FeeRule",
      entityId: created.id,
      before: previous ? { id: previous.id, effectiveTo: previous.effectiveTo } : null,
      after: created,
    });

    return created;
  });
}
