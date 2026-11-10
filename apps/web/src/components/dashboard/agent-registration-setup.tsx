"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentDialog, type Registration } from "@/components/dashboard/agent-management-shared";

export function RegistrationSetup({ projectName, registration, onClose }: {
  projectName: string;
  registration: Registration;
  onClose: () => void;
}) {
  const [apiUrl, setApiUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { setApiUrl(window.location.origin); }, []);

  let isLocalDevelopment = false;
  try {
    const host = new URL(apiUrl).hostname;
    isLocalDevelopment = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    isLocalDevelopment = false;
  }
  const envText = `NETSLEUTH_API_URL=${apiUrl}\nNETSLEUTH_AGENT_KEY=${registration.apiKey}\nCOLLECTION_INTERVAL_MS=10000\nHEARTBEAT_INTERVAL_MS=30000\nNODE_ENV=${isLocalDevelopment ? "development" : "production"}`;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("Copy failed — select and copy the value manually.");
    }
  }

  return <AgentDialog
    title="Agent registered"
    description={`Securely configure ${registration.agent.name} for ${projectName}. This API key will not be shown again.`}
    onClose={onClose}
    className="agent-setup-dialog"
  >
    <div className="setup-warning" role="note"><span className="setup-warning-mark">!</span><p><strong>Save this key now.</strong> It is a secret credential. Supply it through the target machine’s environment or a secret manager; never put it in source code or command-line arguments.</p></div>
    <div className="setup-agent-id"><span>Agent ID</span><code>{registration.agent.id}</code></div>
    <label className="agent-field setup-url-field"><span>Agent API URL</span><Input type="url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} aria-label="Agent API URL" data-testid="input-agent-api-url" /><small>Current browser origin is prefilled. Set the API server origin for the target deployment. Do not add <code>/api</code> or an ingestion path.</small></label>
    <div className="setup-secret">
      <div className="setup-secret-head"><label htmlFor="agent-api-key">One-time agent API key</label><Button type="button" variant="secondary" size="sm" onClick={() => void copy("key", registration.apiKey)} data-testid="button-copy-agent-key">{copied === "key" ? "Copied" : "Copy key"}</Button></div>
      <Input id="agent-api-key" value={registration.apiKey} readOnly autoComplete="off" data-testid="value-agent-api-key" />
    </div>
    <div className="setup-section-heading"><h3>Configure on the Linux host</h3><span>Node.js 22+ · pnpm · iproute2 (`ss`)</span></div>
    <p className="setup-copy">From the monorepo root, install dependencies, build the agent and shared dependency, then run the compiled agent:</p>
    <div className="setup-code">
      <code>pnpm install</code>
      <code>pnpm exec turbo run build --filter=@workspace/netsleuth-agent...</code>
      <code>pnpm --filter @workspace/netsleuth-agent start</code>
      <Button type="button" variant="secondary" size="sm" onClick={() => void copy("commands", "pnpm install\npnpm exec turbo run build --filter=@workspace/netsleuth-agent...\npnpm --filter @workspace/netsleuth-agent start")} data-testid="button-copy-agent-commands">{copied === "commands" ? "Copied" : "Copy commands"}</Button>
    </div>
    <p className="setup-copy">For configuration, copy <code>apps/agent/.env.example</code> to the ignored <code>apps/agent/.env</code> file, set the values below, and keep the key out of terminal arguments and Git. HTTPS is required in production; local development can use HTTP with <code>NODE_ENV=development</code>.</p>
    <div className="setup-code setup-env-code"><pre>{envText}</pre><Button type="button" variant="secondary" size="sm" onClick={() => void copy("configuration", envText)} data-testid="button-copy-agent-config">{copied === "configuration" ? "Copied" : "Copy configuration"}</Button></div>
    <div className="setup-feedback" role="status" aria-live="polite">{copied && (copied === "Copy failed — select and copy the value manually." ? copied : `${copied === "key" ? "API key" : copied} copied to clipboard.`)}</div>
    <div className="agent-dialog-actions setup-close"><Button type="button" onClick={onClose}>Done</Button></div>
  </AgentDialog>;
}
