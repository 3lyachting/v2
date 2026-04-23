import type { NextFunction, Request, Response } from "express";
import { sdk } from "./sdk";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Security-first default: never bypass auth unless explicitly requested.
  // This avoids accidental open admin access when NODE_ENV is unset/misconfigured in hosting.
  const bypassEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.ADMIN_AUTH_BYPASS === "true";
  if (bypassEnabled) {
    return next();
  }
  try {
    const user = await sdk.authenticateRequest(req);
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin requis" });
    }
    (req as any).authUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Authentification requise" });
  }
}

