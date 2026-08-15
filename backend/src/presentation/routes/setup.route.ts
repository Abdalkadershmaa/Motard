import { Router } from "express";
import { z } from "zod";
import { config } from "../../infrastructure/config/env.js";
import type { Container } from "../../infrastructure/di/container.js";
import {
  startWizardUseCase,
  getStatusUseCase,
  activateAndPersistUseCase,
  saveCompanyStepUseCase,
  saveAdminStepUseCase,
  saveReviewStepUseCase,
  completeWizardUseCase,
} from "../../application/use-cases/setup/setupUseCases.js";

/**
 * Phase 0 sub-batch 0F — setup routes.
 *
 *   GET  /api/setup/status?tenantId=...
 *   POST /api/setup/init             (SETUP_TOKEN-gated; creates the tenant)
 *   POST /api/setup/wizard/activate  (consumes the activation key)
 *
 * The `SETUP_TOKEN` env guards the bootstrap path. In dev, the
 * token is optional; in production it is required (validated at
 * container startup — the `isSetupTokenRequired` check below is a
 * belt-and-suspenders guard).
 */
function checkSetupToken(req: { headers: Record<string, unknown> }): boolean {
  if (!config.SETUP_TOKEN) {
    // In dev (or when no token is configured), allow without a token.
    return process.env.NODE_ENV !== "production";
  }
  const provided = (req.headers["x-setup-token"] as string | undefined) ?? "";
  return provided === config.SETUP_TOKEN;
}

export function registerSetupRoutes(router: Router, container: Container): void {
  // GET /api/setup/status — read-only, no token required
  // Returns default "not completed" state when DB is unavailable (dev mode without PostgreSQL)
  router.get("/api/setup/status", async (req, res, next) => {
    try {
      const tenantId = String(req.query.tenantId ?? "bootstrap");
      const r = await getStatusUseCase(container.installationStateRepo, tenantId);
      if (!r.ok) {
        // If DB unavailable, return default wizard state for dev
        res.json({ isCompleted: false, currentStep: "welcome" });
        return;
      }
      res.json(r.data);
    } catch {
      // Fallback for dev without DB: wizard not completed
      res.json({ isCompleted: false, currentStep: "welcome" });
    }
  });

  // POST /api/setup/init — SETUP_TOKEN gated
  router.post("/api/setup/init", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res.status(401).json({
          code: "UNAUTHORIZED",
          message: "رمز الإعداد غير صحيح",
          statusCode: 401,
        });
        return;
      }
      const r = await startWizardUseCase(
        container.tenantRepo,
        container.installationStateRepo,
        req.body,
      );
      if (!r.ok) {
        res.status(422).json({ code: "VALIDATION_ERROR", message: r.error, statusCode: 422 });
        return;
      }
      res.json(r.data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/setup/wizard/activate — SETUP_TOKEN gated
  const activateBody = z.object({ key: z.string().min(1), tenantId: z.string().uuid() });
  router.post("/api/setup/wizard/activate", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "رمز الإعداد غير صحيح", statusCode: 401 });
        return;
      }
      const parsed = activateBody.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json({ code: "VALIDATION_ERROR", message: "بيانات غير صالحة", statusCode: 422 });
        return;
      }
      const r = await activateAndPersistUseCase(
        {
          licenseProvider: container.licenseProvider,
          tenantRepo: container.tenantRepo,
          installationStateRepo: container.installationStateRepo,
          secretsRepo: container.secretsRepo,
          fingerprintProvider: container.fingerprintProvider,
          installationIdStorage: container.installationIdStorage,
          tokenSigner: container.licenseTokenSigner,
          licenseRepo: container.licenseRepo,
        },
        parsed.data.tenantId,
        { key: parsed.data.key },
      );
      if (!r.ok) {
        res.status(400).json({ code: "ACTIVATION_FAILED", message: r.error, statusCode: 400 });
        return;
      }
      res.json(r.data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/setup/wizard/company
  router.post("/api/setup/wizard/company", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "رمز الإعداد غير صحيح", statusCode: 401 });
        return;
      }
      const tenantId = (req.body?.tenantId as string) ?? "";
      if (!tenantId) {
        res
          .status(422)
          .json({ code: "VALIDATION_ERROR", message: "tenantId مطلوب", statusCode: 422 });
        return;
      }
      const r = await saveCompanyStepUseCase(
        container.companyRepo,
        container.installationStateRepo,
        tenantId,
        req.body,
      );
      if (!r.ok) {
        res.status(422).json({ code: "VALIDATION_ERROR", message: r.error, statusCode: 422 });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/setup/wizard/admin
  router.post("/api/setup/wizard/admin", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "رمز الإعداد غير صحيح", statusCode: 401 });
        return;
      }
      const tenantId = (req.body?.tenantId as string) ?? "";
      const r = await saveAdminStepUseCase(
        {
          installationStateRepo: container.installationStateRepo,
          passwordHasher: container.passwordHasher,
        },
        tenantId,
        req.body,
      );
      if (!r.ok) {
        res.status(422).json({ code: "VALIDATION_ERROR", message: r.error, statusCode: 422 });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/setup/wizard/review
  router.post("/api/setup/wizard/review", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "رمز الإعداد غير صحيح", statusCode: 401 });
        return;
      }
      const tenantId = (req.body?.tenantId as string) ?? "";
      const r = await saveReviewStepUseCase(container.installationStateRepo, tenantId, req.body);
      if (!r.ok) {
        res.status(422).json({ code: "VALIDATION_ERROR", message: r.error, statusCode: 422 });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/setup/wizard/complete
  router.post("/api/setup/wizard/complete", async (req, res, next) => {
    try {
      if (!checkSetupToken(req)) {
        res
          .status(401)
          .json({ code: "UNAUTHORIZED", message: "رمز الإعداد غير صحيح", statusCode: 401 });
        return;
      }
      const tenantId = (req.query.tenantId as string) ?? (req.body?.tenantId as string) ?? "";
      const r = await completeWizardUseCase(
        {
          installationStateRepo: container.installationStateRepo,
          authRepo: container.authRepo,
        },
        tenantId,
      );
      if (!r.ok) {
        res.status(500).json({ code: "INTERNAL", message: r.error, statusCode: 500 });
        return;
      }
      res.json(r.data);
    } catch (err) {
      next(err);
    }
  });
}
