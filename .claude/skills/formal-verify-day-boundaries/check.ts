#!/usr/bin/env -S node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
import { verify } from '../../formal-verification/runner.ts'

await verify({ name: 'The start of each day', skill: import.meta.dirname })
