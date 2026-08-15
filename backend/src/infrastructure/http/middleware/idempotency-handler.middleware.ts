import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  getIdempotencyKey,
  readCached,
  writeCached,
  tryClaim,
} from "./idempotency.middleware.js";
import { NotFoundError } from "../../../domain/errors/index.js";

/**
 * Wrap a POST handler so that requests with an `Idempotency-Key` header are
 * cached. Replays within the TTL return the cached response without running
 * the handler again.
 *
 * Tenant scoping: the key is scoped to the tenant from `req.tenantContext` so
 * cross-tenant collisions are impossible.
 *
 * I3 fix: the key is claimed ATOMICALLY (tryClaim, SET NX) before the handler
 * runs, so two concurrent in-flight requests with the same key do not both
 * execute — the loser gets a 409 duplicate-in-flight response.
 */
export function idempotency(...methods: string[]): RequestHandler {
  const allowed = new Set(methods.map((m) => m.toUpperCase()));
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!allowed.has(req.method.toUpperCase())) {
        return next();
      }
      const key = getIdempotencyKey(req);
      if (!key) {
        return next(); // no key, no idempotency — treat as fresh request
      }
      const tenantId = req.tenantContext?.tenantId;
      if (!tenantId) {
        // No tenant context — skip idempotency (middleware order issue)
        return next();
      }
      const cached = await readCached(tenantId, req.method, req.path, key);
      if (cached && cached.status > 0) {
        res
          .status(cached.status)
          .setHeader("Content-Type", cached.contentType)
          .setHeader("Idempotency-Replay", "true")
          .send(cached.body);
        return;
      }
      // Atomically claim the key before running the handler (I3 fix). If another
      // concurrent request already claimed it, refuse as a duplicate in-flight.
      const claimed = await tryClaim(tenantId, req.method, req.path, key);
      if (!claimed) {
        res.status(409).json({
          code: "DUPLICATE_IN_FLIGHT",
          message: "طلب مكرر قيد المعالجة",
          statusCode: 409,
        });
        return;
      }
      // Patch res.json to capture the response body and persist it.
      const originalJson = res.json.bind(res);
      let capturedBody: string | null = null;
      let capturedStatus = res.statusCode;
      let capturedContentType = "application/json; charset=utf-8";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).json = (body: unknown) => {
        try {
          capturedBody = JSON.stringify(body);
          capturedContentType = "application/json; charset=utf-8";
        } catch {
          capturedBody = null;
        }
        return originalJson(body);
      };
      res.on("finish", () => {
        capturedStatus = res.statusCode;
        if (capturedBody !== null && res.statusCode < 500) {
          // Only cache 2xx/3xx/4xx — never cache 5xx (so retries can succeed)
          void writeCached(
            tenantId,
            req.method,
            req.path,
            key,
            capturedStatus,
            capturedBody,
            capturedContentType,
          ).catch(() => {
            // best-effort cache write
          });
        }
      });
      next();
    } catch (e) {
      // If idempotency storage is broken, still serve the request
      next();
    }
  };
}

// Maintain a reference so the symbol is not tree-shaken
export const _notFoundMarker = new NotFoundError("idempotency");
