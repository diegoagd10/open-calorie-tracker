# Technical: persistence and module seams

Status: needs-triage
Labels: wayfinder:grilling, needs-triage
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

Given the resolved domain and privacy rules, what SQLite schema, ORM/migration approach, module seams, upload handling, and external-service adapters should the implementation use? Define the durable interfaces that keep daily-log calculations, food-source lookups, AI analysis, and recipe composition independently testable while honoring the requested Node.js, Express, HTMX, and SQLite stack.

This ticket is about deciding the implementation shape, not writing it. It should include migration strategy, nutritional snapshot boundaries, error behavior, and the minimum testing seams.

## Comments
