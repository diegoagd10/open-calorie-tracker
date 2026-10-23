import { defineConfig } from 'vite-plus'

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
      'typescript/no-explicit-any': 'error',
      'typescript/no-non-null-assertion': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',
      'typescript/consistent-type-imports': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
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
    semi: false,
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
  },
})
