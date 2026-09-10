import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "build/catalog-command",
    rollupOptions: {
      output: {
        entryFileNames: "import-catalog.js",
      },
    },
    ssr: "server/import-catalog.ts",
  },
  publicDir: false,
  resolve: {
    tsconfigPaths: true,
  },
});
