import { defineConfig } from "vite";

// Relative base so the built bundle works whether hosted at a domain root
// or a sub-path. Keeps this project fully self-contained and isolated.
export default defineConfig({
  base: "./",
  server: {
    port: 5190,
    strictPort: true,
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 0, // keep the form image as a cacheable file, not inlined
  },
});
