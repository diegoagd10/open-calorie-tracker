#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const checks = globSync(join(import.meta.dirname, '../skills/formal-verify-*/check.ts')).sort()
const failed = checks
  .map((check) => ({ check, name: basename(dirname(check)) }))
  .filter(({ check, name }) => {
    console.log(`\n=== ${name}`)
    return spawnSync(check, { stdio: 'inherit' }).status !== 0
  })
  .map(({ name }) => name)

console.log(
  failed.length === 0 && checks.length > 0
    ? `\nAll ${checks.length} formal verifications pass.`
    : `\nFailed: ${failed.join(', ') || 'no formal verification found'}`,
)
process.exitCode = failed.length === 0 && checks.length > 0 ? 0 : 1
