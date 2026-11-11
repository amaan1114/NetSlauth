"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AlertStatus, InvestigationAlert } from "@workspace/netsleuth-shared";
import { EventDetailDialog } from "@/components/dashboard/event-detail-dialog";
import { PageHeading } from "@/components/dashboard/page-heading";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Button } from "@/components/ui/button";
import { ApiError, apiRequestWithRefresh } from "@/lib/api";
import { eventTypeLabel, formatEventDate } from "@/lib/events-explorer";
import { EMPTY_ALERT_FILTERS, useAlertDetail, useAlertList, useAlertRelatedEvents, type AlertFilters } from "@/hooks/use-security-alerts";

const AUTH_RULE = "REPEATED_AUTHENTICATION_FAILURES";
const DATABASE_RULE = "UNEXPECTED_DATABASE_CONNECTION";

function shortProjectId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value;
}

function readableError(error: unknown) {
  return error instanceof ApiError ? error.message : "The status change could not be saved. Try again.";
}

function AlertSkeleton() {
  return <div className="alerts-skeleton" aria-label="Loading security alerts" aria-busy="true">
    {[0, 1, 2, 3, 4].map((row) => <div className="alerts-skeleton-row" key={row}>{[0, 1, 2, 3, 4, 5].map((cell) => <span className="skeleton" key={cell} />)}</div>)}
  </div>;
}

function EvidenceValue({ value }: { value: unknown }) {
  return <code className="alert-evidence-value">{typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "Unavailable"}</code>;
}

