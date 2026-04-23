import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerAdminAuthRoutes } from "./adminAuth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import disponibilitesRouter from "../routes/disponibilites";
import avisRouter from "../routes/avis";
import reservationsRouter from "../routes/reservations";
import cabinesRouter from "../routes/cabines";
import stripeRouter from "../routes/stripe";
import stripeWebhookRouter from "../routes/stripeWebhook";
import icalRouter from "../routes/ical";
import googleReviewsRouter from "../routes/googleReviews";
import contactRouter from "../routes/contact";
import workflowRouter from "../routes/workflow";
import customerAuthRouter from "../routes/customerAuth";
import customerPortalRouter from "../routes/customerPortal";
import adminDocumentsRouter from "../routes/adminDocuments";
import backofficeOpsRouter from "../routes/backofficeOps";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Stripe webhook DOIT utiliser express.raw AVANT express.json pour vérifier la signature
  app.use("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookRouter);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerAdminAuthRoutes(app);
  // API routes
  app.use("/api/disponibilites", disponibilitesRouter);
  app.use("/api/avis", avisRouter);
  app.use("/api/reservations", reservationsRouter);
  app.use("/api/cabines-reservees", cabinesRouter);
  app.use("/api/stripe", stripeRouter);
  app.use("/api/ical", icalRouter);
  app.use("/api/google-reviews", googleReviewsRouter);
  app.use("/api/contact", contactRouter);
  app.use("/api/workflow", workflowRouter);
  app.use("/api/customer-auth", customerAuthRouter);
  app.use("/api/customer-portal", customerPortalRouter);
  app.use("/api/admin-documents", adminDocumentsRouter);
  app.use("/api/backoffice-ops", backofficeOpsRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
