# 15 - Search Food Database and confirm external Food candidates

**What to build:** Implement the unified Food Database picker and shared Food Detail and Review flow for recent, owned, and externally searched Food candidates.

**Blocked by:** 14 - Build the Saved Foods library and Food favorites.

**Status:** ready-for-agent

**Mockup starting point:** Start with the Food Database search field, recent results, filter tabs, result list, and shared review drawer in `public/mockup.html`.

- [ ] Food Database opens with recent logged Foods and supports explicit search plus All, My Meals, My Favorites, and My Foods filters without search-as-you-type requests that violate provider limits.
- [ ] A replaceable term/ingredient-search Adapter has a validated request/response contract, normalizes candidates, translates failures, and leaves a manual fallback when the selected provider cannot return a usable result.
- [ ] A result opens the shared review surface with name, available brand/description, natural or declared unit, quantity, full available nutrition, quantity basis, and missing-data warnings.
- [ ] Changing quantity recalculates every available nutrient with full precision and consistent final display formatting.
- [ ] External results remain Food candidates until explicit confirmation; Add to Log and Save to Saved Foods are separate explicit actions.
- [ ] Provider-specific shapes and errors are covered by deterministic Adapter fixtures and the HTTP flow is tested without live upstream calls.
