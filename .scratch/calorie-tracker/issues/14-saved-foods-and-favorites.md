# 14 - Build the Saved Foods library and Food favorites

**What to build:** Turn confirmed Food items into a usable personal library with search, filters, editing, deletion, and independent Favorite behavior.

**Blocked by:** 13 - Navigate and correct the Daily log.

**Status:** ready-for-agent

**Mockup starting point:** Start with the Saved Foods library, Create Food action, library filters, and saved-item review drawer in `public/mockup.html`.

- [ ] Saved Foods provides searchable All, My Favorites, and My Foods views, with the library state ready for the later My Meals extension.
- [ ] The User can create, review, edit, and delete reusable Food items; edits affect future uses only and deletion preserves historical Food-entry snapshots.
- [ ] Saving a Food entry as a Favorite creates an independently editable Food item from that entry's exact snapshot and quantity.
- [ ] Favoriting a confirmed Food item creates a user-owned Favorite marker or saved copy according to the resolved domain rule; unfavoriting removes only the marker and never deletes the Food.
- [ ] Selecting a saved Food reuses the shared review surface with explicit Add to Log and Save to Saved Foods actions.
- [ ] Search, filters, Favorite operations, edits, deletions, and historical independence have observable module and request-level tests.