function AlertInvestigation({ projectId, projectName, alertId, onClose, onAlertUpdated, initialStatus }: {
  projectId: string;
  projectName: string;
  alertId: string;
  onClose: () => void;
  onAlertUpdated: (alert: InvestigationAlert) => void;
  initialStatus?: InvestigationAlert;
}) {
  const { clearAuth } = useAuth();
  const [retryNonce, setRetryNonce] = useState(0);
  const [relatedPage, setRelatedPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<AlertStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [eventHint, setEventHint] = useState("");
  const [statusOverride, setStatusOverride] = useState<AlertStatus | null>(null);
  const { detail, error, loading } = useAlertDetail(projectId, alertId, retryNonce, clearAuth);
  const { related, error: relatedError, loading: relatedLoading } = useAlertRelatedEvents(projectId, alertId, relatedPage, retryNonce, clearAuth);
  const alert = useMemo(() => {
    const base = detail?.alert ?? (initialStatus?.id === alertId ? initialStatus : null);
    return base && statusOverride ? { ...base, status: statusOverride } : base;
  }, [alertId, detail, initialStatus, statusOverride]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    setRelatedPage(1);
    setSelectedEvent(null);
    setMutationError("");
    setStatusOverride(null);
  }, [alertId]);

  const rule = alert?.ruleId === AUTH_RULE
    ? "This rule groups reported authentication failures from the same source and destination within a rolling window."
    : alert?.ruleId === DATABASE_RULE
      ? "This rule compares a reported connection to the project’s configured database ports and allowed destinations."
      : alert?.description ?? "The stored alert description is the available rule context.";
  const evidence = alert?.evidence ?? {};
  const refs = Array.isArray(evidence.events) ? evidence.events.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const eventReferenceIds = refs.map((item) => item.id).filter((id): id is string => typeof id === "string");
  const eventsAvailable = Boolean(related?.events.length);

  async function saveStatus() {
    if (!alert || !confirmStatus || pending) return;
    setPending(true);
    setMutationError("");
    try {
      const result = await apiRequestWithRefresh<{ alert: InvestigationAlert; agent: { id: string; name: string } | null }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/alerts/${encodeURIComponent(alertId)}/status`,
        { method: "PATCH", body: { status: confirmStatus } },
      );
      if (result.alert.projectId !== projectId || result.alert.id !== alertId) throw new Error("The server returned a different alert scope.");
      setStatusOverride(result.alert.status);
      onAlertUpdated(result.alert);
      setConfirmStatus(null);
      setRetryNonce((value) => value + 1);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) clearAuth();
      setMutationError(readableError(requestError));
    } finally {
      setPending(false);
    }
  }

  const nextStatus = alert?.status === "OPEN"
    ? [{ status: "ACKNOWLEDGED" as const, label: "Acknowledge" }, { status: "RESOLVED" as const, label: "Resolve" }]
    : alert?.status === "ACKNOWLEDGED"
      ? [{ status: "RESOLVED" as const, label: "Resolve" }, { status: "OPEN" as const, label: "Reopen" }]
      : alert ? [{ status: "OPEN" as const, label: "Reopen" }] : [];
  const hasDatabasePolicy = typeof evidence.databasePolicy === "object" && evidence.databasePolicy !== null;

  return <>
    <dialog ref={dialogRef} className="alert-investigation-dialog" aria-labelledby="alert-investigation-title"
      onCancel={(event) => { event.preventDefault(); if (!pending) closeRef.current(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !pending) closeRef.current(); }}>
      <div className="alert-investigation-head">
        <div><span className="eyebrow">Project investigation</span><h2 id="alert-investigation-title">{alert?.title ?? (loading ? "Loading alert…" : "Alert details")}</h2><p>{projectName} <span>·</span> {shortProjectId(projectId)}</p></div>
        <button type="button" className="events-dialog-close" aria-label="Close alert investigation" onClick={onClose} disabled={pending} data-testid="button-close-alert-investigation">×</button>
      </div>
      {loading ? <div className="alert-detail-loading" aria-label="Loading alert details" aria-busy="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
        : error ? <div className="alert-detail-error" role="alert"><strong>Alert details unavailable</strong><p>{error}</p><Button type="button" variant="secondary" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>Retry</Button></div>
          : alert && <>
            <div className="alert-investigation-content">
              <section className="alert-detail-section alert-overview">
                <div className="alert-overview-top">
                  <span className={`severity-pill severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                  <span className={`alert-status status-${alert.status.toLowerCase()}`}>{alert.status}</span>
                  <span className="alert-rule-id">{alert.ruleId}</span>
                </div>
                <p className="alert-description">{alert.description}</p>
                <div className="alert-detail-grid">
                  <div><span>Project</span><strong>{projectName}</strong></div>
                  <div><span>Associated agent</span><strong>{detail?.agent?.name ?? (alert.agentId ? shortProjectId(alert.agentId) : "Project-level; multiple agents may contribute")}</strong></div>
                  <div><span>First observed</span><strong>{formatEventDate(alert.firstSeenAt)}</strong></div>
                  <div><span>Last observed</span><strong>{formatEventDate(alert.lastSeenAt)}</strong></div>
                  <div><span>Alert created</span><strong>{formatEventDate(alert.createdAt)}</strong></div>
                  <div><span>Alert updated</span><strong>{formatEventDate(alert.updatedAt)}</strong></div>
                </div>
                <div className="alert-status-actions" aria-label="Alert status actions">
                  {nextStatus.map(({ status, label }) => <Button key={status} type="button" variant={status === "RESOLVED" ? "secondary" : "primary"} size="sm" disabled={pending} onClick={() => setConfirmStatus(status)} data-testid={`button-alert-${label.toLowerCase()}`}>{label}</Button>)}
                  {pending && <span role="status">Saving status…</span>}
                </div>
                {mutationError && <p className="alert-mutation-error" role="alert">{mutationError}</p>}
              </section>

              <section className="alert-detail-section">
                <div className="alert-section-heading"><div><span className="eyebrow">Interpretation</span><h3>What this rule observed</h3></div><span className="alert-fact-label">Rule context</span></div>
                <p className="alert-rule-copy">{rule}</p>
                <p className="alert-boundary-note">Recorded behavior is evidence for review, not a conclusion about intent or successful access. No malicious-IP classification is applied.</p>
              </section>

              <section className="alert-detail-section">
                <div className="alert-section-heading"><div><span className="eyebrow">Stored evidence</span><h3>Available fields</h3></div><span className="alert-fact-label">Redacted by API</span></div>
                <div className="alert-evidence-grid">
                  {(["sourceIp", "destinationIp", "sourcePort", "destinationPort", "protocol", "eventType", "failureCount", "threshold", "windowSeconds", "windowStart", "windowEnd", "observation"] as const).map((key) => {
                    const value = evidence[key];
                    const available = typeof value === "string" || typeof value === "number" || typeof value === "boolean";
                    return <div className="alert-evidence-item" key={key}><span>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><EvidenceValue value={available ? value : undefined} /></div>;
                  })}
                </div>
                {hasDatabasePolicy && <div className="alert-policy-box"><h4>Database policy snapshot in evidence</h4><pre>{JSON.stringify(evidence.databasePolicy, null, 2)}</pre></div>}
                <div className="alert-policy-box"><h4>Evidence references</h4>
                  {typeof evidence.eventId === "string" && <p>Public event ID <code>{evidence.eventId}</code></p>}
                  {Array.isArray(evidence.eventIds) && <p>Referenced public event IDs <code>{evidence.eventIds.filter((item): item is string => typeof item === "string").join(", ") || "Unavailable"}</code></p>}
                  {refs.length > 0 && <p>{refs.length} stored event reference{refs.length === 1 ? "" : "s"} include internal record IDs and occurrence times.</p>}
                  {typeof evidence.sourcePort !== "number" && <p>Source port is not stored with this alert. It may be available in a linked event record.</p>}
                  {!eventReferenceIds.length && typeof evidence.eventId !== "string" && !Array.isArray(evidence.eventIds) && <p>No explicit event reference is stored for this alert.</p>}
                </div>
              </section>

              <section className="alert-detail-section">
                <div className="alert-section-heading"><div><span className="eyebrow">Observed time</span><h3>Investigation timeline</h3></div></div>
                <ol className="alert-timeline">
                  <li><span className="alert-timeline-dot" /><div><strong>First observed</strong><time>{formatEventDate(alert.firstSeenAt)}</time></div></li>
                  {typeof evidence.windowStart === "string" && <li><span className="alert-timeline-dot alert-timeline-evidence" /><div><strong>Evidence window start</strong><time>{formatEventDate(evidence.windowStart)}</time></div></li>}
                  {refs.map((item, index) => <li key={`${String(item.id)}-${index}`}><span className="alert-timeline-dot alert-timeline-evidence" /><div><strong>Referenced event occurrence</strong><time>{formatEventDate(typeof item.occurredAt === "string" ? item.occurredAt : null)}</time></div></li>)}
                  {typeof evidence.windowEnd === "string" && <li><span className="alert-timeline-dot alert-timeline-evidence" /><div><strong>Evidence window end</strong><time>{formatEventDate(evidence.windowEnd)}</time></div></li>}
                  <li><span className="alert-timeline-dot alert-timeline-latest" /><div><strong>Last observed</strong><time>{formatEventDate(alert.lastSeenAt)}</time></div></li>
                  <li><span className="alert-timeline-dot alert-timeline-created" /><div><strong>Alert record created</strong><time>{formatEventDate(alert.createdAt)}</time></div></li>
                </ol>
                <p className="alert-boundary-note">This is a timeline of stored timestamps and referenced evidence, not a complete status history or sequence of every observation.</p>
              </section>

              <section className="alert-detail-section">
                <div className="alert-section-heading"><div><span className="eyebrow">Next step</span><h3>Related stored events</h3></div>{related && <span className="alert-fact-label">Page {related.pagination.page}</span>}</div>
                {relatedError && <div className="alert-related-error" role="alert">{relatedError}<Button type="button" variant="ghost" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>Retry</Button></div>}
                {relatedLoading ? <div className="alert-detail-loading"><span className="skeleton" /><span className="skeleton" /></div>
                  : related?.events.length ? <div className="alert-related-list">{related.events.map((event) => <div className="alert-related-event" key={event.id}>
                    <div><strong>{eventTypeLabel(event.eventType)}</strong><span>{event.sourceIp}:{event.sourcePort ?? "Unavailable"} → {event.destinationIp}:{event.destinationPort ?? "Unavailable"} · {event.protocol}</span><time>{formatEventDate(event.occurredAt)}</time></div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => { setSelectedEvent(event.id); setEventHint(""); }} data-testid={`button-open-related-event-${event.id}`}>Inspect record</Button>
                  </div>)}</div>
                    : !relatedError && <div className="alert-related-empty"><strong>{eventsAvailable ? "No events on this page" : "No linked event records returned"}</strong><span>{eventReferenceIds.length || typeof evidence.eventId === "string" ? "The alert includes references, but no matching stored event is currently available in this result." : "The stored evidence has no explicit references for opening event records."}</span></div>}
                {related && (related.pagination.page > 1 || related.pagination.hasMore) && <div className="alert-related-pagination"><button type="button" className="events-page-button" disabled={related.pagination.page <= 1 || relatedLoading} onClick={() => setRelatedPage((value) => Math.max(1, value - 1))}>Previous events</button><button type="button" className="events-page-button" disabled={!related.pagination.hasMore || relatedLoading} onClick={() => setRelatedPage((value) => value + 1)}>More events</button></div>}
                {eventHint && <p className="alert-related-hint" role="status">{eventHint}</p>}
              </section>
            </div>
            <div className="alert-investigation-footer"><span>RESOLVED alerts remain resolved when later detections arrive. Reopen is an explicit manual status change.</span><Button type="button" variant="secondary" onClick={onClose}>Close investigation</Button></div>
          </>}
    </dialog>

    {confirmStatus && <dialog className="agent-dialog agent-confirm-dialog" open aria-labelledby="alert-confirm-title">
      <div className="agent-dialog-head"><div><h2 id="alert-confirm-title">{confirmStatus === "RESOLVED" ? "Resolve this alert?" : confirmStatus === "ACKNOWLEDGED" ? "Acknowledge this alert?" : "Reopen this alert?"}</h2><p>This changes only the alert status. Observation timestamps and evidence remain unchanged.</p></div></div>
      <div className="revoke-summary"><strong>{alert?.title}</strong><span>Current status: {alert?.status} · New status: {confirmStatus}</span></div>
      <div className="agent-dialog-actions"><Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirmStatus(null)}>Cancel</Button><Button type="button" variant={confirmStatus === "RESOLVED" ? "danger" : "primary"} disabled={pending} onClick={() => void saveStatus()}>{pending ? "Saving…" : `Confirm ${confirmStatus.toLowerCase()}`}</Button></div>
    </dialog>}
    <EventDetailDialog projectId={projectId} recordId={selectedEvent} onClose={() => setSelectedEvent(null)} />
  </>;
}

