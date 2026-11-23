import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as Playwright from 'playwright'
import { build } from 'vite-plus'

const WEB = join(import.meta.dirname, '../../../apps/web')
const SRC = join(WEB, 'src')
const ENTRY = '\0food-log'
const LINK = '\0link'

const requireFromWeb = createRequire(join(WEB, 'package.json'))

export const { chromium } = requireFromWeb('playwright') as typeof Playwright

const MODULES: Record<string, string> = {
  [ENTRY]: `
    import { createElement } from 'react'
    import { createRoot } from 'react-dom/client'
    import { FoodLog } from '@/components/food-log/food-log'
    createRoot(document.getElementById('root')).render(createElement(FoodLog))
  `,
  [LINK]: `
    import { createElement } from 'react'
    export default (props) => createElement('a', props)
  `,
}

export const buildFoodLog = async (): Promise<string> => {
  const result = await build({
    configFile: false,
    root: WEB,
    logLevel: 'error',
    oxc: { jsx: { runtime: 'automatic', development: false } },
    resolve: { alias: { '@': SRC } },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'food-log',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === 'food-log') return ENTRY
          if (id === 'next/link') return LINK
          if (importer === ENTRY || importer === LINK) {
            if (id.startsWith('react')) return requireFromWeb.resolve(id)
          }
          return undefined
        },
        load: (id) => MODULES[id],
      },
    ],
    build: { write: false, minify: false, rollupOptions: { input: 'food-log' } },
  })
  const output = Array.isArray(result) ? result[0]?.output : 'output' in result && result.output
  const chunk = output ? output.find((file) => file.type === 'chunk') : undefined
  if (chunk?.type !== 'chunk') throw new Error('The Food Log did not build')
  return chunk.code
}
