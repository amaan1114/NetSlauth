"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardActivity, DashboardAlert, DashboardAgent, DashboardRange, DashboardSeverity } from "@workspace/netsleuth-shared";

const severityOrder: DashboardSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const severityLabels: Record<DashboardSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export function MetricGrid({ metrics }: { metrics: {
  totalAgents: number;
  onlineAgents: number;
  offlineAgents: number;
  inactiveAgents: number;
  totalNetworkEvents: number;
  openAlerts: number;
  criticalAlerts: number;
} }) {
  const items = [
    { label: "Total agents", value: metrics.totalAgents, note: "All registered" },
    { label: "Online agents", value: metrics.onlineAgents, note: "Stored status" },
    { label: "Offline agents", value: metrics.offlineAgents, note: "Stored status" },
    { label: "Inactive agents", value: metrics.inactiveAgents, note: "Separate from offline" },
    { label: "Network events", value: metrics.totalNetworkEvents, note: "All persisted event types" },
    { label: "Open alerts", value: metrics.openAlerts, note: "Open status only" },
    { label: "Critical alerts", value: metrics.criticalAlerts, note: "Across all statuses" },
  ];
  return (
    <section className="overview-metrics" aria-label="Project summary metrics">
      {items.map((item, index) => (
        <article className={`metric-card metric-card-${index}`} key={item.label}>
          <div className="metric-label">{item.label}</div>
          <div className="metric-value" data-testid={`metric-${item.label.toLowerCase().replaceAll(" ", "-")}`}>{item.value.toLocaleString()}</div>
          <div className="metric-note">{item.note}</div>
        </article>
      ))}
    </section>
  );
}

function formatTime(value: string | number, range: DashboardRange) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, range === "7d"
    ? { weekday: "short", hour: "numeric" }
    : { hour: "numeric", minute: "2-digit" }).format(date);
}

function ActivityTooltip({ active, payload, label, range }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; payload?: DashboardActivity["buckets"][number] }>;
  label?: number;
  range: DashboardRange;
}) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-time">{formatTime(label ?? bucket.start, range)}</div>
      <div className="tooltip-row"><span className="legend-dot network-dot" />Network <strong>{bucket.network.toLocaleString()}</strong></div>
      <div className="tooltip-row"><span className="legend-dot auth-dot" />Authentication <strong>{bucket.authentication.toLocaleString()}</strong></div>
      <div className="tooltip-divider" />
      <div className="tooltip-row tooltip-muted">Heartbeat <strong>{bucket.heartbeat.toLocaleString()}</strong></div>
      <div className="tooltip-row tooltip-muted">Service <strong>{bucket.service.toLocaleString()}</strong></div>
    </div>
  );
}

