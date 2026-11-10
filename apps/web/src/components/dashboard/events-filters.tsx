"use client";

import { networkEventTypeSchema, networkProtocolSchema } from "@workspace/netsleuth-shared";
import type { EventFilters } from "@/lib/events-explorer";
import { eventTypeLabel } from "@/lib/events-explorer";

export function EventsFilters({ filters, agents, errors, onChange, onClear }: {
  filters: EventFilters;
  agents: { id: string; name: string }[];
  errors: string[];
  onChange: (field: keyof EventFilters, value: string) => void;
  onClear: () => void;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  return (
    <>
      <div className="events-filters" aria-label="Filter network events">
        <label className="events-filter-field">
          <span>Event type</span>
          <select value={filters.eventType} onChange={(event) => onChange("eventType", event.target.value)} data-testid="select-event-type">
            <option value="">All event types</option>
            {networkEventTypeSchema.options.map((value) => <option key={value} value={value}>{eventTypeLabel(value)}</option>)}
          </select>
        </label>
        <label className="events-filter-field">
          <span>Protocol</span>
          <select value={filters.protocol} onChange={(event) => onChange("protocol", event.target.value)} data-testid="select-event-protocol">
            <option value="">All protocols</option>
            {networkProtocolSchema.options.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="events-filter-field">
          <span>Source IP</span>
          <input value={filters.sourceIp} onChange={(event) => onChange("sourceIp", event.target.value)} placeholder="Exact IPv4 or IPv6" autoComplete="off" spellCheck={false} data-testid="input-event-source-ip" />
        </label>
        <label className="events-filter-field">
          <span>Destination IP</span>
          <input value={filters.destinationIp} onChange={(event) => onChange("destinationIp", event.target.value)} placeholder="Exact IPv4 or IPv6" autoComplete="off" spellCheck={false} data-testid="input-event-destination-ip" />
        </label>
        <label className="events-filter-field">
          <span>Agent UUID</span>
          <input list="event-agent-options" value={filters.agentId} onChange={(event) => onChange("agentId", event.target.value)} placeholder="Paste an agent UUID" autoComplete="off" spellCheck={false} data-testid="input-event-agent-id" />
          <datalist id="event-agent-options">
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </datalist>
        </label>
        <div className="events-filter-field events-filter-time-field">
          <span>Occurred between · {timezone}</span>
          <div className="events-filter-time">
            <label><span className="sr-only">Start time (inclusive)</span><input type="datetime-local" value={filters.start} onChange={(event) => onChange("start", event.target.value)} aria-label="Start time, inclusive" data-testid="input-event-start" /></label>
            <label><span className="sr-only">End time (exclusive)</span><input type="datetime-local" value={filters.end} onChange={(event) => onChange("end", event.target.value)} aria-label="End time, exclusive" data-testid="input-event-end" /></label>
          </div>
        </div>
        <div className="events-filter-actions">
          <button className="events-filter-clear" type="button" onClick={onClear} data-testid="button-clear-event-filters">Clear filters</button>
          <span className="events-filter-caption">Addresses match exactly. Time bounds are inclusive at start and exclusive at end.</span>
        </div>
      </div>
      {errors.length > 0 && <div className="events-validation" role="alert" data-testid="status-event-filter-validation">{errors.join(" ")}</div>}
    </>
  );
}
