import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pdfkit ships .afm font data files that must be read from node_modules at
  // runtime — bundling it breaks those reads.
  serverExternalPackages: ['pdfkit'],
  experimental: {
    serverActions: {
      // Server Actions verify the browser's Origin against the Host the
      // server sees. Behind a forwarding proxy (GitHub Codespaces, Gitpod)
      // those differ, so form submissions 500 with "Invalid Server Actions
      // request" unless the proxy origins are allowed.
      allowedOrigins: ['localhost:3000', '*.app.github.dev', '*.github.dev', '*.gitpod.io'],
    },
  },
};

export default nextConfig;
