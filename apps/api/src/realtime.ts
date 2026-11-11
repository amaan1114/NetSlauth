import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { RealtimeAgentStatus, RealtimeAlert, RealtimeNetworkEvent } from "@workspace/netsleuth-shared";
import { getProjectService } from "./modules/projects/project.service.js";
import { verifyToken } from "./utils/token.js";

const projectIdSchema = z.string().uuid();
const projectRoom = (projectId: string) => `project:${projectId}`;

let io: Server | null = null;
const socketsByUser = new Map<string, Set<Socket>>();

function accessCookie(socket: Socket): string | null {
  const header = socket.handshake.headers.cookie;
  if (typeof header !== "string") return null;
  const match = header.match(/(?:^|;\s*)netsleuth_access=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function configureRealtime(server: Server) {
  io = server;
  server.use((socket, next) => {
    try {
      const token = accessCookie(socket);
      if (!token || token.length > 8192) return next(new Error("Authentication required"));
      const { userId, expiresAt } = verifyToken(token, "access");
      socket.data.userId = userId;
      socket.data.expiresAt = expiresAt;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  server.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const userSockets = socketsByUser.get(userId) ?? new Set<Socket>();
    userSockets.add(socket);
    socketsByUser.set(userId, userSockets);
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, (socket.data.expiresAt as number) * 1000 - Date.now()));
    socket.on("project:subscribe", async (requestedProjectId: unknown, callback?: (result: { ok: boolean; projectId?: string; error?: string }) => void) => {
      const parsed = projectIdSchema.safeParse(requestedProjectId);
      if (!parsed.success) {
        callback?.({ ok: false, error: "Invalid project" });
        return;
      }
      try {
        await getProjectService(socket.data.userId as string, parsed.data);
        const previousProjectId = socket.data.projectId as string | undefined;
        if (previousProjectId && previousProjectId !== parsed.data) socket.leave(projectRoom(previousProjectId));
        await socket.join(projectRoom(parsed.data));
        socket.data.projectId = parsed.data;
        callback?.({ ok: true, projectId: parsed.data });
      } catch {
        callback?.({ ok: false, error: "Project subscription denied" });
      }
    });

    socket.on("disconnect", () => {
      clearTimeout(expiryTimer);
      userSockets.delete(socket);
      if (userSockets.size === 0) socketsByUser.delete(userId);
      socket.data.projectId = undefined;
    });
  });
}

export function disconnectUserSockets(userId: string) {
  for (const socket of socketsByUser.get(userId) ?? []) socket.disconnect(true);
}

export function emitProjectRealtime(projectId: string, event: {
  name: "network_event:new";
  payload: RealtimeNetworkEvent;
} | {
  name: "alert:new" | "alert:updated";
  payload: RealtimeAlert;
} | {
  name: "agent:status";
  payload: RealtimeAgentStatus;
}) {
  const room = projectRoom(projectId);
  for (const socket of io?.sockets.sockets.values() ?? []) {
    if (!socket.rooms.has(room)) continue;
    if ((socket.data.expiresAt as number) * 1000 <= Date.now()) {
      socket.disconnect(true);
      continue;
    }
    void getProjectService(socket.data.userId as string, projectId)
      .then(() => socket.emit(event.name, event.payload))
      .catch(() => socket.disconnect(true));
  }
}

export function realtimeProjectRoom(projectId: string) {
  return projectRoom(projectId);
}
