import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import type { Pool } from "pg";
import { requestLogger } from "./middleware/requestLogger";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { hiddenDemandRouter } from "./routes/hiddenDemand";
import { opportunitiesRouter } from "./routes/opportunities";
import { opportunitySummaryRouter } from "./routes/opportunitySummary";
import { clientsRouter } from "./routes/clients";
import { candidatesRouter } from "./routes/candidates";
import { jobOpeningsRouter } from "./routes/jobOpenings";
import { clientMatchmakingRouter } from "./routes/clientMatchmaking";
import { hardToFillTargetingRouter } from "./routes/hardToFillTargeting";
import { salesPipelineRouter } from "./routes/salesPipeline";
import { opportunityPackageRouter } from "./routes/opportunityPackage";
import { opportunityRelationshipsRouter } from "./routes/opportunityRelationships";
import { recommendationEngineRouter } from "./routes/recommendationEngine";
import { analyticsRouter } from "./routes/analytics";
import { predictiveAnalysisRouter } from "./routes/predictiveAnalysis";
import { privacyRouter } from "./routes/privacy";
import { crmWriteRouter } from "./routes/crmWrite";
import { revenueAnomaliesRouter } from "./routes/revenueAnomalies";
import { fitsRouter } from "./routes/fits";
import type { MarketSignalProvider } from "./adapters/marketSignalProvider";
import { LoggingPipelineNotifier, type PipelineNotifier } from "./adapters/pipelineNotifier";

export function createApp(
  pool: Pool,
  marketSignalProvider: MarketSignalProvider,
  options?: { providerTimeoutMs?: number },
  notifier: PipelineNotifier = new LoggingPipelineNotifier(),
): Express {
  const app = express();

  // Render sits exactly one proxy hop in front of this container (decision
  // 036). Trusting that one hop, not an unbounded chain, means req.ip and
  // req.secure reflect the real client without letting a client spoof its
  // own IP via a forged X-Forwarded-For header.
  app.set("trust proxy", 1);

  const corsOrigin = process.env.CORS_ORIGIN ?? "*";
  const corsOrigins =
    corsOrigin === "*" ? "*" : corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: corsOrigins }));
  app.use(requestLogger);
  app.use(express.json({ limit: "10kb" }));

  // Every route lives under /api. The frontend is a separate Render Static
  // Site (decision 031), not served by this process, so CORS_ORIGIN must
  // list every real origin that calls this API.
  app.use("/api", healthRouter(pool));
  app.use("/api", authRouter(pool));
  app.use("/api", adminRouter(pool));
  app.use("/api", hiddenDemandRouter(pool, marketSignalProvider, options));
  app.use("/api", opportunitiesRouter(pool));
  app.use("/api", opportunitySummaryRouter(pool));
  app.use("/api", clientsRouter(pool));
  app.use("/api", candidatesRouter(pool));
  app.use("/api", jobOpeningsRouter(pool));
  app.use("/api", clientMatchmakingRouter(pool));
  app.use("/api", hardToFillTargetingRouter(pool));
  app.use("/api", salesPipelineRouter(pool, notifier));
  app.use("/api", opportunityPackageRouter(pool));
  app.use("/api", opportunityRelationshipsRouter(pool));
  app.use("/api", recommendationEngineRouter(pool));
  app.use("/api", analyticsRouter(pool));
  app.use("/api", predictiveAnalysisRouter(pool));
  app.use("/api", privacyRouter(pool));
  app.use("/api", crmWriteRouter(pool));
  app.use("/api", revenueAnomaliesRouter(pool));
  app.use("/api", fitsRouter(pool));

  // The built frontend (decision 037: one Render service, not a separate
  // Static Site) lives alongside dist/ inside the container image — see the
  // top-level Dockerfile's frontend-build stage. Mounted after every /api
  // route so nothing here can shadow an API path.
  app.use(express.static(path.join(__dirname, "..", "frontend-dist")));

  return app;
}
