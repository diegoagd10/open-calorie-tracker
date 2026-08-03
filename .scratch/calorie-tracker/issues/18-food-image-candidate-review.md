# 18 - Analyze food images into editable Food candidates

**What to build:** Turn a Food image into a reviewable candidate workflow that keeps visual uncertainty, portions, matching, and AI edits under explicit User control.

**Blocked by:** 15 - Search Food Database and confirm external Food candidates, and 16 - Import barcode Food candidates with classified failures.

**Status:** ready-for-agent

**Mockup starting point:** Start with Food mode capture, analysis/loading state, identified ingredient review, per-ingredient actions, and whole-meal AI proposal in `public/mockup.html`.

- [ ] Food mode validates image input, distinguishes food from non-food, and reports incomplete, refused, unavailable, and unexpected AI outcomes without inventing nutrition.
- [ ] The AI Adapter returns visible or confidently identifiable ingredient proposals and editable natural-unit portions; it never applies a proposal by itself.
- [ ] Each ingredient supports one automatic match, multiple match selection, or a prefilled manual Food draft requiring calories and explicit confirmation when no match exists.
- [ ] The User can edit or delete an ingredient, request an individual or whole-meal AI edit, inspect the visible proposal, dismiss it, or explicitly confirm it before changes apply.
- [ ] A confirmed result can create confirmed Food data or a Food entry through the shared review flow; no unconfirmed candidate becomes a persisted Food, Meal ingredient, or Food entry.
- [ ] The retained Food image is stored outside the public directory, associated with the confirmed Food or Meal it supports, and remains until explicit deletion.
- [ ] Adapter outcomes, matching cases, manual fallback, proposal confirmation, image validation, safe logging, and HTMX states are tested with deterministic fakes and temporary storage.
