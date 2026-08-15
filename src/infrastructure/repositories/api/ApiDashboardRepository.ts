import { TenantContext } from "@/domain/types";
import type {
  IDashboardRepository,
  DashboardDataDTO,
  TransactionDTO,
} from "@/application/ports/IDashboardRepository";
import { DashboardApiService } from "@/infrastructure/api";
import type { BackendDashboardResponse } from "@/infrastructure/api/DashboardApiService";

/**
 * Frontend adapter: maps the backend GET /api/dashboard response into the
 * existing DashboardDataDTO consumed by the dashboard components.
 *
 * Mapping rule: every DTO field is mapped ONLY when the backend response
 * provides a real source. Fields with no source are set to empty/zero and
 * are documented as NOT CONNECTED — never invented.
 */
export function mapDashboardResponse(raw: BackendDashboardResponse): DashboardDataDTO {
  return {
    store: {
      name: raw.store?.name ?? "", // real source (company profile)
      city: raw.store?.city ?? "", // real source (company profile)
    },
    // user.name/role/initials: not present in the dashboard response → NOT CONNECTED
    user: {
      name: "",
      role: "",
      initials: "",
      unreadNotifications: raw.unreadNotifications ?? 0, // real source
    },
    // session: no session data in the dashboard response → NOT CONNECTED
    session: { open: false, openedAt: "" },
    cashBalance: {
      syp: raw.cashbox?.balance ?? 0, // real source (cashbox.balance)
      usd: 0, // no USD balance source → NOT CONNECTED
    },
    todayProfit: {
      syp: raw.todayProfit?.syp ?? 0, // real source (revenue − COGS)
      usd: 0, // no USD source → NOT CONNECTED
      marginPercent: raw.todayProfit?.marginPercent ?? 0, // real source
      trend: raw.todayProfit?.trend ?? "up", // real source
    },
    todaySales: {
      syp: raw.todaySales?.byCurrency?.SYP?.total ?? 0, // real source (sale invoices, SYP only)
      usd: raw.todaySales?.byCurrency?.USD?.total ?? 0, // real source (sale invoices, USD only)
      changeVsYesterday: 0, // no source → NOT CONNECTED
    },
    activeRolls: {
      total: raw.activeRolls?.total ?? 0, // real source (in-stock rolls)
      fabricTypes: raw.activeRolls?.fabricTypes ?? 0, // real source
      colors: raw.activeRolls?.colors ?? 0, // real source
    },
    totalInventoryKg: raw.totalInventoryKg ?? 0, // real source (sum of remaining kg)
    activeTodayCustomers: raw.activeTodayCustomers ?? 0, // real source (distinct customers today)
    unpaidInvoices: {
      count: raw.unpaidInvoices?.count ?? 0,
      byCurrency: raw.unpaidInvoices?.byCurrency ?? {},
    },
    lowStockRolls: {
      low: raw.lowStockRolls?.low ?? 0, // real source (roll-level)
      outOfStock: raw.lowStockRolls?.outOfStock ?? 0, // real source
    },
    todayInvoices: {
      count:
        raw.todayInvoices?.count ??
        // no per-day invoice count source → NOT CONNECTED (counts come from useInvoicesList)
        0,
      returns: 0, // no source → NOT CONNECTED (returns come from useReturnsList)
    },
    recentTransactions: (raw.recentTransactions && raw.recentTransactions.length > 0
      ? raw.recentTransactions
      : legacyRecentTransactions(raw)
    ).map((t) => ({
      type: t.type,
      id: t.id,
      invoiceNo: t.invoiceNo,
      reference: t.reference,
      amount: t.amount,
      currency: t.currency,
      customer: t.customer,
      supplier: t.supplier,
      party: t.party,
      detail: t.detail,
      time: t.time,
    })),
    alerts: (raw.alerts ?? []).map((a) => ({
      category: a.category,
      level: a.level,
      fabric: a.fabric,
      color: a.color,
      colorCode: a.colorCode,
      rollNo: a.rollNo,
      remaining: a.remaining,
    })),
    topFabrics: (raw.topFabrics ?? []).map((f) => ({
      name: f.name, // real source
      salesK: (f.revenue ?? 0) / 1000, // real source (thousands of SYP)
    })),
    salesTrend: raw.salesTrend ?? {}, // real per-day series from backend
  };
}

/**
 * Fallback: derive transaction rows from the legacy audit-activity source
 * (no amounts, approximate types). Used only when the backend does not yet
 * provide a real `recentTransactions` array.
 */
function legacyRecentTransactions(raw: BackendDashboardResponse): TransactionDTO[] {
  return (raw.recentActivity ?? []).map((a) => ({
    type: activityType(a.module, a.detail),
    id: "",
    invoiceNo: extractInvoiceNumber(a.detail) ?? undefined,
    detail: a.detail,
    time: a.timestamp ?? "",
    amount: 0, // activity carries no amount → NOT CONNECTED
    currency: "SYP",
  }));
}

function activityType(module: string, detail: string): TransactionDTO["type"] {
  if (module === "returns") return "return";
  if (module === "payments" || module === "vouchers") return "payment";
  if (module === "invoices") {
    if (/مرتجع/.test(detail)) return "return";
    if (/دخول|شراء/.test(detail)) return "entry";
  }
  return "sale";
}

function extractInvoiceNumber(detail: string): string | null {
  const m = detail?.match(/INV-\d{4}-\d+/);
  return m ? m[0] : null;
}

export class ApiDashboardRepository implements IDashboardRepository {
  constructor(private api: DashboardApiService) {}

  async getDashboardData(ctx: TenantContext): Promise<DashboardDataDTO> {
    const raw = await this.api.get();
    return mapDashboardResponse(raw);
  }
}