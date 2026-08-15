import type { TenantContext } from "../../domain/types/index.js";

export interface IAuditRepository {
  create(data: {
    tenantId: string;
    actorId?: string;
    actorName?: string;
    module: string;
    action: string;
    entityType?: string;
    entityId?: string;
    detail?: string;
    beforeSnapshot?: Record<string, unknown>;
    afterSnapshot?: Record<string, unknown>;
    ipAddress?: string;
  }): Promise<void>;
}
