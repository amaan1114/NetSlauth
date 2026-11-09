import type { RequestHandler } from "express";
import { validateAccessToken } from "../modules/auth/auth.service.js";
import { HttpError } from "../utils/HttpError.js";

export const authMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const accessToken: unknown = req.cookies.netsleuth_access;
    if (typeof accessToken !== "string" || !accessToken || accessToken.length > 8192) {
      throw new HttpError(401, "Access cookie is required");
    }
    const { userId, sessionId } = await validateAccessToken(accessToken);
    req.userId = userId;
    req.sessionId = sessionId;
    next();
  } catch (error) {
    next(error);
  }
};
