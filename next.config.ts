import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pdfkit ships .afm font data files that must be read from node_modules at
  // runtime — bundling it breaks those reads.
  serverExternalPackages: ['pdfkit', 'unpdf'],
  experimental: {
    serverActions: {
      // Statement uploads (up to 40 PDFs per drop).
      bodySizeLimit: '50mb',
      // Server Actions verify the browser's Origin against the Host the
      // server sees. Behind a forwarding proxy (GitHub Codespaces, Gitpod)
      // those differ, so form submissions 500 with "Invalid Server Actions
      // request" unless the proxy origins are allowed.
      allowedOrigins: ['localhost:3000', '*.app.github.dev', '*.github.dev', '*.gitpod.io'],
    },
  },
};

export default nextConfig;
