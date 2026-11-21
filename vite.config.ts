import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    ignorePatterns: ['**/dist/**', '**/dist-test/**', '**/.next/**', '**/next-env.d.ts'],
    plugins: ['typescript', 'unicorn', 'oxc', 'import'],
    jsPlugins: ['./lint/no-comments.ts'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'typescript/no-floating-promises': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',
      'typescript/consistent-type-imports': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
      'local/no-comments': 'error',
    },
    overrides: [
      {
        files: ['apps/api/**'],
        env: { node: true },
        rules: {
          // oxlint-disable-next-line local/no-comments
          // Nest resolves constructor dependencies from emitted decorator metadata, which needs
          // value imports of the injected classes. `import type` would break DI at runtime.
          'typescript/consistent-type-imports': 'off',
        },
      },
      {
        files: ['apps/web/**'],
        plugins: ['react', 'jsx-a11y', 'nextjs'],
        env: { browser: true },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['apps/api/drizzle/**'],
    semi: false,
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
  },
})
