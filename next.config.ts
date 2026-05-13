import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  // Pin workspace root to this project so Next.js doesn't pick the
  // C:\Users\EDS-EV1\package-lock.json sibling on the deploy machine.
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,

  // Dev mode is sometimes accessed via the server's LAN IP — without this,
  // Next.js 16 blocks /_next/webpack-hmr and font requests from that origin.
  allowedDevOrigins: [
    "45.91.135.9",
    "0.0.0.0",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
