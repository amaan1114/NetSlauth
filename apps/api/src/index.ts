import { createServer } from "node:http";
import pino from "pino";
import { z } from "zod";
import { createApp } from "./app.js";

const logger = pino();
const config = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
}).parse(process.env);

const server = createServer(createApp());
server.on("error", (error) => {
  logger.fatal({ error }, "API failed to start");
  process.exitCode = 1;
});
server.listen(config.PORT, config.HOST, () => {
  logger.info({ host: config.HOST, port: config.PORT }, "NetSleuth API foundation started");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        logger.error({ error }, "API shutdown failed");
        process.exitCode = 1;
      }
    });
    server.closeIdleConnections();
  });
}
