"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { useEventDetails } from "@/hooks/use-network-events";
import { eventTypeLabel, formatEventDate } from "@/lib/events-explorer";

export function EventDetailDialog({ projectId, recordId, onClose }: {
  projectId: string;
  recordId: string | null;
  onClose: () => void;
}) {
  const { clearAuth } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [retryNonce, setRetryNonce] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState("");
  const { event, error, loading } = useEventDetails(projectId, recordId, retryNonce, clearAuth);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (recordId && !dialog.open) dialog.showModal();
    if (!recordId && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [recordId]);

  async function copyAddress(address: string, label: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopyFeedback(`${label} address copied.`);
    } catch {
      setCopyFeedback("Clipboard access was unavailable. Select and copy the address manually.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="events-dialog"
      aria-labelledby="event-detail-title"
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
    >
      <div className="events-dialog-head">
        <div>
          <h2 id="event-detail-title">{event ? eventTypeLabel(event.eventType) : "Event details"}</h2>
          <p>Stored event record · metadata is displayed as text and credentials are not shown.</p>
        </div>
        <button type="button" className="events-dialog-close" aria-label="Close event details" onClick={onClose} data-testid="button-close-event-details">×</button>
      </div>
      {loading ? <div className="events-detail-loading" aria-label="Loading event details" aria-busy="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
        : error ? <div className="events-status events-status-row" role="alert"><span>{error}</span><Button type="button" variant="secondary" size="sm" onClick={() => setRetryNonce((value) => value + 1)} data-testid="button-retry-event-detail">Retry</Button></div>
          : event && <div className="events-detail">
            <div className="events-detail-grid">
              <div className="events-detail-field"><span>Public event ID</span><code>{event.eventId}</code></div>
              <div className="events-detail-field"><span>Record ID</span><code>{event.id}</code></div>
              <div className="events-detail-field"><span>Project</span><code>{event.projectId}</code></div>
              <div className="events-detail-field"><span>Agent</span><strong>{event.agentName} · {event.agentId}</strong></div>
              <div className="events-detail-field"><span>Event type</span><strong>{eventTypeLabel(event.eventType)}</strong></div>
              <div className="events-detail-field"><span>Protocol</span><strong>{event.protocol}</strong></div>
              <div className="events-detail-field"><span>Source</span><strong>{event.sourceIp}:{event.sourcePort ?? "—"} <Button type="button" variant="ghost" size="sm" onClick={() => void copyAddress(event.sourceIp, "Source")} data-testid="button-detail-copy-source">Copy IP</Button></strong></div>
              <div className="events-detail-field"><span>Destination</span><strong>{event.destinationIp}:{event.destinationPort ?? "—"} <Button type="button" variant="ghost" size="sm" onClick={() => void copyAddress(event.destinationIp, "Destination")} data-testid="button-detail-copy-destination">Copy IP</Button></strong></div>
              <div className="events-detail-field"><span>Occurred at</span><strong>{formatEventDate(event.occurredAt)}</strong></div>
              <div className="events-detail-field"><span>Received at</span><strong>{formatEventDate(event.receivedAt)}</strong></div>
            </div>
            <div className="events-detail-metadata">
              <h3>Redacted metadata</h3>
              <pre>{JSON.stringify(event.metadata ?? {}, null, 2)}</pre>
            </div>
            <p className="events-copy-feedback" role="status" aria-live="polite">{copyFeedback}</p>
          </div>}
    </dialog>
  );
}
