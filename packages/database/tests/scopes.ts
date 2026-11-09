import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/client.js";
import {
  listAgentsInProject,
  listNetworkEventsInProject,
  listSecurityAlertsInProject,
} from "../src/queries.js";
import { agents, networkEvents, projects, securityAlerts, workspaces } from "../src/schema/index.js";

// Called only on the harness's transaction-bound client, never an application pool.
export async function checkQueryScopes(db: Database) {
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const projectIds = [randomUUID(), randomUUID(), randomUUID()];
  const fixtureCount = 105;
  const baseTime = Date.UTC(2025, 0, 1);
  const timestamp = (rank: number) => new Date(baseTime + rank * 1_000);
  const fixtures = projectIds.map((projectId, projectIndex) => ({
    projectId,
    workspaceId: projectIndex === 2 ? workspaceB : workspaceA,
    // These permutations give each sort column distinct, unique timestamps in
    // nonchronological insertion order. No assertion relies on tie-breaking.
    rows: Array.from({ length: fixtureCount }, (_, index) => ({
      agentId: randomUUID(),
      eventId: randomUUID(),
      alertId: randomUUID(),
      agentCreatedAt: timestamp((index * 37) % fixtureCount),
      eventOccurredAt: timestamp((index * 13) % fixtureCount),
      alertLastSeenAt: timestamp((index * 17) % fixtureCount),
      projectWideAlert: index % 2 === 0,
    })),
  }));
  const emptyProjects = [workspaceA, workspaceB].map((workspaceId) => ({
    workspaceId, projectId: randomUUID(),
  }));

  await db.insert(workspaces).values([
    { id: workspaceA, name: "scope fixture A" },
    { id: workspaceB, name: "scope fixture B" },
  ]);
  for (const fixture of fixtures) {
    await db.insert(projects).values({
      id: fixture.projectId, workspaceId: fixture.workspaceId, name: "scope fixture project",
    });
    await db.insert(agents).values(fixture.rows.map((row) => ({
      id: row.agentId, projectId: fixture.projectId, name: "scope fixture agent",
      createdAt: row.agentCreatedAt,
      updatedAt: timestamp(fixtureCount - (row.agentCreatedAt.getTime() - baseTime) / 1_000),
    })));
    await db.insert(networkEvents).values(fixture.rows.map((row, index) => ({
      id: row.eventId, agentId: row.agentId, eventId: `scope-event-${index}`,
      eventType: "TEST", sourceIp: "192.0.2.1", destinationIp: "2001:db8::1",
      protocol: "ICMP", occurredAt: row.eventOccurredAt,
      receivedAt: timestamp(fixtureCount - (row.eventOccurredAt.getTime() - baseTime) / 1_000),
    })));
    await db.insert(securityAlerts).values(fixture.rows.map((row, index) => ({
      id: row.alertId, projectId: fixture.projectId,
      agentId: row.projectWideAlert ? null : row.agentId,
      title: "scope fixture alert", description: "test only", severity: "LOW" as const,
      ruleId: "scope-rule", fingerprint: `scope-fingerprint-${index}`,
      firstSeenAt: timestamp(-1), lastSeenAt: row.alertLastSeenAt,
      createdAt: timestamp(fixtureCount - (row.alertLastSeenAt.getTime() - baseTime) / 1_000),
    })));
  }
  for (const scope of emptyProjects) {
    await db.insert(projects).values({
      id: scope.projectId, workspaceId: scope.workspaceId, name: "empty scope fixture project",
    });
  }

  for (const fixture of fixtures) {
    const scope = { workspaceId: fixture.workspaceId, projectId: fixture.projectId };
    const expectedAgents = [...fixture.rows]
      .sort((a, b) => b.agentCreatedAt.getTime() - a.agentCreatedAt.getTime()).slice(0, 100);
    const expectedEvents = [...fixture.rows]
      .sort((a, b) => b.eventOccurredAt.getTime() - a.eventOccurredAt.getTime()).slice(0, 100);
    const expectedAlerts = [...fixture.rows]
      .sort((a, b) => b.alertLastSeenAt.getTime() - a.alertLastSeenAt.getTime()).slice(0, 100);
    const actualAgents = await listAgentsInProject(db, scope);
    const actualEvents = await listNetworkEventsInProject(db, scope);
    const actualAlerts = await listSecurityAlertsInProject(db, scope);

    assert.equal(actualAgents.length, 100, "agents must be capped at 100 rows");
    assert.equal(actualEvents.length, 100, "events must be capped at 100 rows");
    assert.equal(actualAlerts.length, 100, "alerts must be capped at 100 rows");
    // Exact ordered IDs prove both newest-first selection (including the cutoff)
    // and isolation from the other project in this workspace and the other workspace.
    assert.deepEqual(actualAgents.map((row) => row.id), expectedAgents.map((row) => row.agentId),
      "scope must return only its 100 newest agents by createdAt");
    assert.deepEqual(actualEvents.map((row) => row.id), expectedEvents.map((row) => row.eventId),
      "scope must return only its 100 newest events by occurredAt");
    assert.deepEqual(actualAlerts.map((row) => row.id), expectedAlerts.map((row) => row.alertId),
      "scope must return only its 100 newest alerts by lastSeenAt");
    assert.deepEqual(actualAlerts.filter((row) => row.agentId === null).map((row) => row.id),
      expectedAlerts.filter((row) => row.projectWideAlert).map((row) => row.alertId),
      "project-wide alerts must participate in the same ordered, bounded list");
    assert.ok(actualAlerts.some((row) => row.agentId === null), "expected project-wide alerts");
    assert.ok(actualAlerts.some((row) => row.agentId !== null), "expected agent-specific alerts");

    const mismatch = {
      workspaceId: fixture.workspaceId === workspaceA ? workspaceB : workspaceA,
      projectId: fixture.projectId,
    };
    assert.deepEqual(await listAgentsInProject(db, mismatch), [], "mismatched scope leaked agents");
    assert.deepEqual(await listNetworkEventsInProject(db, mismatch), [], "mismatched scope leaked events");
    assert.deepEqual(await listSecurityAlertsInProject(db, mismatch), [], "mismatched scope leaked alerts");
  }

  for (const scope of emptyProjects) {
    assert.deepEqual(await listAgentsInProject(db, scope), [], "empty project must return no agents");
    assert.deepEqual(await listNetworkEventsInProject(db, scope), [], "empty project must return no events");
    assert.deepEqual(await listSecurityAlertsInProject(db, scope), [], "empty project must return no alerts");
  }
}
