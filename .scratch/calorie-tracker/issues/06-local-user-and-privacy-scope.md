# Domain: local user and privacy scope

Status: closed
Labels: wayfinder:grilling, closed
Parent: ../spec.md
Blocked by: none
Assigned: Codex (current session)

## Question

For the first open-source release, is the application a local single-user tool, a self-hosted single-user tool with optional authentication, or a multi-user web application? Decide what personal data is stored, whether uploaded images are retained, how a user exports or deletes data, and what privacy promises the UI must make around sending images to external APIs.

The recommendation should minimize architecture that the individual use case does not need while leaving a credible path for future accounts if that is desired.

## Comments

### Resolution (2026-08-02)

V1 is a self-hosted, single-user application with no authentication or synchronization. The User owns the instance and its data; future account, multi-user, and synchronization support remain possible extensions rather than first-release scope.

The application stores the User's daily logs, Food items, Meals, Favorites, nutritional snapshots, settings, and retained Food images. A Food image is associated with the Food item or Meal it helps identify, create, or correct, and remains until explicitly deleted; there is no automatic expiry in v1. Images are not duplicated into every historical Food entry.

The User chooses and configures the external AI provider. V1 has no separate consent gate, but documentation states that AI analysis may send retained images to that configured provider. The self-hosting User is responsible for access control, backups, API credentials, and privacy. Troubleshooting logs contain safe operational metadata; API-key values and environment-variable values are never logged, although a missing variable name may be reported.

V1 provides export of structured data plus retained images. Deleting a Food item or Meal does not rewrite historical Food entries because their snapshots remain; a separate confirmed delete-all action removes all records and images. No runtime code changed.
