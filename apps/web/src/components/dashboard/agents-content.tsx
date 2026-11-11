"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeading } from "@/components/dashboard/page-heading";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { AgentDialog, errorMessage, formatDate, shortId, statusFor, type Agent, type AgentDetail, type AgentList, type Registration } from "@/components/dashboard/agent-management-shared";
import { RegistrationSetup } from "@/components/dashboard/agent-registration-setup";
import { ApiError, apiRequestWithRefresh } from "@/lib/api";

function SkeletonRows() {
  return <div className="agents-skeleton" aria-label="Loading agents" aria-busy="true">
    {[0, 1, 2, 3].map((row) => <div className="agents-skeleton-row" key={row}>
      {[0, 1, 2, 3, 4].map((cell) => <span className="skeleton" key={cell} />)}
    </div>)}
  </div>;
}

function ProjectAgents({ projectId, projectName, onRegister, realtimeVersion }: {
  projectId: string;
  projectName: string;
  onRegister: (registration: Registration) => void;
  realtimeVersion: number;
}) {
  const { clearAuth } = useAuth();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Agent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Agent | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const mutationLock = useRef(false);
  const hasAgentList = useRef(false);
  const mounted = useRef(false);

  const loadAgents = useCallback(async (background = false) => {
    const id = ++requestId.current;
    if (background && hasAgentList.current) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const result = await apiRequestWithRefresh<AgentList>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/agents`,
      );
      if (id !== requestId.current) return;
      const scopedAgents = result.agents.filter((agent) => agent.projectId === projectId);
      setAgents(scopedAgents);
      hasAgentList.current = true;
      if (scopedAgents.length !== result.agents.length) {
        setLoadError("The API returned agents outside this project scope. Those records were hidden.");
      }
    } catch (error) {
      if (id !== requestId.current) return;
      if (error instanceof ApiError && error.status === 401) clearAuth();
      setLoadError(errorMessage(error, "Could not load agents for this project."));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clearAuth, projectId]);

  useEffect(() => {
    mounted.current = true;
    void loadAgents();
    return () => {
      mounted.current = false;
      requestId.current += 1;
      detailRequestId.current += 1;
    };
  }, [loadAgents]);
  useEffect(() => { if (realtimeVersion) void loadAgents(true); }, [loadAgents, realtimeVersion]);

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = agentName.trim();
    if (!name || name.length > 100 || mutationLock.current) return;
    mutationLock.current = true;
    setRegistering(true);
    setRegisterError(null);
    setNotice(null);
    try {
      const result = await apiRequestWithRefresh<Registration>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/agents`,
        { method: "POST", body: { name } },
      );
      if (!mounted.current) return;
      if (result.agent.projectId !== projectId) {
        setRegisterError("The API response did not match this project. The returned credential was withheld.");
        return;
      }
      onRegister(result);
      setRegisterOpen(false);
      setAgentName("");
      void loadAgents(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearAuth();
      if (mounted.current) setRegisterError(errorMessage(error, "Could not register this agent. Try again."));
    } finally {
      mutationLock.current = false;
      if (mounted.current) setRegistering(false);
    }
  }

  async function openDetails(agent: Agent) {
    setDetailAgentId(agent.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const id = ++detailRequestId.current;
    try {
      const result = await apiRequestWithRefresh<AgentDetail>(`/api/v1/agents/${encodeURIComponent(agent.id)}`);
      if (!mounted.current || id !== detailRequestId.current) return;
      if (result.agent.projectId !== projectId || result.agent.id !== agent.id) {
        setDetailError("Agent details did not match this project and were withheld.");
      } else setDetail(result.agent);
    } catch (error) {
      if (id === detailRequestId.current) {
        if (error instanceof ApiError && error.status === 401) clearAuth();
        setDetailError(errorMessage(error, "Could not load agent details."));
      }
    } finally {
      if (id === detailRequestId.current) setDetailLoading(false);
    }
  }

  function closeDetails() {
    detailRequestId.current += 1;
    setDetailAgentId(null);
    setDetail(null);
    setDetailError(null);
  }

  async function revokeAgent() {
    if (!revokeTarget || mutationLock.current) return;
    mutationLock.current = true;
    setRevoking(true);
    setRevokeError(null);
    try {
      const result = await apiRequestWithRefresh<AgentDetail>(
        `/api/v1/agents/${encodeURIComponent(revokeTarget.id)}/revoke`,
        { method: "POST" },
      );
      if (!mounted.current) return;
      if (result.agent.projectId !== projectId || result.agent.id !== revokeTarget.id) {
        setRevokeError("The API response did not match this project. The list was not changed.");
        return;
      }
      setRevokeTarget(null);
      setNotice(`${result.agent.name} has been revoked. Further ingestion from this agent is blocked.`);
      setAgents((current) => current?.map((agent) => agent.id === result.agent.id ? result.agent : agent) ?? null);
      await loadAgents(true);
      if (detailAgentId === result.agent.id) setDetail(result.agent);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) clearAuth();
      if (mounted.current) setRevokeError(errorMessage(error, "Could not revoke this agent. Try again."));
    } finally {
      mutationLock.current = false;
      if (mounted.current) setRevoking(false);
    }
  }

  const filteredAgents = useMemo(() => (agents ?? []).filter((agent) => {
    const status = statusFor(agent);
    const matchesStatus = filter === "ALL" || status === filter;
    const matchesSearch = `${agent.name} ${agent.id}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  }), [agents, filter, search]);
  const counts = useMemo(() => {
    const list = agents ?? [];
    return {
      shown: list.length,
      online: list.filter((item) => statusFor(item) === "ONLINE").length,
      offline: list.filter((item) => statusFor(item) === "OFFLINE").length,
      inactive: list.filter((item) => statusFor(item) === "INACTIVE").length,
      revoked: list.filter((item) => statusFor(item) === "REVOKED").length,
    };
  }, [agents]);

  return (
    <>
      <PageHeading eyebrow="Infrastructure / collectors" title="Agents" description="Registered collectors and their reported state, scoped to the selected project.">
        <Button type="button" onClick={() => { setRegisterError(null); setRegisterOpen(true); }} data-testid="button-register-agent">
          <Icon name="agents" size={15} /> Register agent
        </Button>
      </PageHeading>

      <div className="agents-scope-strip">
        <div><span className="eyebrow">Project scope</span><strong>{projectName}</strong><code>{shortId(projectId)}</code></div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadAgents(true)} disabled={refreshing} aria-label="Refresh agent list" data-testid="button-refresh-agents">
          <Icon name="refresh" size={14} /> {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <div className="agents-metrics" aria-label="Agent counts">
        <div className="agents-metric"><span>Agents shown</span><strong>{agents ? counts.shown : "—"}</strong></div>
        <div className="agents-metric"><span>Online</span><strong className="tone-online">{agents ? counts.online : "—"}</strong></div>
        <div className="agents-metric"><span>Offline</span><strong className="tone-offline">{agents ? counts.offline : "—"}</strong></div>
        <div className="agents-metric"><span>Inactive</span><strong>{agents ? counts.inactive : "—"}</strong></div>
        <div className="agents-metric"><span>Revoked</span><strong className="tone-revoked">{agents ? counts.revoked : "—"}</strong></div>
      </div>

      <section className="panel agents-panel" aria-labelledby="agents-table-title">
        <div className="panel-header agents-panel-header">
          <div><h2 className="panel-title" id="agents-table-title">Registered collectors</h2><p className="panel-subtitle">Status is reported by the API; it is not inferred from heartbeat age.</p></div>
          <span className="agents-count">{filteredAgents.length} displayed</span>
        </div>
        <div className="agents-controls">
          <label className="agents-search">
            <span className="sr-only">Search agents</span>
            <span className="agents-search-mark" aria-hidden="true">⌕</span>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or ID" data-testid="input-agent-search" />
          </label>
          <label className="agents-filter"><span className="sr-only">Filter by status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} data-testid="select-agent-status-filter">
              <option value="ALL">All statuses</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option><option value="INACTIVE">Inactive</option><option value="REVOKED">Revoked</option>
            </select>
          </label>
        </div>
        {loadError && <div className="agents-error" role="alert"><div><strong>Agent list needs attention</strong><p>{loadError}</p></div><Button type="button" variant="secondary" size="sm" onClick={() => void loadAgents()} data-testid="button-retry-agents">Retry</Button></div>}
        {notice && <div className="agents-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div>}
        {loading && !agents ? <SkeletonRows /> : !agents ? (
          <div className="agents-load-empty"><strong>Agent records are unavailable.</strong><span>Use Retry to reload the selected project.</span><Button type="button" variant="secondary" size="sm" onClick={() => void loadAgents()} data-testid="button-retry-agent-load">Retry</Button></div>
        ) : agents.length === 0 ? (
          <div className="agents-empty">
            <span className="agents-empty-mark"><Icon name="agents" size={20} /></span>
            <h3>No collectors registered</h3>
            <p>Register a collector to create its one-time key and see its reported status here.</p>
            <Button type="button" onClick={() => setRegisterOpen(true)}>Register first agent</Button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="agents-filter-empty"><strong>No agents match</strong><span>Adjust the search or status filter.</span><Button type="button" size="sm" variant="ghost" onClick={() => { setSearch(""); setFilter("ALL"); }}>Clear filters</Button></div>
        ) : (
          <div className="agents-table-viewport">
            <table className="agents-table">
              <thead><tr><th scope="col">Agent</th><th scope="col">Agent ID</th><th scope="col">Status</th><th scope="col">Project</th><th scope="col">Last heartbeat</th><th scope="col">Registered</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{filteredAgents.map((agent) => {
                const status = statusFor(agent);
                return <tr key={agent.id} data-testid={`row-agent-${agent.id}`}>
                  <td><button className="agent-name-button" type="button" onClick={() => void openDetails(agent)} data-testid={`button-agent-details-${agent.id}`}>{agent.name}</button></td>
                  <td><code title={agent.id}>{shortId(agent.id)}</code></td>
                  <td><span className={`agent-pill status-${status.toLowerCase()}`}><i aria-hidden="true" />{status}</span></td>
                  <td><span className="agents-project-name" title={projectName}>{projectName}</span></td>
                  <td>{formatDate(agent.lastHeartbeatAt)}</td>
                  <td>{formatDate(agent.createdAt)}</td>
                  <td><div className="agent-row-actions"><Button type="button" variant="ghost" size="sm" onClick={() => void openDetails(agent)} data-testid={`button-view-agent-${agent.id}`}>View</Button>{status !== "REVOKED" && <Button type="button" variant="danger" size="sm" onClick={() => { setRevokeError(null); setRevokeTarget(agent); }} data-testid={`button-revoke-agent-${agent.id}`}>Revoke</Button>}</div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
        <div className="agents-panel-foot">The API returns up to the latest 100 agents and provides no pagination. Counts above reflect only those returned records, not a global total.</div>
      </section>

      {registerOpen && <AgentDialog title="Register an agent" description={`Create a collector credential for ${projectName}. The key is shown once.`} onClose={() => { if (!registering) { setRegisterOpen(false); setAgentName(""); setRegisterError(null); } }}>
        <form className="agent-form" onSubmit={submitRegistration}>
          <label className="agent-field"><span>Agent name</span><Input autoFocus required minLength={1} maxLength={100} value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="e.g. edge-proxy-01" data-testid="input-agent-name" /><small>Use a name that identifies the host or network role.</small></label>
          {registerError && <p className="agent-form-error" role="alert">{registerError}</p>}
          <div className="agent-dialog-actions"><Button type="button" variant="secondary" onClick={() => { setRegisterOpen(false); setAgentName(""); setRegisterError(null); }} disabled={registering}>Cancel</Button><Button type="submit" disabled={registering || !agentName.trim()} data-testid="button-submit-agent-registration">{registering ? "Registering…" : "Create agent"}</Button></div>
        </form>
      </AgentDialog>}

      {detailAgentId && <AgentDialog title={detail?.name ?? "Agent details"} description="Project-scoped collector record. Credentials are never available on this screen." onClose={closeDetails}>
        {detailLoading ? <div className="agent-detail-loading"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div> : detailError ? <div className="agents-error" role="alert"><p>{detailError}</p><Button type="button" variant="secondary" size="sm" onClick={() => { const item = agents?.find((agent) => agent.id === detailAgentId); if (item) void openDetails(item); }}>Retry</Button></div> : detail && <div className="agent-detail">
          <div className="agent-detail-status"><span className={`agent-pill status-${statusFor(detail).toLowerCase()}`}><i aria-hidden="true" />{statusFor(detail)}</span></div>
          <div className="agent-detail-row"><span>Agent ID</span><code>{detail.id}</code></div>
          <div className="agent-detail-row"><span>Project</span><strong>{projectName}</strong></div>
          <div className="agent-detail-row"><span>Last heartbeat</span><strong>{formatDate(detail.lastHeartbeatAt)}</strong></div>
          <div className="agent-detail-row"><span>Registered</span><strong>{formatDate(detail.createdAt)}</strong></div>
          {detail.revokedAt && <div className="agent-detail-row"><span>Revoked</span><strong>{formatDate(detail.revokedAt)}</strong></div>}
          {statusFor(detail) !== "REVOKED" && <div className="agent-dialog-actions"><Button type="button" variant="danger" onClick={() => { setRevokeTarget(detail); setDetailAgentId(null); setDetail(null); }}>Revoke agent</Button></div>}
        </div>}
      </AgentDialog>}

      {revokeTarget && <AgentDialog title="Revoke this agent?" description="Revocation prevents this collector from sending further ingestion data. This action cannot be undone." onClose={() => { if (!revoking) { setRevokeTarget(null); setRevokeError(null); } }} className="agent-confirm-dialog">
        <div className="revoke-summary"><span className="eyebrow">Agent</span><strong>{revokeTarget.name}</strong><code>{shortId(revokeTarget.id)}</code></div>
        {revokeError && <p className="agent-form-error" role="alert">{revokeError}</p>}
        <div className="agent-dialog-actions"><Button type="button" variant="secondary" disabled={revoking} onClick={() => { setRevokeTarget(null); setRevokeError(null); }}>Keep agent</Button><Button type="button" variant="danger" disabled={revoking} onClick={() => void revokeAgent()} data-testid="button-confirm-agent-revocation">{revoking ? "Revoking…" : "Revoke agent"}</Button></div>
      </AgentDialog>}
    </>
  );
}

interface ScopedRegistration extends Registration {
  projectId: string;
  workspaceId: string;
  userId: string;
}

export function AgentsContent() {
  const { user } = useAuth();
  const { project, workspace, workspaceLoading, projectLoading, workspaces, projects, workspaceError, projectError, reloadWorkspaces, reloadProjects, realtime } = useDashboard();
  const [registration, setRegistration] = useState<ScopedRegistration | null>(null);
  const activeProjectId = project?.id ?? "";

  useEffect(() => {
    if (!registration) return;
    const ownerChanged = registration.userId !== user?.id;
    const workspaceChanged = Boolean(workspace && registration.workspaceId !== workspace.id);
    const projectChanged = Boolean(project && registration.projectId !== project.id);
    const scopeSettledWithoutProject = !workspaceLoading && !projectLoading && (!workspace || !project);
    if (ownerChanged || workspaceChanged || projectChanged || scopeSettledWithoutProject) setRegistration(null);
  }, [project, projectLoading, registration, user?.id, workspace, workspaceLoading]);

  const projectStateLoading = workspaceLoading || projectLoading;
  return <main className="page-wrap agents-page">
    {projectStateLoading ? <div className="agents-page-loading"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      : workspaceError || projectError ? <div className="agents-scope-error" role="alert"><Icon name="warning" /><div><strong>Could not load the current project scope</strong><p>{workspaceError ?? projectError}</p><Button type="button" variant="secondary" size="sm" onClick={() => void (workspaceError ? reloadWorkspaces() : reloadProjects())}>Retry scope loading</Button></div></div>
        : !workspaces.length ? <div className="agents-no-scope"><h1>No workspace available</h1><p>Agents are managed within a project. Select or join a workspace to continue.</p></div>
          : !projects.length ? <div className="agents-no-scope"><h1>No project available</h1><p>Choose a workspace with an authorized project to manage its collectors.</p></div>
            : !project ? <div className="agents-no-scope"><h1>Select a project</h1><p>Choose an authorized project from the selector above.</p></div>
              : <ProjectAgents key={project.id} projectId={project.id} projectName={project.name} realtimeVersion={realtime.agentVersion} onRegister={(value) => {
                if (user?.id && workspace?.id) setRegistration({ ...value, projectId: project.id, workspaceId: workspace.id, userId: user.id });
              }} />}
    {registration && user?.id === registration.userId && activeProjectId === registration.projectId && <RegistrationSetup key={registration.agent.id} projectName={project?.name ?? ""} registration={registration} onClose={() => setRegistration(null)} />}
  </main>;
}
