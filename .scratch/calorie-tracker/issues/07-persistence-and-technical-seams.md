# Technical: persistence and module seams

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

Given the resolved domain and privacy rules, what SQLite schema, ORM/migration approach, module seams, upload handling, and external-service adapters should the implementation use? Define the durable interfaces that keep daily-log calculations, food-source lookups, AI analysis, and recipe composition independently testable while honoring the requested Node.js, Express, HTMX, and SQLite stack.

This ticket is about deciding the implementation shape, not writing it. It should include migration strategy, nutritional snapshot boundaries, error behavior, and the minimum testing seams.

## Comments

### Resolution (2026-08-02)

The implementation will use TypeScript with Drizzle ORM over SQLite. The TypeScript Drizzle schema is the source of truth; `drizzle-kit` generates versioned migration files that are committed to the repository and applied explicitly during deployment. Application startup will not silently mutate the schema.

The persistence model uses separate relational records for reusable Food items, Meals, Meal ingredients and quantities, historical Food entries, nutritional snapshots, and retained Food images. A Food entry stores its immutable nutritional snapshot as explicit nullable nutrient fields plus its declared quantity basis. It may retain an internal reference to the reusable Food item or Meal for navigation and future-use behavior, but calculations always use the snapshot. Unconfirmed Food candidates and AI review drafts remain transient and only become persisted domain records after explicit confirmation.

Nutrition calculations live in a pure domain Module with a small Interface independent of Drizzle, Express, HTTP, and AI. External food-data providers and configured AI providers are separate Adapters behind typed Interfaces; provider SDK types and errors do not leak into application Modules. Provider failures are translated into application categories such as `not_found`, `invalid`, `temporarily_unavailable`, and `unexpected`, preserving the agreed retry and manual-fallback behavior.

Retained Food images are managed by a dedicated image-storage Module. Images are validated and stored as local files outside the public directory; SQLite stores their metadata and managed association with a Food item or Meal. The Module owns retrieval, export, and explicit deletion. This does not introduce user-visible source tracking.

Each user-visible write is atomic inside the persistence Module: a Meal log, Food entry, snapshot, relationship, or image metadata change either completes together or does not persist. Technical troubleshooting events use structured backend logging separate from nutrition data, with safe categories, operation names, provider identifiers, and correlation IDs; API keys, environment values, images, prompts, and raw provider responses are excluded.

Testing starts with pure calculation tests, temporary SQLite tests where persistence behavior requires real SQLite semantics, deterministic Adapter fakes, and a small number of Express/HTMX wiring tests. Integration tests may be added when isolated tests cannot provide confidence or a failure exposes real persistence or request-wiring behavior.
