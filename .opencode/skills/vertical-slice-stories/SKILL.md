---
name: vertical-slice-stories
description: Use when the user asks to review product or technical requirements, create AI-agent-sized vertical-slice story codes and titles, append a confirmed dependency backlog, or create and update its delivery tracker.
---

# Vertical Slice Stories

Turn requirements into a reviewed delivery graph, not a list of acceptance-test fragments.

## Workflow

1. Read the product requirements, technical design, project instructions, and current implementation.
   Inspect application code, persistence, integrations, routes, and tests. Record which user outcomes are complete, mocked, partially implemented, or absent. This step is complete when every candidate capability has implementation evidence or is confirmed absent.

2. Remove completed outcomes from the candidate backlog.
   Judge completion against the requirement's delivery level. A development mock does not satisfy a production requirement unless the user explicitly accepts it as complete. When the user's completion assumption conflicts with the code, show the evidence and ask whether to exclude the gap from scope.

3. Cut coherent vertical deliveries sized for one capable AI agent.
   A story should carry one user journey through every relevant layer, including UI, API, persistence, integration behavior, and tests. Combine CRUD operations, validation, retries, units, and summary updates when they share one domain and implementation seam. Keep stories separate when they depend on different providers, unresolved decisions, security boundaries, or offline lifecycles.

4. Avoid micro-stories.
   Do not create one story per error case, validation branch, button, endpoint, or database table. Prefer a complete water journey over separate log, view, edit, delete, and conversion stories. Prefer separate catalog, barcode, and nutrition-label stories when each has a different provider or extraction blocker.

5. Build the delivery graph.
   For every story, assign:
   - A sequential code using the project's existing prefix, or a concise product prefix plus three digits.
   - A title that names the complete observable outcome.
   - A status from the definitions below.
   - Prerequisite story codes, distinct from external blockers.
   - An external owner role and the exact unresolved decision, when blocked.

6. Present one review table.
   Use these columns in this order: `Code`, `Title`, `Status`, `Depends on`, `External owner`, `Blocker or sequencing reason`. Do not split titles and blockers into separate tables. Use role names when the documents do not assign individuals.

7. Open a confirmation review before editing requirements.
   When Lavish is available or project instructions require it, load the `lavish` skill and its `table`, `comparison`, `code`, and `input` playbooks. Match the project's design system, render the exact proposed document change with `@pierre/diffs`, and keep all dependency data in the same story table. Poll and apply feedback until the user explicitly approves or ends the session.

8. Apply feedback by reshaping stories, not layering exceptions.
   Merge adjacent stories when the user judges that one agent can deliver more. Fold unit behavior into the domain journey it affects. Recalculate codes and every dependency after a merge or removal. This step is complete when codes are contiguous, every dependency points to an existing story, and the review artifact matches the proposed append exactly.

9. Append only after explicit confirmation.
   Add the exact approved table to the requested requirements document. Include dependency and blocker columns by default; use fewer columns only when the user explicitly approves that narrower draft. Do not create full story descriptions or acceptance criteria unless requested.

10. Create or update the delivery tracker.
    Use `STORY_TRACKER.md` unless the project already has a canonical tracker. Give every story exactly one delivery state, its approved title, and concise current implementation evidence. Keep delivery progress separate from readiness: a story can be in progress while externally blocked. Mark a story `Done` only after code and tests satisfy its full required delivery level; a mock of a production requirement remains `In progress`. Link the tracker from the backlog document.

11. Verify the result.
    Confirm that the backlog and tracker contain every approved code exactly once, codes are unique and contiguous, titles match, dependencies are valid, delivery evidence matches the current code, implementation-complete outcomes are absent from new-work stories, and no unrelated files changed. Keep the Lavish review open for final comments until the user ends it.

## Readiness Status Definitions

- `Ready`: no prerequisite story or unresolved external decision prevents implementation.
- `Sequenced`: implementation waits only for listed prerequisite stories.
- `Blocked`: one or more listed prerequisite stories and an unresolved external decision prevent implementation.
- `External decision`: no story prerequisite exists, but an unresolved provider, product, or architecture choice prevents completion.

## Delivery Status Definitions

- `Not started`: no implementation for the complete story outcome exists.
- `In progress`: part of the story exists, including a prototype or mock that does not yet satisfy the required delivery level.
- `Done`: the complete story outcome is implemented and verified at the required delivery level.

## Sizing Test

A story is the right size when one agent can implement and verify the complete named journey without waiting for another agent, once its listed dependencies and external decisions are resolved. Merge stories that share the same journey and blocker. Split stories that require independently selected providers or materially different persistence, security, or synchronization designs.
