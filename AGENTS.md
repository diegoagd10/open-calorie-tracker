## Agent skills

### Issue tracker

Specs and tickets live as local Markdown outside Git. Before spec, ticket, triage, or implementation tracking operations, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the local Markdown triage vocabulary in `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`. Before exploring the codebase, read `docs/agents/domain.md`.

### Pull requests

Before committing, pushing, or creating a PR, follow `docs/verification.md#pull-request-gate` and install the hook with `pnpm hooks:install`. Treat a hook failure as actionable feedback: read its output and saved logs, fix the cause, and retry the same Git command. Never bypass verification with `--no-verify`, an alternate `core.hooksPath`, or a forged summary. Create PRs with `pnpm pr:create` only after the verified push succeeds.
