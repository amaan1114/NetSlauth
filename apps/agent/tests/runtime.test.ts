import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { startTestApi, sendCounts } from "./http.js";

test("SIGINT/SIGTERM stop timers and drain pending HTTP; a deadline cancels stalled work", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "netsleuth-agent-test-"));
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "ss"), `#!${process.execPath}\nprocess.stdout.write("tcp LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*\\n");\n`, { mode: 0o755 });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const agentKey = `ns_agent_${"c".repeat(64)}`;
  const agentPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const configUrl = new URL("../src/config/index.ts", import.meta.url).href;
  const entryUrl = new URL("../src/index.ts", import.meta.url).href;
  for (const mode of ["SIGINT", "SIGTERM", "deadline"] as const) {
    await t.test(mode, { timeout: 10000 }, async () => {
      let resolveHeartbeat!: () => void;
      const heartbeatReceived = new Promise<void>((resolve) => { resolveHeartbeat = resolve; });
      let finishHeartbeat: (() => void) | undefined;
      let heartbeatFinished = false;
      let requests = 0;
      const api = await startTestApi((events, _req, res) => {
        requests++;
        if (events[0]?.eventType === "AGENT_HEARTBEAT") {
          finishHeartbeat = () => { heartbeatFinished = true; sendCounts(res, events.length); };
          resolveHeartbeat();
        } else sendCounts(res, events.length);
      });
      const args = mode === "deadline"
        ? ["--import", "tsx", "--input-type=module", "-e", `import {startAgent} from ${JSON.stringify(entryUrl)}; import {readConfig} from ${JSON.stringify(configUrl)}; startAgent(readConfig(), 100);`]
        : ["--import", "tsx", agentPath];
      const child = spawn(process.execPath, args, {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_ENV: "test",
          NETSLEUTH_API_URL: api.url, NETSLEUTH_AGENT_KEY: agentKey,
          COLLECTION_INTERVAL_MS: "1000", HEARTBEAT_INTERVAL_MS: "1000",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
      const closed = once(child, "close");
      try {
        await Promise.race([
          heartbeatReceived,
          delay(4000).then(() => { throw new Error("Agent did not send initial heartbeat"); }),
        ]);
        child.kill(mode === "deadline" ? "SIGTERM" : mode);
        if (mode !== "deadline") {
          await delay(30);
          assert.equal(child.exitCode, null, "Agent exited before pending HTTP finished");
          finishHeartbeat!();
        }
        const [code, signal] = await closed;
        assert.equal(code, 0);
        assert.equal(signal, null);
        assert.match(output, /Agent stopped/);
        assert.equal(output.includes(agentKey), false);
        assert.equal(heartbeatFinished, mode !== "deadline");
        if (mode === "deadline") assert.match(output, /Shutdown deadline reached/);
        const count = requests;
        await delay(50);
        assert.equal(requests, count, "Agent kept polling after shutdown");
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await api.close();
      }
    });
  }
});

test("a temporary API outage exhausts bounded retries without crashing; polling and heartbeats recover", { timeout: 10000, skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "netsleuth-agent-outage-"));
  const marker = join(directory, "polls");
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "ss"), `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(marker)}, "poll\\n"); process.stdout.write("tcp LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*\\n");\n`, { mode: 0o755 });
  let unavailable = true;
  let recoveredHeartbeat = false;
  const api = await startTestApi((events, _req, res) => {
    if (unavailable) { res.writeHead(503).end(); return; }
    if (events[0]?.eventType === "AGENT_HEARTBEAT") recoveredHeartbeat = true;
    sendCounts(res, events.length);
  });
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_ENV: "test",
      NETSLEUTH_API_URL: api.url, NETSLEUTH_AGENT_KEY: `ns_agent_${"d".repeat(64)}`,
      COLLECTION_INTERVAL_MS: "1000", HEARTBEAT_INTERVAL_MS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const closed = once(child, "close");
  try {
    const deadline = Date.now() + 6000;
    while (!output.includes("Heartbeat publishing failed") && Date.now() < deadline) await delay(50);
    assert.match(output, /Heartbeat publishing failed/);
    assert.match(output, /retrying batch \(3\/3\)/);
    assert.equal(child.exitCode, null);
    unavailable = false;
    let polls = 0;
    while (Date.now() < deadline) {
      polls = (await readFile(marker, "utf8")).trim().split("\n").length;
      if (recoveredHeartbeat && polls >= 2) break;
      await delay(50);
    }
    assert.equal(recoveredHeartbeat, true, "Heartbeat did not recover after the API returned");
    assert.ok(polls >= 2, "Collection stopped during the outage");
    assert.equal(child.exitCode, null);
    child.kill("SIGTERM");
    const [code, signal] = await closed;
    assert.equal(code, 0);
    assert.equal(signal, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await api.close();
    await rm(directory, { recursive: true, force: true });
  }
});
