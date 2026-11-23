#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { verify } from '../../formal-verification/runner.ts'

await verify({
  name: 'Logging once',
  skill: import.meta.dirname,
  model: {
    module: 'LogOnce',
    replayed: 'the Food Log and the API',
    rules: ['OneEntry', 'LastPressWins', 'ListIsTrue'],
    brokenDesigns: [
      { design: 'InsertEveryPress', breaks: 'OneEntry' },
      { design: 'FirstArrivalWins', breaks: 'LastPressWins' },
      { design: 'LastArrivalWins', breaks: 'LastPressWins' },
      { design: 'NoReloadOnCancel', breaks: 'ListIsTrue' },
    ],
    replayBounds: { MaxPresses: 2 },
  },
})
