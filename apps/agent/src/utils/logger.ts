// Callers log fixed operational messages, never keys, URLs, raw errors, or response bodies.
export const logger = {
  info: (message: string) => console.log(`[NetSleuth agent] ${message}`),
  error: (message: string) => console.error(`[NetSleuth agent] ${message}`),
};
