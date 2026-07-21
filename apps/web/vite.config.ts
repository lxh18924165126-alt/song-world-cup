import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configuredBase = process.env.VITE_BASE_PATH ?? "/";
const base = configuredBase === "/"
  ? "/"
  : `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`;
const basePrefix = base === "/" ? "" : base.slice(0, -1);
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";
const apiProxy = {
  [`${basePrefix}/api`]: {
    target: apiProxyTarget,
    rewrite: (path: string) => basePrefix ? path.slice(basePrefix.length) : path,
  },
};

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
});

