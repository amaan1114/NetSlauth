"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExplorerEventDetail, ExplorerEventList } from "@workspace/netsleuth-shared";
import type { AgentList } from "@/components/dashboard/agent-management-shared";
import { ApiError, apiRequestWithRefresh } from "@/lib/api";
import { eventListIsUsable, eventListKey, makeEventListUrl, validateEventFilters, type EventFilters, type EventListParams } from "@/lib/events-explorer";

interface ListState {
  key: string;
  events: ExplorerEventList | null;
  error: string | null;
}

interface AgentState {
  projectId: string;
  agents: AgentList["agents"] | null;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function useNetworkEvents(projectId: string, filters: EventFilters, offset: number, refreshNonce: number, clearAuth: () => void, searchPending = false) {
  const validationErrors = useMemo(() => validateEventFilters(filters), [filters]);
  const params: EventListParams = useMemo(() => ({
    ...filters,
    limit: 25,
    offset,
  }), [filters, offset]);
  const requestKey = `${eventListKey(projectId, params)}:${refreshNonce}`;
  const [listState, setListState] = useState<ListState>({ key: "", events: null, error: null });
  const [agentState, setAgentState] = useState<AgentState>({ projectId: "", agents: null });

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    let active = true;
    void apiRequestWithRefresh<AgentList>(`/api/v1/projects/${encodeURIComponent(projectId)}/agents`, { signal: controller.signal })
      .then((result) => {
        if (active) setAgentState({
          projectId,
          agents: result.agents.filter((agent) => agent.projectId === projectId),
        });
      })
      .catch((error: unknown) => {
        if (active && error instanceof ApiError && error.status === 401) clearAuth();
        if (active) setAgentState({ projectId, agents: [] });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [clearAuth, projectId]);

  useEffect(() => {
    if (!projectId || validationErrors.length || searchPending) return;
    const controller = new AbortController();
    let active = true;
    const key = requestKey;
    void apiRequestWithRefresh<ExplorerEventList>(
      makeEventListUrl(projectId, params),
      { signal: controller.signal },
    ).then((result) => {
      if (!active) return;
      if (!eventListIsUsable(result, projectId)) {
        setListState({ key, events: null, error: "The API returned events outside this project scope. Those records were withheld." });
        return;
      }
      setListState({ key, events: result, error: null });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) clearAuth();
      setListState({ key, events: null, error: readableError(error, "Could not load network events for this project.") });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [clearAuth, params, projectId, refreshNonce, requestKey, validationErrors.length, searchPending]);

  const matchingState = listState.key === requestKey;
  return {
    agents: agentState.projectId === projectId ? agentState.agents ?? [] : [],
    events: matchingState ? listState.events : null,
    error: matchingState ? listState.error : null,
    loading: !matchingState && validationErrors.length === 0,
    validationErrors,
  };
}

export function useEventDetails(projectId: string, recordId: string | null, retryNonce: number, clearAuth: () => void) {
  const [state, setState] = useState<{
    key: string;
    event: ExplorerEventDetail | null;
    error: string | null;
  }>({ key: "", event: null, error: null });
  const key = `${projectId}:${recordId ?? ""}:${retryNonce}`;

  useEffect(() => {
    if (!projectId || !recordId) return;
    let active = true;
    const controller = new AbortController();
    void apiRequestWithRefresh<{ event: ExplorerEventDetail }>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(recordId)}`,
      { signal: controller.signal },
    ).then((result) => {
      if (!active) return;
      if (result.event.projectId !== projectId || result.event.id !== recordId) {
        setState({ key, event: null, error: "Event details did not match the selected project and were withheld." });
      } else setState({ key, event: result.event, error: null });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) clearAuth();
      setState({ key, event: null, error: readableError(error, "Could not load this event's details.") });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [clearAuth, key, projectId, recordId]);

  return {
    event: state.key === key ? state.event : null,
    error: state.key === key ? state.error : null,
    loading: Boolean(recordId) && state.key !== key,
  };
}
