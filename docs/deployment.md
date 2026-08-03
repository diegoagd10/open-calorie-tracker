# Self-hosted deployment

Docker Compose is the supported production shape. The application listens on internal HTTP; an optional reverse proxy owns HTTPS, certificates, domains, and public exposure.

## Persistent boundary

Set `DATA_DIR` to one host directory. It contains:

- `calories.sqlite` — SQLite data;
- `images/` — retained Food images; and
- `exports/` — generated structured exports.

Provider credentials and configuration belong in the deployment environment, not in `DATA_DIR`. Technical logs are emitted to container output and exclude credentials, environment values, prompts, images, raw provider responses, and sensitive nutrition data.

## Start

```bash
docker compose build
docker compose run --rm calories node dist/src/cli.js migrate
docker compose up -d
curl http://localhost:3000/health
```

Migrations are an explicit operator step before the server starts. Runtime startup never mutates the schema. Provider outages are handled as application errors and do not restart the container.

## Backup and restore

Stop the application before copying or archiving the complete data directory so SQLite and retained images are consistent:

```bash
docker compose stop calories
CALORIES_STOPPED=1 DATA_DIR=/srv/calories/data BACKUP_DIR=/srv/calories/backups ./scripts/backup.sh
docker compose start calories
```

Restore replaces the complete data directory. Keep the prior directory until the restored instance passes its health check:

```bash
docker compose stop calories
DATA_DIR=/srv/calories/data ./scripts/restore.sh /srv/calories/backups/calories-YYYYMMDDTHHMMSSZ.tar.gz
docker compose start calories
curl --fail http://localhost:3000/health
```

The user owns backup storage, privacy, retention, and recovery decisions. There is no automatic cloud backup.

## Upgrade

1. Stop the application.
2. Archive the complete `DATA_DIR`.
3. Pull or build the new image.
4. Apply committed migrations explicitly: `docker compose run --rm calories node dist/src/cli.js migrate`.
5. Start the new image and verify `/health`.

If a migration fails, do not start the new image against an uncertain directory. Restore the prior image and complete backup, then investigate the migration separately.
