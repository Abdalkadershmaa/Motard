import { Redis } from "ioredis";
import { redis } from "../../auth/TokenDenylist.js";

/**
 * Idempotency-Key service for POST endpoints.
 *
 * Contract:
 *   - Client sends header `Idempotency-Key: <string>` (recommended: UUID).
 *   - Server caches the response under that key for IDEMPOTENCY_TTL_SECONDS.
 *   - If the same key arrives again within the TTL, the cached response is
 *     returned (status+body bytes) and the handler is NOT executed again.
 *   - If no key is provided, the handler runs normally (no idempotency).
 *
 * Storage:
 *   - Primary: Redis (if available) using SETEX with TTL.
 *   - Fallback: in-memory Map (best-effort within a single process; useful for
 *     dev/test when Redis is not configured).
 *
 * Key format: `idempotency:<tenantId>:<method>:<path>:<key>` to avoid cross-tenant
 * collisions and allow scoped replay when the same key is intentionally used
 * across different endpoints.
 */

export const IDEMPOTENCY_TTL_SECONDS = 300; // 5 minutes
const IDEMPOTENCY_HEADER = "idempotency-key";

interface CachedResponse {
  status: number;
  body: string;
  contentType: string;
}

const memoryCache = new Map<string, CachedResponse>();

function buildKey(tenantId: string, method: string, path: string, key: string): string {
  return `idempotency:${tenantId}:${method}:${path}:${key}`;
}

export function getIdempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers[IDEMPOTENCY_HEADER];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 200) return null;
  return trimmed;
}

export async function readCached(
  tenantId: string,
  method: string,
  path: string,
  key: string,
): Promise<CachedResponse | null> {
  const fullKey = buildKey(tenantId, method, path, key);
  if (redis) {
    try {
      const raw = await redis.get(fullKey);
      if (raw) return JSON.parse(raw) as CachedResponse;
    } catch {
      // fall through to memory cache
    }
  }
  return memoryCache.get(fullKey) ?? null;
}

export async function writeCached(
  tenantId: string,
  method: string,
  path: string,
  key: string,
  status: number,
  body: string,
  contentType: string,
): Promise<void> {
  const fullKey = buildKey(tenantId, method, path, key);
  const value: CachedResponse = { status, body, contentType };
  if (redis) {
    try {
      await redis.setex(fullKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(value));
      return;
    } catch {
      // fall through
    }
  }
  memoryCache.set(fullKey, value);
  // Naive cleanup: rely on TTL via a sweep. For dev/test fallback this is fine.
  setTimeout(() => {
    if (memoryCache.get(fullKey) === value) memoryCache.delete(fullKey);
  }, IDEMPOTENCY_TTL_SECONDS * 1000).unref();
}

/**
 * Atomically claim an idempotency key BEFORE running the handler (I3 fix).
 * Under concurrency, two in-flight requests with the same key must not both
 * execute: the first caller wins the claim; the second is a duplicate.
 * - Redis: `SET key value NX EX ttl` (returns "OK" only if the key is new).
 * - Memory fallback: synchronous check-and-set (single-threaded → atomic).
 */
export async function tryClaim(
  tenantId: string,
  method: string,
  path: string,
  key: string,
): Promise<boolean> {
  const fullKey = buildKey(tenantId, method, path, key);
  const placeholder: CachedResponse = { status: 0, body: "", contentType: "application/json" };
  if (redis) {
    try {
      const result = await redis.set(
        fullKey,
        JSON.stringify(placeholder),
        "EX",
        IDEMPOTENCY_TTL_SECONDS,
        "NX",
      );
      return result === "OK";
    } catch {
      // fall through to memory
    }
  }
  if (memoryCache.has(fullKey)) return false;
  memoryCache.set(fullKey, placeholder);
  return true;
}

export { redis };
