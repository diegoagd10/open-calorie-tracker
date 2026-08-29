---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Food Log mock surface brief

## Scope and mode

- Primary target: `index.html`
- Mode: Operate
- Mobile-first responsive web mock for the full day-one account, setup, logging, history, and settings experience.

## Audience, job, and constraints

- Primary audience: an iPhone owner privately tracking nutrition and water on a self-hosted website.
- Primary job: understand today at a glance, then log or correct a food or water event with minimal friction.
- Primary actions: Add Food and Add Water; secondary actions include date navigation, entry correction, history, and goal changes.
- Constraints: English UI, USDA names preserved, WCAG 2.2 AA, neutral progress, no gamification, no images, no offline promise, and all demonstration content labeled mock data.

## Chosen direction

- Direction: category-standard nutrition tracker, intentionally familiar, with Apple Health as the craft reference for native iPhone hierarchy, privacy cues, restrained surfaces, typography, and information clarity.
- Approved comp: `.impeccable/mocks/canon-apple/option-3.webp`.
- Composition: compact daily summary first; horizontally paging nutrient group; chronological Food Entries and Water Events as the dominant canvas; thumb-reachable water sheet and bottom navigation.
- Memorable moment: adding water lifts a compact bottom sheet over the timeline without losing the selected day or totals.
- Do not literalize the generated iOS status bar or device home indicator; this remains a responsive website, not a screenshot of a native app.

## Sampled visual system

- Page ground: `#FAFBFD`
- Primary ink: `#0A0E1A`
- Action green: `#4DA64A`
- Water blue: `#3377D9`
- Secondary ink: `#4F5461`
- Muted ink: `#979BA3`
- Cool rule/track: `#A9C6CA` at reduced opacity
- Type: system humanist sans (`-apple-system`, BlinkMacSystemFont, `Segoe UI`, sans-serif) with tabular numerals.
- Corner language: 16–22px grouped surfaces; fully round event markers and compact action buttons; no decorative pill fields.
- Lines/elevation: crisp 1px cool separators; minimal two-layer ambient shadow only on summary and overlays.

## Fidelity inventory

| Ingredient | Comp commitment | Medium |
| --- | --- | --- |
| Top identity row | Today title and Private cue; account access lives inside Settings | Semantic HTML + inline SVG |
| Nearby date rail | Seven compact dates, selected Saturday, past/future rules | HTML buttons + CSS grid |
| Calorie summary | Compact ring beside exact current/goal values | Accessible HTML progress + inline SVG circle |
| Nutrient page one | Protein, carbohydrate, and fat in one horizontal group | HTML + CSS grid |
| Nutrient page two | Fiber, sugar, and sodium with incomplete state | HTML + CSS grid |
| Chronological log | Food and water events aligned to exact times and one vertical rail | Semantic list + CSS + inline SVG icons |
| Food entry detail | Source, immutable snapshot language, edit/delete controls | Dialog surface + HTML form |
| Water sheet | 8/16/24 fl oz presets plus exact custom amount | Native dialog + HTML buttons/form |
| Add Food flow | Deliberate search, typed USDA states, result and measurement selection | Layered dialogs + local fixtures |
| Account and setup | Register, sign in, validation, units, goals, success | Routed mock panels + semantic forms |
| History and settings | Calendar/past day, effective-dated goals, password/logout | Routed mock panels + semantic forms |
| Bottom navigation | Log, History, Settings; current destination explicit | HTML navigation + inline SVG |
| Responsive desktop | Phone-like daily canvas plus supportive context rail, no horizontal overflow | CSS media queries |
| Raster imagery | None required; product explicitly excludes food and profile photography | Accepted absence |

## States represented

- Registration and sign-in validation, generic invalid credentials, and success.
- First-run unit and goal setup.
- Today populated, past day populated, past day empty, and future day write-disabled.
- Nutrition page one/page two, provider-missing nutrient marked incomplete, and explicit zero.
- Add Food search idle, too-short query, results, no results, provider unavailable/rate-limited, unsafe measurement, quantity selection, and saved success.
- Food Entry edit, quantity recalculation preview, and delete confirmation.
- Water presets, custom amount validation, edit, delete confirmation, and saved success.
- Goal update with effective date; password change success; logout.

## Unresolved decisions

- Production branding and logo are not supplied; the mock uses the product name as text only.
