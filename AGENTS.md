# Project Agent Instructions

## Lavish Diff Explanations

When a user asks to explain, review, summarize, or present a non-trivial change set, create a Lavish diff walkthrough under `.lavish/` and open it for review.

- Match the visual system documented in `DESIGN.md`; do not use a generic report theme when the project has an established design language.
- Load the Lavish `code`, `table`, and `comparison` playbooks. Load `diagram` whenever architecture, classes, components, state, or relationships are part of the explanation.
- Render source files and diffs with `@pierre/diffs`. Do not use hand-written `<pre>` blocks, static code screenshots, or pasted terminal diffs.
- Organize the walkthrough by user-facing concern rather than raw repository order. Include repository shape, requirement decisions, client changes, backend changes, delivery/runtime changes, tests, and the remaining production boundary when applicable.
- Show the current backend file tree and explain each file's responsibility for backend changes.
- Include relationship diagrams when the change introduces or modifies components, classes, interfaces, modules, persistence records, or request flows.
- Represent the code accurately. Distinguish concrete classes, React function components, TypeScript interfaces, modules, inline route groups, framework instances, and conceptual groupings with explicit stereotypes. Never invent source classes to make a class diagram look conventional.
- Keep cross-stack and backend-only diagrams separate when one combined diagram would be too dense.
- Place paths and evidence next to each claim. Include exact routes, test scenarios, and relevant implementation boundaries.
- State what is implemented versus mocked or still required for production. Never imply that in-memory storage, development helpers, or simulated delivery are production infrastructure.
- Report current runtime state when servers, tunnels, or preview processes are relevant.
- Include verification results such as typechecking, integration tests, builds, accessibility checks, and review disposition.
- Poll the Lavish session, apply queued comments, and continue until the user ends the session. Do not reopen an ended session unless the user explicitly asks.
- Keep the final chat response concise: summarize the result, identify the artifact path, and include any requested PR or review URL.
