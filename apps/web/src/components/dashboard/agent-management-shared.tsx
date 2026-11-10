"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

export type AgentStatus = "ONLINE" | "OFFLINE" | "INACTIVE";

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  status: AgentStatus;
  lastHeartbeatAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentList { agents: Agent[] }
export interface AgentDetail { agent: Agent }
export interface Registration { agent: Agent; apiKey: string }

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

export function statusFor(agent: Agent) {
  return agent.revokedAt ? "REVOKED" : agent.status;
}

export function AgentDialog({ title, description, onClose, children, className = "" }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className={`agent-dialog ${className}`}
      aria-labelledby="agent-dialog-title"
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
    >
      <div className="agent-dialog-head">
        <div>
          <h2 id="agent-dialog-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}>×</Button>
      </div>
      {children}
    </dialog>
  );
}
