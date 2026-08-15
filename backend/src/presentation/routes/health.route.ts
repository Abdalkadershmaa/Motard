import { Router } from "express";

export function registerHealthRoutes(
  router: Router,
  checkDatabase: () => Promise<boolean>,
  checkRedis: () => Promise<boolean>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rbac: any,
) {
  router.get("/api/health/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.get("/api/health/ready", async (_req, res) => {
    const dbOk = await checkDatabase();
    const redisOk = await checkRedis();

    if (dbOk && redisOk) {
      res.status(200).json({ status: "ready", checks: { database: true, redis: true } });
    } else {
      res.status(503).json({
        status: "not_ready",
        checks: { database: dbOk, redis: redisOk },
      });
    }
  });

  router.get("/api/health/deep", rbac(["admin"]), async (_req, res) => {
    const dbOk = await checkDatabase();
    const redisOk = await checkRedis();
    res.status(200).json({
      status: dbOk && redisOk ? "ok" : "degraded",
      checks: { database: dbOk, redis: redisOk, migrations: "pending" },
    });
  });
}
