#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { verify } from '../../formal-verification/runner.ts'

await verify({
  name: 'The login lock',
  skill: import.meta.dirname,
  module: 'LoginLock',
  replayed: 'AuthService.login',
  rules: ['GuessLimit', 'LockHolds', 'NotShutOut'],
  brokenDesigns: [
    { design: 'CountAfterCheck', breaks: 'GuessLimit' },
    { design: 'CountAfterCheck', breaks: 'LockHolds' },
    { design: 'LeakOnError', breaks: 'NotShutOut' },
  ],
})
