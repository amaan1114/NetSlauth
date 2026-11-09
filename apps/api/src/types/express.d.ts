export {};
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      agentId?: string;
      projectId?: string;
    }
  }
}
