---
name: Calories UI Mock
description: A precise, calm food log built like a local desk instrument.
colors:
  canvas: "#0b1020"
  canvas-soft: "#101728"
  surface: "#151c2d"
  surface-raised: "#1e2840"
  surface-bright: "#283650"
  line: "#2c3954"
  line-strong: "#465a7a"
  text: "#eef0ff"
  text-soft: "#cbd2e3"
  muted: "#9aa4bb"
  faint: "#77839c"
  accent: "#b8a3ff"
  accent-strong: "#d4c8ff"
  accent-ink: "#171129"
  blue: "#83b9ee"
  purple: "#c7a8f2"
  orange: "#e8a66d"
  teal: "#71d6c1"
  pink: "#ed8fae"
  amber: "#f4bf68"
  danger: "#f47f78"
typography:
  display:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(42px, 5vw, 64px)"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.08em"
  headline:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.4vw, 34px)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.12em"
rounded:
  sm: "7px"
  md: "12px"
  lg: "18px"
spacing:
  xs: "5px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "40px"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "42px"
---

# Design System: Calories UI Mock

## Overview

**Creative North Star: "The Local Food Log Instrument"**

Calories treats the current day as a work surface rather than a dashboard. The interface is a quiet, precise instrument for recording food, reading data quality, and choosing what to trust. Its visual language uses deep ink tonal layers, blue-steel hairline borders, measured numerals, and a rare ultraviolet commit action.

The product stays calm without becoming soft or generic. The rail, readout deck, chronological feed, and review drawer share the same disciplined grammar. Uncertainty is named in place; the visual system never turns nutrition into a score or hides missing data behind polish.

**Key Characteristics:**
- Deep ink canvas with layered navy surfaces.
- Ultraviolet actions and muted nutrient role colors.
- DM Sans for interface reading; IBM Plex Mono for measurements and labels.
- Hairline borders and tonal layering instead of shadows.
- Compact, authored SVG icons with a five-destination mobile rail and centered Add Food action.

## Colors

The palette is a deep ink instrument panel with a cool-white readout, one high-value ultraviolet commit color, and restrained status colors.

### Primary
- **Ultraviolet commit** (`#b8a3ff`): Primary actions, active navigation, confirmed progress, and the most important positive state.
- **Ultraviolet highlight** (`#d4c8ff`): Hover and high-emphasis action state only.

### Secondary
- **Readout blue** (`#83b9ee`): Protein and cool informational measurements.
- **Readout purple** (`#c7a8f2`): Carbohydrate and total-sugar measurements.
- **Readout orange** (`#e8a66d`): Fat measurements.
- **Readout teal** (`#71d6c1`): Fiber measurements.
- **Readout pink** (`#ed8fae`): Added-sugar measurements.

### Tertiary
- **Amber caution** (`#f4bf68`): Missing data, upper references, and review-required states.
- **Soft danger** (`#f47f78`): Errors and exceeded upper references only.

### Neutral
- **Night canvas** (`#0b1020`): The full-page ground.
- **Canvas soft** (`#101728`): Inputs and secondary structural fields.
- **Instrument surface** (`#151c2d`): Main panels and readout containers.
- **Raised surface** (`#1e2840`): Drawers, dialogs, and active control groups.
- **Bright surface** (`#283650`): Hovered controls and focused tonal lift.
- **Hairline / strong line** (`#2c3954` / `#465a7a`): Dividers, borders, and focus-adjacent structure.
- **Text / soft text** (`#eef0ff` / `#cbd2e3`): Primary and secondary reading levels.
- **Muted / faint text** (`#9aa4bb` / `#77839c`): Supporting copy, metadata, and quiet labels.

**The Rare Accent Rule.** Ultraviolet is a commit signal, not decoration. Use it for actions, active state, and confirmed progress; do not scatter it across every label.

## Typography

**Display Font:** DM Sans (with system sans fallbacks)
**Body Font:** DM Sans (with system sans fallbacks)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace fallbacks)

**Character:** DM Sans keeps the interface legible and human at operational density. IBM Plex Mono appears only where the interface is reporting a measurement, timestamp, unit, or system label.

### Hierarchy
- **Display** (500, `clamp(42px, 5vw, 64px)`, `.9`): Calorie and Meal totals; tabular, measured emphasis.
- **Headline** (600, `clamp(24px, 2.4vw, 34px)`, `1.05`): Workspace page titles.
- **Title** (600, `18px`, `1.15`): Panel and section headings.
- **Body** (400, `15px`, `1.45`): Explanatory copy and everyday interface text.
- **Label** (600, `10px`, `1.4`, `0.12em`, uppercase): Navigation context, state labels, and structural metadata.

