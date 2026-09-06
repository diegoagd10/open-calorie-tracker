# Issue tracker: Cairn

## Tracker and project selection

This repository uses **Cairn** for specs, tickets, blocking dependencies, comments, and progress. Use the `cairn` CLI. Planning documents live in its local SQLite database outside Git; the repository's Git remote remains the source-code host.

Before working with documents, run:

```sh
cairn --help
cairn project resolve
```

Resolve from the target repository's checkout, not from the Cairn installation directory. If the repository has not been registered, set it up with `cairn project add .` as part of the user's requested tracker setup. Outside a checkout, use `cairn project list` to find the intended project, then pass `--project PROJECT-ID-OR-NAME` to document commands. Prefer the returned project ID when names are ambiguous. Never substitute an ID from another project.

The normal database location is the user's XDG data directory under `cairn/cairn.sqlite`, falling back to `~/.local/share/cairn/cairn.sqlite`. If using a custom database, use the same `CAIRN_DB` or `--db PATH` consistently for registration and subsequent commands. Do not put the database in Git.

Data commands return JSON. Operational errors go to stderr with a nonzero exit status; stop dependent operations and resolve the error before continuing. Node may also emit a SQLite warning on stderr, so inspect the exit status and keep stdout separate. `cairn doc export` returns original Markdown rather than JSON.

## Publish specs and tickets

Keep the active planning skill's templates and review steps. Write each complete Markdown body to a UTF-8 file, preferably a temporary file outside Git, then pass it using `--body-file`. Do not interpolate Markdown into shell commands. Cairn stores and exports the body unchanged.

```sh
cairn spec create --title "Offline search" --body-file "path/to/spec.md"
cairn ticket create --title "Index saved notes" --body-file "path/to/index-ticket.md" --parent SPEC-ID
cairn ticket create --title "Search saved notes" --body-file "path/to/search-ticket.md" --parent SPEC-ID --blocked-by FIRST-TICKET-ID
```

Replace the example paths with files you have written, and the placeholder IDs with IDs returned by earlier commands. For `to-spec`, publish one spec. For `to-tickets`, publish one ticket per approved slice. If the source is an existing spec, use its ID as `--parent` on each ticket; otherwise omit `--parent`. Do not pass a ticket ID as a spec parent.

Publish blockers first so dependent tickets can reference their real IDs. Use `--blocked-by ID,ID` for structured dependencies, even when the Markdown also describes them. Creating tickets does not close or change the parent spec. A multi-command publication can partially succeed: inspect existing documents before retrying to avoid duplicates.

After publication, read back each document with `cairn doc get ID`. Verify its Markdown, parent, and blockers against the approved plan, then report the returned IDs.

## Read, update, and export

```sh
cairn spec list
cairn ticket list
cairn doc get ID
cairn doc update ID --body-file "path/to/revised.md" --revision REVISION
cairn doc update TICKET-ID --blocked-by BLOCKER-ID,OTHER-BLOCKER-ID --revision REVISION
cairn comment add ID --body-file "path/to/note.md"
cairn doc export ID
cairn export
```

`doc get` includes the body, comments, relationships, and current revision. Before editing a document, read it and pass the returned revision to `doc update`; on a conflict, read again and reconcile. The `--blocked-by` list replaces all blockers rather than appending. Use `--blocked-by ""` to clear them with a shell that preserves empty arguments; Windows PowerShell 5.1 users can use `--blocked-by=,`, which Cairn also parses as an empty list. Omit `--blocked-by` to leave dependencies unchanged.

## Triage and implementation

Triage labels and lifecycle statuses are separate. Use the project's configured label vocabulary. Cairn's default roles are `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. Set a document's label with `--label` on creation or `cairn doc update ID --label LABEL`. New documents default to `ready-for-agent`.

```sh
cairn next
cairn doc get TICKET-ID
cairn doc status TICKET-ID in-progress
cairn comment add TICKET-ID --body-file "path/to/verification.md"
cairn doc status TICKET-ID done
```

`cairn next` returns only `todo` tickets labelled exactly `ready-for-agent` whose blockers are all done. If the project uses a different readiness label, use `ticket list` and inspect statuses and blockers explicitly. Read the selected ticket, its comments, and its parent spec before implementing it.

Lifecycle statuses are `todo`, `in-progress`, `done`, and `cancelled`. A blocked ticket cannot start or finish. A cancelled blocker remains unresolved until its dependency is removed or the blocker is completed. Changing a triage label to `wontfix` does not cancel a ticket; change the lifecycle status explicitly when appropriate.

Verify the ticket's acceptance criteria, record the evidence in a comment, then mark it done. Cairn enforces dependency rules but does not run tests or judge acceptance criteria. Close a parent spec explicitly only after checking its overall outcome and after all its tickets are done or cancelled.

For parallel agents, assign distinct tickets explicitly and give each agent its project and ticket IDs. `cairn next` lists available work; it does not atomically claim or assign it. Agents on the same computer must use the same database. Worktrees of a registered repository can resolve to the same project; registering a separate clone can associate it through a normalized remote.
