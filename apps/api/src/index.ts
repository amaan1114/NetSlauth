import { z } from "zod";
import { createApp } from "./app.js";

const config = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
}).parse(process.env);

const app = createApp();

app.listen(config.PORT, config.HOST, () => {
  console.log(`NetSleuth API running on ${config.HOST}:${config.PORT}`);
});
