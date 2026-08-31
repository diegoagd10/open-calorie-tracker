import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const javascriptFiles = ["**/*.{cjs,js,mjs}"];
const typescriptFiles = ["**/*.{ts,tsx}"];
const codeFiles = [...javascriptFiles, ...typescriptFiles];

const typedRules = tseslint.configs.recommendedTypeChecked.map((configuration) => ({
  ...configuration,
  files: typescriptFiles,
}));

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      ".react-router/**",
      "build/**",
      "coverage/**",
      "docs/mocks/**",
      "drizzle/**",
      "node_modules/**",
      "public/**",
    ],
  },
  {
    ...eslint.configs.recommended,
    files: codeFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  ...typedRules,
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // FormData values are deliberately normalized before Zod validates them.
      "@typescript-eslint/no-base-to-string": "off",
      // React Router uses thrown Response objects for HTTP control flow.
      "@typescript-eslint/only-throw-error": "off",
      // Async interface implementations need not await in every implementation.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    extends: [tseslint.configs.disableTypeChecked],
    files: javascriptFiles,
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    ...vitest.configs.recommended,
    files: ["tests/**/*.test.ts"],
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
    },
  },
  {
    files: ["tests/usda-catalog.live.test.ts"],
    rules: {
      // The live audit deliberately asserts only when a provider returns data.
      "vitest/no-conditional-expect": "off",
    },
  },
  {
    files: codeFiles,
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read environment variables only from an authorized runtime boundary.",
        },
      ],
    },
  },
  {
    files: [
      "app/runtime.server.ts",
      "app/**/runtime.server.ts",
      "scripts/**",
      "server.js",
      "server/app.ts",
      "server/operational-logging.js",
      "tests/**",
    ],
    rules: {
      "no-restricted-properties": "off",
    },
  },
);
