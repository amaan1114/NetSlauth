"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeAgentStatus, RealtimeAlert, RealtimeNetworkEvent } from "@workspace/netsleuth-shared";

export interface ProjectRealtimeState {
  connected: boolean;
  networkEventVersion: number;
  alertVersion: number;
  agentVersion: number;
}

let socket: Socket | null = null;

function getSocket() {
  socket ??= io({
    path: "/socket.io",
    withCredentials: true,
    autoConnect: false,
  });
  return socket;
}

export function useProjectRealtime(projectId: string): ProjectRealtimeState {
  const [state, setState] = useState<ProjectRealtimeState>({
    connected: false,
    networkEventVersion: 0,
    alertVersion: 0,
    agentVersion: 0,
  });

  useEffect(() => {
    if (!projectId) {
      setState((current) => ({ ...current, connected: false }));
      return;
    }
    const client = getSocket();
    const isCurrentProject = (payload: { projectId: string }) => payload.projectId === projectId;
    const onConnect = () => {
      setState((current) => ({ ...current, connected: true }));
      client.emit("project:subscribe", projectId);
    };
    const onDisconnect = () => setState((current) => ({ ...current, connected: false }));
    const onNetworkEvent = (payload: RealtimeNetworkEvent) => {
      if (isCurrentProject(payload)) setState((current) => ({ ...current, networkEventVersion: current.networkEventVersion + 1 }));
    };
    const onAlert = (payload: RealtimeAlert) => {
      if (isCurrentProject(payload)) setState((current) => ({ ...current, alertVersion: current.alertVersion + 1 }));
    };
    const onAgent = (payload: RealtimeAgentStatus) => {
      if (isCurrentProject(payload)) setState((current) => ({ ...current, agentVersion: current.agentVersion + 1 }));
    };

    client.on("connect", onConnect);
    client.on("disconnect", onDisconnect);
    client.on("network_event:new", onNetworkEvent);
    client.on("alert:new", onAlert);
    client.on("alert:updated", onAlert);
    client.on("agent:status", onAgent);
    if (!client.connected) client.connect();
    else onConnect();
    return () => {
      client.off("connect", onConnect);
      client.off("disconnect", onDisconnect);
      client.off("network_event:new", onNetworkEvent);
      client.off("alert:new", onAlert);
      client.off("alert:updated", onAlert);
      client.off("agent:status", onAgent);
    };
  }, [projectId]);

  return state;
}
