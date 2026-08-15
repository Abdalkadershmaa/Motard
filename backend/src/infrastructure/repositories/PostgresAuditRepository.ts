import type { DB } from "../orm/drizzle.js";
import type { IAuditRepository } from "../../application/ports/IAuditRepository.js";
import { auditLogs } from "../orm/schemas/audit-log.table.js";

export class PostgresAuditRepository implements IAuditRepository {
  constructor(private readonly db: DB) {}

  async create(data: {
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
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      tenantId: data.tenantId,
      actorId: data.actorId ?? null,
      actorName: data.actorName ?? null,
      module: data.module,
      action: data.action,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      detail: data.detail ?? null,
      beforeSnapshot: data.beforeSnapshot ? JSON.stringify(data.beforeSnapshot) : null,
      afterSnapshot: data.afterSnapshot ? JSON.stringify(data.afterSnapshot) : null,
      ipAddress: data.ipAddress ?? null,
    });
  }
}
