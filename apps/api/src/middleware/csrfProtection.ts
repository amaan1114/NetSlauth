import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { env, refreshCookieConfig } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";

function signature(context: string, refreshToken: unknown) {
  return createHmac("sha256", env.JWT_REFRESH_SECRET)
    .update(`netsleuth-csrf:${context}:${typeof refreshToken === "string" && refreshToken.length <= 8192 ? refreshToken : "anonymous"}`)
    .digest("hex");
}

export function issueCsrfToken(req: Request, res: Response) {
  const previous: unknown = req.cookies.netsleuth_csrf;
  const context = typeof previous === "string" && /^[a-f0-9]{64}$/.test(previous) ? previous : randomBytes(32).toString("hex");
  res.cookie("netsleuth_csrf", context, { ...refreshCookieConfig, maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
  return signature(context, req.cookies.netsleuth_refresh);
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  // Validate browser origin as well as the signed, session-bound CSRF token.
  const origin = req.get("origin");
  const sameOrigin = `${req.protocol}://${req.get("host")}`;
  if (origin && origin !== sameOrigin && !env.CORS_ORIGINS.includes(origin)) {
    next(new HttpError(403, "Origin is not allowed"));
    return;
  }
  const context: unknown = req.cookies.netsleuth_csrf;
  const token = req.get("x-csrf-token");
  if (typeof context !== "string" || !/^[a-f0-9]{64}$/.test(context) || !token || !/^[a-f0-9]{64}$/.test(token)) {
    next(new HttpError(403, "Invalid or missing CSRF token"));
    return;
  }
  const expected = signature(context, req.cookies.netsleuth_refresh);
  if (!timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"))) {
    next(new HttpError(403, "Invalid or missing CSRF token"));
    return;
  }
  next();
};
