# 11 - Bootstrap the TypeScript application and persistence boundary

**What to build:** Replace the prototype runtime with the production-shaped TypeScript/ESM Express/HTMX application seam. Establish the Drizzle-backed SQLite persistence boundary, explicit migration workflow, single-user configuration, safe technical logging, and test harness that later vertical slices can use.

**Blocked by:** None - can start immediately.

**Status:** ready-for-agent

**Mockup starting point:** Start with the shell, navigation rail, local-instance status, and settings navigation in `public/mockup.html`. Preserve the visual language while wiring a real server-rendered application instead of the static fixture behavior.

- [ ] The application runs as TypeScript/ESM with Express 5, HTMX responses, a composition root, and development/test commands.
- [ ] Drizzle schema definitions and committed versioned migrations create SQLite data under configurable `DATA_DIR`; startup never mutates the schema implicitly.
- [ ] A single local User and authoritative Timezone setting can be read and updated, with configuration validation and browser timezone seeding only when no setting exists.
- [ ] A health endpoint and structured safe technical logger exist; logs exclude API keys, environment values, images, prompts, raw provider responses, and sensitive nutrition data.
- [ ] Isolated tests and request-level tests can run against temporary SQLite/data directories and deterministic fakes.
