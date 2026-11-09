import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This app lives in a subfolder of another project; keep Next from guessing the root.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
