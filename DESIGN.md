---
name: Calorie Tracker Authentication
description: Dark iOS-first passwordless authentication for a private daily record.
colors:
  system-background: "#000000"
  grouped-surface: "#1c1c1e"
  inset-surface: "#2c2c2e"
  label: "#ffffff"
  secondary-label: "#a1a1a6"
  tertiary-label: "#8e8e93"
  separator: "rgba(84, 84, 88, 0.62)"
  interaction-blue: "#0a84ff"
  interaction-blue-pressed: "#409cff"
  success: "#30d158"
  success-text: "#63df81"
  success-fill: "rgba(48, 209, 88, 0.14)"
  error: "#ff453a"
  error-text: "#ff8a83"
  error-fill: "rgba(255, 69, 58, 0.14)"
  disabled-fill: "#3a3a3c"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(2.15rem, 9vw, 2.8rem)"
    fontWeight: 720
    lineHeight: 1.03
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(1.75rem, 7.5vw, 2.2rem)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "1.06rem"
    fontWeight: 650
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.48
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 550
rounded:
  field: "0.8rem"
  button: "0.85rem"
  card: "1.45rem"
  card-compact: "1.25rem"
  pill: "999px"
  circle: "50%"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.interaction-blue}"
    textColor: "{colors.label}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    height: "3.15rem"
    padding: "0 1rem"
  button-primary-pressed:
    backgroundColor: "{colors.interaction-blue-pressed}"
    textColor: "{colors.label}"
    rounded: "{rounded.button}"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-fill}"
    textColor: "{colors.tertiary-label}"
    rounded: "{rounded.button}"
    height: "3.15rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.interaction-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: "2.75rem"
  input-email:
    backgroundColor: "{colors.inset-surface}"
    textColor: "{colors.label}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: "3.75rem"
    padding: "0.72rem 0.9rem"
  action-container:
    backgroundColor: "{colors.grouped-surface}"
    textColor: "{colors.label}"
    rounded: "{rounded.card}"
    padding: "1.25rem"
  status-error:
    backgroundColor: "{colors.error-fill}"
    textColor: "{colors.error-text}"
    rounded: "{rounded.field}"
    padding: "0.9rem"
  status-success:
    backgroundColor: "{colors.success-fill}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.field}"
    padding: "0.9rem"
  progress-current:
    backgroundColor: "{colors.interaction-blue}"
    rounded: "{rounded.pill}"
    height: "0.24rem"
---

# Design System: Calorie Tracker Authentication

## Overview

**Creative North Star: "The Private iPhone Record"**

Authentication feels native to the device: a true-black environment, dark grouped surfaces, compact system chrome, one blue interaction tint, and direct touch-first controls. The tone is private, factual, and calm rather than promotional.

Email, verification, and setup form one visible sequence. State changes are explicit, semantic colors always carry text and icon support, and the composition remains phone-shaped at larger widths.

**Key Characteristics:**

- True-black canvas with charcoal grouped and inset surfaces.
- System typography with compact, high-contrast hierarchy.
- One interaction blue, reserved semantic green and red, and no decorative color.
- Safe-area-aware, single-column layouts with 44pt-or-larger targets.
- Persistent three-step authentication progress and reduced-motion support.

## Colors

The palette follows iOS dark roles: black establishes the environment, charcoal separates grouped content, and white-to-gray labels carry hierarchy.

### Primary

- **Interaction Blue:** The only interactive accent, used for current progress, links, focus, enabled primary actions, and selected icons. Its pressed token is a state variation only.

### Neutral

- **System Black:** The full-screen background and browser theme color.
- **Grouped Charcoal:** The main action container and grouped review rows.
- **Inset Charcoal:** Inputs, detail groups, and neutral status panels inside a grouped container.
- **Primary, Secondary, and Tertiary Labels:** White for decisions, softer gray for explanation, and muted gray for metadata or upcoming steps.
- **Separator:** A translucent neutral line used only between grouped rows and beneath translucent chrome.

### Semantic

- **Success Green:** Verification and session outcomes, paired with explicit success copy and an icon.
- **Error Red:** delivery and link failures, paired with explicit failure copy, an alert role, and a recovery action.

**The One Tint Rule.** Interaction blue is the only non-semantic accent. Pressed blue is a state of that tint, not a second accent.

**The Semantic Exception Rule.** Green and red appear only for successful or failed outcomes, always beside text and an icon.

## Typography

