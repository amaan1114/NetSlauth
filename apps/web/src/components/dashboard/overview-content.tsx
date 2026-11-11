"use client";

import { useEffect, useState } from "react";
import type { DashboardRange } from "@workspace/netsleuth-shared";
import { PageHeading } from "@/components/dashboard/page-heading";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Icon } from "@/components/ui/icon";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import {
  ActivityPanel,
  AgentHealthPanel,
  MetricGrid,
  OverviewError,
  OverviewLoading,
  RecentAlertsPanel,
  SeverityPanel,
} from "@/components/dashboard/overview-panels";

export function OverviewContent() {
  const { workspace, project, workspaces, projects, workspaceLoading, projectLoading, workspaceError, projectError, reloadProjects, reloadWorkspaces, realtime } = useDashboard();
  const [range, setRange] = useState<DashboardRange>("24h");
  const projectId = project?.id ?? "";
  const { summary, activity, refresh } = useDashboardOverview(projectId, range);
  useEffect(() => { if (realtime.networkEventVersion || realtime.alertVersion || realtime.agentVersion) refresh(); }, [realtime.agentVersion, realtime.alertVersion, realtime.networkEventVersion, refresh]);
  const scopeLoading = workspaceLoading || projectLoading;

  return (
    <main className="page-wrap">
      <PageHeading eyebrow="Project overview" title="Overview" description="A clear read on registered infrastructure, recorded activity, and alert state for the project in scope. Counts update when this view is refreshed." >
        {project ? <button className="overview-refresh" type="button" onClick={refresh} disabled={summary.loading || activity.loading} data-testid="button-refresh-overview"><Icon name="refresh" size={14} />Refresh</button> : null}
      </PageHeading>
      {scopeLoading ? (
        <div className="panel" aria-label="Loading current scope"><div className="panel-content"><div className="skeleton" style={{ width: 180, height: 16, borderRadius: 4 }} /><div className="skeleton" style={{ width: "70%", height: 12, marginTop: 13, borderRadius: 4 }} /></div></div>
      ) : workspaceError || projectError ? (
        <div className="empty-scope" role="alert"><span className="empty-icon"><Icon name="warning" /></span><div><h2 className="empty-title">Scope could not be loaded</h2><p className="empty-copy error-copy">{workspaceError ?? projectError}</p><button type="button" className="retry-button" onClick={() => { void reloadWorkspaces(); void reloadProjects(); }}>Retry scope request</button></div></div>
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
          <div className="overview-scope-line">
            <div className="scope-line" aria-label="Current dashboard scope">
              <span className="scope-chip"><Icon name="layers" size={13} />{workspace.name}</span>
              <span className="scope-chip"><Icon name="folder" size={13} />{project.name}</span>
            </div>
            <div className="fetched-at" data-testid="text-fetched-at">
              {summary.fetchedAt || activity.fetchedAt
                ? <>Fetched {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(summary.fetchedAt ?? activity.fetchedAt!))}</>
                : "Awaiting project data"}
            </div>
          </div>
          {summary.loading && !summary.data ? <OverviewLoading /> : null}
          {summary.error ? <OverviewError message={summary.error} retry={refresh} /> : null}
          {activity.error ? <OverviewError message={activity.error} retry={refresh} /> : null}
          {summary.data ? (
            <>
              <MetricGrid metrics={summary.data.metrics} />
              <div className="overview-grid">
                <ActivityPanel activity={activity.data} range={range} onRangeChange={setRange} error={activity.error} />
                <SeverityPanel distribution={summary.data.severityDistribution} />
              </div>
              <div className="overview-lower-grid">
                <RecentAlertsPanel alerts={summary.data.recentAlerts} />
                <AgentHealthPanel agents={summary.data.agentHealth.items} hasMore={summary.data.agentHealth.hasMore} projectName={project.name} />
              </div>
            </>
          ) : null}
          {!summary.data && summary.error && activity.data ? (
            <div className="overview-grid overview-partial-grid">
              <ActivityPanel activity={activity.data} range={range} onRangeChange={setRange} error={activity.error} />
              <div className="panel-empty overview-no-data"><span className="empty-mark"><Icon name="warning" size={17} /></span><div><strong>Severity distribution unavailable</strong><p>Severity counts are included in the project summary, which could not be loaded.</p></div></div>
            </div>
          ) : null}
          {!summary.loading && !summary.error && !summary.data ? (
            <div className="panel-empty overview-no-data"><span className="empty-mark"><Icon name="shield" size={17} /></span><div><strong>Project summary is not available</strong><p>Retry to request the selected project’s current summary.</p></div></div>
          ) : null}
        </>
      )}
    </main>
  );
}
