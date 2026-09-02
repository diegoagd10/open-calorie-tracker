import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "build/recovery",
    rollupOptions: {
      output: {
        entryFileNames: "recover-administrator.js",
      },
    },
    ssr: "server/recover-administrator.ts",
  },
  publicDir: false,
  resolve: {
    tsconfigPaths: true,
  },
});
