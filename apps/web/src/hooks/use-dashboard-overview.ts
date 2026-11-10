"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardActivity, DashboardRange, DashboardSummary } from "@workspace/netsleuth-shared";
import { ApiError, apiRequestWithRefresh } from "@/lib/api";
import { useAuth } from "@/components/providers/auth-provider";

interface ScopedResult<T> {
  projectId: string;
  range?: DashboardRange;
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
}

const emptyResult = <T,>(projectId: string, range?: DashboardRange): ScopedResult<T> => ({
  projectId,
  range,
  data: null,
  loading: Boolean(projectId),
  error: null,
  fetchedAt: null,
});

export function useDashboardOverview(projectId: string, range: DashboardRange) {
  const { clearAuth } = useAuth();
  const [summaryResult, setSummaryResult] = useState<ScopedResult<DashboardSummary>>(() => emptyResult(projectId));
  const [activityResult, setActivityResult] = useState<ScopedResult<DashboardActivity>>(() => emptyResult(projectId, range));
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!projectId) {
      setSummaryResult(emptyResult(""));
      return;
    }

    const controller = new AbortController();
    setSummaryResult(emptyResult(projectId));
    const loadSummary = async () => {
      try {
        const data = await apiRequestWithRefresh<DashboardSummary>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard/summary`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (data.projectId !== projectId) throw new Error("The summary response did not match the selected project.");
        setSummaryResult({ projectId, data, error: null, loading: false, fetchedAt: new Date().toISOString() });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setSummaryResult({
          projectId,
          data: null,
          error: error instanceof ApiError ? error.message : "Could not load project summary.",
          loading: false,
          fetchedAt: null,
        });
      }
    };
    void loadSummary();
    return () => controller.abort();
  }, [projectId, refreshVersion, clearAuth]);

  useEffect(() => {
    if (!projectId) {
      setActivityResult(emptyResult("", range));
      return;
    }

    const controller = new AbortController();
    setActivityResult(emptyResult(projectId, range));
    const loadActivity = async () => {
      try {
        const data = await apiRequestWithRefresh<DashboardActivity>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard/activity?range=${range}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (data.projectId !== projectId || data.range !== range) {
          throw new Error("The activity response did not match the selected project or range.");
        }
        setActivityResult({ projectId, range, data, error: null, loading: false, fetchedAt: new Date().toISOString() });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setActivityResult({
          projectId,
          range,
          data: null,
          error: error instanceof ApiError ? error.message : "Could not load project activity.",
          loading: false,
          fetchedAt: null,
        });
      }
    };
    void loadActivity();
    return () => controller.abort();
  }, [projectId, range, refreshVersion, clearAuth]);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    if (!projectId) return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId, refresh]);

  const summary = summaryResult.projectId === projectId ? summaryResult : emptyResult<DashboardSummary>(projectId);
  const activity = activityResult.projectId === projectId && activityResult.range === range
    ? activityResult
    : emptyResult<DashboardActivity>(projectId, range);

  return { summary, activity, refresh };
}
