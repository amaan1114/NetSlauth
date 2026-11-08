import { createServer } from "node:http";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { pool } from "./services/database.js";

const server = createServer(createApp());
const io = new Server(server, { cors: { origin: env.CORS_ORIGINS } });

server.on("error", () => {
  console.error("API server failed to start");
  void pool.end().finally(() => process.exit(1));
});

server.listen(env.PORT, env.HOST, () => {
  console.log(`NetSleuth API running on ${env.HOST}:${env.PORT}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Closing API server");
  // Bound shutdown if a request or connection does not finish.
  setTimeout(() => process.exit(1), 10_000).unref();
  io.close(() => {
    void pool.end().then(
      () => process.exit(0),
      () => {
        console.error("Database shutdown failed");
        process.exit(1);
      },
    );
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
