# UX: daily log and food-entry flows

Status: closed
Labels: wayfinder:prototype, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

What should the user experience look and feel like for the main daily log, date navigation, daily nutrient summary, past-date editing, deletion, and the four ways to add food: manual entry, barcode lookup, food-image analysis, and saved recipe?

The resolution should define the primary layout, navigation, responsive/mobile behavior, states, confirmation points, empty/error/loading states, and the minimum visual vocabulary needed for a separate AI design tool to produce useful mocks. It should distinguish the product-design brief from the later HTMX implementation.

## Expected asset

A design brief that can be copied into an external UI design AI without requiring that tool to understand this repository: [Calories UX design brief](../design/ux-daily-log-and-entry-flows.md).

## Comments

### Resolution (2026-08-02)

The shared UX direction is a dark-first, minimal, English-language day-first application. The primary navigation is `Log`, `Food Database`, and `Saved Foods`; the daily log is a single newest-to-oldest feed with optional meal tags, editable date/time, and explicit edit/delete actions. `Add Food` opens exactly three sources: `Food Database`, `Scan Food`, and `Saved Foods`.

`Food Database` opens with search, filters (`All`, `My Meals`, `My Favorites`, `My Foods`), and recent logged results. `Scan Food` is one camera hub with `Scan Food`, `Barcode`, and `Food Label` modes. AI results are always reviewed, ingredients can be edited/deleted individually, and the whole meal can be proposed for editing with AI. `Saved Foods` owns manual foods, favorites, and meals; `Create Meal` combines independently captured ingredients and calculates per-serving nutrition.

All sources reuse one Food Detail and Review surface with natural unit selection, quantity controls, full nutrition details, live recalculation, and explicit `Add to Log`/`Save to Saved Foods` actions. The dashboard uses nutrient progress bars with direction-specific reference semantics; exact official reference values remain in the nutrition research/domain decisions. The full mock brief is linked above.
