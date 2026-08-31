# Open Calory Tracker

## What it is

Open Calory Tracker is a private, self-hosted web application for tracking
nutrition and water. It helps people find existing foods, record what they
consume, set their own goals, compare daily totals, and revisit or correct past
entries.

## Why it exists

It was built for people who want a fast way to track nutrition and water
without manually transcribing food data or giving up control of their history.
The application keeps past records useful even when its external food catalog
changes or is temporarily unavailable, and presents progress factually without
coaching, judgment, or gamification.

## Deployment

For production configuration, deployment, updates, and backups, follow the
[production deployment guide](docs/deployment.md).

## Local verification

Use `pnpm verify` for the fast local gate and `pnpm verify:deep` for the full
gate. Their scope, expected duration, prerequisites, and opt-in external suites
are documented in the [verification guide](docs/verification.md).
