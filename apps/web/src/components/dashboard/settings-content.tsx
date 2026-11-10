"use client";

import { PageHeading } from "@/components/dashboard/page-heading";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Icon } from "@/components/ui/icon";

export function SettingsContent() {
  const { user } = useAuth();
  const { workspace, project, workspaceLoading, projectLoading, workspaces, projects, workspaceError, projectError } = useDashboard();
  const loading = workspaceLoading || projectLoading;
  return <main className="page-wrap">
    <PageHeading eyebrow="Account and scope" title="Settings" description="Review the signed-in identity and currently selected project. This page is read-only." />
    {loading ? <div className="panel"><div className="panel-content"><div className="skeleton" style={{ width: 160, height: 15, borderRadius: 4 }} /><div className="skeleton" style={{ width: "65%", height: 12, marginTop: 14, borderRadius: 4 }} /></div></div>
      : workspaceError || projectError ? <div className="empty-scope" role="alert"><span className="empty-icon"><Icon name="warning" /></span><div><h2 className="empty-title">Could not load settings scope</h2><p className="empty-copy error-copy">{workspaceError ?? projectError}</p></div></div>
        : !workspaces.length ? <div className="empty-scope"><span className="empty-icon"><Icon name="layers" /></span><div><h2 className="empty-title">No workspaces available</h2><p className="empty-copy">Workspace setup is managed through the existing API. Profile information remains available below.</p></div></div>
          : !projects.length ? <div className="empty-scope"><span className="empty-icon"><Icon name="folder" /></span><div><h2 className="empty-title">No project selected</h2><p className="empty-copy">This workspace does not currently contain a project.</p></div></div> : null}
    <div className="foundation-grid" style={{ marginTop: 18 }}>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Profile</h2><span className="tag">Read only</span></div>
        <div className="panel-content scope-details">
          <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{user?.name ?? "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{user?.email ?? "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Account ID</span><span className="detail-value">{user?.id ?? "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Created</span><span className="detail-value">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</span></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Selected project</h2><span className="tag">Read only</span></div>
        <div className="panel-content scope-details">
          <div className="detail-row"><span className="detail-label">Workspace</span><span className="detail-value">{workspace?.name ?? "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Project</span><span className="detail-value">{project?.name ?? "—"}</span></div>
          <div className="detail-row"><span className="detail-label">Description</span><span className="detail-value">{project?.description ?? "Not set"}</span></div>
          <div className="detail-row"><span className="detail-label">Database policy</span><span className="detail-value">{project?.databasePolicy ? `${project.databasePolicy.databasePorts.length} configured port${project.databasePolicy.databasePorts.length === 1 ? "" : "s"}` : "Not configured"}</span></div>
        </div>
      </section>
    </div>
  </main>;
}
