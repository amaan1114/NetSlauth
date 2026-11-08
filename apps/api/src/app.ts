import express from "express";

// Composition boundary: future controllers receive services here.
// Domain and detection logic must not depend on Express.
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/health", (_request, response) => {
    response.json({ service: "netsleuth-api", status: "ok", stage: "foundation" });
  });
  return app;
}
