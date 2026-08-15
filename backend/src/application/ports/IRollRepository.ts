import type { TenantContext, PaginatedResult, UUID } from "../../domain/types/index.js";
import type { RollData } from "../../domain/entities/Roll.js";

export interface RollFilter {
  colorId?: UUID;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateRollData {
  colorId: UUID;
  rollNo: string;
  dyeBatch?: string;
  initialKg: number;
  remainingKg?: number;
  pricePerKg: number;
  salePricePerKg?: number;
  currency?: string;
  supplierId?: UUID;
  entryDate: string;
  widthCm?: number;
  weightGsm?: number;
}

export interface IRollRepository {
  findById(id: string, ctx: TenantContext): Promise<RollData | null>;
  findByRollNo(rollNo: string, ctx: TenantContext): Promise<RollData | null>;
  list(filter: RollFilter, ctx: TenantContext): Promise<PaginatedResult<RollData>>;
  create(data: CreateRollData, ctx: TenantContext): Promise<RollData>;
  update(id: string, data: Partial<CreateRollData>, ctx: TenantContext): Promise<RollData>;
  decrement(id: string, kg: number, expectedVersion: number, ctx: TenantContext): Promise<RollData>;
  increment(id: string, kg: number, expectedVersion: number, ctx: TenantContext): Promise<RollData>;
  delete(id: string, ctx: TenantContext): Promise<boolean>;
}
