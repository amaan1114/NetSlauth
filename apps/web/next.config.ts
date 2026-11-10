import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : []),
  ],
  // The shared preview proxy handles /api; this rewrite supports local Next.js too.
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.NETSLEUTH_API_URL ?? "http://127.0.0.1:4000"}/api/:path*`,
    }];
  },
};

export default config;
