import type { Metadata } from "next";
import { OverviewContent } from "@/components/dashboard/overview-content";

export const metadata = { title: "Overview" } satisfies Metadata;

export default function DashboardPage() {
  return <OverviewContent />;
}
