# Open Calory Tracker

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Portable mock: vanilla HTML, CSS, and JavaScript with no build step. The production specification calls for a mobile-first React Router Framework Mode application with SSR, strict TypeScript, CSS Modules, SQLite, Drizzle, and Docker; this artifact demonstrates only the interface and local presentation states.

## Users

The primary user is an iPhone owner privately tracking food, nutrition, and water on a self-hosted website. They need a fast daily loop, access to any past day, and confidence that history belongs only to their account. The same person also owns and operates the Portainer/Traefik deployment.

## Product Purpose

Provide the smallest useful private nutrition loop: register without email, set units and personal goals, find United States foods in USDA FoodData Central, log a provider-backed quantity, record exact water, compare daily totals with active goals, correct entries, and revisit history.

Success means the common action—logging food or water today—takes little effort on a phone while historical nutrition remains stable, traceable, and understandable when provider data is incomplete.

## Positioning

Each logged food becomes an editable local Nutrition Snapshot: its USDA source, authoritative measurement base, and nutrient values are retained so past records do not drift when the catalog changes or becomes unavailable.

## Operating Context

- Mobile-first use in iPhone Safari, including Add to Home Screen.
- A private self-hosted deployment reachable through Traefik; no App Store installation and no offline promise.
- Daily Food Logs are organized by the user’s original local calendar date, with fast nearby-date navigation and access to any past date.
- Food discovery deliberately submits a search to a server-side USDA catalog instead of searching on every keystroke.
- Nutrition goals are effective-dated so historical days retain the goals that applied then.

## Capabilities and Constraints

- Username/password registration and sign-in only; no email or recovery. Usernames are immutable, case-insensitively unique, and allow 3–30 ASCII letters, digits, dot, hyphen, and underscore. Passwords allow 12–128 characters, including spaces and Unicode.
- First-run setup requires US or metric display units and goals for calories, water, protein, carbohydrate, fat, fiber, sugar, and sodium. It must not collect age, sex, height, weight, name, or other health-profile data.
- The Food Log opens on today, supports any past date, rejects future records, and orders entries deterministically by displayed time and creation order.
- USDA FoodData Central is the sole MVP catalog. Search covers Branded, Survey/FNDDS, and Foundation results, preserves the provider’s English names, labels result type, shows attribution, and exposes only safe provider-backed measurements.
- Food Entries may repeat, can be edited or deleted independently, and retain source provenance. Missing nutrients remain unavailable rather than becoming zero; known totals still contribute and affected summaries are marked incomplete.
- The fixed calorie summary precedes a two-page nutrition carousel: protein/carbohydrate/fat, then fiber/sugar/sodium. Sugar and sodium are maximums; other goals are targets. Exceeded values remain neutral and nonjudgmental.
- Water supports exact amounts plus fixed 8, 16, and 24 fl oz presets (converted for metric display), event history, edit/delete, total, equivalent 8 oz glasses, and progress toward the active goal.
- User-visible material states include loading, empty, validation, generic credential failure, provider unavailable/rate-limited, no results, unsafe/missing measurement, incomplete nutrient totals, save success, duplicate-submit protection, and destructive confirmation.
- This mock uses local synthetic fixtures and deterministic UI-only interactions. APIs, authentication, persistence, Docker, migrations, health checks, and deployment behavior are represented only by their visible outcomes.
- Out of scope: custom foods, barcode flows, images/OCR, favorites, plates, second catalog providers, offline/sync, email, recovery, exercise/health integrations, AI analysis, reminders, gamification, analytics, sharing, payments, and ads.

## Evidence on Hand

GitHub issue #13, “Spec: Ship the day-one calorie and water tracking MVP,” is the sole product specification. No customer proof, pricing, production screenshots, logo, product photography, or factual nutrition claims were supplied. All demonstration nutrition and account content in the mock must be clearly labeled as mock data.

## Product Principles

1. Make today’s private logging loop immediate on a phone.
2. Preserve history locally and never disguise missing provider data as zero.
3. Collect only what the feature needs; avoid health-profile surveillance.
4. Explain source, state, and consequence without judgment or gamification.
5. Prefer predictable deliberate actions over invisible automation.

## Accessibility & Inclusion

Every delivered flow must meet WCAG 2.2 AA and remain operable by keyboard, screen reader, and touch. The interface is English; USDA food names remain in their original English form. Visible focus, semantic controls, useful labels, sufficient contrast, reduced motion, and touch targets suitable for iPhone use are required.
