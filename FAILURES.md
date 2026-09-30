# PR audit 161: Find, create, and log Saved Foods through MCP and REST
base `fcf93e8c79ccbefec21b00ea000b480e59445cce` · head `708d65f46a81cf0c89755b0e68976449dbb0149b` · 2026-09-30
sources `/home/dagd/.tickets/open-calory-tracker/mcp-saved-foods`
runs `/tmp/pr-spec-audit-161-Ed4U4P/run-a.md` · `/tmp/pr-spec-audit-161-Ed4U4P/run-b.md`
BOUNDARY 4 · NULL/EMPTY 0 · AUTHORIZATION 0 · INJECTION 1 · STATE 2
PENDING_USER 3 · CONTRADICTION 4 · NO_EVIDENCE 0

## `app/api-keys/authentication.server.ts`

Confirmed: AUTHORIZATION.
Not applicable: BOUNDARY, NULL/EMPTY, INJECTION, STATE — this change only accepts a set of scopes in the existing authenticator.

## `app/api-keys/presets.ts`

Confirmed: AUTHORIZATION.
Not applicable: BOUNDARY, NULL/EMPTY, INJECTION, STATE — this file declares scope choices and membership checks.

## `app/database/saved-foods.server.ts`

### B-1 - Accented names do not match across case

- **Category**: BOUNDARY
- **Status**: PENDING_USER
- **Risk**: Medium
- **Found by**: both
- **Finding**: `app/database/saved-foods.server.ts:22` uses SQLite `lower`, which leaves `Á` and `á` distinct, while `spec.md:89` requires case-insensitive substring matching and `issues/02-log-foods-scope-and-search.md:26` records the inherited ASCII-only exception.
- **Proposal**: Define the intended handling of non-ASCII case pairs and use Unicode-aware matching if they must match.
- **Decision**: Must case-insensitive Saved Food search include non-ASCII case pairs?

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: INJECTION — Drizzle binds the query and user id as SQL parameters.

## `app/database/schema.server.ts`

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: BOUNDARY, INJECTION — the changed declarations add nullability and a per-user unique index without processing request input.

## `app/food-entry/food-entry.server.ts`

### S-1 - Editing a logged serving breaks an identical retry

- **Category**: STATE
- **Status**: CONTRADICTION
- **Risk**: Medium
- **Found by**: both
- **Finding**: `app/food-entry/food-entry.server.ts:492-494` compares a retry with the mutable Food Entry quantity, so a web edit at `app/food-entry/food-entry.server.ts:1230` makes the original request conflict despite `spec.md:150`; `tests/routes/api-key-food-entries-route.test.ts:189-199` edits the entry without retrying it.
- **Proposal**: Store the original external request identity separately from editable Food Entry fields and compare retries with it.
- **Decision**: Apply proposal?

### S-2 - A delayed retry recreates a web-deleted entry

- **Category**: STATE
- **Status**: CONTRADICTION
- **Risk**: High
- **Found by**: both
- **Finding**: `app/food-entry/food-entry.server.ts:992-997` finds prior keys only in live Food Entries, while web deletion removes the row at `app/food-entry/food-entry.server.ts:1299-1310`, so a later identical request creates another entry contrary to `spec.md:150`; `tests/routes/api-key-food-entries-route.test.ts:201-209` never retries after deletion.
- **Proposal**: Retain the external key and its original request identity after deletion, then return a stable replay or deleted-result response without logging food again.
- **Decision**: Apply proposal?

Confirmed: BOUNDARY, NULL/EMPTY, AUTHORIZATION.
Not applicable: INJECTION — service queries use bound values and do not execute caller text.

## `app/food-log/idempotency-key.ts`

Confirmed: BOUNDARY, NULL/EMPTY, STATE.
Not applicable: AUTHORIZATION, INJECTION — this helper validates and prefixes keys without granting access or executing them.

## `app/mcp/daily-log-summary.ts`

Confirmed: STATE.
Not applicable: BOUNDARY, NULL/EMPTY, AUTHORIZATION, INJECTION — this extraction preserves existing summary formatting and adds no new input or access path.

## `app/mcp/server.server.ts`

Confirmed: AUTHORIZATION.
Not applicable: BOUNDARY, NULL/EMPTY, INJECTION, STATE — this change selects tools by a scope set.

