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

Local USDA and Open Food Facts installation, storage, recovery, limits, and
end-to-end verification are covered in the [food catalog operations
guide](docs/food-catalog-operations.md).

Camera barcode scanning requirements and privacy behavior are documented in
[the camera scanning guide](docs/barcode-scanning.md).

Plate photos: see [capture, corrections, operator OAuth provisioning, and live pilot](docs/photo-analysis.md).

## Contributing

Install the [local Git hook](docs/verification.md#pull-request-gate) with
`pnpm hooks:install`. Pushes run the deep verification suite and stop on failure.
After a successful push, create the PR with `pnpm pr:create`.
