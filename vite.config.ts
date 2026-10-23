import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    ignorePatterns: ['**/dist/**', '**/.next/**', '**/next-env.d.ts'],
    plugins: ['typescript', 'unicorn', 'oxc', 'import'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'typescript/no-floating-promises': 'error',
    },
    overrides: [
      {
        files: ['apps/api/**'],
        env: { node: true },
      },
      {
        files: ['apps/web/**'],
        plugins: ['react', 'jsx-a11y', 'nextjs'],
        env: { browser: true },
      },
    ],
  },
  fmt: {
    singleQuote: true,
    trailingComma: 'all',
  },
});
