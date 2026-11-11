import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import {
  agents,
  networkEvents,
  projects,
  securityAlerts,
  type NewSecurityAlert,
} from "@workspace/netsleuth-database";
import { db } from "../../services/database.js";
import {
  databasePolicySchema,
  normalizeIp,
} from "../projects/project.validation.js";
import { emitProjectRealtime } from "../../realtime.js";

export const AUTH_FAILURE_THRESHOLD = 5;
export const AUTH_FAILURE_WINDOW_SECONDS = 60;
export const AUTH_FAILURE_RULE_ID = "REPEATED_AUTHENTICATION_FAILURES";
export const DATABASE_CONNECTION_RULE_ID = "UNEXPECTED_DATABASE_CONNECTION";

const fingerprint = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export const detectEventsService = async (
  projectId: string,
  eventIds: string[],
) => {
  if (eventIds.length === 0) return;
  const changedAlerts = await db.transaction(async (transaction) => {
    const changes: Array<{
      kind: "new" | "updated";
      alert: {
        id: string;
        projectId: string;
        title: string;
        severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
        ruleId: string;
        firstSeenAt: Date;
        lastSeenAt: Date;
        createdAt: Date;
        updatedAt: Date;
      };
    }> = [];
    // Serialize detection within a project, including observations from different agents.
    const [project] = await transaction
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (!project) return changes; // A project deleted after ingestion has no remaining events or alerts.
    const policy = project.databasePolicy
      ? databasePolicySchema.parse(project.databasePolicy)
      : null;
    const events = await transaction
      .select({ event: networkEvents })
      .from(networkEvents)
      .innerJoin(agents, eq(agents.id, networkEvents.agentId))
      .where(
        and(
          eq(agents.projectId, project.id),
          inArray(networkEvents.id, eventIds),
        ),
      )
      .orderBy(asc(networkEvents.occurredAt), networkEvents.id);

    const saveAlert = async (alert: NewSecurityAlert) => {
      const [existing] = await transaction.select({ id: securityAlerts.id }).from(securityAlerts)
        .where(and(eq(securityAlerts.projectId, alert.projectId), eq(securityAlerts.fingerprint, alert.fingerprint)))
        .limit(1);
      const [saved] = await transaction
        .insert(securityAlerts)
        .values(alert)
        .onConflictDoUpdate({
          target: [securityAlerts.projectId, securityAlerts.fingerprint],
          set: {
            lastSeenAt: alert.lastSeenAt,
            evidence: alert.evidence,
            updatedAt: new Date(),
          },
          // Never regress newer evidence, change firstSeenAt, or silently reopen resolved alerts.
          setWhere: and(
            ne(securityAlerts.status, "RESOLVED"),
            lte(securityAlerts.lastSeenAt, alert.lastSeenAt!),
          ),
        })
        .returning({
          id: securityAlerts.id,
          projectId: securityAlerts.projectId,
          title: securityAlerts.title,
          severity: securityAlerts.severity,
          status: securityAlerts.status,
          ruleId: securityAlerts.ruleId,
          firstSeenAt: securityAlerts.firstSeenAt,
          lastSeenAt: securityAlerts.lastSeenAt,
          createdAt: securityAlerts.createdAt,
          updatedAt: securityAlerts.updatedAt,
        });
      if (saved) changes.push({ kind: existing ? "updated" : "new", alert: saved });
    };

    for (const { event } of events) {
      if (event.eventType === "AUTHENTICATION_FAILURE") {
        const windowMs = AUTH_FAILURE_WINDOW_SECONDS * 1000;
        const time = event.occurredAt.getTime();
        // Look in both directions: a late event can complete a later rolling window.
        const failures = await transaction
          .select({
            id: networkEvents.id,
            eventId: networkEvents.eventId,
            agentId: networkEvents.agentId,
            occurredAt: networkEvents.occurredAt,
          })
          .from(networkEvents)
          .innerJoin(agents, eq(agents.id, networkEvents.agentId))
          .where(
            and(
              eq(agents.projectId, project.id),
              eq(networkEvents.eventType, "AUTHENTICATION_FAILURE"),
              eq(networkEvents.sourceIp, event.sourceIp),
              eq(networkEvents.destinationIp, event.destinationIp),
              gte(networkEvents.occurredAt, new Date(time - windowMs)),
              lte(networkEvents.occurredAt, new Date(time + windowMs)),
            ),
          )
          .orderBy(asc(networkEvents.occurredAt), networkEvents.id);
        const current = failures.findIndex(
          (failure) => failure.id === event.id,
        );
        let left = 0;
        let matched: typeof failures = [];
        for (let right = 0; right < failures.length; right++) {
          while (
            failures[right]!.occurredAt.getTime() -
              failures[left]!.occurredAt.getTime() >
            windowMs
          )
            left++;
          if (
            left <= current &&
            right >= current &&
            right - left + 1 >= AUTH_FAILURE_THRESHOLD
          ) {
            matched = failures.slice(left, right + 1);
          }
        }
        if (matched.length >= AUTH_FAILURE_THRESHOLD) {
          const start = matched[0]!.occurredAt;
          const end = matched[matched.length - 1]!.occurredAt;
          await saveAlert({
            projectId: project.id,
            agentId: null, // A project-level pair may include events from several agents.
            title: "Repeated authentication failures",
            description:
              "Repeated reported authentication failures were observed for this source and destination. This is not proof of malicious activity.",
            severity: "HIGH",
            ruleId: AUTH_FAILURE_RULE_ID,
            fingerprint: fingerprint(
              AUTH_FAILURE_RULE_ID,
              event.sourceIp,
              event.destinationIp,
            ),
            firstSeenAt: start,
            lastSeenAt: end,
            evidence: {
              sourceIp: event.sourceIp,
              destinationIp: event.destinationIp,
              failureCount: matched.length,
              threshold: AUTH_FAILURE_THRESHOLD,
              windowSeconds: AUTH_FAILURE_WINDOW_SECONDS,
              windowStart: new Date(end.getTime() - windowMs).toISOString(),
              windowEnd: end.toISOString(),
              eventIds: matched.map((failure) => failure.eventId),
              events: matched.map((failure) => ({
                ...failure,
                occurredAt: failure.occurredAt.toISOString(),
              })),
            },
          });
        }
      }

      const isConnection =
        event.eventType === "NETWORK_CONNECTION_ATTEMPT" ||
        event.eventType === "NETWORK_CONNECTION_ESTABLISHED";
      if (
        !policy ||
        !isConnection ||
        !event.destinationPort ||
        !["TCP", "UDP"].includes(event.protocol)
      )
        continue;
      if (!policy.databasePorts.includes(event.destinationPort)) continue;
      const destinationIp = normalizeIp(event.destinationIp);
      const allowed = policy.allowedDestinations.some(
        (destination) =>
          destination.ip === destinationIp &&
          destination.port === event.destinationPort &&
          destination.protocol === event.protocol,
      );
      if (allowed) continue;
      await saveAlert({
        projectId: project.id,
        agentId: event.agentId,
        title: "Database destination outside configured allowlist",
        description:
          "A reported connection targets a monitored database port outside the project's allowlist. A connection attempt does not prove a successful database login.",
        severity: "MEDIUM",
        ruleId: DATABASE_CONNECTION_RULE_ID,
        fingerprint: fingerprint(
          DATABASE_CONNECTION_RULE_ID,
          event.agentId,
          event.sourceIp,
          event.destinationIp,
          String(event.destinationPort),
          event.protocol,
        ),
        firstSeenAt: event.occurredAt,
        lastSeenAt: event.occurredAt,
        evidence: {
          sourceIp: event.sourceIp,
          destinationIp: event.destinationIp,
          destinationPort: event.destinationPort,
          protocol: event.protocol,
          eventId: event.eventId,
          eventType: event.eventType,
          databasePolicy: policy,
          observation:
            event.eventType === "NETWORK_CONNECTION_ATTEMPT"
              ? "connection_attempt"
              : "connection_established",
        },
      });
    }
    await transaction.update(networkEvents)
      .set({ detectionStatus: "PROCESSED" })
      .where(inArray(networkEvents.id, eventIds));
    return changes;
  });
  const emitted = new Set<string>();
  for (const change of changedAlerts) {
    if (emitted.has(change.alert.id)) continue;
    emitted.add(change.alert.id);
    emitProjectRealtime(projectId, {
      name: change.kind === "new" ? "alert:new" : "alert:updated",
      payload: {
        id: change.alert.id,
        projectId: change.alert.projectId,
        title: change.alert.title,
        severity: change.alert.severity,
        status: change.alert.status,
        ruleId: change.alert.ruleId,
        firstSeenAt: change.alert.firstSeenAt.toISOString(),
        lastSeenAt: change.alert.lastSeenAt.toISOString(),
        createdAt: change.alert.createdAt.toISOString(),
        updatedAt: change.alert.updatedAt.toISOString(),
      },
    });
  }
};

export const reconcilePendingDetections = async (limit = 100) => {
  const pending = await db
    .select({ id: networkEvents.id, projectId: agents.projectId })
    .from(networkEvents)
    .innerJoin(agents, eq(agents.id, networkEvents.agentId))
    .where(eq(networkEvents.detectionStatus, "PENDING"))
    .orderBy(asc(networkEvents.receivedAt), networkEvents.id)
    .limit(limit);
  const byProject = new Map<string, string[]>();
  for (const event of pending) {
    const ids = byProject.get(event.projectId) ?? [];
    ids.push(event.id);
    byProject.set(event.projectId, ids);
  }
  for (const [projectId, eventIds] of byProject) {
    await detectEventsService(projectId, eventIds);
  }
  return pending.length;
};
