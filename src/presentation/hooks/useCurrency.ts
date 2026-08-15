import { useSyncExternalStore } from "react";
import type { Currency } from "@/domain/types";

/**
 * Presentation-layer currency utilities.
 *
 * Replaces `@/lib/mock-currency` — provides the same API surface (Currency type,
 * CURRENCIES, currencySymbol, formatAmount, useCurrencies) but lives in the
 * presentation layer and has zero dependency on mock data files.
 *
 * The currency metadata is static configuration (not domain state), so it is
 * safe to define here as constants.
 */

export type { Currency };

export const CURRENCIES: { code: Currency; label: string; symbol: string }[] = [
  { code: "SYP", label: "ليرة سورية", symbol: "ل.س" },
  { code: "USD", label: "دولار أمريكي", symbol: "$" },
  { code: "EUR", label: "يورو", symbol: "€" },
];

/** Default currency used throughout the app. */
export const DEFAULT_CURRENCY: Currency = "SYP";

/** Default exchange rates relative to SYP (1 SYP = rate) — fallback until the user sets real rates in Settings. */
export const EXCHANGE_RATES: Record<Currency, number> = {
  SYP: 1,
  USD: 13500,
  EUR: 14700,
};

export const USD_RATE = EXCHANGE_RATES.USD;

export const currencyState: {
  defaultCurrency: Currency;
  rates: Record<Currency, number>;
  lastUpdated: string;
} = {
  defaultCurrency: DEFAULT_CURRENCY,
  rates: { ...EXCHANGE_RATES },
  lastUpdated: "2026-07-01",
};

/**
 * Set a manual exchange rate (SYP per 1 unit of `code`), as entered by the
 * user in Settings. Persisted via the settings API; notifies all subscribers
 * so dashboards, prices and reports re-render with the new rate immediately.
 */
export function setExchangeRate(code: Currency, rate: number): void {
  currencyState.rates[code] = rate;
  currencyState.lastUpdated = new Date().toISOString().slice(0, 10);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("currency-change"));
  }
}

export function currencySymbol(c: Currency | ""): string {
  return CURRENCIES.find((x) => x.code === c)?.symbol ?? c;
}

export function formatAmount(n: number, c: Currency): string {
  const sym = currencySymbol(c);
  return `${Math.round(n).toLocaleString("en-US")} ${sym}`;
}

/** Format a number with thousands separators only (no symbol), e.g. 1_250_000 → "1,250,000". */
export function formatThousands(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Parse a user-typed amount that may contain thousands separators
 * (e.g. "1,250,000") into a raw number. Returns NaN for invalid input.
 */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function setDefaultCurrency(c: Currency) {
  currencyState.defaultCurrency = c;
  // Notify subscribers via the store event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("currency-change"));
  }
}

/** React hook — re-renders on currency state changes. */
export function useCurrencies() {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("currency-change", callback);
      return () => window.removeEventListener("currency-change", callback);
    },
    () => currencyState,
    () => currencyState,
  );
}
