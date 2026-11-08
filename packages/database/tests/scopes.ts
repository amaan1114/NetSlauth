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
  const fixtures = projectIds.map((projectId, index) => ({
    projectId,
    workspaceId: index === 2 ? workspaceB : workspaceA,
    agentId: randomUUID(),
    eventId: randomUUID(),
    alertId: randomUUID(),
  }));

  await db.insert(workspaces).values([
    { id: workspaceA, name: "scope fixture A" },
    { id: workspaceB, name: "scope fixture B" },
  ]);
  for (const fixture of fixtures) {
    await db.insert(projects).values({
      id: fixture.projectId, workspaceId: fixture.workspaceId, name: "scope fixture project",
    });
    await db.insert(agents).values({
      id: fixture.agentId, projectId: fixture.projectId, name: "scope fixture agent",
    });
    await db.insert(networkEvents).values({
      id: fixture.eventId, agentId: fixture.agentId, eventId: "scope-event",
      eventType: "TEST", sourceIp: "192.0.2.1", destinationIp: "2001:db8::1",
      protocol: "ICMP", occurredAt: new Date(),
    });
    await db.insert(securityAlerts).values({
      id: fixture.alertId, projectId: fixture.projectId, agentId: fixture.agentId,
      title: "scope fixture alert", description: "test only", severity: "LOW",
      ruleId: "scope-rule", fingerprint: "scope-fingerprint",
    });
  }

  for (const fixture of fixtures) {
    const scope = { workspaceId: fixture.workspaceId, projectId: fixture.projectId };
    assert.deepEqual((await listAgentsInProject(db, scope)).map((row) => row.id),
      [fixture.agentId], "matching scope must return exactly its agent");
    assert.deepEqual((await listNetworkEventsInProject(db, scope)).map((row) => row.id),
      [fixture.eventId], "matching scope must return exactly its event");
    assert.deepEqual((await listSecurityAlertsInProject(db, scope)).map((row) => row.id),
      [fixture.alertId], "matching scope must return exactly its alert");

    const mismatch = {
      workspaceId: fixture.workspaceId === workspaceA ? workspaceB : workspaceA,
      projectId: fixture.projectId,
    };
    assert.deepEqual(await listAgentsInProject(db, mismatch), [], "mismatched scope leaked agents");
    assert.deepEqual(await listNetworkEventsInProject(db, mismatch), [], "mismatched scope leaked events");
    assert.deepEqual(await listSecurityAlertsInProject(db, mismatch), [], "mismatched scope leaked alerts");
  }
}
