import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NetSleuth — Security observability",
    template: "%s · NetSleuth",
  },
  description: "Understand infrastructure activity across your NetSleuth workspaces.",
  openGraph: {
    title: "NetSleuth — Security observability",
    description: "Understand infrastructure activity across your NetSleuth workspaces.",
    siteName: "NetSleuth",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
