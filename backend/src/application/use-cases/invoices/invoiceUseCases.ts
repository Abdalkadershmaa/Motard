import type { IInvoiceRepository, InvoiceFilter } from "../../ports/IInvoiceRepository.js";
import type { TenantContext, PaginatedResult } from "../../../domain/types/index.js";
import type { InvoiceData, CreateInvoiceInput } from "../../../domain/entities/Invoice.js";
import type { IAuditRepository } from "../../ports/IAuditRepository.js";
import { logAuditError } from "../../../infrastructure/audit/auditErrorHandler.js";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function createInvoiceUseCase(
  repo: IInvoiceRepository,
  audit: IAuditRepository,
  input: CreateInvoiceInput,
  autoNumber: string,
  ctx: TenantContext,
): Promise<Result<InvoiceData>> {
  if (!input.lines?.length) return { ok: false, error: "يجب إضافة بند واحد على الأقل" };
  if (!input.partyId) return { ok: false, error: "الطرف مطلوب" };
  try {
    const invoice = await repo.create(input, autoNumber, ctx);
    audit
      .create({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        module: "invoices",
        action: "create",
        entityType: "invoice",
        entityId: invoice.id,
        detail: `فاتورة ${invoice.number}`,
      })
      .catch((err: unknown) => logAuditError(err, { module: "invoices", action: "create", entityId: invoice.id, tenantId: ctx.tenantId }));
    return { ok: true, data: invoice };
  } catch (e) {
    console.error("[createInvoiceUseCase] failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    // drizzle wraps the real PostgreSQL error in `cause` — inspect the full chain.
    const causeMsg = e instanceof Error && e.cause instanceof Error ? e.cause.message : "";
    const combined = `${msg}\n${causeMsg}`;
    if (combined.includes("duplicate") || combined.includes("idx_invoices_tenant_type_number")) {
      return { ok: false, error: "رقم الفاتورة مكرر. حاول مرة أخرى." };
    }
    if (combined.includes("foreign key") || combined.includes("violates foreign key")) {
      return { ok: false, error: "بيانات البند غير صالحة (صبغة/لون/قماش غير موجود)." };
    }
    if (combined.includes("numeric field overflow")) {
      return { ok: false, error: "قيمة السعر أو الكمية كبيرة جداً — تأكد من الأرقام المدخلة." };
    }
    return { ok: false, error: `فشل إنشاء الفاتورة: ${msg}` };
  }
}

export async function cancelInvoiceUseCase(
  repo: IInvoiceRepository,
  audit: IAuditRepository,
  id: string,
  cancelledBy: string,
  ctx: TenantContext,
): Promise<Result<InvoiceData> & { code?: string }> {
  try {
    const invoice = await repo.cancel(id, cancelledBy, ctx);
    audit
      .create({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        module: "invoices",
        action: "cancel",
        entityType: "invoice",
        entityId: invoice.id,
        detail: `إلغاء فاتورة ${invoice.number}`,
      })
      .catch((err: unknown) => logAuditError(err, { module: "invoices", action: "cancel", entityId: invoice.id, tenantId: ctx.tenantId }));
    return { ok: true, data: invoice };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cancelInvoiceUseCase] failed:", e);
    // TX11: surface the structured code so the route can map NOT_FOUND → 404.
    const code = e instanceof Error && "code" in e ? (e as { code?: string }).code : undefined;
    return { ok: false, error: `فشل إلغاء الفاتورة: ${msg}`, code };
  }
}

export async function findInvoiceUseCase(
  repo: IInvoiceRepository,
  id: string,
  ctx: TenantContext,
): Promise<{ ok: true; data: InvoiceData | null } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await repo.findById(id, ctx) };
  } catch (e) {
    return { ok: false, error: "فشل البحث" };
  }
}

export async function findInvoiceByNumberUseCase(
  repo: IInvoiceRepository,
  number: string,
  type: string,
  ctx: TenantContext,
): Promise<{ ok: true; data: InvoiceData | null } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await repo.findByNumber(number, type, ctx) };
  } catch (e) {
    return { ok: false, error: "فشل البحث" };
  }
}

export async function listInvoicesUseCase(
  repo: IInvoiceRepository,
  filter: InvoiceFilter,
  ctx: TenantContext,
): Promise<Result<PaginatedResult<InvoiceData>>> {
  try {
    return { ok: true, data: await repo.list(filter, ctx) };
  } catch (e) {
    return { ok: false, error: "فشل عرض الفواتير" };
  }
}
