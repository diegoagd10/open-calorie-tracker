import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "build/recovery",
    rollupOptions: {
      input: {
        "recover-administrator": "server/recover-administrator.ts",
        "recover-administrator-keys": "server/recover-administrator-keys.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
    ssr: true,
  },
  publicDir: false,
  resolve: {
    tsconfigPaths: true,
  },
});
