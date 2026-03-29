import type { NextConfig } from "next";
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const webRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(webRoot, '..'),
  },
};

export default nextConfig;
