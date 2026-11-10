"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/components/providers/auth-provider";
import { DashboardProvider } from "@/components/providers/dashboard-provider";
import { DashboardShell } from "./dashboard-shell";

function GuardedShell({ children }: { children: React.ReactNode }) {
  const { user, loading, error, refreshUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && !error) router.replace("/login");
  }, [loading, user, error, router]);

  if (loading || (!user && !error)) {
    return <main className="app-frame" aria-label="Loading dashboard"><div className="main-column"><div className="page-wrap"><div className="skeleton" style={{ width: 190, height: 26, borderRadius: 5 }} /><div className="skeleton" style={{ width: "100%", height: 190, marginTop: 28, borderRadius: 8 }} /></div></div></main>;
  }
  if (error && !user) {
    return <main className="app-frame"><div className="main-column"><div className="page-wrap"><div className="empty-scope"><span className="empty-icon"><span aria-hidden="true">!</span></span><div><h1 className="empty-title">Session check unavailable</h1><p className="empty-copy error-copy">{error}</p><button className="retry-button" style={{ marginTop: 12 }} onClick={() => void refreshUser()}>Retry</button></div></div></div></div></main>;
  }

  return (
    <DashboardProvider key={user?.id ?? pathname}>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  return <AuthProvider><GuardedShell>{children}</GuardedShell></AuthProvider>;
}
