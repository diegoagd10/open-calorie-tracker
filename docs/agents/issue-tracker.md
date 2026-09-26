# Issue tracker: local Markdown

Specs, tickets, triage, blockers, and progress for this repository live outside Git under `/home/dagd/.tickets/open-calory-tracker/`. This directory is shared by all worktrees of the `diegoagd10/open-calory-tracker` repository. Use filesystem reads and writes for tracker operations.

## Layout

- One feature per directory: `/home/dagd/.tickets/open-calory-tracker/<feature-slug>/`.
- One spec per feature: `<feature-slug>/spec.md`.
- One implementation ticket per file: `<feature-slug>/issues/NN-<slug>.md`, numbered from `01` in dependency order.
- Before creating a feature or ticket, inspect the project directory to avoid duplicates. If the directory appears to belong to another project, ask for a different name before writing.

## Document state and blockers

- Put `Status: todo`, `Status: in-progress`, `Status: done`, or `Status: cancelled` near the top of each spec and ticket.
- Put `Triage: <label>` near the top, using the vocabulary in `docs/agents/triage-labels.md`.
- Each ticket has a `Blocked by:` line containing ticket numbers or paths. Leave the value empty when the ticket has no blockers. A ticket is ready only when every blocker is `done`.
- Append comments and implementation notes under `## Comments` in the relevant Markdown file.

## Skill operations

- `/to-spec` writes one feature spec to `spec.md` and marks it `Triage: ready-for-agent` when fully specified.
- `/to-tickets` writes one file per approved implementation slice and records blocker edges with ticket numbers or paths.
- `/triage` updates the document's `Triage:` label and `Status:` as appropriate.
- `/implement` reads the chosen ticket, its spec, and its blockers before starting; it records progress and verification in the ticket file.
- To find a document, inspect the feature directory and open the referenced path or ticket number. Keep ticket bodies as editable Markdown files.

The repository's Git remote hosts source code and pull requests; it is not this project's issue tracker.
