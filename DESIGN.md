---
name: Daily Intake
description: A colorful dark field for maintaining a personal nutrition ledger.
colors:
  background: "#0d1120"
  sidebar: "#0f1426"
  surface: "#151b32"
  surface-raised: "#1b2240"
  surface-soft: "#252e4f"
  surface-lead: "#1c1831"
  surface-strip: "#121a31"
  line: "#334266"
  line-strong: "#4d5d88"
  foreground: "#f5f3ff"
  muted: "#b7bed6"
  quiet: "#8b94b8"
  accent: "#d4f65c"
  accent-hover: "#e1ff77"
  accent-ink: "#11150b"
  calories: "#ffcf66"
  protein: "#f38ad2"
  carbs: "#ff9b6e"
  fat: "#ffd36e"
  fiber: "#a78bfa"
  sugar: "#ff8eaa"
  sodium: "#72e0b0"
  water: "#5fe0ed"
  weight: "#ff9f7a"
  target: "#c79bff"
  success: "#71e0a4"
  warning: "#ffd36e"
  danger: "#ff7f9d"
rounded:
  control: "10px"
  field: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  nav-column: "248px"
  page-inline: "clamp(18px, 4.5vw, 72px)"
  panel: "29px"
  panel-mobile: "22px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 17px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 17px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "0"
    padding: "9px 0"
---

# Design System: Daily Intake

## Overview

**Creative North Star: "The Color-Field Ledger"**

Daily Intake is a practical personal record, not a gamified dashboard. Its
night field is built from deep ink-blue surfaces, paper-white type, hairline
rules, and a small set of flat saturated signals. Color is structural: each
nutrition family owns a hue so the eye can scan a day, target, or trend without
decoding a new visual language on every surface.

The system uses tonal layering and line-work rather than decoration. Large
readouts and short labels create a strong operational hierarchy; panels contain
work without looking like glossy cards. The local-only ledger character is
reinforced by a restrained sidebar, compact uppercase annotations, tabular
numbers, and the recurring rule of separating food, water, targets, and weight
into clear records.

**Key Characteristics:**
- Ink-blue night field with paper-white hierarchy.
- Hairline dividers and softly raised panels with flat color fields.
- Citrus actions, cyan water, coral weight, and a deliberate nutrient palette.
- Dense information organized as matrices, strips, lists, and workbenches.
- Simple, manual-first controls with no gamified decoration.

## Colors

The palette is committed rather than monochrome: a deep blue field supports
citrus actions, cyan water, coral weight, lilac targets, and a small set of
nutrient hues. Saturation is reserved for navigation, labels, readouts, and
the top edge of a meaningful work zone; surfaces remain dark and matte.

### Primary
- **Citrus Action** (`{colors.accent}`): Primary actions, active navigation, date labels, selected values, and key positive emphasis.
- **Citrus Hover** (`{colors.accent-hover}`): Hover state for filled primary actions.
- **Water Cyan** (`{colors.water}`): Hydration readouts, water action labels, and water-specific hover states.
- **Weight Coral** (`{colors.weight}`): Weight readings, trend lines, and the record-reading surface.
- **Target Lilac** (`{colors.target}`): Optional target weight and effective target context.

### Nutrition Signals
- **Calorie Gold** (`{colors.calories}`): Calories and the primary daily readout.
- **Protein Pink** (`{colors.protein}`): Protein floor and protein status context.
- **Carb Coral** (`{colors.carbs}`): Carbohydrate ceiling and carbohydrate context.
- **Fiber Lilac** (`{colors.fiber}`): Fiber context.
- **Sugar Rose** (`{colors.sugar}`): Sugar context.
- **Sodium Mint** (`{colors.sodium}`): Sodium context.
- **Fat Gold** (`{colors.fat}`): Derived fat limit context.

### Neutral
- **Ink Field** (`{colors.background}`): Global page background.
- **Sidebar Ink** (`{colors.sidebar}`): Desktop rail and mobile header background.
- **Blue Surface** (`{colors.surface}`): Main panels and controls.
- **Raised Blue** (`{colors.surface-raised}`): Nested controls, selected products, and settings links.
- **Soft Blue** (`{colors.surface-soft}`): Hover surfaces and subtle navigation emphasis.
- **Lead Ink** (`{colors.surface-lead}`): The prominent calorie total block.
- **Strip Ink** (`{colors.surface-strip}`): Target strip and chart field.
- **Hairline** (`{colors.line}`): Default panel, list, and grid rules.
- **Strong Hairline** (`{colors.line-strong}`): Control borders, date controls, and structural separators.
- **Paper White** (`{colors.foreground}`): Main text, headings, values, and primary control text.
- **Muted Text** (`{colors.muted}`): Supporting copy and secondary labels.
- **Quiet Text** (`{colors.quiet}`): Metadata, annotations, units, and low-emphasis labels.
- **Citrus Ink** (`{colors.accent-ink}`): Text on filled citrus controls.

