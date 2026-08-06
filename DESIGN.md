---
name: Daily Intake
description: A calm dark field instrument for maintaining a personal nutrition ledger.
colors:
  background: "#0b0d0f"
  sidebar: "#0e1113"
  surface: "#121619"
  surface-raised: "#181d21"
  surface-soft: "#1c2227"
  surface-lead: "#171c20"
  surface-strip: "#0f1316"
  line: "#2b333a"
  line-strong: "#3a444c"
  foreground: "#eff1ed"
  muted: "#a1aab1"
  quiet: "#78838b"
  accent: "#e2a36a"
  accent-hover: "#efb77f"
  water: "#79b7bd"
  success: "#93bda0"
  warning: "#d8b177"
  danger: "#e18b86"
  accent-ink: "#19130d"
  selection-ink: "#13100d"
rounded:
  control: "9px"
  field: "10px"
  panel: "14px"
  pill: "999px"
spacing:
  nav-column: "248px"
  page-inline: "clamp(18px, 4.5vw, 72px)"
  panel: "28px"
  panel-mobile: "22px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: "43px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "41px"
    padding: "0 14px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "0"
    padding: "9px 0"
---

# Design System: Daily Intake

## Overview

**Creative North Star: "The Night Field Ledger"**

Daily Intake is a calm field instrument, not a gamified dashboard. Its night
field is built from graphite surfaces, paper-white type, hairline rules, and
small areas of amber and cool water color. The visual language is quiet,
measured, and operational: it lets the day, its thresholds, and the next
precise entry stay legible without spectacle.

The system uses tonal layering rather than decoration. Large readouts and
short labels create a field-notebook hierarchy; panels contain work without
looking like glossy cards. The local-only ledger character is reinforced by
the restrained sidebar, small uppercase annotations, tabular numbers, and
the recurring rule of separating food, water, targets, and weight into clear
records.

**Key Characteristics:**
- Graphite night field with paper-white hierarchy.
- Hairline dividers and restrained, softly raised panels.
- Amber is the action voice; cool water is the hydration signal.
- Dense information is organized as matrices, strips, lists, and workbenches.
- Calm, manual-first controls with no gamified decoration.

## Colors

The palette is nearly monochrome: warm amber carries action and attention,
cool teal carries water, and muted semantic colors describe ledger status.

### Primary
- **Field Amber** (`{colors.accent}`): Primary actions, active navigation, date labels, selected values, and key positive emphasis.
- **Amber Hover** (`{colors.accent-hover}`): Hover state for filled primary actions.
- **Water Signal** (`{colors.water}`): Hydration readouts, water action labels, and water-specific hover states.

### Secondary
- **Ledger Success** (`{colors.success}`): Met limits, successful saves, and confirmed states.
- **Ledger Warning** (`{colors.warning}`): Below-target states and attention that is not an error.
- **Ledger Danger** (`{colors.danger}`): Exceeded limits, validation errors, and alerts.

### Neutral
- **Night Field** (`{colors.background}`): Global page background.
- **Sidebar Graphite** (`{colors.sidebar}`): Desktop rail and mobile header background.
- **Graphite Surface** (`{colors.surface}`): Main panels and controls.
- **Raised Graphite** (`{colors.surface-raised}`): Nested controls, selected products, and settings links.
- **Soft Graphite** (`{colors.surface-soft}`): Hover surfaces and subtle navigation emphasis.
- **Lead Graphite** (`{colors.surface-lead}`): The prominent calorie total block.
- **Strip Graphite** (`{colors.surface-strip}`): Target strip and chart field.
- **Hairline** (`{colors.line}`): Default panel, list, and grid rules.
- **Strong Hairline** (`{colors.line-strong}`): Control borders, date controls, and structural separators.
- **Paper White** (`{colors.foreground}`): Main text, headings, values, and primary control text.
- **Muted Text** (`{colors.muted}`): Supporting copy and secondary labels.
- **Quiet Text** (`{colors.quiet}`): Metadata, annotations, units, and low-emphasis labels.
- **Amber Ink** (`{colors.accent-ink}`): Text on filled amber controls.
- **Selection Ink** (`{colors.selection-ink}`): Text selected against amber.

