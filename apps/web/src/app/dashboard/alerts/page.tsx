import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertsContent } from "@/components/dashboard/alerts-content";

export const metadata: Metadata = { title: "Security alerts" };

export default function AlertsPage() {
  return <main className="page-wrap alerts-page">
    <Suspense fallback={<div className="alerts-page-loading" aria-label="Loading alerts" aria-busy="true"><span className="skeleton" /><span className="skeleton" /></div>}>
      <AlertsContent />
    </Suspense>
  </main>;
}
