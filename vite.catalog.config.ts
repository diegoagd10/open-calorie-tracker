import { defineConfig } from "vite";
export default defineConfig({ build: { emptyOutDir: false, outDir: "build/catalog", rollupOptions: { output: { entryFileNames: "import-worker.js" } }, ssr: "app/catalog-management/import-worker.ts" }, publicDir: false });
