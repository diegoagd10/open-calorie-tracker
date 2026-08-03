# 17 - Review Food Label candidates

**What to build:** Add Food Label mode to Scan Food so a captured nutrition label becomes an editable candidate rather than an unverified or silently persisted Food.

**Blocked by:** 16 - Import barcode Food candidates with classified failures.

**Status:** ready-for-agent

**Mockup starting point:** Start with Food Label mode, framing guide, partial extraction card, and shared review drawer in `public/mockup.html`.

- [ ] Food Label mode accepts a validated image and requests product name, serving/quantity basis, and visible nutrient values through a replaceable Adapter.
- [ ] Extracted fields are editable before confirmation; missing or uncertain values remain visibly unknown and never become known zeroes.
- [ ] Calories and declared quantity basis are required before a Food Label candidate can be confirmed; manual entry remains available for partial or failed extraction.
- [ ] The candidate opens the shared review surface and supports explicit Add to Log or Save to Saved Foods only after review.
- [ ] Invalid images, incomplete extraction, provider refusal, temporary availability, and unexpected failures have user-visible states with retry only where appropriate.
- [ ] Image validation, field normalization, error classification, and request behavior use deterministic fakes and temporary data in tests.
