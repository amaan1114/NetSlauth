import type { ErrorResponse, SuccessResponse } from "@workspace/netsleuth-shared";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  databasePolicy: {
    databasePorts: number[];
    allowedDestinations: {
      ip: string;
      port: number;
      protocol: "TCP" | "UDP" | "OTHER";
    }[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceList {
  workspaces: Workspace[];
}

export interface ProjectList {
  projects: Project[];
}

export interface AuthPayload {
  user: User;
}

export class ApiError extends Error {
  readonly status: number;
  readonly isNetworkError: boolean;

  constructor(message: string, status = 0, isNetworkError = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("Could not reach the NetSleuth API. Check your connection and try again.", 0, true);
  }

  let payload: SuccessResponse<T> | ErrorResponse | undefined;
  try {
    payload = (await response.json()) as SuccessResponse<T> | ErrorResponse;
  } catch {
    if (!response.ok) {
      throw new ApiError(`The server returned an unexpected response (${response.status}).`, response.status);
    }
  }

  if (!response.ok || payload?.success === false) {
    const errorPayload = payload as ErrorResponse | undefined;
    throw new ApiError(errorPayload?.message ?? `Request failed (${response.status}).`, response.status);
  }

  const successPayload = payload as SuccessResponse<T> | undefined;
  if (!successPayload || !successPayload.success) {
    throw new ApiError("The server returned an invalid response.", response.status);
  }
  return successPayload.data as T;
}

export async function apiRequestWithRefresh<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || path.endsWith("/auth/refresh")) {
      throw error;
    }
    try {
      if (!refreshInFlight) {
        refreshInFlight = apiRequest<AuthPayload>("/api/v1/auth/refresh", { method: "POST" })
          .then(() => undefined)
          .finally(() => {
            refreshInFlight = null;
          });
      }
      await refreshInFlight;
    } catch (refreshError) {
      throw refreshError instanceof ApiError
        ? refreshError
        : new ApiError("Your session has expired.", 401);
    }
    return apiRequest<T>(path, options);
  }
}

let refreshInFlight: Promise<void> | null = null;
