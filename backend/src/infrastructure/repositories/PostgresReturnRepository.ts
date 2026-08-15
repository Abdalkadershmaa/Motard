import { eq, and, desc, ilike, or, ne, sql, inArray } from "drizzle-orm";
import type { DB } from "../orm/drizzle.js";
import type { IReturnRepository, ReturnFilter } from "../../application/ports/IReturnRepository.js";
import { returns } from "../orm/schemas/return.table.js";
import { returnLines } from "../orm/schemas/return-line.table.js";
import { rolls } from "../orm/schemas/roll.table.js";
import { ledgerEntries } from "../orm/schemas/ledger-entry.table.js";
import { invoiceLines } from "../orm/schemas/invoice-line.table.js";
import { invoices } from "../orm/schemas/invoice.table.js";
import { recordStockMovement } from "./stockMovementHelper.js";
import {
  ReturnDoc,
  type ReturnData,
  type CreateReturnInput,
} from "../../domain/entities/Return.js";
import type { TenantContext, PaginatedResult } from "../../domain/types/index.js";

export class PostgresReturnRepository implements IReturnRepository {
  constructor(private readonly db: DB) {}

  async findById(id: string, ctx: TenantContext): Promise<ReturnData | null> {
    const rows = await this.db
      .select()
      .from(returns)
      .where(and(eq(returns.id, id), eq(returns.tenantId, ctx.tenantId)))
      .limit(1);
    if (rows.length === 0) return null;
    const lines = await this.db.select().from(returnLines).where(eq(returnLines.returnId, id));
    return this.toDomain(rows[0], lines);
  }

  async list(filter: ReturnFilter, ctx: TenantContext): Promise<PaginatedResult<ReturnData>> {
    const conditions = [eq(returns.tenantId, ctx.tenantId)];
    if (filter.kind) conditions.push(eq(returns.kind, filter.kind));
    if (filter.partyId) conditions.push(eq(returns.partyId, filter.partyId));
    if (filter.status) conditions.push(eq(returns.status, filter.status));
    if (filter.search) conditions.push(or(ilike(returns.number!, `%${filter.search}%`))!);
    const where = and(...conditions);
    const page = Math.max(0, filter.page ?? 0);
    const limit = Math.min(1000, Math.max(1, filter.limit ?? 20));
    const offset = page * limit;

    const [dataRows, countRows] = await Promise.all([
      this.db
        .select()
        .from(returns)
        .where(where)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(returns.createdAt)),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(returns)
        .where(where),
    ]);

    const ids = dataRows.map((r) => r.id);
    const items =
      ids.length > 0
        ? await this.db.select().from(returnLines).where(inArray(returnLines.returnId, ids))
        : [];
    const byId = new Map<string, typeof items>();
    for (const it of items) {
      const l = byId.get(it.returnId) ?? [];
      l.push(it);
      byId.set(it.returnId, l);
    }

