import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";

export const ACCESS_COOKIE = "netsleuth_access";
export const REFRESH_COOKIE = "netsleuth_refresh";
export const CSRF_COOKIE = "netsleuth_csrf";
export const AUTH_PATH = "/api/v1/auth";

export function cookieOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === "string" && value.length <= 8192 ? value : undefined;
}

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string; refreshLifetime: number }) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...cookieOptions("/"), maxAge: env.JWT_ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions(AUTH_PATH), maxAge: tokens.refreshLifetime * 1000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions("/"));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(AUTH_PATH));
}
