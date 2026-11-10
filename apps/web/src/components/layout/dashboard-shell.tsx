"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useDashboard } from "@/components/providers/dashboard-provider";
import { Brand } from "@/components/ui/brand";
import { Icon, type IconName } from "@/components/ui/icon";

const links: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/dashboard/agents", label: "Agents", icon: "agents" },
  { href: "/dashboard/events", label: "Network Events", icon: "events" },
  { href: "/dashboard/alerts", label: "Security Alerts", icon: "alerts" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
];

const pageLabels: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/agents": "Agents",
  "/dashboard/events": "Network Events",
  "/dashboard/alerts": "Security Alerts",
  "/dashboard/settings": "Settings",
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { workspace } = useDashboard();
  return (
    <>
      {open && <button className="mobile-overlay" aria-label="Close navigation" onClick={onClose} />}
      <aside className={`sidebar${open ? " mobile-open" : ""}`}>
        <Brand />
        <div className="workspace-card">
          <div className="eyebrow">Active workspace</div>
          <div className="workspace-name" title={workspace?.name}>{workspace?.name ?? "No workspace selected"}</div>
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="nav-list" aria-label="Dashboard navigation">
          {links.map((link) => {
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`));
            return (
              <Link key={link.href} href={link.href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClose} data-testid={`link-nav-${link.label.toLowerCase().replaceAll(" ", "-")}`}>
                <span className="nav-icon"><Icon name={link.icon} /></span><span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-note"><span className="status-dot" /> HTTP-only cookie session</div>
          <div className="profile-row">
            <span className="avatar" aria-hidden="true">{initials(user?.name ?? "")}</span>
            <div className="profile-copy">
              <div className="profile-name" data-testid="text-current-user">{user?.name ?? "Account"}</div>
              <div className="profile-email">{user?.email ?? ""}</div>
            </div>
            <button className="logout-button" aria-label="Log out" title="Log out" data-testid="button-logout" onClick={() => void logout()}><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { workspaces, workspace, projects, project, workspaceLoading, projectLoading, workspaceError, projectError, selectWorkspace, selectProject, reloadWorkspaces, reloadProjects } = useDashboard();
  const [menuOpen, setMenuOpen] = useState(false);
  const title = pageLabels[pathname] ?? "Dashboard";

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".user-menu")) setMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="mobile-menu" onClick={onMenu} aria-label="Open navigation" data-testid="button-open-navigation"><Icon name="menu" /></button>
        <div className="scope-select" title={workspaceError ?? "Select workspace"}>
          <Icon name="layers" size={15} />
            <select aria-label="Current workspace" aria-busy={workspaceLoading} value={workspace?.id ?? ""} onChange={(event) => selectWorkspace(event.target.value)} disabled={workspaceLoading || !workspaces.length} data-testid="select-workspace">
              <option value="" disabled>{workspaceLoading ? "Loading…" : workspaceError ? "Unavailable" : "No workspaces"}</option>
              {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          {workspaceError && <button className="retry-button" onClick={() => void reloadWorkspaces()} aria-label="Retry loading workspaces"><Icon name="refresh" size={12} /></button>}
        </div>
        <span className="scope-divider" />
        <div className="scope-select" title={projectError ?? "Select project"}>
          <Icon name="folder" size={15} />
            <select aria-label="Current project" aria-busy={projectLoading} value={project?.id ?? ""} onChange={(event) => selectProject(event.target.value)} disabled={projectLoading || !projects.length} data-testid="select-project">
              <option value="" disabled>{projectLoading ? "Loading…" : projectError ? "Unavailable" : "No projects"}</option>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          {projectError && <button className="retry-button" onClick={() => void reloadProjects()} aria-label="Retry loading projects"><Icon name="refresh" size={12} /></button>}
        </div>
      </div>
      <div className="topbar-right">
        <span className="crumb">Dashboard</span><span className="crumb" aria-hidden="true">/</span><span className="crumb-current">{title}</span>
        <div className="user-menu">
          <button className="avatar top-avatar" aria-label="Open user menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} data-testid="button-user-menu">{initials(user?.name ?? "")}</button>
          {menuOpen && <div className="user-popover">
            <div className="user-popover-meta"><div className="user-popover-name">{user?.name}</div><div className="user-popover-email">{user?.email}</div></div>
            <Link href="/dashboard/settings" className="user-popover-action" onClick={() => setMenuOpen(false)}>Account settings</Link>
            <button className="user-popover-action" onClick={() => void logout()}>Log out</button>
          </div>}
        </div>
      </div>
    </header>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { error } = useAuth();
  return (
    <div className="app-frame">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="main-column">
        <Topbar onMenu={() => setMobileOpen((value) => !value)} />
        {error && <p role="alert" className="auth-error" style={{ margin: "16px 24px 0" }}>{error}</p>}
        {children}
      </div>
    </div>
  );
}
