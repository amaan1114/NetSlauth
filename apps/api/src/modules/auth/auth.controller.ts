import type { RequestHandler } from "express";
import { HttpResponse } from "../../utils/HttpResponse.js";
import { HttpError } from "../../utils/HttpError.js";
import { issueCsrfToken } from "../../middleware/csrfProtection.js";
import { AUTH_PATH, CSRF_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, cookieOptions, readCookie, setAuthCookies } from "./auth.cookies.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
import type { AuthService } from "./auth.service.js";

export function createAuthController(service: AuthService) {
  const register: RequestHandler = async (req, res) => {
    const result = await service.register(registerSchema.parse(req.body));
    setAuthCookies(res, result);
    res.status(201).json(new HttpResponse(201, "Registration successful", { user: result.user }));
  };
  const login: RequestHandler = async (req, res) => {
    const result = await service.login(loginSchema.parse(req.body));
    setAuthCookies(res, result);
    res.json(new HttpResponse(200, "Login successful", { user: result.user }));
  };
  const refresh: RequestHandler = async (req, res) => {
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) throw new HttpError(401, "Refresh cookie is required");
    try {
      const result = await service.refresh(token);
      setAuthCookies(res, result);
      res.json(new HttpResponse(200, "Session refreshed", { user: result.user }));
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) clearAuthCookies(res);
      throw error;
    }
  };
  const logout: RequestHandler = async (req, res) => {
    await service.logout(readCookie(req, REFRESH_COOKIE), readCookie(req, ACCESS_COOKIE));
    clearAuthCookies(res);
    res.clearCookie(CSRF_COOKIE, cookieOptions(AUTH_PATH));
    res.json(new HttpResponse(200, "Logout successful"));
  };
  const me: RequestHandler = async (req, res) => {
    if (!req.userId) throw new HttpError(401, "Authentication is required");
    res.json(new HttpResponse(200, "Current user", { user: await service.currentUser(req.userId) }));
  };
  const csrf: RequestHandler = (req, res) => {
    res.json(new HttpResponse(200, "CSRF token issued", { csrfToken: issueCsrfToken(req, res) }));
  };
  return { register, login, refresh, logout, me, csrf };
}
