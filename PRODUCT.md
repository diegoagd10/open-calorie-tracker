# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person tracking personal nutrition, hydration, and weight during a daily
routine. They need to record today's intake, backfill past dates, and review
progress without re-entering the same food definitions.

## Product Purpose

Daily Intake is a local, single-user nutrition ledger. It lets the user
configure daily food and water targets, record food from a reusable
serving-based database, record water independently, review daily status, and
follow weight progress over time. Success means the user can maintain an
accurate daily record with low-friction manual entry while preserving useful
history.

## Positioning

The product is private and local-first: no account is required and the data is
stored locally. Reusable serving-based food products reduce repeated entry, and
confirmed food records preserve independent dated snapshots so later product
changes cannot rewrite history. Manual entry is the MVP, with a source-neutral
product draft seam reserved for future providers.

## Operating Context

The primary workflow is:

- First visit: configure Targets, then open the Daily Log.
- Normal food entry: Daily Log -> Food Database -> product -> quantity and
  nutrition review -> dated snapshot.
- Water entry: Daily Log -> add ounces, a glass, or a bottle.
- Weight entry: Settings -> Weight -> dated weight history.

The Daily Log supports today and past dates, never future dates. Food, water,
target lookup, and the selected date share the same calendar-date context.

## Capabilities and Constraints

- Track calories, protein, carbohydrates, fat, fiber, sugar, and sodium.
- Track water separately in fluid ounces, with glass and bottle helpers.
- Configure effective-dated daily limits and minimums. Fat is a derived
  maximum based on 30% of the configured calorie maximum; it is a product rule,
  not a medical recommendation.
- Create, search, edit, and retire reusable food products measured by serving.
  Serving descriptions are free text and nutrition values may be decimal.
- Review calculated nutrition before confirming a food entry.
- Preserve independent food snapshots when products are edited or retired.
- Edit or delete individual food log entries without changing the catalog.
- Record one canonical weight in pounds per date and optionally compare it with
  a target weight.
- Preserve existing calorie-only data through migration when present.
- Keep authentication, accounts, cloud sync, sharing, barcode lookup, OCR, AI
  image analysis, recipes, exercise tracking, reminders, and recommendations
  out of the MVP.
- Future input providers must remain behind an application seam and must not
  add source-picker UI to the MVP.

## Brand Commitments

- Product name: Daily Intake.
- Existing product vocabulary includes Daily Log, Food Database, Targets,
  Weight, Product, Serving, Food snapshot, and Target version.
- Data is local-only and no account is required.
- Status copy must describe configured limits and minimums without making
  medical claims or calling values safe, unsafe, ideal, or prescribed.

## Evidence on Hand

- `plan.md` contains the product problem, scope, vocabulary, invariants, user
  stories, route contract, validation rules, and definition of done.
- `README.md` documents the local SQLite runtime, development commands, and
  existing calorie-data migration behavior.
- `src/` contains the current Next.js application, domain logic, repositories,
  APIs, and responsive UI implementation.
- `docs/research/daily-fat-target.md` records the research basis and limits for
  the derived fat maximum.
- No customer testimonials, external usage metrics, or marketing proof are on
  hand; future work must not fabricate them.

## Product Principles

- Keep daily logging simple and manual-first.
- Preserve historical truth through independent food snapshots and
  effective-dated targets.
- Keep food, water, and weight as separate concerns with clear persistence
  boundaries.
- Make metric-specific status actionable without implying medical advice.
- Keep future input integrations extensible without complicating the MVP.

## Accessibility & Inclusion

- The responsive web UI must remain usable on desktop and narrow screens
  without horizontal overflow.
- Every interactive control needs a visible keyboard focus state.
- Forms need associated labels and actionable validation messages.
- Loading and status changes need appropriate accessible live-region semantics.
- Reduced-motion preferences must be respected.
