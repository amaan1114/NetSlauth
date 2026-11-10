import type { Metadata } from "next";
import { EventsContent } from "@/components/dashboard/events-content";

export const metadata: Metadata = { title: "Network events" };

export default function EventsPage() {
  return <main className="page-wrap events-page"><EventsContent /></main>;
}
