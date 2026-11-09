import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";
import { AUTH_PATH, CSRF_COOKIE, REFRESH_COOKIE, cookieOptions, readCookie } from "../modules/auth/auth.cookies.js";

function signature(context: string, refreshToken: string | undefined) {
  return createHmac("sha256", env.JWT_REFRESH_SECRET)
    .update(`netsleuth-csrf:${context}:${refreshToken ?? "anonymous"}`)
    .digest("hex");
}

export function issueCsrfToken(req: Request, res: Response) {
  const previous = readCookie(req, CSRF_COOKIE);
  const context = previous && /^[a-f0-9]{64}$/.test(previous) ? previous : randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, context, { ...cookieOptions(AUTH_PATH), maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
  return signature(context, readCookie(req, REFRESH_COOKIE));
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  // Validate browser origin as well as the signed, session-bound CSRF token.
  const origin = req.get("origin");
  const sameOrigin = `${req.protocol}://${req.get("host")}`;
  if (origin && origin !== sameOrigin && !env.CORS_ORIGINS.includes(origin)) {
    next(new HttpError(403, "Origin is not allowed"));
    return;
  }
  const context = readCookie(req, CSRF_COOKIE);
  const token = req.get("x-csrf-token");
  if (!context || !/^[a-f0-9]{64}$/.test(context) || !token || !/^[a-f0-9]{64}$/.test(token)) {
    next(new HttpError(403, "Invalid or missing CSRF token"));
    return;
  }
  const expected = signature(context, readCookie(req, REFRESH_COOKIE));
  if (!timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"))) {
    next(new HttpError(403, "Invalid or missing CSRF token"));
    return;
  }
  next();
};
