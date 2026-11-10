import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { ScopeContent } from "@/components/dashboard/scope-content";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <main className="page-wrap">
    <PageHeading eyebrow="Infrastructure" title="Agents" description="A project-scoped home for registered collectors. Agent management and live status are not part of this foundation." />
    <ScopeContent noun="agents" />
  </main>;
}
