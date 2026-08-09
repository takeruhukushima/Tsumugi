import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  output: "server",
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  adapter: cloudflare({
    platformProxy: { enabled: true }, // gives `astro dev` access to D1 via Miniflare
    imageService: "compile", // Cloudflare has no sharp at runtime
  }),
  integrations: [react()],
  vite: {
    ssr: {
      // atproto packages ship node-oriented code; let the Workers runtime
      // (nodejs_compat) resolve node built-ins instead of Vite pre-bundling them.
      external: ["node:crypto", "node:buffer", "node:util"],
    },
  },
});
