"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, apiRequestWithRefresh, type Project, type ProjectList, type Workspace, type WorkspaceList } from "@/lib/api";
import { useAuth } from "./auth-provider";

interface DashboardContextValue {
  workspaces: Workspace[];
  projects: Project[];
  workspace: Workspace | null;
  project: Project | null;
  workspaceLoading: boolean;
  projectLoading: boolean;
  workspaceError: string | null;
  projectError: string | null;
  selectWorkspace: (id: string) => void;
  selectProject: (id: string) => void;
  reloadWorkspaces: () => Promise<void>;
  reloadProjects: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { user, clearAuth } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const workspaceRequest = useRef(0);
  const projectRequest = useRef(0);
  const currentUserId = user?.id ?? "";
  const selectedWorkspaceRef = useRef(selectedWorkspaceId);
  selectedWorkspaceRef.current = selectedWorkspaceId;

  const clearSelections = useCallback(() => {
    setWorkspaces([]);
    setProjects([]);
    setSelectedWorkspaceId("");
    setSelectedProjectId("");
    setWorkspaceError(null);
    setProjectError(null);
    setWorkspaceLoading(false);
    setProjectLoading(false);
  }, []);

  const reloadWorkspaces = useCallback(async () => {
    const requestId = ++workspaceRequest.current;
    if (!currentUserId) {
      clearSelections();
      return;
    }
    setWorkspaceLoading(true);
    setWorkspaceError(null);
    try {
      const result = await apiRequestWithRefresh<WorkspaceList>("/api/v1/workspaces");
      if (requestId !== workspaceRequest.current) return;
      setWorkspaces(result.workspaces);
      const storageKey = `netsleuth:${currentUserId}:workspace`;
      const storedId = window.localStorage.getItem(storageKey);
      const nextId = result.workspaces.some((item) => item.id === selectedWorkspaceRef.current)
        ? selectedWorkspaceRef.current
        : result.workspaces.find((item) => item.id === storedId)?.id ?? result.workspaces[0]?.id ?? "";
      setSelectedWorkspaceId(nextId);
      if (nextId) window.localStorage.setItem(storageKey, nextId);
      else window.localStorage.removeItem(storageKey);
    } catch (requestError) {
      if (requestId !== workspaceRequest.current) return;
      if (requestError instanceof ApiError && requestError.status === 401) clearAuth();
      setWorkspaces([]);
      setProjects([]);
      setSelectedWorkspaceId("");
      setSelectedProjectId("");
      setWorkspaceError(requestError instanceof ApiError ? requestError.message : "Could not load workspaces.");
    } finally {
      if (requestId === workspaceRequest.current) setWorkspaceLoading(false);
    }
  }, [clearAuth, clearSelections, currentUserId]);

  const reloadProjects = useCallback(async () => {
    const workspaceId = selectedWorkspaceId;
    const requestId = ++projectRequest.current;
    setProjects([]);
    setSelectedProjectId("");
    setProjectError(null);
    if (!workspaceId || !currentUserId) {
      setProjectLoading(false);
      return;
    }
    setProjectLoading(true);
    try {
      const result = await apiRequestWithRefresh<ProjectList>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`);
      if (requestId !== projectRequest.current || workspaceId !== selectedWorkspaceRef.current) return;
      const authorizedProjects = result.projects.filter((item) => item.workspaceId === workspaceId);
      setProjects(authorizedProjects);
      const storageKey = `netsleuth:${currentUserId}:project:${workspaceId}`;
      const storedId = window.localStorage.getItem(storageKey);
      const nextId = authorizedProjects.find((item) => item.id === storedId)?.id ?? authorizedProjects[0]?.id ?? "";
      setSelectedProjectId(nextId);
      if (nextId) window.localStorage.setItem(storageKey, nextId);
      else window.localStorage.removeItem(storageKey);
    } catch (requestError) {
      if (requestId !== projectRequest.current) return;
      if (requestError instanceof ApiError && requestError.status === 401) clearAuth();
      setProjects([]);
      setSelectedProjectId("");
      setProjectError(requestError instanceof ApiError ? requestError.message : "Could not load projects.");
    } finally {
      if (requestId === projectRequest.current) setProjectLoading(false);
    }
  }, [clearAuth, currentUserId, selectedWorkspaceId]);

  useEffect(() => {
    setWorkspaces([]);
    setProjects([]);
    setSelectedWorkspaceId("");
    setSelectedProjectId("");
    setWorkspaceLoading(Boolean(currentUserId));
    if (currentUserId) void reloadWorkspaces();
    else clearSelections();
    return () => {
      workspaceRequest.current += 1;
      projectRequest.current += 1;
    };
  }, [clearSelections, currentUserId, reloadWorkspaces]);

  useEffect(() => {
    void reloadProjects();
    return () => {
      projectRequest.current += 1;
    };
  }, [reloadProjects]);

  useEffect(() => {
    const refresh = () => {
      void reloadWorkspaces();
      void reloadProjects();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [reloadProjects, reloadWorkspaces]);

  const selectWorkspace = useCallback((id: string) => {
    if (!workspaces.some((item) => item.id === id)) return;
    projectRequest.current += 1;
    selectedWorkspaceRef.current = id;
    setProjects([]);
    setSelectedProjectId("");
    setProjectError(null);
    setSelectedWorkspaceId(id);
    if (currentUserId) window.localStorage.setItem(`netsleuth:${currentUserId}:workspace`, id);
  }, [currentUserId, workspaces]);

  const selectProject = useCallback((id: string) => {
    if (!projects.some((item) => item.id === id)) return;
    setSelectedProjectId(id);
    if (currentUserId && selectedWorkspaceId) {
      window.localStorage.setItem(`netsleuth:${currentUserId}:project:${selectedWorkspaceId}`, id);
    }
  }, [currentUserId, projects, selectedWorkspaceId]);

  const value = useMemo(
    () => ({
      workspaces, projects,
      workspace: workspaces.find((item) => item.id === selectedWorkspaceId) ?? null,
      project: projects.find((item) => item.id === selectedProjectId && item.workspaceId === selectedWorkspaceId) ?? null,
      workspaceLoading, projectLoading, workspaceError, projectError,
      selectWorkspace, selectProject, reloadWorkspaces, reloadProjects,
    }),
    [workspaces, projects, selectedWorkspaceId, selectedProjectId, workspaceLoading, projectLoading,
      workspaceError, projectError, selectWorkspace, selectProject, reloadWorkspaces, reloadProjects],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("useDashboard must be used within DashboardProvider");
  return context;
}
