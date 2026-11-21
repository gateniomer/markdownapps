import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const schemaPath = fileURLToPath(new URL("./src/schemas/topics.js", import.meta.url));

// Project sites live under /<repo>/; user sites and custom domains live at /.
// The deploy workflow sets BASE_PATH from the repository name.
function normalizeBase(value) {
  const trimmed = String(value || "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [svelte()],
  resolve: {
    alias: {
      "markdownapps/schema/topics": schemaPath,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // svelte/compiler is a lazy chunk that only loads when a template is
    // installed or rendered, so its size is expected.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 4321,
    strictPort: true,
  },
});
