import { db } from "../orm/drizzle.js";
import { documentSequences } from "../orm/schemas/document-sequence.table.js";
import { eq, and, sql } from "drizzle-orm";

const PREFIXES: Record<string, string> = {
  invoice: "INV",
  return: "RET",
  voucher: "VOC",
  expense: "EXP",
  order: "ORD",
  print: "PRT",
  customer: "CUS",
  supplier: "SUP",
  settlement: "SET",
};

const WIDTHS: Record<string, number> = {
  invoice: 4,
  return: 4,
  voucher: 4,
  expense: 4,
  order: 4,
  print: 4,
};

/**
 * Generate the next sequential document number for a given entity type and tenant.
 * Uses SELECT ... FOR UPDATE inside a transaction to guarantee uniqueness and gapless-per-entity sequencing.
 *
 * Format: `{PREFIX}-{YYYY}-{NNNN}`
 *
 * @param entityType - e.g. "invoice", "return", "voucher", "expense", "order"
 * @param tenantId  - UUID of the tenant
 * @returns         - formatted document number string
 */
export async function nextDocumentNumber(entityType: string, tenantId: string): Promise<string> {
  const prefix = PREFIXES[entityType] ?? entityType.toUpperCase();
  const width = WIDTHS[entityType] ?? 4;
  const year = new Date().getFullYear().toString();

  return db.transaction(async (tx) => {
    // Lock the row for this tenant+entityType combination
    const existing = await tx
      .select({ id: documentSequences.id, lastNumber: documentSequences.lastNumber, prefix: documentSequences.prefix })
      .from(documentSequences)
      .where(
        and(
          eq(documentSequences.tenantId, tenantId),
          eq(documentSequences.entityType, entityType),
        ),
      )
      .for("update")
      .limit(1);

    const nextNumber = (existing[0]?.lastNumber ?? 0) + 1;

    if (existing.length > 0) {
      await tx
        .update(documentSequences)
        .set({ lastNumber: nextNumber })
        .where(eq(documentSequences.id, existing[0].id));
    } else {
      await tx.insert(documentSequences).values({
        tenantId,
        entityType,
        prefix,
        lastNumber: nextNumber,
      });
    }

    const padded = String(nextNumber).padStart(width, "0");
    return `${prefix}-${year}-${padded}`;
  });
}
