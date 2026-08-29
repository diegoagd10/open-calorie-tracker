---
name: Open Calory Tracker
description: A private, chronological daily ledger for food, nutrition, and water.
colors:
  ground: "#fafbfd"
  surface: "#ffffff"
  surface-soft: "#f3f6f8"
  ink: "#0a0e1a"
  ink-secondary: "#4f5461"
  muted: "#626a78"
  rule: "#d9dee6"
  rule-strong: "#c6ccd6"
  action-green: "#197727"
  action-green-dark: "#125f1e"
  action-green-soft: "#e8f5e9"
  water-blue: "#1558a7"
  water-blue-dark: "#0d477f"
  water-blue-soft: "#eaf3ff"
  caution-amber: "#c77a00"
  caution-amber-soft: "#fff4dc"
  destructive-red: "#c43b3b"
  destructive-red-soft: "#fff0f0"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2rem, 7vw, 3rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.85rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  action:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "normal"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  sm: "10px"
  surface: "16px"
  overlay: "22px"
  full: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2.25rem"
components:
  button-primary:
    backgroundColor: "{colors.action-green-dark}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.sm}"
    padding: "0.62rem 1rem"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.action}"
    rounded: "{rounded.sm}"
    padding: "0.62rem 1rem"
    height: "44px"
  button-water:
    backgroundColor: "{colors.water-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.sm}"
    padding: "0.62rem 1rem"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "9px"
    padding: "0.65rem 0.7rem"
    height: "44px"
  chip-info:
    backgroundColor: "{colors.water-blue-soft}"
    textColor: "{colors.water-blue-dark}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "0.3rem 0.55rem"
    height: "28px"
  card-summary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "1.15rem 1rem 1rem"
---

# Design System: Open Calory Tracker

## Overview

**Creative North Star: "The Private Day Ledger"**

Open Calory Tracker should feel like a precise personal record that happens to be effortless to use on an iPhone. Its visual world borrows Apple Health's restraint and information craft—cool grouped surfaces, strong native typography, explicit privacy cues, and controls that feel immediately familiar—while keeping the chronological day, not an abstract wellness dashboard, at the center.

The system is calm, cool, and factual. Dark slate type carries the information hierarchy; green is reserved for food and primary logging actions; blue identifies water and informational navigation. Progress is descriptive rather than celebratory, incomplete data remains visibly incomplete, and destructive or caution colors communicate state without moralizing.

**Key Characteristics:**

- Chronological daily records are the dominant visual material.
- Cool near-white grounds support crisp white grouped surfaces.
- System typography and tabular numerals create native clarity.
- Green and blue are semantic action colors, not decoration.
- Rounded, touch-sized controls remain restrained and utility-led.

## Colors

The palette is a cool neutral ledger with two disciplined semantic voices: food/action green and water/information blue.

### Primary

- **Action Green:** Marks Add Food, calorie progress, selected dates, the current destination, and affirmative save actions.
- **Deep Action Green:** Carries high-contrast primary buttons and action text where a quieter, denser green is needed.
- **Soft Action Green:** Tints selected controls, food markers, and privacy-supporting notices without implying celebration.

### Secondary

- **Water Blue:** Identifies water actions, nutrient progress, and keyboard focus.
- **Deep Water Blue:** Supports links and informational text that must remain legible on pale surfaces.
- **Soft Water Blue:** Tints water selections, catalog labels, and mock-data chips.

### Tertiary

- **Caution Amber:** Marks incomplete or constrained provider data.
- **Destructive Red:** Is reserved for validation failures, destructive actions, and their confirmations.

### Neutral

- **Cool Ground:** The app canvas and mobile safe-area ground.
- **Clean Surface:** Grouped cards, event rows, fields, dialogs, and sheets.
- **Soft Surface:** Hover, inset, segmented-control, and secondary-control fills.
- **Slate Ink:** Primary text and decisive numeric values.
- **Secondary Slate:** Supporting copy and inactive controls.
- **Muted Slate:** Metadata, captions, provider notes, and unavailable detail.
- **Cool Rule / Strong Cool Rule:** One-pixel grouping, field, and timeline boundaries.

### Named Rules

**The Two Voices Rule.** Green belongs to food and affirmative logging; blue belongs to water, information, and focus. Never swap them for variety.

**The Neutral Progress Rule.** Progress communicates amount and completeness; exceeding a goal does not trigger alarm, praise, or gamified color.

## Typography

**Display Font:** System humanist sans with native Apple, Windows, and common web fallbacks  
**Body Font:** The same system humanist sans stack  
**Numeric Treatment:** Tabular numerals for times, quantities, totals, goals, and calendar dates

**Character:** The single-family system stack is familiar, compact, and highly legible. Hierarchy comes from size, weight, density, and muted metadata—not ornamental type or excessive casing.

### Hierarchy

- **Display:** Bold, tightly tracked, single-line page identity for Today.
- **Headline:** Bold view titles for History and Settings.
- **Title:** Strong dialog and section titles with compact line height.
- **Body:** Neutral reading text and form controls; supporting paragraphs stay near 36–50 characters where the layout allows.
- **Label:** Bold, compact control and field labels; uppercase is limited to tiny privacy or date metadata.
- **Action:** Extra-bold, compact button text for decisive 44px controls.
- **Caption:** Muted provider, unit, provenance, and state detail.

### Named Rules

**The Exact Number Rule.** Use tabular numerals anywhere values need to be compared vertically or revisited over time.