function ProjectAlerts({ projectId, projectName, realtimeVersion }: { projectId: string; projectName: string; realtimeVersion: number }) {
  const { clearAuth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const alertId = searchParams.get("alertId");
  const [filters, setFilters] = useState<AlertFilters>(EMPTY_ALERT_FILTERS);
  const [debouncedText, setDebouncedText] = useState({ ruleId: "", sourceIp: "" });
  const [pageState, setPageState] = useState({ filterKey: "", page: 1 });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [updatedAlert, setUpdatedAlert] = useState<InvestigationAlert | undefined>();
  const previousProject = useRef(projectId);
  useEffect(() => { if (realtimeVersion) setRefreshNonce((value) => value + 1); }, [realtimeVersion]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText({ ruleId: filters.ruleId, sourceIp: filters.sourceIp }), 350);
    return () => window.clearTimeout(timer);
  }, [filters.ruleId, filters.sourceIp]);

  useEffect(() => {
    if (previousProject.current !== projectId) {
      previousProject.current = projectId;
      setFilters(EMPTY_ALERT_FILTERS);
      setDebouncedText({ ruleId: "", sourceIp: "" });
      setPageState({ filterKey: "", page: 1 });
      setUpdatedAlert(undefined);
      if (alertId) clearAlertQuery();
    }
  }, [projectId]);

  function clearAlertQuery() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("alertId");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  function changeFilter(field: keyof AlertFilters, value: string) {
    setFilters((current) => ({ ...current, [field]: value }));
    setPageState({ filterKey: "", page: 1 });
  }
  function clearFilters() {
    setFilters(EMPTY_ALERT_FILTERS);
    setDebouncedText({ ruleId: "", sourceIp: "" });
    setPageState({ filterKey: "", page: 1 });
  }

  const pendingText = filters.ruleId !== debouncedText.ruleId || filters.sourceIp !== debouncedText.sourceIp;
  const effectiveFilters = useMemo<AlertFilters>(() => ({
    severity: filters.severity,
    status: filters.status,
    start: filters.start,
    end: filters.end,
    ruleId: debouncedText.ruleId,
    sourceIp: debouncedText.sourceIp,
  }), [debouncedText, filters.end, filters.severity, filters.start, filters.status]);
  const filterKey = JSON.stringify(effectiveFilters);
  const page = pageState.filterKey === filterKey ? pageState.page : 1;
  const { alerts, error, loading, validationErrors } = useAlertList(projectId, page, effectiveFilters, refreshNonce, clearAuth, pendingText);
  const dateValidationErrors = useMemo(() => {
    const out: string[] = [];
    const start = filters.start ? new Date(filters.start) : null;
    const end = filters.end ? new Date(filters.end) : null;
    if (filters.start && (!start || Number.isNaN(start.getTime()))) out.push("Enter a valid start time.");
    if (filters.end && (!end || Number.isNaN(end.getTime()))) out.push("Enter a valid end time.");
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) out.push("End time must be later than start time.");
    return out;
  }, [filters.end, filters.start]);
  const allErrors = [...validationErrors, ...dateValidationErrors.filter((message) => !validationErrors.includes(message))];

  return <>
    <PageHeading eyebrow="Detection / stored signals" title="Security alerts" description="Review project-scoped detection evidence, inspect linked event records, and manage alert status. A signal is not a verdict." />
    <div className="alerts-scope-strip"><div><span className="eyebrow">Project scope</span><strong>{projectName}</strong><code>{shortProjectId(projectId)}</code></div><button className="overview-refresh" type="button" disabled={loading || pendingText} onClick={() => setRefreshNonce((value) => value + 1)}>Refresh alerts</button></div>
    <p className="alerts-evidence-note"><strong>Evidence boundary</strong><span>Alerts represent persisted agent-reported observations and detection-rule context. They do not establish intent, maliciousness, or successful access.</span></p>
    <section className="panel alerts-workspace" aria-labelledby="alerts-workspace-title">
      <div className="panel-header alerts-panel-header"><div><h2 className="panel-title" id="alerts-workspace-title">Alert records</h2><p className="panel-subtitle">Most recently observed first · last observed time is not creation time</p></div><span className="alerts-page-indicator">Page {page} · 20 per request</span></div>
      <div className="alerts-filters" aria-label="Filter security alerts">
        <label className="alert-filter"><span>Severity</span><select value={filters.severity} onChange={(event) => changeFilter("severity", event.target.value)} data-testid="select-alert-severity"><option value="">All severities</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="alert-filter"><span>Status</span><select value={filters.status} onChange={(event) => changeFilter("status", event.target.value)} data-testid="select-alert-status"><option value="">All statuses</option>{["OPEN", "ACKNOWLEDGED", "RESOLVED"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="alert-filter alert-filter-text"><span>Detection rule</span><input value={filters.ruleId} maxLength={100} onChange={(event) => changeFilter("ruleId", event.target.value)} placeholder="Exact rule identifier" data-testid="input-alert-rule" /></label>
        <label className="alert-filter alert-filter-text"><span>Source IP</span><input value={filters.sourceIp} onChange={(event) => changeFilter("sourceIp", event.target.value)} placeholder="Exact IPv4 or IPv6" aria-invalid={Boolean(allErrors.some((item) => item.includes("Source IP")))} data-testid="input-alert-source-ip" /></label>
        <label className="alert-filter"><span>Last observed from</span><input type="datetime-local" value={filters.start} onChange={(event) => changeFilter("start", event.target.value)} data-testid="input-alert-start" /></label>
        <label className="alert-filter"><span>Last observed before</span><input type="datetime-local" value={filters.end} onChange={(event) => changeFilter("end", event.target.value)} data-testid="input-alert-end" /></label>
        <button type="button" className="alerts-clear-filters" onClick={clearFilters} disabled={!Object.values(filters).some(Boolean)} data-testid="button-clear-alert-filters">Clear filters</button>
      </div>
      {allErrors.length > 0 && <div className="alert-validation" role="alert">{allErrors.map((message) => <p key={message}>{message}</p>)}</div>}
      {error && <div className="alerts-error" role="alert"><div><strong>Could not load alert records</strong><p>{error}</p></div><button type="button" className="retry-button" onClick={() => setRefreshNonce((value) => value + 1)}>Retry</button></div>}
      {loading || pendingText ? <AlertSkeleton />
        : error ? <div className="alerts-empty"><span className="agents-empty-mark">!</span><h3>Alert records unavailable</h3><p>Retry to load the selected project’s current page.</p></div>
          : allErrors.length ? <div className="alerts-empty"><span className="agents-empty-mark">!</span><h3>Review the filters</h3><p>Correct the highlighted values before searching stored alerts.</p></div>
            : alerts?.alerts.length ? <div className="alerts-table-wrap"><table className="alerts-table alerts-investigation-table"><thead><tr><th>Alert</th><th>Severity</th><th>Detection rule</th><th>Source</th><th>Destination</th><th>First seen</th><th>Last observed</th><th>Status</th></tr></thead><tbody>
              {alerts.alerts.map((item) => <tr key={item.id} data-testid={`row-security-alert-${item.id}`}>
                <td className="alert-title-cell"><button type="button" className="alert-title-button" onClick={() => { setUpdatedAlert(item); const params = new URLSearchParams(searchParams.toString()); params.set("alertId", item.id); router.push(`${pathname}?${params.toString()}`, { scroll: false }); }} data-testid={`button-investigate-alert-${item.id}`}>{item.title}</button></td>
                <td><span className={`severity-pill severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td><td className="mono-cell">{item.ruleId}</td>
                <td className="mono-cell">{typeof item.evidence.sourceIp === "string" ? item.evidence.sourceIp : "Unavailable"}</td>
                <td className="mono-cell">{typeof item.evidence.destinationIp === "string" ? item.evidence.destinationIp : "Unavailable"}</td>
                <td>{formatEventDate(item.firstSeenAt)}</td><td>{formatEventDate(item.lastSeenAt)}</td><td><span className={`alert-status status-${item.status.toLowerCase()}`}>{item.status}</span></td>
              </tr>)}
            </tbody></table></div>
              : alerts && <div className="alerts-empty"><span className="agents-empty-mark">—</span><h3>{Object.values(effectiveFilters).some(Boolean) ? "No alerts match these filters" : "No stored alerts yet"}</h3><p>{Object.values(effectiveFilters).some(Boolean) ? "Widen the last-observed range or clear an exact-match filter to review more evidence." : "Security alerts appear here only when a project detection rule matches persisted event evidence."}</p></div>}
      {alerts && (alerts.alerts.length > 0 || page > 1) && <div className="events-pagination"><span className="events-page-summary">{alerts.alerts.length ? `Showing ${alerts.alerts.length} records on page ${page} · no global total returned` : `No records on page ${page}`}</span><div className="events-page-actions"><button type="button" className="events-page-button" disabled={page <= 1 || loading || pendingText} onClick={() => setPageState({ filterKey, page: Math.max(1, page - 1) })} data-testid="button-alerts-previous">Previous</button><button type="button" className="events-page-button" disabled={!alerts.pagination.hasMore || loading || pendingText} onClick={() => setPageState({ filterKey, page: page + 1 })} data-testid="button-alerts-next">Next</button></div></div>}
    </section>
    {alertId && <AlertInvestigation key={`${projectId}:${alertId}`} projectId={projectId} projectName={projectName} alertId={alertId} initialStatus={updatedAlert} onClose={clearAlertQuery} onAlertUpdated={(item) => { setUpdatedAlert(item); setRefreshNonce((value) => value + 1); }} />}
  </>;
}

export function AlertsContent() {
  const { project, workspaceLoading, projectLoading, workspaces, projects, workspaceError, projectError, reloadWorkspaces, reloadProjects, realtime } = useDashboard();
  const scopeLoading = workspaceLoading || projectLoading;
  if (scopeLoading) return <div className="alerts-page-loading" aria-label="Loading project scope" aria-busy="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>;
  if (workspaceError || projectError) return <div className="agents-scope-error" role="alert"><div><strong>Could not load project scope</strong><p>{workspaceError ?? projectError}</p><button className="retry-button" type="button" onClick={() => void (workspaceError ? reloadWorkspaces() : reloadProjects())}>Retry scope loading</button></div></div>;
  if (!workspaces.length) return <div className="agents-no-scope"><h1>No workspace available</h1><p>Security alerts are visible only within an authorized project.</p></div>;
  if (!projects.length) return <div className="agents-no-scope"><h1>No project available</h1><p>Choose a workspace with an authorized project to review alert evidence.</p></div>;
  if (!project) return <div className="agents-no-scope"><h1>Select a project</h1><p>Choose an authorized project from the selector above.</p></div>;
  return <ProjectAlerts projectId={project.id} projectName={project.name} realtimeVersion={realtime.alertVersion} />;
}
