import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/wasm/:path*",
      headers: [{ key: "Content-Type", value: "application/wasm" }],
    },
    {
      source: "/ort/:path*.wasm",
      headers: [{ key: "Content-Type", value: "application/wasm" }],
    },
  ],
};

export default nextConfig;
