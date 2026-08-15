export interface DashboardTransaction {
  type: "sale" | "payment" | "entry" | "return";
  id: string;
  invoiceNo?: string;
  reference?: string;
  amount: number;
  currency: string;
  customer?: string;
  supplier?: string;
  party?: string;
  detail: string;
  time: string;
}

export interface DashboardData {
  store: { name: string; city: string };
  // FIX 1.1: per-currency breakdown only — money is NEVER mixed across currencies.
  // Frontend must read byCurrency[<code>] explicitly.
  todaySales: { byCurrency: Record<string, { total: number; count: number }> };
  todayInvoices: { count: number };
  weekSales: { byCurrency: Record<string, { total: number; count: number }> };
  monthSales: { byCurrency: Record<string, { total: number; count: number }> };
  recentTransactions: DashboardTransaction[];
  outstandingOrders: number;
  lowStockFabrics: number;
  lowStockRolls: { low: number; outOfStock: number };
  todayProfit: { syp: number; marginPercent: number; trend: "up" | "down" };
  activeRolls: { total: number; fabricTypes: number; colors: number };
  totalInventoryKg: number;
  activeTodayCustomers: number;
  unpaidInvoices: {
    count: number;
    byCurrency: Record<string, { count: number; totalDue: number }>;
  };
  salesTrend: Record<string, Array<{ label: string; value: number }>>;
  alerts: Array<{
    category: "inventory" | "financial";
    level: "low" | "out" | "overdue";
    fabric?: string;
    color?: string;
    colorCode?: string;
    rollNo?: string;
    remaining?: string;
  }>;
  topCustomers: Array<{ partyId: string; name: string; revenue: number; currency: string }>;
  topFabrics: Array<{ fabricId: string; name: string; kgSold: number; revenue: number }>;
  cashbox: { balance: number; todayMovementCount: number; isLocked: boolean };
  vouchers: { receiptsThisMonth: number; paymentsThisMonth: number; count: number };
  unreadNotifications: number;
  recentActivity: Array<{ module: string; action: string; detail: string; timestamp: string }>;
}
