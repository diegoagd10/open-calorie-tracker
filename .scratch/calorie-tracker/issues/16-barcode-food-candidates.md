# 16 - Import barcode Food candidates with classified failures

**What to build:** Add the Barcode mode to Scan Food and make Open Food Facts barcode results reviewable, editable, and safe under incomplete data or upstream failures.

**Blocked by:** 15 - Search Food Database and confirm external Food candidates.

**Status:** ready-for-agent

**Mockup starting point:** Start with Scan Food Barcode mode, manual barcode entry, not-found state, and retry state in `public/mockup.html`.

- [ ] Barcode mode supports camera input where available and an accessible manual barcode fallback, with server-side provider credentials and an identifying User-Agent.
- [ ] The Open Food Facts Adapter normalizes supported barcode forms, requests selected fields, preserves explicit quantity bases, and normalizes available nutrient units using deterministic fixtures.
- [ ] A found record becomes a Food candidate and opens the shared review surface; it never logs or saves silently.
- [ ] The UI distinguishes invalid input, not found, incomplete or conflicting data, temporary unavailability, and unexpected failure.
- [ ] Retry is offered only for temporary backend/upstream availability failures; not-found and invalid states retain manual fallback without pointless retry loops.
- [ ] Adapter classification, candidate normalization, retry policy, safe logging, and HTMX responses are covered by tests with no live Open Food Facts dependency.
