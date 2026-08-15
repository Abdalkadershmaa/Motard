import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { container } from "@/infrastructure/container";
import { buildTenantContext } from "@/infrastructure/di/auth-context";
import { isOk } from "@/core/result";
import { toast } from "sonner";
import type { OrderFilter } from "@/application/ports/IOrderRepository";
import type { CreateOrderInput, UpdateOrderInput } from "@/core/dtos/OrderDTO";
import type { Order } from "@/domain/entities/Order";
import { UUID } from "@/domain/types";
import { rolls, refreshInventory } from "@/presentation/hooks/useInventory";

const ctx = buildTenantContext();

const KEYS = {
  root: ["orders"] as const,
  list: (f?: OrderFilter) => ["orders", "list", f ?? {}] as const,
  detail: (id: string) => ["orders", "detail", id] as const,
};

export function useOrdersList(filter: OrderFilter = {}) {
  return useQuery({
    queryKey: KEYS.list(filter),
    queryFn: ({ signal }) => {
      void signal;
      return container.orders.list.execute(filter, ctx);
    },
    staleTime: 30_000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => {
      void signal;
      return container.orders.repository.findById(id, ctx);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const res = await container.orders.create.execute(input, ctx);
      if (!isOk(res)) throw res.error;
      return res.value;
    },
    onSuccess: () => {
      toast.success("تم إنشاء الطلب");
      qc.invalidateQueries({ queryKey: KEYS.root });
      // Order create reserves rolls → stock availability changed.
      void refreshInventory();
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => {
      toast.error(`فشل إنشاء الطلب: ${e.message}`);
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await container.orders.cancel.execute(id, ctx);
      if (!isOk(res)) throw res.error;
      return res.value;
    },
    onSuccess: () => {
      toast.error("تم إلغاء الطلب");
      qc.invalidateQueries({ queryKey: KEYS.root });
      // Order cancel releases reservations → stock availability changed.
      void refreshInventory();
      qc.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (e: Error) => {
      toast.error(`فشل إلغاء الطلب: ${e.message}`);
    },
  });
}

export function useFulfillOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, invoiceId }: { orderId: string; invoiceId: string }) => {
      const res = await container.orders.fulfill.execute(orderId as UUID, invoiceId as UUID, ctx);
      if (!isOk(res)) throw res.error;
      return res.value;
    },
    onSuccess: () => {
      toast.info("تم تنفيذ الطلب");
      qc.invalidateQueries({ queryKey: KEYS.root });
      // Fulfill releases reservations → stock availability changed.
      void refreshInventory();
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => {
      toast.error(`فشل تنفيذ الطلب: ${e.message}`);
    },
  });
}

export { type Order, type CreateOrderInput, type UpdateOrderInput, type OrderFilter };

export type OrderStatus = "open" | "partially_available" | "available" | "fulfilled" | "cancelled";
export type OrderAvailability = "none" | "partial" | "full";

type OrderAvailabilityItem = {
  fabricId?: string | null;
  fabricName: string;
  colorId?: string | null;
  colorName: string;
  requestedKg: number;
};

/** Rolls currently in stock (remainingKg > 0) matching an order item by color. */
export function matchRollsForItem(item: OrderAvailabilityItem): {
  rollIds: string[];
  availableKg: number;
} {
  if (!item.colorId) return { rollIds: [], availableKg: 0 };
  const available = rolls.filter((r) => r.remainingKg > 0 && r.colorId === item.colorId);
  return {
    rollIds: available.map((r) => r.id),
    availableKg: available.reduce((sum, r) => sum + r.remainingKg, 0),
  };
}

export function orderAvailability(o: {
  items: ReadonlyArray<OrderAvailabilityItem>;
}): OrderAvailability {
  if (o.items.length === 0) return "none";
  let anyMatch = false;
  let allFull = true;
  for (const it of o.items) {
    const { availableKg } = matchRollsForItem(it);
    if (availableKg > 0) anyMatch = true;
    if (availableKg < it.requestedKg) allFull = false;
  }
  return anyMatch ? (allFull ? "full" : "partial") : "none";
}
