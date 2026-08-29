# Open Calory Tracker MVP mock

Portable, mobile-first interface mock based on GitHub issue #13. It uses only vanilla HTML, CSS, and JavaScript; all behavior is local and presentation-only.

## Preview

```bash
cd mocks/calorie-water-tracker-mvp
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Represented surfaces

- Today’s Food Log with nearby-date navigation, calorie summary, two-page nutrient carousel, chronological Food Entries, Water Events, USDA attribution, and incomplete nutrient totals.
- Add Food flow with deliberate USDA search, catalog-type labels, safe provider-backed measurements, quantity preview, Nutrition Snapshot explanation, idempotent save feedback, no-results, rate-limit, unavailable, and unsafe-measurement states.
- Food Entry edit and delete confirmation.
- Water presets, exact custom amount, equivalent 8 fl oz-glass count, US/metric conversion, edit-as-replacement, validation, and delete/save outcomes.
- History calendar with populated, empty, and future-day states.
- Registration, sign-in, generic credential failure, duplicate username, first-run units/goals, password change, session rotation, and logout outcomes.
- Effective-dated goal and display-unit settings.
- Responsive phone, tablet, and desktop compositions.

## How to explore states

- Select August 27 for an empty past day and August 30 for a future day.
- In Add Food, search for `yogurt`, `bread`, `none`, `rate`, or `unavailable`.
- Select a Food Entry to change its provider-backed measurement/quantity or delete that occurrence; the timeline and daily calories update locally.
- Select Add Water to open the preset/custom bottom sheet.
- Open Settings → Prototype states for direct state shortcuts.
- Open Settings → Account access for registration and sign-in flows. Username `wrong` triggers the generic credential error; `demo.user` triggers the case-insensitive duplicate state during registration.

## Assumptions

- The production name and logo were not supplied. The mock uses “Open Calory Tracker” as text and a simple non-shipping geometric mark on desktop.
- All names, quantities, times, goals, and nutrition values are synthetic mock data and are not health advice or factual product claims.
- The selected visual direction is the familiar category-standard tracker, with Apple Health as the quality reference for native iPhone hierarchy, privacy cues, restrained grouped surfaces, and information clarity.
- The approved composition is `.impeccable/mocks/canon-apple/option-3.webp`; its generated iOS status bar, device frame, and home indicator are not literalized in the website.
- Production APIs, authentication, sessions, SQLite, USDA access, Docker, migrations, persistence, and deployment are outside this artifact and are represented only through deterministic UI states.
- Metric display converts water events, goals, totals, and the specified 8/16/24 fl oz preset identities to milliliters while retaining their authoritative ounce amounts internally.
