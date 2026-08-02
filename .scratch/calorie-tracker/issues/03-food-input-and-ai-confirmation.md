# Domain: food sources and AI confirmation

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

How should each food-input source behave from capture to confirmed food entry? Decide the barcode lookup result states, manual nutrition form, image analysis output, ingredient-to-nutrition matching, quantity estimation, confidence display, correction flow, and the rule for what can be added to the daily log without user confirmation.

The resolution must account for an image that is not food, an image with several ingredients, an ingredient with no external match, a barcode with incomplete nutrition, and an AI estimate that is obviously wrong.

## Comments

### Resolution (2026-08-02)

The food-input flows are explicit and reviewable. Manual entry is confirmed when the user saves it. Barcode and AI results remain `Food candidates` until the user reviews and confirms them; nothing is added to the daily log or silently overwritten by AI.

Calories and a declared quantity basis are mandatory. Macro and other nutrient fields are optional; missing values remain unknown rather than zero. Barcode results distinguish `not found`, invalid input, incomplete/conflicting data, temporary availability failures, and other operational errors. Failures notify the user; retry is suggested only for backend or upstream availability failures, while manual entry remains available where appropriate. Backend technical logs record provider and operational details for troubleshooting. Source origin is not part of the domain model or normal UI.

The Scan Food hub validates that the captured input matches the selected Food, Barcode, or Food Label mode and notifies the user when it does not. Food images may propose visible ingredients and editable natural-unit portions. Nutrition lookup auto-selects a single match, presents multiple matches for user choice, and creates a prefilled manual-entry draft when no match exists. An unmatched draft requires user-supplied calories and explicit confirmation. AI confidence is shown as guidance; the user can edit, delete, or use the already-decided per-ingredient or whole-meal AI proposal flows. AI-derived portions and matches remain proposals until confirmation.
