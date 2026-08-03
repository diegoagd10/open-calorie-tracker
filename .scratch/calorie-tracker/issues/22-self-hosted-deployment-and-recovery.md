# 22 - Package self-hosted deployment and recovery workflows

**What to build:** Make Docker Compose the supported production path and document the operator-controlled storage, migration, health, backup, restore, and upgrade contract.

**Blocked by:** 21 - Export and erase owned data.

**Status:** ready-for-agent

**Mockup starting point:** Start with the Local instance status and settings/navigation chrome in `public/mockup.html`; this ticket adds operational behavior rather than a new end-user screen.

- [ ] Docker Compose runs the TypeScript/Express application with configurable internal HTTP, a host-mounted `DATA_DIR`, and the documented SQLite, images, and exports layout.
- [ ] Secrets and provider configuration come from deployment environment values outside `DATA_DIR`; technical logs go to container output and exclude secret/private payloads.
- [ ] Health checks cover the local application and database, and the restart policy does not turn external provider outages into restart loops.
- [ ] The documented backup archives the complete `DATA_DIR` while the app is stopped; restore replaces the complete directory and verifies the instance through the health check.
- [ ] The documented upgrade sequence backs up data, stops the app, applies committed migrations explicitly, and starts the new image; failed migrations leave a clear restore path.
- [ ] Optional reverse-proxy deployment owns HTTPS, certificates, domains, and public exposure; deployment smoke tests verify mounted persistence, migration ordering, health, backup, restore, and secret/log separation.