**The Role Color Rule.** Use color to identify a real record family or action:
citrus acts, cyan hydrates, coral weighs, lilac marks targets, and nutrient
signals stay attached to their named metric. Do not add color as decoration or
use status color as a substitute for status wording.

## Typography

**Display Font:** Geist, with Arial, Helvetica, sans-serif fallbacks.

**Body Font:** Geist, with Arial, Helvetica, sans-serif fallbacks.

**Label/Mono Font:** No separate mono face is shipped. Numeric values use
`font-variant-numeric: tabular-nums` so ledger columns align.

**Character:** Geist is clean, compact, and contemporary. Tight tracking and
heavy display weights make the large values feel like a modern instrument,
while hue-led labels give dense data a memorable visual index.

### Hierarchy
- **Display** (720, `clamp(3rem, 6vw, 5.8rem)`, `0.91`): Page titles such as Daily Log, Targets, and Weight; tracking `-0.07em`.
- **Readout** (680, `clamp(3.9rem, 7vw, 6.2rem)`, `0.84`): The daily calorie total; tracking `-0.08em`, tabular numerals.
- **Headline** (680, `1.42rem` to `1.45rem`, normal): Panel headings and record titles; tracking `-0.045em`.
- **Body** (400 default, `0.8rem` to `0.91rem`, `1.55` to `1.65`): Explanatory copy, capped around 32ch to 60ch where the source defines a measure.
- **Label** (650 to 820, `0.58rem` to `0.76rem`, uppercase with `0.04em` to `0.12em` tracking): Field labels, navigation, statuses, units, and metadata.

**The Instrument Numbers Rule.** Nutrition, water, weight, and target values
use tabular numerals and remain visually stronger than their units or labels.

## Layout

Desktop uses a full-bleed frame with a fixed `248px` navigation rail and a
flexible content column. The rail is sticky and full viewport height; the
content column is allowed to shrink with `min-width: 0` so panels do not force
horizontal overflow. The rail anchors to the viewport edge rather than
floating inside a centered max-width frame.

Page surfaces are centered within route-specific measures: the Daily Log is
`1160px`, Food Database is `1180px`, and Settings is `1080px`. Pages use
`52px clamp(18px, 4.5vw, 72px)` padding on larger screens and `34px 16px 58px`
on mobile, with `84px` desktop bottom breathing room.

The Daily Log leads with a date-aware header, a two-column color-field summary
board, a six-cell target strip, a three-part water board, and a food log. The
Food Database uses a catalog/workbench split (`1.12fr` / `0.88fr`) that stacks
below `900px`. Targets use colored threshold fields; Weight places its two
entry controls beside each other on desktop and keeps the chart full-width.
Grid fields move from three columns to two and then one as width narrows.

At `max-width: 760px`, the desktop rail disappears and the header becomes a
compact mobile header with the Daily Intake wordmark, "Personal ledger" tag,
and a four-column navigation bar: Daily Log, Foods, Targets, Weight. The mobile
bar keeps the same citrus active state and ink-blue hover treatment. Headers
stack, panels reduce to `22px` padding, primary actions become full width where
useful, list rows wrap, water actions become one column at `480px`, and form
grids collapse to one column at the narrowest width.

## Elevation & Depth

Depth is a restrained hybrid of tonal layering and ambient shadows. Surfaces
are primarily distinguished by dark color steps and hairline boundaries, not
by floating chrome. Main panels use `var(--shadow-panel)`; date controls use
`var(--shadow-date)`. Shadows should remain soft and subordinate to the ink
field.

**The Quiet Depth Rule.** A surface earns depth through one tonal step or one
ambient shadow, never through stacked effects, gradients, or ornamental glow.

## Shapes

The form language is gently rounded but disciplined: controls use `10px`,
nested fields use `12px`, major panels use `16px`, and status chips are fully
rounded pills (`999px`). Panels have a `1px` hairline border and clip their
internal grids or strips when needed. Text inputs are deliberately flatter:
transparent backgrounds, no side border, and a single bottom rule that turns
citrus or the field role color on focus.