**The One Signal Rule.** Use amber for action and current focus, teal only for
water, and semantic colors only for status. Do not use the accent palette as
general decoration.

## Typography

**Display Font:** Geist, with Arial, Helvetica, sans-serif fallbacks.

**Body Font:** Geist, with Arial, Helvetica, sans-serif fallbacks.

**Label/Mono Font:** No separate mono face is shipped. Numeric values use
`font-variant-numeric: tabular-nums` so ledger columns align.

**Character:** Geist is clean, compact, and contemporary. Tight tracking and
heavy display weights make the large values feel instrument-like, while muted
body copy keeps the interface calm.

### Hierarchy
- **Display** (680, `clamp(2.7rem, 5.5vw, 5rem)`, `0.94`): Page titles such as Daily Log, Food Database, and Settings; tracking `-0.065em`.
- **Readout** (650, `clamp(3.6rem, 7vw, 5.9rem)`, `0.86`): The daily calorie total; tracking `-0.075em`, tabular numerals.
- **Headline** (650, `1.42rem` to `1.45rem`, normal): Panel headings and record titles; tracking `-0.045em`.
- **Body** (400 default, `0.8rem` to `0.91rem`, `1.55` to `1.65`): Explanatory copy, capped around 32ch to 60ch where the source defines a measure.
- **Label** (650 to 800, `0.58rem` to `0.76rem`, uppercase with `0.04em` to `0.12em` tracking): Field labels, navigation, statuses, units, and metadata.

**The Instrument Numbers Rule.** Nutrition, water, weight, and target values
use tabular numerals and remain visually stronger than their units or labels.

## Layout

Desktop uses a centered frame capped at `1560px`, with a fixed `248px`
navigation rail and a flexible content column. The rail is sticky and full
viewport height; the content column is allowed to shrink with `min-width: 0`
so panels do not force horizontal overflow.

Page surfaces are centered within route-specific measures: the Daily Log is
`1160px`, Food Database is `1180px`, and Settings is `1040px`. Pages use
`48px clamp(18px, 4.5vw, 72px)` padding on larger screens and `34px 16px 58px`
on mobile, with `80px` desktop bottom breathing room.

The Daily Log leads with a date-aware header, a two-column summary board, a
six-cell target strip, a three-part water board, and a food log. The Food
Database uses a catalog/workbench split (`1.12fr` / `0.88fr`) that stacks below
`900px`. Settings uses stacked panels and explicit form sections. Grid fields
usually move from three columns to two and then one as width narrows.

At `max-width: 760px`, the desktop rail disappears and the header becomes a
compact mobile header with the Daily Intake wordmark, “Personal ledger” tag,
and a four-column navigation bar: Daily Log, Foods, Targets, Weight. The
mobile bar keeps the same amber active state and graphite hover treatment.
Headers stack, panels reduce to `22px` padding, primary actions become full
width where useful, list rows wrap, water actions become one column at
`480px`, and form grids collapse to one column at the narrowest width.

## Elevation & Depth

Depth is a restrained hybrid of tonal layering and ambient shadows. Surfaces
are primarily distinguished by background steps and hairline boundaries, not
by floating chrome. Main panels use `0 22px 48px rgba(0, 0, 0, 0.14)`; date
controls use `0 16px 34px rgba(0, 0, 0, 0.18)`. Shadows should remain soft and
subordinate to the graphite layers.

**The Quiet Depth Rule.** A surface earns depth through one tonal step or one
ambient shadow, never through stacked effects, gradients, or ornamental glow.

## Shapes

The form language is gently rounded but disciplined: controls use `9px`,
nested fields use `10px`, major panels use `14px`, and status chips are fully
rounded pills (`999px`). Panels have a `1px` hairline border and clip their
internal grids or strips when needed. Text inputs are deliberately flatter:
transparent backgrounds, no side border, and a single bottom rule that turns
amber on focus.

## Components

