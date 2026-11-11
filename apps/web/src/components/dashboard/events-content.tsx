"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExplorerEvent } from "@workspace/netsleuth-shared";
import { EventDetailDialog } from "@/components/dashboard/event-detail-dialog";
import { EventsFilters } from "@/components/dashboard/events-filters";
import { EventsTable } from "@/components/dashboard/events-table";
import { PageHeading } from "@/components/dashboard/page-heading";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Icon } from "@/components/ui/icon";
import { useNetworkEvents } from "@/hooks/use-network-events";
import { EMPTY_EVENT_FILTERS, type EventFilters } from "@/lib/events-explorer";

const DEBOUNCED_FIELDS = ["sourceIp", "destinationIp", "agentId"] as const;

function EventSkeleton() {
  return <div className="events-skeleton" aria-label="Loading network events" aria-busy="true">
    {[0, 1, 2, 3, 4].map((row) => <div className="events-skeleton-row" key={row}>
      {[0, 1, 2, 3, 4, 5].map((cell) => <span className="skeleton" key={cell} />)}
    </div>)}
  </div>;
}

function shortProjectId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function ProjectEvents({ projectId, projectName, realtimeVersion }: { projectId: string; projectName: string; realtimeVersion: number }) {
  const { clearAuth } = useAuth();
  const [filters, setFilters] = useState<EventFilters>(EMPTY_EVENT_FILTERS);
  const [debouncedText, setDebouncedText] = useState({
    sourceIp: "",
    destinationIp: "",
    agentId: "",
  });
  const [pagination, setPagination] = useState({ filterKey: "", offset: 0 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  useEffect(() => { if (realtimeVersion) setRefreshNonce((value) => value + 1); }, [realtimeVersion]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedText({
        sourceIp: filters.sourceIp,
        destinationIp: filters.destinationIp,
        agentId: filters.agentId,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filters.agentId, filters.destinationIp, filters.sourceIp]);

  const searchPending = DEBOUNCED_FIELDS.some((field) => filters[field] !== debouncedText[field]);
  const effectiveFilters = useMemo<EventFilters>(() => ({
    eventType: filters.eventType,
    protocol: filters.protocol,
    start: filters.start,
    end: filters.end,
    sourceIp: debouncedText.sourceIp,
    destinationIp: debouncedText.destinationIp,
    agentId: debouncedText.agentId,
  }), [debouncedText, filters.eventType, filters.protocol, filters.start, filters.end]);
  const filterKey = JSON.stringify(effectiveFilters);
  const offset = pagination.filterKey === filterKey ? pagination.offset : 0;
  const { agents, events, error, loading, validationErrors } = useNetworkEvents(
    projectId,
    effectiveFilters,
    offset,
    refreshNonce,
    clearAuth,
    searchPending,
  );

  function changeFilter(field: keyof EventFilters, value: string) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPagination({ filterKey: "", offset: 0 });
  }

  function clearFilters() {
    setFilters(EMPTY_EVENT_FILTERS);
    setDebouncedText({ sourceIp: "", destinationIp: "", agentId: "" });
    setPagination({ filterKey: "", offset: 0 });
  }

  async function copyAddress(address: string, eventId: string, side: "source" | "destination") {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(`${eventId}:${side}`);
      setCopyFeedback(`${side === "source" ? "Source" : "Destination"} address copied.`);
    } catch {
      setCopiedAddress(null);
      setCopyFeedback("Clipboard access was unavailable. Select and copy the address manually.");
    }
    window.setTimeout(() => {
      setCopiedAddress(null);
      setCopyFeedback("");
    }, 2200);
  }

  const firstRow = events && events.events.length ? events.pagination.offset + 1 : 0;
  const lastRow = events ? events.pagination.offset + events.events.length : 0;
  const noResultsFiltered = Object.values(effectiveFilters).some(Boolean);

  return (
    <>
      <PageHeading
        eyebrow="Observability / recorded events"
        title="Network events"
        description="Inspect persisted event records reported by agents in the selected project. These records are connection evidence, not packet capture."
      />
      <div className="events-scope-strip">
        <div className="events-scope-copy"><span className="eyebrow">Project scope</span><strong>{projectName}</strong><code>{shortProjectId(projectId)}</code></div>
        <button className="events-refresh" type="button" onClick={() => { setPagination({ filterKey, offset: 0 }); setRefreshNonce((value) => value + 1); }} disabled={loading || searchPending || validationErrors.length > 0} data-testid="button-refresh-events" aria-label="Refresh network events">
          <Icon name="refresh" size={13} /> Refresh
        </button>
      </div>
      <p className="events-evidence-note"><strong>Evidence boundary</strong><span>Rows reflect stored agent-reported events only. No packet contents or live traffic stream are represented here.</span></p>
      <section className="panel events-panel" aria-labelledby="events-panel-title">
        <div className="events-panel-head">
          <div><h2 id="events-panel-title">Event records</h2><p>Newest occurrence first · current page only · 25 records per request</p></div>
          {events && <span className="events-page-indicator" data-testid="text-events-page">Page {Math.floor(events.pagination.offset / events.pagination.limit) + 1}</span>}
        </div>
        <EventsFilters
          filters={filters}
          agents={agents}
          errors={validationErrors}
          onChange={changeFilter}
          onClear={clearFilters}
        />
        {error && <div className="events-status events-status-row" role="alert" data-testid="status-events-error"><div><strong>Could not load event records</strong><p>{error}</p></div><button className="events-retry" type="button" onClick={() => setRefreshNonce((value) => value + 1)} data-testid="button-retry-events">Retry</button></div>}
        {loading || searchPending ? <EventSkeleton />
          : validationErrors.length > 0 ? <div className="events-empty"><span className="events-empty-mark">!</span><h3>Review the filters</h3><p>Correct the highlighted values before querying stored events.</p></div>
            : error ? <div className="events-empty"><span className="events-empty-mark">!</span><h3>Event records unavailable</h3><p>Retry to load the selected project’s current page.</p></div>
              : events && events.events.length > 0 ? <EventsTable
                events={events.events}
                onOpen={(event: ExplorerEvent) => setSelectedRecordId(event.id)}
                onCopy={(address, eventId, side) => void copyAddress(address, eventId, side)}
                copiedAddress={copiedAddress}
              />
                : events ? <div className="events-empty">
                  <span className="events-empty-mark"><Icon name="events" size={17} /></span>
                  <h3>{noResultsFiltered ? "No events match these filters" : "No event records yet"}</h3>
                  <p>{noResultsFiltered ? "Try widening the time range or clearing one of the exact-match filters." : "This project has no event records on this page. Agent heartbeats and service discoveries appear here only when persisted as events."}</p>
                </div> : null}
        {events && (events.events.length > 0 || offset > 0) && <div className="events-pagination">
          <span className="events-page-summary" data-testid="text-events-range">Showing {firstRow}–{lastRow} records · no global total is returned</span>
          <div className="events-page-actions">
            <button type="button" className="events-page-button" disabled={offset === 0 || loading || searchPending} onClick={() => setPagination({ filterKey, offset: Math.max(0, offset - events.pagination.limit) })} data-testid="button-events-previous">Previous</button>
            <button type="button" className="events-page-button" disabled={!events.pagination.hasMore || loading || searchPending || offset + events.pagination.limit > 1_000_000} onClick={() => setPagination({ filterKey, offset: offset + events.pagination.limit })} data-testid="button-events-next">Next</button>
          </div>
        </div>}
      </section>
      <p className="events-copy-feedback" role="status" aria-live="polite">{copyFeedback}</p>
      <EventDetailDialog projectId={projectId} recordId={selectedRecordId} onClose={() => setSelectedRecordId(null)} />
    </>
  );
}

export function EventsContent() {
  const { project, workspaceLoading, projectLoading, workspaces, projects, workspaceError, projectError, reloadWorkspaces, reloadProjects, realtime } = useDashboard();
  const scopeLoading = workspaceLoading || projectLoading;

  if (scopeLoading) return <div className="events-scope-loading" aria-label="Loading project scope" aria-busy="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>;
  if (workspaceError || projectError) {
    return <div className="events-no-scope" role="alert">
      <h1>Could not load project scope</h1><p>{workspaceError ?? projectError}</p>
      <button className="events-retry" type="button" onClick={() => void (workspaceError ? reloadWorkspaces() : reloadProjects())}>Retry scope loading</button>
    </div>;
  }
  if (!workspaces.length) return <div className="events-no-scope"><h1>No workspace available</h1><p>Network events are visible within an authorized project. Join or select a workspace to continue.</p></div>;
  if (!projects.length) return <div className="events-no-scope"><h1>No project available</h1><p>Choose a workspace with an authorized project to inspect its event records.</p></div>;
  if (!project) return <div className="events-no-scope"><h1>Select a project</h1><p>Choose an authorized project from the selector above.</p></div>;
  return <ProjectEvents key={project.id} projectId={project.id} projectName={project.name} realtimeVersion={realtime.networkEventVersion} />;
}
