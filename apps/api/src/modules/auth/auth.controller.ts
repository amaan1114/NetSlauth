import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { HttpError } from "../../utils/HttpError.js";
import { env, cookieConfig, refreshCookieConfig } from "../../config/env.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
import {
  signUpService, signInService, getMeService,
  refreshTokenService,
} from "./auth.service.js";
import { disconnectUserSockets } from "../../realtime.js";
import { verifyToken } from "../../utils/token.js";

export const signUpController: RequestHandler = async (req, res, next) => {
  try {
    const { name, email, password } = registerSchema.parse(req.body);
    const { user, accessToken, refreshToken, refreshLifetime } = await signUpService(name, email, password);
    res.cookie("netsleuth_access", accessToken, { ...cookieConfig, maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000 });
    res.cookie("netsleuth_refresh", refreshToken, { ...refreshCookieConfig, maxAge: refreshLifetime * 1000 });
    return res.status(201).json(new HttpResponse(201, "Registration successful", { user }));
  } catch (error) {
    next(error);
  }
};

export const signInController: RequestHandler = async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { user, accessToken, refreshToken, refreshLifetime } = await signInService(email, password);
    res.cookie("netsleuth_access", accessToken, { ...cookieConfig, maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000 });
    res.cookie("netsleuth_refresh", refreshToken, { ...refreshCookieConfig, maxAge: refreshLifetime * 1000 });
    return res.json(new HttpResponse(200, "Login successful", { user }));
  } catch (error) {
    next(error);
  }
};

export const getMeController: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userId) throw new HttpError(401, "Authentication is required");
    const user = await getMeService(req.userId);
    return res.json(new HttpResponse(200, "Current user", { user }));
  } catch (error) {
    next(error);
  }
};

export const refreshSessionController: RequestHandler = async (req, res, next) => {
  try {
    const token: unknown = req.cookies.netsleuth_refresh;
    if (typeof token !== "string" || !token || token.length > 8192) {
      throw new HttpError(401, "Refresh cookie is required");
    }
    const { user, accessToken, refreshToken, refreshLifetime } = await refreshTokenService(token);
    disconnectUserSockets(user.id);
    res.cookie("netsleuth_access", accessToken, { ...cookieConfig, maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000 });
    res.cookie("netsleuth_refresh", refreshToken, { ...refreshCookieConfig, maxAge: refreshLifetime * 1000 });
    return res.json(new HttpResponse(200, "Session refreshed", { user }));
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 401) {
      res.clearCookie("netsleuth_access", cookieConfig);
      res.clearCookie("netsleuth_refresh", refreshCookieConfig);
    }
    next(error);
  }
};

export const logoutController: RequestHandler = async (req, res, next) => {
  try {
    const accessToken = req.cookies.netsleuth_access;
    if (typeof accessToken === "string") {
      try {
        disconnectUserSockets(verifyToken(accessToken, "access").userId);
      } catch {
        // Logout remains successful even when the access cookie is expired.
      }
    }
    res.clearCookie("netsleuth_access", cookieConfig);
    res.clearCookie("netsleuth_refresh", refreshCookieConfig);
    return res.json(new HttpResponse(200, "Logout successful"));
  } catch (error) {
    next(error);
  }
};