## `app/mcp/tools.server.ts`

### I-1 - Saved Food names break one-line MCP summaries

- **Category**: INJECTION
- **Status**: CONTRADICTION
- **Risk**: Medium
- **Found by**: one run, verified
- **Finding**: `app/mcp/tools.server.ts:89`, `app/mcp/tools.server.ts:157`, and `app/mcp/tools.server.ts:203` interpolate names containing embedded newlines into agent-facing text even though `issues/02-log-foods-scope-and-search.md:13` and `issues/04-log-saved-food-mcp.md:14` require one-line summaries; `tests/routes/mcp-route.test.ts:330` checks only an ordinary name.
- **Proposal**: Escape control characters when composing MCP text while preserving the original names in structured content.
- **Decision**: Apply proposal?

Confirmed: BOUNDARY, NULL/EMPTY, AUTHORIZATION, STATE.

## `app/routes.ts`

Confirmed: AUTHORIZATION.
Not applicable: BOUNDARY, NULL/EMPTY, INJECTION, STATE — this table only registers static API paths.

## `app/routes/api-v1.server.ts`

Confirmed: AUTHORIZATION, NULL/EMPTY.
Not applicable: BOUNDARY, INJECTION, STATE — this module maps authentication results and serializes Food Entry fields.

## `app/routes/api.v1.daily-log.ts`

Confirmed: AUTHORIZATION, NULL/EMPTY.
Not applicable: BOUNDARY, INJECTION, STATE — the change moves existing response and authentication helpers without changing daily-log behavior.

## `app/routes/api.v1.food-entries.ts`

### B-2 - Nonpositive Saved Food IDs return not found

- **Category**: BOUNDARY
- **Status**: CONTRADICTION
- **Risk**: Low
- **Found by**: one run, verified
- **Finding**: `app/routes/api.v1.food-entries.ts:22` accepts zero and negative integer `savedFoodId` values, which become `404 saved_food_not_found` at `app/routes/api.v1.food-entries.ts:44` after `app/food-entry/food-entry.server.ts:936-939` rejects them, while `spec.md:169` assigns malformed or out-of-bounds fields `400 invalid_request`; `tests/routes/api-key-food-entries-route.test.ts:260` omits nonpositive IDs.
- **Proposal**: Require a positive integer in the REST body schema and reserve 404 for a well-formed absent or foreign ID.
- **Decision**: Apply proposal?

### B-3 - Food Entry POST reads unbounded JSON

- **Category**: BOUNDARY
- **Status**: PENDING_USER
- **Risk**: Medium
- **Found by**: both
- **Finding**: `app/routes/api.v1.food-entries.ts:68` parses an authenticated JSON body without a byte limit, while `spec.md:126-127` defines its fields but no size limit and `app/mcp/server.server.ts:8` caps MCP requests at 64 KiB.
- **Proposal**: Set a REST body limit and reject oversized requests while reading, before JSON parsing.
- **Decision**: What maximum body size should `POST /api/v1/food-entries` accept?

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: INJECTION — the source tag is checked against an own-property registry and source fields are parsed before service calls.

## `app/routes/api.v1.saved-foods.ts`

### B-4 - Saved Food POST reads unbounded JSON

- **Category**: BOUNDARY
- **Status**: PENDING_USER
- **Risk**: Medium
- **Found by**: both
- **Finding**: `app/routes/api.v1.saved-foods.ts:65` parses an authenticated JSON body without a byte limit, while `spec.md:119-120` defines its fields but no size limit and `app/mcp/server.server.ts:8` caps MCP requests at 64 KiB.
- **Proposal**: Apply the chosen REST body limit while reading, before JSON parsing.
- **Decision**: What maximum body size should `POST /api/v1/saved-foods` accept?

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: INJECTION — the strict body schema validates fields and the response is JSON.

## `app/routes/settings.api-keys.tsx`

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: BOUNDARY, INJECTION — checkbox rendering adds no numeric limit and React escapes displayed values.

## `drizzle/0029_saved_food_idempotency.sql`

Confirmed: NULL/EMPTY, AUTHORIZATION, STATE.
Not applicable: BOUNDARY, INJECTION — the migration uses static SQL without request input.

Dropped: none
