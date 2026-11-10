"use client";

import { useDashboard } from "@/components/providers/dashboard-provider";
import { Icon } from "@/components/ui/icon";

export function ScopeContent({ noun }: { noun: "agents" | "events" | "alerts" }) {
  const { workspace, project, workspaceLoading, projectLoading, workspaces, projects, workspaceError, projectError, reloadWorkspaces, reloadProjects } = useDashboard();
  const working = workspaceLoading || projectLoading;
  const featureText: Record<typeof noun, { title: string; summary: string }> = {
    agents: { title: "Agent inventory is not connected yet", summary: "This area will list registered collectors and their latest check-ins once the dashboard agent view is implemented." },
    events: { title: "Network event explorer is not available yet", summary: "No event records are shown here. The explorer will be added in a separate product update." },
    alerts: { title: "Alert investigation is not available yet", summary: "No alert records are displayed here. Alert triage and investigation workflows are outside this foundation." },
  };

  if (working) {
    return <div className="panel" aria-label={`Loading ${noun}`}><div className="panel-content"><div className="skeleton" style={{ width: 175, height: 15, borderRadius: 4 }} /><div className="skeleton" style={{ width: "78%", height: 11, marginTop: 13, borderRadius: 4 }} /></div></div>;
  }
  if (workspaceError || projectError) {
    return <div className="empty-scope" role="alert"><span className="empty-icon"><Icon name="warning" /></span><div><h2 className="empty-title">Could not load the current scope</h2><p className="empty-copy error-copy">{workspaceError ?? projectError}</p><button className="retry-button" style={{ marginTop: 11 }} onClick={() => void (workspaceError ? reloadWorkspaces() : reloadProjects())}>Retry</button></div></div>;
  }
  if (!workspaces.length) {
    return <div className="empty-scope"><span className="empty-icon"><Icon name="layers" /></span><div><h2 className="empty-title">No workspaces available</h2><p className="empty-copy">Create or join a workspace through the existing workspace setup API. This dashboard foundation does not create workspaces.</p></div></div>;
  }
  if (!workspace) {
    return <div className="empty-scope"><span className="empty-icon"><Icon name="layers" /></span><div><h2 className="empty-title">Select a workspace</h2><p className="empty-copy">Choose an authorized workspace from the selector above to continue.</p></div></div>;
  }
  if (!projects.length) {
    return <div className="empty-scope"><span className="empty-icon"><Icon name="folder" /></span><div><h2 className="empty-title">No projects in this workspace</h2><p className="empty-copy">Projects are managed through the existing project setup API. Once a project is available, its scope will appear here.</p></div></div>;
  }
  if (!project) {
    return <div className="empty-scope"><span className="empty-icon"><Icon name="folder" /></span><div><h2 className="empty-title">Select a project</h2><p className="empty-copy">Choose an authorized project from this workspace to view its context.</p></div></div>;
  }
  const content = featureText[noun];
  return (
    <div className="panel context-panel">
      <div className="panel-header"><h2 className="panel-title">Project scope</h2><span className="tag">Read-only foundation</span></div>
      <div className="context-body">
        <span className="context-symbol"><Icon name={noun === "agents" ? "agents" : noun === "events" ? "events" : "shield"} size={20} /></span>
        <h2 className="context-title">{content.title}</h2>
        <p className="context-copy">{content.summary}</p>
      </div>
    </div>
  );
}
