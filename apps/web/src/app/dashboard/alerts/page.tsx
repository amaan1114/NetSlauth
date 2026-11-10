import type { Metadata } from "next";
import { PageHeading } from "@/components/dashboard/page-heading";
import { ScopeContent } from "@/components/dashboard/scope-content";

export const metadata: Metadata = { title: "Security alerts" };

export default function AlertsPage() {
  return <main className="page-wrap">
    <PageHeading eyebrow="Detection" title="Security alerts" description="A project-scoped home for security signals. No sample alerts or investigation workflows are shown here." />
    <ScopeContent noun="alerts" />
  </main>;
}
