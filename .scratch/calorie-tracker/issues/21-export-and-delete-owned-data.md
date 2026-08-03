# 21 - Export and erase owned data

**What to build:** Give the self-hosting User explicit control over exporting, removing, and auditing retained application data without destroying historical snapshots accidentally.

**Blocked by:** 18 - Analyze food images into editable Food candidates, 19 - Create and log one-unit Meals from confirmed Foods, and 20 - Configure and confirm Nutrition targets and estimates.

**Status:** ready-for-agent

**Mockup starting point:** Start with the local-instance status and settings visual language in `public/mockup.html`; add the missing ownership controls as a deliberate settings surface rather than inventing a new visual system.

- [ ] The User can export structured application records and retained Food images in a documented, restorable format under `DATA_DIR/exports`.
- [ ] The User can explicitly delete an individual retained Food image without deleting the associated Food, Meal, or historical Food entry unless the domain action requires it.
- [ ] Deleting a reusable Food or Meal preserves all historical Food-entry Nutritional snapshots and removes only the reusable definition and allowed associations.
- [ ] A confirmed delete-all operation removes all domain records, retained images, and generated exports atomically or reports a recoverable failure without partial hidden state.
- [ ] Export and deletion actions are protected against path traversal, expose clear confirmation and result states, and never include API keys, environment values, raw prompts, or raw provider responses.
- [ ] Temporary-directory tests verify export contents, image handling, snapshot preservation, delete-all behavior, and failure recovery.