**Display Font:** Apple system stack with SF Pro Text and Helvetica Neue fallbacks
**Body Font:** Apple system stack with SF Pro Text and Helvetica Neue fallbacks

**Character:** Familiar iPhone typography keeps sign-in immediate and unbranded. Tight tracking and heavier weights create hierarchy without introducing a display typeface.

### Hierarchy

- **Display:** Short privacy or state statements, balanced to roughly 14-15 characters per line.
- **Headline:** The immediate task inside the grouped action container.
- **Title:** Compact application chrome and high-priority interface labels.
- **Body:** Instructions and supporting copy; keep lines within the 31rem implemented measure.
- **Label:** Field labels, metadata, privacy markers, and progress captions.

**The Device Type Rule.** Use the system stack only; no imported typeface, decorative display face, or all-caps interface copy.

## Layout

Authentication is a centered single column capped at `34rem`; widening the viewport never turns it into a desktop split layout. The shell uses safe-area insets on every exposed edge, with at least `1rem` horizontal and `1.5rem` bottom padding.

The base rhythm is one context block, three-part progress, one grouped action container, then quiet footer metadata. At `430px` and below, top padding and card radius tighten and the footer stacks. At `760px` and above, only breathing room grows: top padding expands and the grouped container receives more internal padding.

Treat `44px` as the web expression of the iOS 44pt minimum target. Text links and clear actions meet it; primary buttons, grouped rows, and the email field exceed it.

## Elevation & Depth

Depth is primarily tonal: true black, grouped charcoal, and inset charcoal establish containment. A diffuse dark shadow grounds the grouped action container, while the app icon alone receives a blue ambient glow. The translucent toolbar uses blur and a separator rather than visual mass.

**The Tonal Depth Rule.** Grouping comes from black-to-charcoal layers; shadows support only the app icon and grouped action container.

## Shapes

Corners are continuous and iOS-like. Fields and status panels use the field radius, buttons use the slightly softer button radius, and the main grouped container uses the larger card radius, tightening to the compact card radius on narrow phones. Progress tracks and timing badges are pills; verification seals are circular.

Borders stay scarce. Use a faint outer border on the grouped action container, an inset blue focus ring on the field, and separators only between rows within the same group.

## Components

### Authentication Header

- A translucent dark toolbar keeps the product title left and the lock-plus-Private marker right.
- Safe-area-aware horizontal padding and a bottom separator preserve native chrome behavior.

### Authentication Progress

- Always show `Email`, `Verify`, and `Setup` in that order.
- The current segment is blue and bold, complete segments become secondary gray, and upcoming segments remain tertiary gray.
- Set `aria-current="step"` on the current item; labels remain visible so progress never depends on color alone.

### Cards / Containers

- The action container is one grouped charcoal surface with a faint border, large radius, and compact internal hierarchy.
- Detail and setup rows form inset groups with left-indented separators; do not turn each row into a separate floating card.

### Inputs / Fields

- The email field is an inset charcoal, stacked-label control with a `3.75rem` minimum height.
- Focus uses a two-pixel inset blue ring plus the global visible focus outline. Validation errors appear as text below the field and receive alert semantics.

### Buttons

- Primary actions are full-width blue controls with white sentence-case labels and no shadow. Hover, active, and pressed states use the pressed-blue token.
- Disabled actions use disabled charcoal and tertiary text without reducing opacity. Loading replaces the directional icon with a spinner while preserving the label and control size.
- Secondary actions are clear blue controls. Text links retain an underline where they behave as navigation.

### Status & Verification

- Neutral, success, and error messages combine icon, title, and detail copy in one rounded inset panel.
- Verification has three explicit states: a pulsing blue working seal, a green check seal, and a red alert seal. The pulse is removed under `prefers-reduced-motion: reduce`; no meaning is lost.
- Resend remains disabled during its countdown and while sending, with the remaining time written into the label.

## Do's and Don'ts

### Do:

- **Do** keep authentication on true black with grouped charcoal containment.
- **Do** preserve the Email, Verify, Setup sequence and expose its current step to assistive technology.
- **Do** pair progress, success, error, loading, and disabled states with visible text rather than color alone.
- **Do** honor safe areas, text scaling, keyboard focus, reduced motion, and 44pt-or-larger targets.

### Don't:

- **Don't** introduce any accent beyond interaction blue and semantic success or error.
- **Don't** expand authentication into a desktop split layout; preserve the centered one-column mobile boundary.
- **Don't** use shadows as the default separator between grouped content.
- **Don't** hide recovery actions or collapse state feedback into an icon alone.