## Components

### Buttons
- **Character:** Small, confident, and action-oriented rather than glossy.
- **Primary:** Citrus fill with dark ink, `44px` minimum height, `0 17px` padding, `10px` radius, and heavy (`820`) type. Hover changes to citrus hover and lifts `1px`.
- **Secondary:** Transparent blue control with a strong hairline border, `44px` minimum height, and `0 17px` padding. Hover uses target lilac or citrus depending on the workflow.
- **Text action:** Transparent, muted, underlined text with `5px 0` padding. Hover changes to citrus; used for Edit, Retire, Back, and small form actions.
- **Focus / disabled:** All interactive controls use the global visible citrus focus ring. Disabled or saving controls reduce opacity and use a wait cursor; they do not change the layout.

### Status Chips
- **Style:** Compact uppercase pill with `3px 7px` padding, `1px solid currentColor`, and quiet text by default.
- **State:** Within-limit and met use success; exceeded uses danger; below-target uses warning. Status wording describes configured limits and minimums, never medical judgment.

### Cards / Containers
- **Corner Style:** `16px` for route panels; `12px` for nested controls and selected records.
- **Background:** Blue surface, raised blue for nested work, and lead/strip ink for signature zones.
- **Border:** `1px solid var(--line)` by default, with strong hairline for controls and structural edges.
- **Internal Padding:** `29px` on desktop panels, `22px` on mobile; compact cells use `12px` to `20px`.
- **Signature patterns:** The Daily Log summary board pairs one gold total with six color-led nutrient cells; the Food Database pairs a saved-product catalog with a review workbench; Targets use a color-field form and Weight uses a two-control row above its trend line.

### Inputs / Fields
- **Style:** Associated labels are small, uppercase, tracked, and muted. Target fields use dark role-colored surfaces; inputs remain transparent with a bottom rule, paper-white text, and tabular numerals.
- **Focus:** The bottom rule becomes the field's role color with a `0 2px 0 var(--tone)` underline treatment; the global `2px` citrus outline with `3px` offset remains the keyboard fallback.
- **Error / feedback:** Errors use danger and `role="alert"`; loading, confirmation, and other status changes use `role="status"` or `aria-live="polite"` where the shipped UI requires it.

### Navigation
- **Desktop:** Sticky `248px` sidebar with wordmark, three-bar mark in citrus/pink/cyan, a quiet caption, primary links, and a Settings group separated by a hairline. Links are compact (`0.78rem`, `650`) with `9px` radius.
- **States:** Default links are muted; hover and focus use foreground text on soft blue; active links use citrus on a dark selected surface and expose `aria-current="page"`.
- **Mobile:** Below `760px`, hide the sidebar and use the full-width mobile header plus a four-column navigation bar. The mobile links use compact centered labels, the same active/hover grammar, and an explicit `aria-label="Mobile navigation"`.

## Do's and Don'ts

### Do:
- **Do** preserve the Color-Field Ledger direction: ink-blue surfaces, paper-white type, hairline rules, citrus actions, and purposeful role colors.
- **Do** use the actual role palette and keep each hue attached to a real record family or action.
- **Do** keep nutrition, water, weight, and target values aligned with tabular numerals.
- **Do** keep labels associated with fields and retain visible keyboard focus states.
- **Do** expose loading and save/error feedback through the shipped status and alert semantics.
- **Do** respect `prefers-reduced-motion: reduce` by removing transitions and scroll animation.
- **Do** preserve the desktop rail/mobile four-item navigation topology and the no-horizontal-overflow behavior.

### Don't:
- **Don't** turn the ledger into a gamified dashboard with badges, progress theatrics, confetti, or motivational reward language.
- **Don't** introduce gradients, neon glow, glassmorphism, decorative illustrations, or glossy card chrome.
- **Don't** use citrus as a general background, or water/status colors for unrelated actions.
- **Don't** replace hairline rules and bottom-rule fields with thick outlines, filled form controls, or pill-shaped everything.
- **Don't** hide focus, rely on color alone for status, or remove the associated label and live-region grammar.
- **Don't** add horizontal scrolling to ordinary page content; only intentionally wide chart content may scroll inside its chart container.
- **Don't** make status copy medical, prescriptive, or judgmental; describe the configured ledger relationship instead.