**The Measurement Rule.** Mono is for data and orientation, never for decorative "technical" flavor.

## Layout

The desktop shell uses a sticky `242px` navigation rail and a fluid workspace constrained to `1380px`. The workspace combines an asymmetrical calorie instrument with a larger nutrient deck, then resolves into a single newest-first feed. Secondary surfaces use side panels or drawers rather than replacing the active context.

At `1180px`, the summary becomes a single column to prevent dense readouts from collapsing. At `900px`, the rail becomes a compact mobile header and a five-column fixed bottom navigation with Log, Food Database, Add Food, Saved Foods, and Daily Targets. At `620px`, controls stack, feed rows become four-column touch layouts, and drawers become bottom sheets. The rhythm is built from 8–24px intervals with larger separation between major instruments.

## Elevation & Depth

This system is flat by default. There are no decorative shadows or gradients. Depth comes from tonal layering between the canvas, instrument surface, raised surface, and bright hover surface, reinforced by hairline borders. Dialogs and drawers use an opaque raised surface so content remains legible under interruption.

**The Flat Instrument Rule.** A surface earns depth by changing tone or state, not by floating on a generic shadow.

## Shapes

Controls use compact 7px corners; primary panels use 12px corners; full-width mobile sheets use 18px top corners. Borders are 1px and quiet. Progress tracks and status dots may be fully rounded because they represent continuous measurement; content containers remain gently squared and tactile.

## Components

### Buttons
- **Shape:** Compact, gently squared corners (`7px`) with a 40px default height; mobile controls expand to touch-safe sizes.
- **Primary:** Ultraviolet fill with dark ink; reserved for commit actions such as `Add Food`, `Add to Log`, and `Save Meal`.
- **Hover / Focus:** Primary lightens to the highlight ultraviolet; all controls use a 2px ultraviolet focus outline with 3px offset.
- **Secondary / Ghost:** Raised tonal surface for secondary decisions; text buttons remain transparent and use ultraviolet text for direct, low-weight actions.

### Chips
- **Style:** Small mono uppercase labels with a 1px contextual border; source and uncertainty remain readable without color alone.
- **State:** Saved, manual, candidate, target, and reference states use distinct role colors while preserving their text labels.

### Cards / Containers
- **Corner Style:** 12px for instruments, 18px for dialogs and mobile sheets.
- **Background:** Canvas, instrument, raised, and bright surfaces form the depth hierarchy.
- **Shadow Strategy:** No shadows at rest; tonal contrast and borders carry structure.
- **Border:** 1px hairline by default, stronger only for focus, active, or safety states.
- **Internal Padding:** 17–25px for panels; list rows use dividers and vertical rhythm rather than nested cards.

### Inputs / Fields
- **Style:** 42px search fields and 43px form fields use the instrument surface, a 1px strong line, and 7px corners.
- **Focus:** Border shifts to the blue-steel focus color with the shared visible outline.
- **Error / Disabled:** Errors use soft danger on a dark red-brown surface; disabled controls reduce opacity without hiding their labels.

### Navigation
- **Style:** Rail items are 44px high with icon, label, and optional mono key. Active navigation uses a raised tonal row and ultraviolet icon.
- **Mobile:** Log, Food Database, Saved Foods, and the Daily Targets utility remain reachable in a fixed bottom bar with a centered Add Food action. Scan Food is entered through the source selector, not promoted to another destination.

### Shared Review Drawer
The signature component is a right-side desktop drawer and near-full-height mobile sheet. It makes source, uncertainty, quantity basis, nutrition, and explicit commit actions visible in one place. It must work for Database, Barcode, Food Label, Scan Food, Saved Foods, and historical-entry editing.

## Do's and Don'ts

### Do:
- **Do** keep the current day and the next action visible in the first viewport.
- **Do** keep source, quantity basis, units, and missing values adjacent to the data they qualify.
- **Do** use the same review grammar across every Food source.
- **Do** preserve 44px touch targets on mobile and visible keyboard focus everywhere.
- **Do** let neutral language carry nutrition status alongside color.

### Don't:
- **Don't** use gradients, glossy glass, decorative shadows, or gamified score language.
- **Don't** turn the primary accent into a background texture or use it on every control.
- **Don't** use color as the only indicator of uncertainty, range, or error.
- **Don't** split the chronological Daily log into meal sections.
- **Don't** make a candidate, AI proposal, or external record look confirmed before review.
