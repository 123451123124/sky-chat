import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['kafkajs', '@elastic/elasticsearch', 'pdfjs-dist'],
};

export default nextConfig;
