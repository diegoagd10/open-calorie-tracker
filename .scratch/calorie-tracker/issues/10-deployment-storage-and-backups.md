# Technical: deployment, file storage, and backup mechanics

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

What deployment contract, persistent directory layout, configuration boundary, migration procedure, and backup/restore workflow should the self-hosted single-user instance use? Decide how the SQLite database, retained Food images, technical logs, and generated/exported data live across restarts and upgrades; how operators run the TypeScript/Express application; how environment values and secrets are supplied; and what the supported backup and restore procedure guarantees.

The resolution should remain self-hosted and open-source, preserve the User's ownership and privacy responsibilities, and define enough operational behavior for the later implementation plan without implementing deployment files or runtime code.

## Comments

### Resolution (2026-08-02)

Docker Compose is the canonical supported self-hosted deployment. Direct `pnpm`/Node execution remains a development path, not the production contract. The deployment runs the TypeScript/Express application as a container with a configurable internal HTTP port; HTTPS, domains, certificates, and public exposure are handled by an optional reverse proxy outside the application.

All durable application data lives under one host-mounted `DATA_DIR`:

- `DATA_DIR/calories.sqlite` for the SQLite database;
- `DATA_DIR/images/` for retained Food images; and
- `DATA_DIR/exports/` for generated exports.

Technical logs go to container stdout/stderr, leaving collection and retention to the self-hosted operator. Secrets and provider configuration are supplied through the deployment environment file and remain outside `DATA_DIR`; API keys and environment values are never logged.

The deployment includes a local application/database health check and a restart policy. The health check covers the application and local database only; upstream provider outages are application errors and do not cause container restart loops.

The supported backup is a user-run archive of the complete `DATA_DIR` while the application is stopped. Restore replaces the complete data directory and then verifies the restored instance with the health check. There is no automatic cloud backup; the User owns backup storage, privacy, and recovery responsibilities.

Upgrades follow an explicit sequence: stop the application, archive the complete `DATA_DIR`, apply the committed Drizzle migrations, and start the new image. The application never mutates the schema implicitly at startup. If an upgrade or migration fails, the operator restores the previous image and backup. This decision defines the operational contract without implementing Docker files, migrations, or runtime code.
