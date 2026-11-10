"use client";

import { PageHeading } from "@/components/dashboard/page-heading";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Icon } from "@/components/ui/icon";

export function OverviewContent() {
  const { user } = useAuth();
  const { workspace, project, workspaces, projects, workspaceLoading, projectLoading, workspaceError, projectError } = useDashboard();
  const scopeLoading = workspaceLoading || projectLoading;

  return (
    <main className="page-wrap">
      <PageHeading eyebrow="Workspace overview" title="Overview" description="A grounded view of the workspace and project currently in scope. Monitoring data will appear here as dashboard features are delivered." />
      {scopeLoading ? (
        <div className="panel" aria-label="Loading current scope"><div className="panel-content"><div className="skeleton" style={{ width: 180, height: 16, borderRadius: 4 }} /><div className="skeleton" style={{ width: "70%", height: 12, marginTop: 13, borderRadius: 4 }} /></div></div>
      ) : workspaceError || projectError ? (
        <div className="empty-scope" role="alert"><span className="empty-icon"><Icon name="warning" /></span><div><h2 className="empty-title">Scope could not be loaded</h2><p className="empty-copy error-copy">{workspaceError ?? projectError}</p><p className="empty-copy">Use the selectors above to retry the request.</p></div></div>
      ) : !workspaces.length ? (
        <div className="empty-scope"><span className="empty-icon"><Icon name="layers" /></span><div><h2 className="empty-title">No workspaces available</h2><p className="empty-copy">Create or join a workspace through the existing workspace setup API. NetSleuth keeps workspace creation outside this dashboard foundation.</p></div></div>
      ) : !workspace ? (
        <div className="empty-scope"><span className="empty-icon"><Icon name="layers" /></span><div><h2 className="empty-title">Select a workspace</h2><p className="empty-copy">Choose one of your authorized workspaces above.</p></div></div>
      ) : !projects.length ? (
        <div className="empty-scope"><span className="empty-icon"><Icon name="folder" /></span><div><h2 className="empty-title">This workspace has no projects</h2><p className="empty-copy">Projects are managed with the existing project setup API. This foundation does not add onboarding or project creation flows.</p></div></div>
      ) : !project ? (
        <div className="empty-scope"><span className="empty-icon"><Icon name="folder" /></span><div><h2 className="empty-title">Select a project</h2><p className="empty-copy">Choose an authorized project in the workspace selector.</p></div></div>
      ) : (
        <>
          <div className="scope-line" aria-label="Current dashboard scope">
            <span className="scope-chip"><Icon name="layers" size={13} />{workspace.name}</span>
            <span className="scope-chip"><Icon name="folder" size={13} />{project.name}</span>
          </div>
          <div className="foundation-grid" style={{ marginTop: 17 }}>
            <section className="panel context-panel">
              <div className="panel-header"><h2 className="panel-title">Project context</h2><span className="tag">Authorized scope</span></div>
              <div className="context-body">
                <span className="context-symbol"><Icon name="shield" size={20} /></span>
                <h2 className="context-title">Your project is in view.</h2>
                <p className="context-copy">{project.description?.trim() || "No project description has been added."} The overview is ready for real monitoring data when those dashboard features are implemented.</p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-header"><h2 className="panel-title">Current session</h2><span className="status-dot" title="Authenticated" /></div>
              <div className="panel-content scope-details">
                <div className="detail-row"><span className="detail-label">Signed in as</span><span className="detail-value">{user?.name}</span></div>
                <div className="detail-row"><span className="detail-label">Account</span><span className="detail-value">{user?.email}</span></div>
                <div className="detail-row"><span className="detail-label">Workspace</span><span className="detail-value">{workspace.name}</span></div>
                <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value">{project.name}</span></div>
              </div>
            </section>
          </div>
        </>
      )}
      <hr className="page-divider" />
      <div className="eyebrow">Monitoring data</div>
      <p className="page-description" style={{ marginTop: 8 }}>No agents, events, alerts, or activity counts are fabricated in this foundation. Explore the sections from the sidebar for their current implementation status.</p>
    </main>
  );
}
