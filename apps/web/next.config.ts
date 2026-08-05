import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  redirects() {
    return Promise.resolve([
      { source: "/", destination: "/projects/new", permanent: false },
      { source: "/login", destination: "/projects/new", permanent: false },
      { source: "/projects", destination: "/projects/new", permanent: false },
      { source: "/settings", destination: "/projects/new", permanent: false },
      {
        source: "/projects/:projectId/storyboard",
        destination: "/projects/new",
        permanent: false,
      },
      {
        source: "/projects/:projectId/preview",
        destination: "/projects/new",
        permanent: false,
      },
      {
        source: "/projects/:projectId/render",
        destination: "/projects/new",
        permanent: false,
      },
      {
        source: "/projects/:projectId/export",
        destination: "/projects/new",
        permanent: false,
      },
    ]);
  },
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: [
    "@stickmotion/db",
    "@stickmotion/queue",
    "@stickmotion/shared",
    "@stickmotion/storage",
  ],
};

export default nextConfig;