import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, ".."),
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
