import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { ScopeContent } from "@/components/dashboard/scope-content";

export const metadata: Metadata = { title: "Network events" };

export default function EventsPage() {
  return <main className="page-wrap">
    <PageHeading eyebrow="Observability" title="Network events" description="A scoped workspace for network activity. The event explorer and its data views will be implemented separately." />
    <ScopeContent noun="events" />
  </main>;
}