    return {
      data: dataRows.map((r) => this.toDomain(r, byId.get(r.id) ?? [])),
      meta: {
        total: Number(countRows[0]?.count ?? 0),
        page,
        limit,
        hasNext: offset + limit < Number(countRows[0]?.count ?? 0),
        totalPages: Math.ceil(Number(countRows[0]?.count ?? 0) / limit),
      },
    };
  }

  async create(
    input: CreateReturnInput,
    autoNumber: string,
    ctx: TenantContext,
  ): Promise<ReturnData> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(returns)
        .values({
          tenantId: ctx.tenantId,
          number: autoNumber,
          kind: input.kind,
          date: input.date,
          partyId: input.partyId,
          originalInvoiceId: input.originalInvoiceId ?? null,
          reason: input.reason,
          currency: input.currency ?? "SYP",
          notesPrint: input.notesPrint,
          notesInternal: input.notesInternal,
          createdBy: ctx.userId,
        })
        .returning();

      await tx.insert(returnLines).values(
        input.lines.map((l) => ({
          tenantId: ctx.tenantId,
          returnId: row.id,
          rollId: l.rollId,
          quantityKg: String(l.quantityKg),
          pricePerKg: String(l.pricePerKg),
        })),
      );

      // Validate return quantities against original invoice (sale + purchase returns)
      const invoiceLineQtys = new Map<string, { original: number; returned: number }>();
      if (input.originalInvoiceId) {
        // The original invoice must exist, be active, match the return kind's
        // invoice type, and belong to the same party.
        const [origInv] = await tx
          .select({ type: invoices.type, partyId: invoices.partyId, status: invoices.status })
          .from(invoices)
          .where(
            and(
              eq(invoices.id, input.originalInvoiceId),
              eq(invoices.tenantId, ctx.tenantId),
            ),
          )
          .limit(1);
        if (!origInv) {
          throw new Error("الفاتورة الأصلية غير موجودة");
        }
        const expectedInvoiceType = input.kind === "sale" ? "sale" : "entry";
        if (origInv.type !== expectedInvoiceType) {
          throw new Error(
            `نوع الفاتورة الأصلية (${origInv.type}) لا يطابق نوع المرتجع (${input.kind})`,
          );
        }
        if (origInv.status !== "active") {
          throw new Error("لا يمكن الإرجاع على فاتورة ملغاة");
        }
        if (origInv.partyId !== input.partyId) {
          throw new Error("الفاتورة الأصلية لا تخص هذا الطرف");
        }
        const origLines = await tx
          .select({ rollId: invoiceLines.rollId, qty: invoiceLines.quantityKg })
          .from(invoiceLines)
          .where(
            and(
              eq(invoiceLines.invoiceId, input.originalInvoiceId),
              eq(invoiceLines.tenantId, ctx.tenantId),
            ),
          );
        for (const ol of origLines) {
          invoiceLineQtys.set(ol.rollId, { original: Number(ol.qty), returned: 0 });
        }
        // Sum active, already-returned quantities per roll for the original invoice,
        // grouped by rollId so every line is counted exactly once.
        const prevReturns = await tx
          .select({
            rollId: returnLines.rollId,
            total: sql<number>`COALESCE(SUM(${returnLines.quantityKg}), 0)`,
          })
          .from(returnLines)
          .innerJoin(
            returns,
            and(
              eq(returns.id, returnLines.returnId),
              // Exclude the current (already-inserted) return row so the summed
              // "previously returned" quantity does NOT include this line itself.
              ne(returns.id, row.id),
              eq(returns.status, "active"),
              eq(returns.originalInvoiceId, input.originalInvoiceId),
              eq(returns.tenantId, ctx.tenantId),
            ),
          )
          .groupBy(returnLines.rollId);
        for (const pr of prevReturns) {
          const entry = invoiceLineQtys.get(pr.rollId);
          if (entry) entry.returned = Math.round(Number(pr.total) * 100) / 100;
        }
        // Guard each line
        for (const line of input.lines) {
          const entry = invoiceLineQtys.get(line.rollId);
          if (entry && line.quantityKg > entry.original - entry.returned) {
            const verb = input.kind === "sale" ? "المباعة" : "المشتراة";
            throw new Error(
              `الكمية المرتجعة (${line.quantityKg} كغ) تتجاوز الكمية ${verb} في الفاتورة الأصلية (${entry.original} كغ) بعد خصم المرتجعات السابقة (${entry.returned} كغ)`,
            );
          }
        }
      }

      for (const line of input.lines) {
        const [r] = await tx
          .select({ remainingKg: rolls.remainingKg, version: rolls.version })
          .from(rolls)
          .where(and(eq(rolls.id, line.rollId), eq(rolls.tenantId, ctx.tenantId)))
          .for("update")
          .limit(1);
        if (r) {
          const currentKg = Number(r.remainingKg);
          // مرتجع إدخال = إرجاع مواد للمورد → ينقص المخزون؛ مرتجع بيع = استرجاع من العميل → يزيد المخزون
          const delta = input.kind === "entry" ? -line.quantityKg : line.quantityKg;
          const newKg = Math.max(0, currentKg + delta);
          if (input.kind === "entry" && currentKg < line.quantityKg) {
            throw new Error(
              `الكمية المرتجعة (${line.quantityKg} كغ) تتجاوز المتاح في الصبغة (${currentKg} كغ)`,
            );
          }
          const updated = await tx
            .update(rolls)
            .set({
              remainingKg: String(newKg),
              status: sql`CASE WHEN ${String(newKg)} <= '0' THEN 'exhausted' ELSE 'in_stock' END`,
              version: sql`${rolls.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(rolls.id, line.rollId),
                eq(rolls.tenantId, ctx.tenantId),
                eq(rolls.version, Number(r.version)),
              ),
            )
            .returning({ id: rolls.id });
          if (updated.length === 0) {
            throw new Error(`Roll ${line.rollId} was modified concurrently. Please retry.`);
          }
          await recordStockMovement(
            tx,
            {
              rollId: line.rollId,
              direction: input.kind === "entry" ? "out" : "in",
              movementType: input.kind === "entry" ? "return_entry" : "return_sale",
              quantityKg: line.quantityKg,
              balanceAfterKg: newKg,
              referenceType: input.kind === "entry" ? "purchase_return" : "sales_return",
              referenceId: row.id,
              referenceNumber: autoNumber,
              movementDate: input.date,
              description: `${input.kind === "entry" ? "Entry return" : "Sale return"} ${autoNumber}`,
            },
            ctx,
          );
        }
      }

      // Write the ledger entry for the return (atomic with stock + return).
      // Returns always CREDIT the party account, reversing the invoice debit:
      // an entry return credits the supplier, a sale return credits the customer.
      const isEntryReturn = input.kind === "entry";
      const returnTotal = input.lines.reduce(
        (s, l) => s + Math.round(Number(l.quantityKg) * Number(l.pricePerKg)),
        0,
      );
      const returnRefType = isEntryReturn ? "purchase_return" : "sales_return";
      if (returnTotal > 0) {
        // C4 fix: double-entry. Party leg (credits the party) + balancing
        // inventory leg (debit) so the transaction nets to zero.
        await tx.insert(ledgerEntries).values([
          {
            tenantId: ctx.tenantId,
            partyId: input.partyId,
            date: input.date,
            type: returnRefType,
            debit: 0,
            credit: returnTotal,
            currency: input.currency ?? "SYP",
            cashImpact: "none",
            referenceType: returnRefType,
            referenceId: row.id,
            referenceNumber: autoNumber,
            description: `${isEntryReturn ? "Entry return" : "Sale return"} ${autoNumber}`,
            createdBy: ctx.userId,
          },
          {
            tenantId: ctx.tenantId,
            partyId: null,
            date: input.date,
            type: "inventory_asset",
            debit: returnTotal,
            credit: 0,
            currency: input.currency ?? "SYP",
            cashImpact: "none",
            referenceType: returnRefType,
            referenceId: row.id,
            referenceNumber: autoNumber,
            description: `Inventory ${isEntryReturn ? "relief" : "reinstated"} ${autoNumber}`,
            createdBy: ctx.userId,
          },
        ]);
      }

      const lines = await tx.select().from(returnLines).where(eq(returnLines.returnId, row.id));
      return this.toDomain(row, lines);
    });
  }

  async cancel(id: string, cancelledBy: string, ctx: TenantContext): Promise<ReturnData> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(returns)
        .where(
          and(eq(returns.id, id), eq(returns.tenantId, ctx.tenantId), eq(returns.status, "active")),
        )
        .for("update")
        .limit(1);
      if (!r) throw new Error("Return not found or already cancelled");

      const lines = await tx.select().from(returnLines).where(eq(returnLines.returnId, id));

      for (const l of lines) {
        const [roll] = await tx
          .select({ remainingKg: rolls.remainingKg, version: rolls.version })
          .from(rolls)
          .where(and(eq(rolls.id, l.rollId), eq(rolls.tenantId, ctx.tenantId)))
          .for("update")
          .limit(1);
        if (roll) {
          // عكس التأثير الأصلي عند الإلغاء: مرتجع إدخال → يعيد الكمية للمخزون؛ مرتجع بيع → يخصمها
          const delta = r.kind === "entry" ? Number(l.quantityKg) : -Number(l.quantityKg);
          const newKg = Math.max(0, Number(roll.remainingKg) + delta);
          const updated = await tx
            .update(rolls)
            .set({
              remainingKg: String(newKg),
              status: sql`CASE WHEN ${String(newKg)} <= '0' THEN 'exhausted' ELSE 'in_stock' END`,
              version: sql`${rolls.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(rolls.id, l.rollId),
                eq(rolls.tenantId, ctx.tenantId),
                eq(rolls.version, Number(roll.version)),
              ),
            )
            .returning({ id: rolls.id });
          if (updated.length === 0) {
            throw new Error(`Roll ${l.rollId} was modified concurrently. Please retry.`);
          }
          await recordStockMovement(
            tx,
            {
              rollId: l.rollId,
              direction: r.kind === "entry" ? "in" : "out",
              movementType: r.kind === "entry" ? "return_entry" : "return_sale",
              quantityKg: Number(l.quantityKg),
              balanceAfterKg: newKg,
              referenceType: r.kind === "entry" ? "purchase_return_cancel" : "sales_return_cancel",
              referenceId: r.id,
              referenceNumber: r.number,
              movementDate: r.date,
              description: `Cancel ${r.kind === "entry" ? "entry" : "sale"} return ${r.number} (reverse stock)`,
            },
            ctx,
          );
        }
      }

      // Reverse the linked ledger entry atomically when the return is cancelled
      // (mirrors PostgresInvoiceRepository.cancel / PostgresVoucherRepository.cancel).
      await tx
        .update(ledgerEntries)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy,
        })
        .where(
          and(
            eq(ledgerEntries.referenceId, id),
            eq(ledgerEntries.tenantId, ctx.tenantId),
            or(
              eq(ledgerEntries.referenceType, "purchase_return"),
              eq(ledgerEntries.referenceType, "sales_return"),
            ),
            eq(ledgerEntries.status, "active"),
          ),
        );

      const [updated] = await tx
        .update(returns)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy,
          version: sql`${returns.version} + 1`,
        })
        .where(and(eq(returns.id, id), eq(returns.tenantId, ctx.tenantId)))
        .returning();

      return this.toDomain(updated, lines);
    });
  }

  private toDomain(
    row: typeof returns.$inferSelect,
    linesRows: (typeof returnLines.$inferSelect)[],
  ): ReturnData {
    return ReturnDoc.reconstitute(this.mapRow(row, linesRows)).toData();
  }

  private mapRow(
    row: typeof returns.$inferSelect,
    linesRows: (typeof returnLines.$inferSelect)[],
  ): ReturnData {
    const n = (v: string | null) => v ?? undefined;
    return {
      id: row.id,
      tenantId: row.tenantId,
      number: row.number,
      kind: row.kind as ReturnData["kind"],
      date: row.date,
      partyId: row.partyId,
      originalInvoiceId: n(row.originalInvoiceId),
      reason: row.reason,
      currency: row.currency,
      notesPrint: n(row.notesPrint),
      notesInternal: n(row.notesInternal),
      status: row.status as ReturnData["status"],
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      createdBy: n(row.createdBy),
      cancelledAt: row.cancelledAt?.toISOString(),
      cancelledBy: n(row.cancelledBy),
      lines: linesRows.map((l) => ({
        id: l.id,
        returnId: l.returnId,
        rollId: l.rollId,
        quantityKg: Number(l.quantityKg),
        pricePerKg: Number(l.pricePerKg),
      })),
    };
  }
}
