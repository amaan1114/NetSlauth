"use client";

import { useEffect, useMemo, useState } from "react";
import type { AlertDetail, AlertList, AlertRelatedEvents, AlertSeverity, AlertStatus } from "@workspace/netsleuth-shared";
import { ApiError, apiRequestWithRefresh } from "@/lib/api";
import { isExactIpAddress } from "@/lib/events-explorer";

export interface AlertFilters {
  severity: string;
  status: string;
  ruleId: string;
  sourceIp: string;
  start: string;
  end: string;
}

export const EMPTY_ALERT_FILTERS: AlertFilters = {
  severity: "", status: "", ruleId: "", sourceIp: "", start: "", end: "",
};

export function validateAlertFilters(filters: AlertFilters, isExactIpAddress: (value: string) => boolean): string[] {
  const errors: string[] = [];
  if (filters.severity && !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(filters.severity)) errors.push("Choose a listed severity.");
  if (filters.status && !["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(filters.status)) errors.push("Choose a listed status.");
  if (filters.ruleId.trim().length > 100) errors.push("Rule ID must be 100 characters or fewer.");
  if (filters.sourceIp.trim() && !isExactIpAddress(filters.sourceIp.trim())) errors.push("Source IP must be one complete IPv4 or IPv6 address.");
  const start = filters.start ? new Date(filters.start) : null;
  const end = filters.end ? new Date(filters.end) : null;
  if (filters.start && (!start || Number.isNaN(start.getTime()))) errors.push("Enter a valid start time.");
  if (filters.end && (!end || Number.isNaN(end.getTime()))) errors.push("Enter a valid end time.");
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) errors.push("End time must be later than start time.");
  return errors;
}

export function makeAlertListUrl(projectId: string, page: number, filters: AlertFilters): string {
  const query = new URLSearchParams({ page: String(page), limit: "20" });
  if (filters.severity) query.set("severity", filters.severity);
  if (filters.status) query.set("status", filters.status);
  if (filters.ruleId.trim()) query.set("ruleId", filters.ruleId.trim());
  if (filters.sourceIp.trim()) query.set("sourceIp", filters.sourceIp.trim());
  if (filters.start) query.set("start", new Date(filters.start).toISOString());
  if (filters.end) query.set("end", new Date(filters.end).toISOString());
  return `/api/v1/projects/${encodeURIComponent(projectId)}/alerts?${query.toString()}`;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function useAlertList(projectId: string, page: number, filters: AlertFilters, refreshNonce: number, clearAuth: () => void, pending = false) {
  const validationErrors = useMemo(() => validateAlertFilters(filters, isExactIpAddress), [filters]);
  const requestKey = `${projectId}:${page}:${JSON.stringify(filters)}:${refreshNonce}`;
  const [state, setState] = useState<{ key: string; result: AlertList | null; error: string | null }>({ key: "", result: null, error: null });
  useEffect(() => {
    if (!projectId || pending || validationErrors.length) return;
    let active = true;
    const controller = new AbortController();
    const key = requestKey;
    void apiRequestWithRefresh<AlertList>(makeAlertListUrl(projectId, page, filters), { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        if (!Array.isArray(result.alerts) || result.alerts.some((alert) => alert.projectId !== projectId)) {
          setState({ key, result: null, error: "The API returned alerts outside this project scope. Those records were withheld." });
          return;
        }
        setState({ key, result, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setState({ key, result: null, error: errorText(error, "Could not load security alerts for this project.") });
      });
    return () => { active = false; controller.abort(); };
  }, [clearAuth, filters, page, pending, projectId, refreshNonce, requestKey, validationErrors.length]);
  const matching = state.key === requestKey;
  return {
    alerts: matching ? state.result : null,
    error: matching ? state.error : null,
    loading: !matching && validationErrors.length === 0,
    validationErrors,
  };
}

export function useAlertDetail(projectId: string, alertId: string | null, retryNonce: number, clearAuth: () => void) {
  const key = `${projectId}:${alertId ?? ""}:${retryNonce}`;
  const [state, setState] = useState<{ key: string; result: AlertDetail | null; error: string | null }>({ key: "", result: null, error: null });
  useEffect(() => {
    if (!projectId || !alertId) return;
    let active = true;
    const controller = new AbortController();
    void apiRequestWithRefresh<AlertDetail>(`/api/v1/projects/${encodeURIComponent(projectId)}/alerts/${encodeURIComponent(alertId)}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        if (result.alert.projectId !== projectId || result.alert.id !== alertId) {
          setState({ key, result: null, error: "Alert details did not match this project and were withheld." });
          return;
        }
        setState({ key, result, error: null });
      }).catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setState({ key, result: null, error: errorText(error, "Could not load this alert's details.") });
      });
    return () => { active = false; controller.abort(); };
  }, [alertId, clearAuth, key, projectId]);
  return { detail: state.key === key ? state.result : null, error: state.key === key ? state.error : null, loading: Boolean(alertId) && state.key !== key };
}

export function useAlertRelatedEvents(projectId: string, alertId: string | null, page: number, retryNonce: number, clearAuth: () => void) {
  const key = `${projectId}:${alertId ?? ""}:${page}:${retryNonce}`;
  const [state, setState] = useState<{ key: string; result: AlertRelatedEvents | null; error: string | null }>({ key: "", result: null, error: null });
  useEffect(() => {
    if (!projectId || !alertId) return;
    let active = true;
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), limit: "20" });
    void apiRequestWithRefresh<AlertRelatedEvents>(`/api/v1/projects/${encodeURIComponent(projectId)}/alerts/${encodeURIComponent(alertId)}/events?${query}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        if (result.events.some((event) => event.projectId !== projectId)) {
          setState({ key, result: null, error: "Related events did not match this project and were withheld." });
          return;
        }
        setState({ key, result, error: null });
      }).catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setState({ key, result: null, error: errorText(error, "Could not load the stored events linked to this alert.") });
      });
    return () => { active = false; controller.abort(); };
  }, [alertId, clearAuth, key, page, projectId]);
  return { related: state.key === key ? state.result : null, error: state.key === key ? state.error : null, loading: Boolean(alertId) && state.key !== key };
}

export type { AlertSeverity, AlertStatus };
