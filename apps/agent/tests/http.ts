import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { NetworkEventInput } from "../src/types/index.js";

export const startTestApi = async (
  handler: (events: NetworkEventInput[], req: IncomingMessage, res: ServerResponse) => void,
) => {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    handler(JSON.parse(Buffer.concat(chunks).toString("utf8")), req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server did not start");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
};

export const sendCounts = (res: ServerResponse, insertedCount: number, duplicateCount = 0) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    success: true, statusCode: 200, message: "Events ingested successfully",
    data: { insertedCount, duplicateCount },
  }));
};
