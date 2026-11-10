"use client";

import type { ExplorerEvent } from "@workspace/netsleuth-shared";
import { eventTypeLabel, formatEventDate } from "@/lib/events-explorer";

function kindClass(eventType: string): string {
  if (eventType === "AGENT_HEARTBEAT") return "type-heartbeat";
  if (eventType.startsWith("AUTHENTICATION_")) return "type-auth";
  if (eventType === "SERVICE_DISCOVERED") return "type-service";
  return "";
}

export function EventsTable({ events, onOpen, onCopy, copiedAddress }: {
  events: ExplorerEvent[];
  onOpen: (event: ExplorerEvent) => void;
  onCopy: (address: string, eventId: string, side: "source" | "destination") => void;
  copiedAddress: string | null;
}) {
  return (
    <div className="events-table-viewport">
      <table className="events-table">
        <thead>
          <tr>
            <th scope="col">Event type</th><th scope="col">Source</th><th scope="col">Source port</th>
            <th scope="col">Destination</th><th scope="col">Dest. port</th><th scope="col">Protocol</th>
            <th scope="col">Agent</th><th scope="col">Occurred</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} data-testid={`row-network-event-${event.id}`}>
              <td>
                <button className="events-type-button" type="button" onClick={() => onOpen(event)} aria-label={`View ${eventTypeLabel(event.eventType)} event details`} data-testid={`button-event-details-${event.id}`}>
                  <i className={`events-type-mark ${kindClass(event.eventType)}`} aria-hidden="true" />{eventTypeLabel(event.eventType)}
                </button>
              </td>
              <td><span className="events-address">{event.sourceIp}<button className="events-copy" type="button" aria-label={`Copy source address ${event.sourceIp}`} title="Copy source IP" onClick={() => onCopy(event.sourceIp, event.id, "source")} data-testid={`button-copy-source-${event.id}`}>{copiedAddress === `${event.id}:source` ? "OK" : "Copy"}</button></span></td>
              <td><span className="events-port">{event.sourcePort ?? "—"}</span></td>
              <td><span className="events-address">{event.destinationIp}<button className="events-copy" type="button" aria-label={`Copy destination address ${event.destinationIp}`} title="Copy destination IP" onClick={() => onCopy(event.destinationIp, event.id, "destination")} data-testid={`button-copy-destination-${event.id}`}>{copiedAddress === `${event.id}:destination` ? "OK" : "Copy"}</button></span></td>
              <td><span className="events-port">{event.destinationPort ?? "—"}</span></td>
              <td><span className="events-protocol">{event.protocol}</span></td>
              <td><span className="events-agent" title={`${event.agentName} · ${event.agentId}`}>{event.agentName || event.agentId}</span></td>
              <td><time className="events-time" dateTime={event.occurredAt} title={new Date(event.occurredAt).toLocaleString()}>{formatEventDate(event.occurredAt)}</time></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
