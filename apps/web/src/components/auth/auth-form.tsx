"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Brand } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiRequest, type AuthPayload } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registering = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest<AuthPayload>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: registering ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password },
      });
      if (typeof window !== "undefined") {
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith("netsleuth:")) window.localStorage.removeItem(key);
        }
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not complete sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Brand />
        <div className="auth-story">
          <div className="page-kicker">Security observability</div>
          <h1>Know what moves through your infrastructure.</h1>
          <p>A clear starting point for your team to understand agents, network activity, and security signals across the projects you own.</p>
        </div>
        <div className="auth-stamp">Private by default · Cookie-secured access</div>
      </aside>
      <main className="auth-main">
        <section className="auth-card">
          <h2>{registering ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-subtitle">{registering ? "Set up your NetSleuth account to continue." : "Sign in to your workspace and pick up where you left off."}</p>
          {error && <div role="alert" className="auth-error" data-testid="status-auth-error">{error}</div>}
          <form onSubmit={(event) => void submit(event)}>
            {registering && <label className="form-field">
              <span className="form-label">Name</span>
              <Input autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" data-testid="input-name" />
            </label>}
            <label className="form-field">
              <span className="form-label">Email address</span>
              <Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" data-testid="input-email" />
            </label>
            <label className="form-field">
              <span className="form-label">Password</span>
              <Input type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registering ? "At least 8 characters" : "Your password"} data-testid="input-password" />
            </label>
            <Button className="full-button" type="submit" disabled={busy} data-testid="button-submit-auth">
              {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="auth-switch">
            {registering ? "Already have an account? " : "New to NetSleuth? "}
            <Link href={registering ? "/login" : "/register"} data-testid="link-auth-switch">{registering ? "Sign in" : "Create an account"}</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
