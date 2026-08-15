import {
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  TrendingUp,
  Users,
  Truck,
  Wallet,
} from "lucide-react";
import { useLedgerEntries, useCashMovementsOn } from "@/presentation/hooks/useLedger";
import { useCashBalance } from "@/presentation/hooks/useCashbox";
import { useExpensesList } from "@/presentation/hooks/useExpenses";
import { useInvoicesList } from "@/presentation/hooks/useInvoices";
import { useVouchersList } from "@/presentation/hooks/useVouchers";
import { buildOutstanding } from "@/presentation/hooks/useLedger";
import { customers, suppliers, customerById, supplierById } from "@/presentation/hooks/useParties";
import { formatAmount } from "@/presentation/hooks/useCurrency";
import { KpiCard } from "./KpiCard";

export function AccountingKpiRow() {
  const { data: ledgerEntries = [] } = useLedgerEntries();
  const { data: invoicesData } = useInvoicesList();
  const invoices = invoicesData?.data ?? [];
  const { data: expensesData } = useExpensesList();
  const expenses = expensesData ?? [];
  const { data: vouchersData } = useVouchersList();
  const vouchers = vouchersData?.data ?? [];
  const { data: balanceData } = useCashBalance();
  const balance = balanceData ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const { data: cashMovementsData } = useCashMovementsOn(today);
  const { in: inToday, out: outToday } = cashMovementsData ?? { in: 0, out: 0 };

  const todayExpenses = expenses
    .filter((e) => e.status === "active" && e.date === today)
    .reduce((s, e) => s + e.amount, 0);
  const largestExpense = expenses
    .filter((e) => e.status === "active" && e.date === today)
    .sort((a, b) => b.amount - a.amount)[0];

  // AR / AP
  let arCount = 0,
    arTotal = 0;
  for (const c of customers) {
    const outs = buildOutstanding(c.id, invoices, vouchers);
    if (outs.length) {
      arCount++;
      arTotal += outs.reduce((s, r) => s + r.remaining, 0);
    }
  }
  let apCount = 0,
    apTotal = 0;
  for (const s of suppliers) {
    const outs = buildOutstanding(s.id, invoices, vouchers);
    if (outs.length) {
      apCount++;
      apTotal += outs.reduce((sum, r) => sum + r.remaining, 0);
    }
  }

  const lastReceipt = vouchers.filter((v) => v.kind === "receipt" && v.status === "active")[0];
  const lastPayment = vouchers.filter((v) => v.kind === "payment" && v.status === "active")[0];

  // Sales invoices DEBIT the customer's account (customer owes us), so today's
  // sales are the sum of debits on active sales_invoice ledger entries.
  const salesToday = ledgerEntries
    .filter((e) => e.status === "active" && e.date === today && e.type === "sales_invoice")
    .reduce((s, e) => s + e.debit, 0);
  const netProfit = salesToday - todayExpenses;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-foreground">مؤشرات المحاسبة</h3>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="النقدية الحالية" icon={Wallet} primary={formatAmount(balance, "SYP")} />
        <KpiCard title="وارد اليوم" icon={ArrowDownLeft} primary={formatAmount(inToday, "SYP")} />
        <KpiCard title="صادر اليوم" icon={ArrowUpRight} primary={formatAmount(outToday, "SYP")} />
        <KpiCard
          title="مصاريف اليوم"
          icon={Receipt}
          primary={formatAmount(todayExpenses, "SYP")}
          secondary={largestExpense ? `أكبر: ${largestExpense.category}` : undefined}
        />
        <KpiCard
          title="أرباح صافية اليوم"
          icon={TrendingUp}
          primary={formatAmount(netProfit, "SYP")}
        />
        <KpiCard
          title="الذمم المدينة (عملاء)"
          icon={Users}
          primary={formatAmount(arTotal, "SYP")}
          secondary={`${arCount} عميل`}
        />
        <KpiCard
          title="الذمم الدائنة (موردون)"
          icon={Truck}
          primary={formatAmount(apTotal, "SYP")}
          secondary={`${apCount} مورد`}
        />
        <KpiCard
          title="آخر سند قبض"
          icon={ArrowDownLeft}
          primary={lastReceipt ? formatAmount(lastReceipt.amount, lastReceipt.currency) : "—"}
          secondary={lastReceipt ? customerById(lastReceipt.partyId)?.name : undefined}
        />
        <KpiCard
          title="آخر سند صرف"
          icon={ArrowUpRight}
          primary={lastPayment ? formatAmount(lastPayment.amount, lastPayment.currency) : "—"}
          secondary={lastPayment ? supplierById(lastPayment.partyId)?.name : undefined}
        />
      </div>
    </div>
  );
}
