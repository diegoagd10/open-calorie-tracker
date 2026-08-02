# Map: Personal calorie tracker

Status: needs-triage
Labels: wayfinder:map
Type: decision map

## Destination

Reach a clear, implementation-ready product and technical plan for an open-source web application that lets an individual log food by date, calculate daily calories and nutrients, edit past entries, and create reusable recipes. Codex will implement the application after the map is clear.

The UX decision in this map must produce a self-contained design brief and mock requirements that can be handed to a separate AI design tool. That tool designs the interface; this effort retains responsibility for implementing the chosen interface and all functionality.

## Notes

- Domain: individual food and nutrition tracking.
- Existing context: an Express/HTMX barcode lookup POC using Open Food Facts and an OpenAI image ingredient-extraction POC already exist in the repository.
- Intended implementation direction: HTMX browser interactions, Node.js/Express backend, SQLite persistence, and an ORM/migration workflow unless a later decision changes that direction.
- Skills to consult while resolving the map: `wayfinder`, `grilling`, `domain-modeling`, `codebase-design`, `prototype`, and `research` when external facts are needed.
- Standing preference: keep the interface understandable and server-rendered; do not let AI silently create or log uncertain nutrition data without user confirmation.

## Decisions so far

<!-- Closed tickets are indexed here. Open tickets are discovered from the issue tracker. -->

- [UX: daily log and food-entry flows](issues/01-ux-daily-log-and-entry-flows.md) — Dark-first English day log with three food sources, a shared detail/review surface, editable AI review, and a Saved Foods meal builder; [design brief](design/ux-daily-log-and-entry-flows.md).

## Not yet specified

- Whether this first release is local single-user only or needs accounts, authentication, and synchronization.
- The canonical quantity and serving semantics for manual entries, barcode results, image estimates, and recipes.
- How much uncertainty the product exposes for AI estimates and incomplete external nutrition records.
- The precise role of the food library, saved recipes, and historical snapshots when source data changes.
- Deployment, file storage, backup, and privacy expectations for uploaded food images.
- The acceptance criteria and build sequence that follow once these decisions are resolved.

## Out of scope

- Payments, subscriptions, or monetization; the project is open source and not intended to charge users.
- Medical diagnosis, treatment, or prescriptive health advice.
- Native mobile applications in this web-app effort.