export function ActivityPanel({ activity, range, onRangeChange, error }: {
  activity: DashboardActivity | null;
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  error?: string | null;
}) {
  const buckets = activity?.buckets.map((bucket) => ({ ...bucket, epoch: new Date(bucket.start).getTime() })) ?? [];
  const hasVisibleEvents = buckets.some((bucket) => bucket.network > 0 || bucket.authentication > 0);
  const heartbeatTotal = buckets.reduce((sum, bucket) => sum + bucket.heartbeat, 0);
  const serviceTotal = buckets.reduce((sum, bucket) => sum + bucket.service, 0);
  const intervalLabel = activity?.intervalMinutes
    ? activity.intervalMinutes < 60 ? `${activity.intervalMinutes} min buckets` : `${activity.intervalMinutes / 60} hr buckets`
    : "Waiting for activity";

  return (
    <section className="panel overview-panel activity-panel">
      <div className="panel-header activity-header">
        <div>
          <h2 className="panel-title">Network activity</h2>
          <p className="panel-subtitle">Persisted events across the selected period</p>
        </div>
        <div className="range-control" role="group" aria-label="Activity time range">
          {(["1h", "24h", "7d"] as const).map((option) => (
            <button
              key={option}
              className={`range-button${range === option ? " selected" : ""}`}
              type="button"
              aria-pressed={range === option}
              onClick={() => onRangeChange(option)}
              data-testid={`button-range-${option}`}
            >{option}</button>
          ))}
        </div>
      </div>
      <div className="activity-legend">
        <span><i className="legend-dot network-dot" />Network</span>
        <span><i className="legend-dot auth-dot" />Authentication</span>
        <span className="activity-interval">{intervalLabel}</span>
      </div>
      {error ? (
        <div className="chart-error-state" role="status">
          <strong>Activity is unavailable</strong>
          <p>{error}</p>
        </div>
      ) : !activity ? (
        <div className="overview-chart-state" aria-label="Loading activity chart">
          <div className="chart-skeleton skeleton" />
          <div className="chart-state-line skeleton" />
        </div>
      ) : (
        <>
          {hasVisibleEvents ? null : (
            <div className="chart-empty-note" role="status">
              No network or authentication events were recorded in this period. Heartbeat and service events are excluded from the lines below.
            </div>
          )}
          <div className="activity-chart" role="img" aria-label={`Network and authentication event counts, ${range}, grouped in ${activity.intervalMinutes} minute intervals`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={buckets} margin={{ top: 12, right: 14, bottom: 2, left: -18 }}>
                <CartesianGrid stroke="#29343a" strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="epoch"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value: number) => formatTime(value, range)}
                  tick={{ fill: "#7f9090", fontSize: 10 }}
                  axisLine={{ stroke: "#344146" }}
                  tickLine={false}
                  minTickGap={26}
                />
                <YAxis
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => Math.max(1, dataMax)]}
                  tick={{ fill: "#7f9090", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={37}
                />
                <Tooltip content={<ActivityTooltip range={range} />} />
                <Area type="linear" dataKey="network" name="Network" stroke="#9bc9ad" strokeWidth={2} fill="#9bc9ad" fillOpacity={0.14} baseValue={0} activeDot={{ r: 4, fill: "#9bc9ad", stroke: "#17211c", strokeWidth: 2 }} isAnimationActive={false} />
                <Area type="linear" dataKey="authentication" name="Authentication" stroke="#d5a970" strokeWidth={2} fill="#d5a970" fillOpacity={0.12} baseValue={0} activeDot={{ r: 4, fill: "#d5a970", stroke: "#241e16", strokeWidth: 2 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="activity-disclosure">
            Excluded from chart lines: {heartbeatTotal.toLocaleString()} heartbeat and {serviceTotal.toLocaleString()} service events.
          </div>
        </>
      )}
    </section>
  );
}

export function SeverityPanel({ distribution }: { distribution: Record<DashboardSeverity, number> }) {
  const max = Math.max(1, ...severityOrder.map((severity) => distribution[severity]));
  return (
    <section className="panel overview-panel severity-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Alert severity</h2>
          <p className="panel-subtitle">All alert statuses · not confirmed attacks</p>
        </div>
        <span className="tag">All time</span>
      </div>
      <div className="severity-list">
        {severityOrder.map((severity) => (
          <div className="severity-row" key={severity}>
            <span className={`severity-label severity-${severity.toLowerCase()}`}>{severityLabels[severity]}</span>
            <div className="severity-track" aria-hidden="true">
              <div className={`severity-fill severity-${severity.toLowerCase()}`} style={{ width: `${(distribution[severity] / max) * 100}%` }} />
            </div>
            <strong className="severity-count">{distribution[severity].toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function dateLabel(value: string | null) {
  if (!value) return "No heartbeat recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function RecentAlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <section className="panel overview-panel alerts-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Recent alerts</h2>
          <p className="panel-subtitle">Latest detections in this project</p>
        </div>
        <Link href="/dashboard/alerts" className="subtle-link">View alerts</Link>
      </div>
      {alerts.length ? (
        <div className="alerts-table-wrap">
          <table className="alerts-table">
            <thead><tr><th scope="col">Alert</th><th scope="col">Severity</th><th scope="col">Rule</th><th scope="col">Source IP</th><th scope="col">First seen</th><th scope="col">Status</th><th scope="col">Context</th></tr></thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id} data-testid={`row-alert-${alert.id}`}>
                  <td className="alert-title-cell">{alert.title}</td>
                  <td><span className={`severity-pill severity-${alert.severity.toLowerCase()}`}>{severityLabels[alert.severity]}</span></td>
                  <td className="mono-cell">{alert.ruleId}</td>
                  <td className="mono-cell">{alert.sourceIp ?? "—"}</td>
                  <td>{dateLabel(alert.firstSeenAt)}</td>
                  <td><span className={`alert-status status-${alert.status.toLowerCase()}`}>{alert.status.toLowerCase()}</span></td>
                  <td><Link className="alert-context-link" href={`/dashboard/alerts?alertId=${encodeURIComponent(alert.id)}`} aria-label={`Open context for ${alert.title}`}>Context</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel-empty"><span className="empty-mark">0</span><div><strong>No alerts recorded</strong><p>There are no alert records for this project yet.</p></div></div>
      )}
      <div className="panel-footnote">Alert context opens in the alerts area; investigation detail is not yet available.</div>
    </section>
  );
}

export function AgentHealthPanel({ agents, hasMore, projectName }: {
  agents: DashboardAgent[];
  hasMore: boolean;
  projectName: string;
}) {
  return (
    <section className="panel overview-panel agents-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Agent health</h2>
          <p className="panel-subtitle">Stored status · heartbeat freshness does not change status</p>
        </div>
        <span className="tag">{agents.length} shown</span>
      </div>
      {agents.length ? (
        <div className="agent-list">
          {agents.map((agent) => (
            <div className="agent-row" key={agent.id} data-testid={`agent-${agent.id}`}>
              <span className={`agent-state-dot agent-${agent.status.toLowerCase()}`} aria-hidden="true" />
              <div className="agent-main">
                <div className="agent-name">{agent.name}</div>
                <div className="agent-meta">{projectName} <span aria-hidden="true">·</span> Last heartbeat {dateLabel(agent.lastHeartbeatAt)}</div>
              </div>
              <span className={`agent-status agent-${agent.status.toLowerCase()}`}>{agent.status.toLowerCase()}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-empty"><span className="empty-mark">0</span><div><strong>No agents registered</strong><p>Agent health will appear here when agents are registered to this project.</p></div></div>
      )}
      <div className="panel-footnote">
        Status reflects the value stored by the backend; no stale-heartbeat status is inferred.
        {hasMore ? " Showing the first 10 agents by ID; additional agents are not shown here." : ""}
      </div>
    </section>
  );
}

export function OverviewLoading() {
  return (
    <div className="overview-loading" aria-label="Loading project overview">
      <div className="overview-metrics">{Array.from({ length: 7 }, (_, index) => <div className="metric-card" key={index}><div className="skeleton metric-skeleton-label" /><div className="skeleton metric-skeleton-value" /><div className="skeleton metric-skeleton-note" /></div>)}</div>
      <div className="overview-grid"><div className="panel loading-panel"><div className="skeleton chart-skeleton" /></div><div className="panel loading-panel"><div className="skeleton metric-skeleton-value" /></div></div>
    </div>
  );
}

export function OverviewError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="overview-error" role="alert">
      <div><strong>Some project data could not be loaded</strong><p>{message}</p></div>
      <button className="retry-button" type="button" onClick={retry}>Retry</button>
    </div>
  );
}
