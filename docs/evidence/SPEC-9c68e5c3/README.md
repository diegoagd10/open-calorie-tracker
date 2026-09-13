# SPEC-9c68e5c3 browser QA

Manual QA on September 13, 2026 against application code at `548fa23883dbff0aaf41c5f4cc035d10fce730ce`, including both merges from `main`.

The existing manual test account and Food Entries were preserved when moving the test app to the merged build. The app uses the complete OFF JSONL archive (4,745,915 products) and the existing 52-food USDA browser fixture. Test dates are pinned to August 29, 2026. Screenshots contain synthetic accounts and source food data; passwords and tokens are excluded.

| Flow | Observed result | Evidence |
| --- | --- | --- |
| Password authentication | An incorrect password returns the generic sign-in error. Signing out and opening a protected page redirects to `/login`; valid administrator credentials restore access. | [Rejected password](02-auth-rejected.png), [authenticated Food Log](04-food-log-saved.png) |
| Member onboarding | Creating a member requires a password change before setup. The member replaces it and completes setup successfully. | [Required password change](10-member-password-required.png), [member Food Log](12-member-food-log.png) |
| Account isolation and authorization | A member receives 404 for catalog administration and for an administrator's Food Entry. Its daily log contains only its own entry. | [Restricted catalog page](11-member-catalog-restricted.png), [member Food Log](12-member-food-log.png) |
| OFF barcode lookup | UPC `078742366906` resolves to EAN `0078742366906`, Great Value 100% Whole Wheat Round Top Bread. The declared serving is 26 g with 60 kcal, 3 g protein, 12 g carbohydrate, 1 g fat, 2 g fiber, 1 g sugar, and 100 mg sodium. | [Mobile barcode review](03-bread-barcode.png) |
| OFF food logging during replacement | Two servings recalculate to 120 kcal, 6 g protein, 24 g carbohydrate, 2 g fat, 4 g fiber, 2 g sugar, and 200 mg sodium. Confirming saves the entry; a fresh page load and reopening the editor preserve those values. | [Saved log](04-food-log-saved.png), [saved nutrition](05-saved-nutrition.png) |
| Catalog search | Packaged-products search returns OFF results; basic-foods search returns USDA results. Searching and reviewing a food do not add an entry. | [Packaged products](06-packaged-search.png), [basic foods](07-basic-search.png) |
| USDA measurement and logging | Selecting the source-backed 76 g chopped-cup measurement for FDC 747447 recalculates to 24.3 kcal. Confirming saves the USDA entry in the daily log. | [Mobile measurement review](08-usda-measurement.png), [USDA entry and update](13-usda-update-admin.png) |
| Official update checks | OFF metadata matches the installed JSONL archive to the September 13 official snapshot and reports no change. The synthetic USDA fixture remains an unknown official release, as expected. | [OFF update metadata](09-update-check.png) |
| Incomplete OFF nutrition | A real product without an explicit nutrition basis remains reviewable; measurement selection and calculated logging are disabled. | [Review-only product](15-incomplete-nutrition-review.png) |
| Complete OFF reimport and activation | The same full JSONL archive builds a new database while the old generation remains active during import. Both connected clients receive the success notification. After activation, bread lookup still returns 60 kcal per 26 g serving and the saved two-serving snapshot is unchanged. | [Administrator notification](16-off-update-admin.png), [member notification](17-off-update-member.png), [installed catalog](18-off-catalog-after.png), [bread after reimport](19-bread-after-reimport.png), [preserved snapshot](20-snapshot-after-reimport.png) |
| Notification independence | Dismissing the administrator notification leaves the member notification visible. Reloading the administrator page does not replay the dismissed event. | [Member notification](17-off-update-member.png) |
| USDA reimport and notifications | Repeated bundled terminal imports succeed with 52 foods. Connected administrator and member clients each display “USDA Foundation catalog updated.” | [Administrator notification](13-usda-update-admin.png), [member notification](14-usda-update-member.png) |

The screenshots capture the application UI directly. USDA notification captures include successive fixture reimports to capture both clients' transient notifications. Metadata checks are separate from imports and do not download or install catalog archives automatically.

Manual authentication QA covers passwords and account permissions. Hardware-key sign-in was not manually exercised.

## Performance observation

During the complete OFF reimport, broad searches for `apple` returned the expected packaged-product results but took 4,427 ms (All filter) and 4,546 ms (Packaged products filter) in server request logs. These are individual observed request durations, not a percentile measurement. The selected lookup/prefix benchmark in `docs/local-off-catalog.md` does not characterize this broad-query case. After the reimport completed, the same packaged `apple` query took 686 ms on the server (714 ms for complete browser navigation). Functional search checks passed; broad-query latency during a full import remains a follow-up performance concern.

## Complete archive replacement evidence

- Bundled operator command: `pnpm catalog:import:off -- <local official JSONL GZIP>`; exit status 0.
- Import started at 2026-09-13T20:28:02.320Z and completed at 2026-09-13T20:57:10.255Z (29 minutes 8 seconds, including local submission).
- Processed 4,745,990 records; installed 4,745,915; rejected 75 (61 duplicate identities, 13 oversized product fields, one invalid identity). Nutrition exclusions leave review-only products in the catalog and are separate from rejected identities.
- Archive SHA-256: `9f6c5a19666aac27e43060268fdf0fb8d540a1474bef3f88db9b83c5bbd67d0e`.
- Old generation: `a0f07744-5317-4a30-bf4c-99bec0c45cc2`. New active generation: `009fc89c-4597-4ba0-9f79-468e3064f785`. The old database was retired after completion.
- All five Food Entries present before the final switch are byte-equivalent when read back afterward (full-row digest comparison); the browser separately verifies the saved bread snapshot's eight quantity/nutrient fields.
- Fresh browser assertions for both completion notifications, independent dismissal, reload deduplication, new-generation barcode lookup, and saved nutrition preservation all passed.