### Buttons
- **Character:** Small, confident, and action-oriented rather than glossy.
- **Primary:** Amber fill with dark ink, `43px` minimum height, `0 16px` padding, `9px` radius, and heavy (`800`) type. Hover changes to amber hover and lifts `1px`.
- **Secondary:** Transparent graphite control with a strong hairline border, paper-white text, `41px` minimum height, and `0 14px` padding. Hover uses amber border and a warm graphite surface.
- **Text action:** Transparent, muted, underlined text with `5px 0` padding. Hover changes to amber; used for Edit, Retire, Back, and small form actions.
- **Focus / disabled:** All interactive controls use the global visible amber focus ring. Disabled or saving controls reduce opacity and use a wait cursor; they do not change the layout.

### Status Chips
- **Style:** Compact uppercase pill with `3px 7px` padding, `1px solid currentColor`, and quiet text by default.
- **State:** Within-limit and met use success; exceeded uses danger; below-target uses warning. Status wording describes configured limits and minimums, never medical judgment.

### Cards / Containers
- **Corner Style:** `14px` for route panels; `10px` for nested controls and selected records.
- **Background:** Graphite surface, raised graphite for nested work, and lead/strip graphite for signature zones.
- **Border:** `1px solid var(--line)` by default, with strong hairline for controls and structural edges.
- **Internal Padding:** `28px` on desktop panels, `22px` on mobile; compact cells use `12px` to `20px`.
- **Signature patterns:** The Daily Log summary board pairs one oversized total with a six-cell nutrient matrix; the Food Database pairs a saved-product catalog with a review workbench; Settings uses stacked record panels.

### Inputs / Fields
- **Style:** Associated labels are small, uppercase, tracked, and quiet/muted. Inputs are transparent with a bottom rule, paper-white text, and tabular numerals for dates and measurements.
- **Focus:** The bottom rule becomes amber with a `0 2px 0 var(--accent)` underline treatment; the global `2px` amber outline with `3px` offset remains the keyboard fallback.
- **Error / feedback:** Errors use danger and `role="alert"`; loading, confirmation, and other status changes use `role="status"` or `aria-live="polite"` where the shipped UI requires it.

### Navigation
- **Desktop:** Sticky `248px` sidebar with wordmark, three-bar mark in amber/white/teal, a quiet caption, primary links, and a Settings group separated by a hairline. Links are compact (`0.78rem`, `650`) with `9px` radius.
- **States:** Default links are muted; hover and focus use foreground text on soft graphite; active links use amber on a dark selected surface and expose `aria-current="page"`.
- **Mobile:** Below `760px`, hide the sidebar and use the full-width mobile header plus a four-column navigation bar. The mobile links use compact centered labels, the same active/hover grammar, and an explicit `aria-label="Mobile navigation"`.

## Do's and Don'ts

### Do:
- **Do** preserve the calm field instrument direction: graphite surfaces, paper-white type, hairline rules, amber actions, and cool water signal.
- **Do** use the actual semantic palette and keep accent colors sparse and purposeful.
- **Do** keep nutrition, water, weight, and target values aligned with tabular numerals.
- **Do** keep labels associated with fields and retain visible keyboard focus states.
- **Do** expose loading and save/error feedback through the shipped status and alert semantics.
- **Do** respect `prefers-reduced-motion: reduce` by removing transitions and scroll animation.
- **Do** preserve the desktop rail/mobile four-item navigation topology and the no-horizontal-overflow behavior.

### Don't:
- **Don't** turn the ledger into a gamified dashboard with badges, progress theatrics, confetti, or motivational reward language.
- **Don't** introduce bright gradients, neon colors, glassmorphism, decorative illustrations, or glossy card chrome.
- **Don't** use amber as a general background, or teal/status colors for unrelated actions.
- **Don't** replace hairline rules and bottom-rule fields with thick outlines, filled form controls, or pill-shaped everything.
- **Don't** hide focus, rely on color alone for status, or remove the associated label and live-region grammar.
- **Don't** add horizontal scrolling to ordinary page content; only intentionally wide chart content may scroll inside its chart container.
- **Don't** make status copy medical, prescriptive, or judgmental; describe the configured ledger relationship instead.
