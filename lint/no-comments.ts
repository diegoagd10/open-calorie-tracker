import { definePlugin, defineRule } from 'vite-plus/lint/plugins'

const DIRECTIVE = /^\s*(?:oxlint|eslint)-/

const noComments = defineRule({
  meta: {
    type: 'problem',
    messages: {
      noComments:
        'Comments are banned. Make the code say it: a clearer name, a type, a test, or a lint rule. A comment about third-party behavior we cannot change may stay behind `oxlint-disable-next-line local/no-comments`.',
    },
  },
  create(context) {
    return {
      Program() {
        let runEndLine = -1
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === 'Shebang') continue
          const continuesRun = comment.type === 'Line' && comment.loc.start.line === runEndLine + 1
          runEndLine = comment.type === 'Line' ? comment.loc.end.line : -1
          if (DIRECTIVE.test(comment.value)) {
            runEndLine = -1
          } else if (!continuesRun) {
            context.report({ loc: comment.loc, messageId: 'noComments' })
          }
        }
      },
    }
  },
})

export default definePlugin({
  meta: { name: 'local' },
  rules: { 'no-comments': noComments },
})
