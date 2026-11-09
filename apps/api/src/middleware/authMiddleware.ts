import type { RequestHandler } from "express";
import type { AuthService } from "../modules/auth/auth.service.js";
import { ACCESS_COOKIE, readCookie } from "../modules/auth/auth.cookies.js";
import { HttpError } from "../utils/HttpError.js";

export function authMiddleware(service: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, ACCESS_COOKIE);
    if (!token) throw new HttpError(401, "Access cookie is required");
    const identity = await service.validateAccess(token);
    req.userId = identity.userId;
    req.sessionId = identity.sessionId;
    next();
  };
}