**The Native Voice Rule.** Use the platform system stack throughout; do not introduce a display face that makes the tracker feel editorial or promotional.

## Layout

The spatial model is mobile-first and vertically chronological. On phones, the day header, seven-date rail, compact summary, and event timeline form one continuous canvas with a fixed three-destination bottom navigation. Inputs and primary controls maintain a minimum 44px touch target; content uses a compact 0.35rem–1rem internal rhythm and 1.5rem separation between major groups.

At 420px and below, the date rail shows six compact dates, the summary ring tightens, timeline columns narrow, and complex detail grids collapse. At 760px, the daily canvas centers at 760px and bottom sheets become contained overlays. At 1120px, the experience becomes a three-column shell: a 248px navigation rail, a 560–660px primary day canvas, and a 264px supporting context rail. The chronological log remains visually central at every width.

**The Day-First Rule.** Supporting navigation and context may flank the day on larger screens, but must never displace the selected day's summary and timeline as the primary canvas.

**The Thumb-Reach Rule.** Primary logging entry points remain available near the timeline and lower edge; dialogs and sheets preserve the selected day in the background.

## Elevation & Depth

The system uses a hybrid of crisp tonal layering and minimal ambient shadow. Most structure comes from white surfaces, pale cool grounds, and one-pixel rules. Shadows are reserved for the daily summary, floating navigation, transient feedback, and overlays that must clearly separate from the preserved day beneath them.

### Shadow Vocabulary

- **Ambient Low:** A restrained two-layer shadow for summary and calendar surfaces; it separates without making cards look collectible.
- **Overlay High:** A broader two-layer shadow for dialogs, bottom sheets, and toasts.
- **Semantic Lift:** Small green or blue glows belong only to selected dates and circular logging markers.

### Named Rules

**The Group Before Lift Rule.** Establish hierarchy with tone, rule, and spacing first. Add shadow only when a surface truly floats or temporarily overlays the day.

## Shapes

The form language is softly grouped and system-like. Small controls and event-row corners use the compact radius; cards and grouped lists use the surface radius; dialogs and bottom sheets use the large overlay radius. Event markers and compact status chips are fully round. Fields stay gently rounded rather than pill-shaped, and adjacent list items share borders instead of becoming a stack of floating capsules.

**The Grouped Surface Rule.** Radius belongs to the outer boundary of a logical group; internal rows are separated by rules, not individual card silhouettes.

## Components

### Buttons

- **Shape:** Compact rounded rectangle with a minimum 44px touch height.
- **Primary:** Deep action green with white text for affirmative food, account, and settings actions.
- **Water:** Water blue with white text for water-specific confirmation.
- **Secondary:** White surface, strong cool rule, and secondary slate text.
- **Hover / Focus / Active:** Hover deepens or softens the semantic fill; focus uses a visible blue ring; active compresses subtly without moving layout.

### Chips

- **Style:** Fully rounded, compact, semibold labels with a soft semantic tint.
- **State:** Use for information such as Mock data or catalog type, not as the default shape for fields or navigation.

### Cards / Containers

- **Corner Style:** Medium grouped-surface radius; large radius only for overlays.
- **Background:** Clean surface over cool ground.
- **Shadow Strategy:** Flat by default, ambient low for the daily summary and calendar, overlay high for transient layers.
- **Border:** Crisp one-pixel cool rule, strengthened on hover where the whole row is interactive.
- **Internal Padding:** Compact to standard spacing; do not inflate dense daily records.

### Inputs / Fields

- **Style:** White field, strong cool rule, gently rounded corners, and a 44px minimum height.
- **Focus:** Border shifts to water blue with a translucent external focus ring.
- **Error / Disabled:** Error text and surfaces use destructive red; disabled controls lower opacity while preserving readable labels.

### Navigation

- **Mobile:** Fixed three-item bottom navigation with icon above label and the current destination in deep action green.
- **Desktop:** Compact left rail with a soft green active row; navigation remains secondary to the day canvas.
- **State:** Every active destination is explicit in both color and semantic state, never color alone.

### Chronological Event Row

Food and water events align exact time, a semantic circular marker, source-aware description, value, and disclosure on one continuous rail. Food markers use the green family; water markers use the blue family. The event container reads as one grouped record even though its content, value, and chevron columns are separately structured.

### Bottom Sheet

The water workflow rises from the thumb edge with a visible drag handle, contained presets, exact-entry field, and explicit cancel/save actions. At tablet width it becomes a centered, fully rounded overlay while retaining the same compact hierarchy.

## Do's and Don'ts

### Do:

- **Do** keep the selected day, exact totals, and chronological events visually dominant.
- **Do** use green for food and affirmative logging, blue for water and information, and neutrals for ordinary progress.
- **Do** preserve tabular numerals, 44px touch targets, visible focus, and reduced-motion behavior.
- **Do** label provenance, incomplete nutrients, future-day restrictions, and mock data directly.
- **Do** group related rows inside shared surfaces with crisp dividers.

### Don't:

- **Don't** turn the experience into a generalized wellness dashboard or gamified scorecard.
- **Don't** use photography, food imagery, decorative gradients, or ornamental illustration in the MVP interface.
- **Don't** disguise unavailable provider data as zero or use judgmental success/failure color for goal progress.
- **Don't** literalize native device chrome such as an iOS status bar or home indicator.
- **Don't** make every control a pill or every record an independently floating card.
