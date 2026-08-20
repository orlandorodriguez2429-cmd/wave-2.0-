import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pdfkit ships .afm font data files that must be read from node_modules at
  // runtime — bundling it breaks those reads.
  serverExternalPackages: ['pdfkit'],
};

export default nextConfig;
