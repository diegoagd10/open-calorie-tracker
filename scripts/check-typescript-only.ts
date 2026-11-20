#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

const PATTERNS = ['*.js', '*.mjs', '*.cjs', '*.jsx']

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...PATTERNS],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file !== '')

if (files.length > 0) {
  console.error(`This repo is TypeScript only, but found JavaScript files:
${files.map((file) => `  ${file}`).join('\n')}

Rewrite each one in TypeScript. Node runs .ts files directly, so no build step is needed.
For a script outside apps/ and packages/, copy the tsconfig.json and package.json pattern
from .claude/skills/verify-open-calorie-tracker/ so that pnpm check type-checks it.
Do not turn off lint rules to make a JavaScript file pass.`)
  process.exit(1)
}
