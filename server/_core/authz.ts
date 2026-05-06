import type { NextFunction, Request, Response } from "express";
import { sdk } from "./sdk";

/** Accès réservé au rôle admin complet (pas les comptes « consultation »). */
export async function requireAdminExclusive(req: Request, res: Response, next: NextFunction) {
  const bypassEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.ADMIN_AUTH_BYPASS === "true";
  if (bypassEnabled) {
    return next();
  }
  try {
    const user = await sdk.authenticateRequest(req);
    if (String((user as any).role || "") !== "admin") {
      return res.status(403).json({ error: "Réservé aux administrateurs principaux" });
    }
    (req as any).authUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: "Authentification requise" });
  }
}

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
    const role = String((user as any).role || "");
    if (role === "admin") {
      (req as any).authUser = user;
      return next();
    }
    if (role === "viewer" && (req.method === "GET" || req.method === "HEAD")) {
      (req as any).authUser = user;
      return next();
    }
    if (role === "viewer") {
      return res.status(403).json({ error: "Accès consultatif uniquement" });
    }
    return res.status(403).json({ error: "Admin requis" });
  } catch {
    return res.status(401).json({ error: "Authentification requise" });
  }
}

