# Technical: deployment, file storage, and backup mechanics

Status: needs-info
Labels: wayfinder:grilling, needs-info
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

What deployment contract, persistent directory layout, configuration boundary, migration procedure, and backup/restore workflow should the self-hosted single-user instance use? Decide how the SQLite database, retained Food images, technical logs, and generated/exported data live across restarts and upgrades; how operators run the TypeScript/Express application; how environment values and secrets are supplied; and what the supported backup and restore procedure guarantees.

The resolution should remain self-hosted and open-source, preserve the User's ownership and privacy responsibilities, and define enough operational behavior for the later implementation plan without implementing deployment files or runtime code.

## Comments
