# Calorie Tracker — Technical Design Document

## 1. Status and Purpose

This is an initial technical design boundary document derived from the confirmed product requirements. It identifies required system behavior, domain invariants, and unresolved technical decisions without pretending that an implementation architecture has already been selected.

The product direction mentioned during discovery is a mobile-first Progressive Web App, primarily used on iPhone and accessible from any phone. Ionic was mentioned as a possible client framework, but it is not yet a confirmed technical choice.

## 2. Technical Scope

The system will eventually require these major capabilities:

- Passwordless email authentication and mandatory email ownership verification
- Strict per-account data isolation
- Daily food, plate, nutrition, goal, and water persistence
- Food catalog search and item retrieval
- Barcode capture and lookup
- Nutrition-label image capture and value extraction
- Attached image storage and lifecycle management
- Offline local persistence with later synchronization
- Derived daily nutrition and water aggregates
- Historical goal versioning by effective date
- Multi-device synchronization and conflict preservation
- US and metric display conversion

No backend framework, hosting platform, database, authentication provider, email provider, food database, image-processing provider, or storage provider is selected yet.

## 3. Conceptual Domain Model

The names below are conceptual and do not prescribe database tables or API resources.

### 3.1 Account

Owns a verified email identity, unit preference, sessions, goals, saved items, logs, and images. All user-owned records must be isolated by account.

### 3.2 Goal version

Contains an effective date and goal values for calories, water, protein, carbohydrates, fat, fiber, sugar, and sodium. Historical goal resolution selects the version active on the viewed date.

### 3.3 Food entry

Represents one consumed food. Expected conceptual fields include:

- Owner
- Calendar date and display time
- Source type: catalog, barcode, nutrition label, favorite, or reusable plate component
- Lifecycle state: pending, successful, retryable error, or terminal error
- Product name
- Measurement and quantity
- Calories and primary nutrient values
- Availability state for each nutrient
- Optional additional nutrition facts
- Optional attached scan image
- Optional parent plate

### 3.4 Plate entry

Represents a named, same-day collection of successful food entries. It owns one fixed plate time and derived combined nutrition. It is text-only and may itself be saved as a reusable template.

### 3.5 Water entry

Represents one plain-water event with owner, calendar date, display time, and normalized volume.

### 3.6 Saved item

Represents a reusable snapshot of either a food or a complete plate. Removing a saved item must not mutate previously logged occurrences.

### 3.7 Scan attempt

Represents the lifecycle of a barcode or label capture, including its image, processing state, error classification, and resulting food entry when successful. Whether this is a separate persisted object or part of a food entry remains a design decision.

## 4. Core Domain Invariants

- Every user-owned record belongs to exactly one account.
- Data from one account must never be readable or mutable by another account.
- A food or water record belongs to one calendar date and cannot be moved to another date.
- Entries for today use current local time.
- Retroactive entries use one minute after the newest existing time on that date, or 12:00 PM when none exists.
- Historical calendar dates remain stable across later timezone changes.
- Only successful same-day food entries can become plate components.
- A food entry cannot simultaneously exist as a standalone card and a plate component.
- A plate's time is copied from the latest selected component at creation and does not derive from later component changes.
- A plate with one component remains valid; a plate with zero components is deleted.
- Plate nutrition is derived from its current components.
- Deleting a logged plate deletes its contained component records.
- Failed records contribute nothing to aggregates.
- A missing nutrient is unknown, not zero.
- Editing one logged food must not mutate catalog data, saved items, or other log occurrences.
- Attached scan images cannot be independently removed from successful entries.

## 5. Authentication Flow Requirements

1. The client accepts an email address.
2. The system validates its basic form and requests a passwordless sign-in email.
3. The user must open the emailed link to establish a verified session.
4. Invalid or failed email delivery returns a user-readable error and supports resend.
5. Successful resend returns a short confirmation.
6. A verified session persists on the device until local sign-out.
7. The same account may maintain simultaneous sessions on multiple phones.

Account deletion and remote revocation of all sessions are not required in version one. Session expiration, token rotation, link lifetime, replay protection, and recovery policies are pending technical decisions.

## 6. Food Ingestion Pipelines

### 6.1 Catalog search

- Accept a typed query and return matching existing items.
- Selecting a result creates a successful one-serving food entry immediately.
- An empty result set creates no log record.
- Offline availability may be limited to locally available saved or recent data.

### 6.2 Barcode

- Capture a barcode and retain the scan image.
- Resolve it against the selected food data source.
- A successful result creates a one-serving entry immediately.
- Failure creates a persisted error entry classified as retryable or terminal.

### 6.3 Nutrition label

- Capture and retain the label image.
- Extract product name when available, serving information, calories, and nutrition values.
- A successful result creates a one-serving entry immediately.
- A missing product name becomes `Unnamed food` and does not by itself make processing fail.
- Missing individual nutrient values remain unknown and make applicable aggregates incomplete.
- Failure creates the same retryable or terminal error behavior as barcode processing.

### 6.4 Offline capture

- Barcode and label captures create a pending local record immediately.
- The original image must survive application restart and connectivity loss.
- Processing resumes after connectivity returns.
- Pending transitions to successful, retryable error, or terminal error.

## 7. Aggregation Rules

- Daily calories and nutrients sum successful standalone foods and successful plate components exactly once.
- A plate card exposes derived plate totals but must not cause its components to be double-counted in daily totals.
- Failed and pending entries contribute no values.
- If any successful contributing entry has an unknown value for a nutrient, the known subtotal may be shown but the day's value is marked incomplete.
- Water total is the sum of normalized water-entry volumes.
- Equivalent glasses are calculated against the fixed 8 fl oz glass size.
- Goal comparison resolves the goal version effective on the selected calendar date.
- Sugar and sodium are evaluated as maximums; other configured values are targets.

Rounding, precision, normalization units, and display-conversion rules require explicit technical definitions before implementation.

## 8. Plate Operations

### 8.1 Create

- Input: a required name and two or more eligible same-day standalone food entries.
- Result: a new plate that owns the selected foods and adopts the latest selected time.
- Exact minimum component count at initial creation should be confirmed; the product discussion established that an existing plate may remain with one component.

### 8.2 Add food

- A new food may be created directly inside an existing plate through any supported food-ingestion path.
- An existing standalone food cannot be moved into an existing plate.
- Adding a component does not change plate time.

### 8.3 Edit and delete

- Component changes recalculate derived plate and daily aggregates.
- Removing the final component deletes the empty plate.
- There is no ungroup operation.
- Deleting a logged plate cascades to its component foods and attached images.

Transactional boundaries for plate creation, recalculation, and cascading deletion must prevent partial updates.

## 9. Offline and Multi-Device Synchronization

The client must support offline creation and editing of locally available records. When synchronization finds competing versions that cannot be safely merged, the product rule is to preserve both as separate records and let the user delete the unwanted duplicate.

The technical design must distinguish:

- Intentional duplicate consumption entries
- A duplicated record created to preserve conflicting offline edits
- Retries of the same pending scan

Conflict detection, idempotency, local identifiers, server identifiers, ordering, and retry semantics are pending decisions.

## 10. Image Lifecycle

- Barcode and nutrition-label captures are associated with their log entry or scan attempt.
- Images must remain available across offline processing and multi-device access.
- Successful entry images cannot be deleted independently.
- Deleting an entry deletes its attached image unless another retained record legitimately references the same asset.
- Retrying a failed capture may replace the failed image.

Storage format, compression, resizing, retention, deduplication, privacy controls, and upload limits are pending.

## 11. Units and Time

- The product supports US and metric display.
- Water presets use fixed underlying US quantities of 8, 16, and 24 fl oz and are converted for metric display.
- Food measurements may use servings, packages, grams, ounces, or source-supplied units.
- Calendar-date ownership must be modeled separately from mutable device timezone behavior.
- Records cannot be moved between calendar dates after creation.

Canonical storage units, timezone representation, daylight-saving behavior, conversion precision, and same-minute ordering require technical decisions.

## 12. UX Requirements Relevant to Technical Design

- The intended client is mobile-first and optimized for iPhone while remaining usable on other phones.
- The home experience contains a fixed calorie card, a two-page nutrition carousel, a separate water section, and a newest-first Food Log.
- Food cards support image and text-only variants.
- Plate cards are always text-only.
- Pending and error states must be visible directly in the Food Log.
- Retryable failures expose Quick Retry; terminal failures expose details and Delete.
- The Add Food surface offers Saved Foods, Food Database, Scan Barcode, and Scan Nutrition Label.
- The date strip remains neutral and a calendar supports long-range navigation.
- The application is English-only in version one.
- Accessibility behavior, responsive breakpoints, exact copy, empty states, loading states, and visual tokens remain to be specified.

## 13. Security and Privacy Requirements

- Enforce account ownership on every user-data operation.
- Protect passwordless links against reuse and interception.
- Prevent unauthenticated access to food logs, goals, water records, saved items, and images.
- Do not expose one user's images or records to another user through predictable references or shared caches.
- Treat captured nutrition labels and barcode photos as private account data.
- Avoid collecting profile or health-demographic data not required by the product.

Detailed threat modeling, encryption choices, audit requirements, rate limits, abuse prevention, and privacy-policy obligations remain pending.

## 14. Testing Boundaries

The eventual implementation must verify at minimum:

- Email-link success, failure, resend, expiration, and replay behavior
- Cross-account data isolation
- Today and retroactive time assignment
- Historical date stability across timezone changes
- Food ingestion success, partial data, pending, retryable failure, and terminal failure
- Offline restart and later synchronization
- Conflict duplication without silent loss
- Plate creation, immutable plate time, aggregation, component removal, empty-plate deletion, and cascade deletion
- No double counting of plate components
- Missing nutrient propagation into incomplete daily totals
- Goal effective-date resolution
- Unit conversions and water preset equivalence
- Image persistence and deletion lifecycle
- Multi-phone session and synchronization behavior

The concrete test framework and quality gates are not selected.

## 15. Pending Technical Decisions

### Client and delivery

- Confirm whether Ionic is the client framework.
- Decide whether version one is a browser-installed PWA only or also packaged for an app store.
- Define browser and operating-system support targets.
- Define the client state-management, offline-storage, and synchronization approach.

### Backend and data

- Select backend language, framework, API style, hosting, and deployment model.
- Select the primary database and migration strategy.
- Define domain identifiers, ownership enforcement, and transaction boundaries.
- Define aggregate calculation strategy and cache invalidation.
- Define backup, restore, retention, and disaster-recovery requirements.

### Authentication and email

- Select authentication and transactional-email providers.
- Define magic-link lifetime, single-use behavior, session lifetime, refresh, revocation, and rate limits.
- Define handling for email-address changes and inaccessible email accounts.

### Food and scanning

- Select food database provider and geographic/catalog coverage.
- Select barcode scanning and lookup approach.
- Select nutrition-label recognition approach and provider.
- Define confidence thresholds, partial-success rules, retry classification, and provider fallback behavior.
- Define how corrected entry data remains isolated from provider catalog data.

### Images

- Select object storage, upload protocol, image formats, compression, size limits, and access-control mechanism.
- Define offline image queueing, retry, cleanup, and orphan handling.

### Time, units, and synchronization

- Define canonical time, date, volume, weight, and nutrient representations.
- Define precision and rounding rules.
- Define offline operation logs, idempotency, merge detection, and duplicate preservation.
- Define deterministic ordering when entries share a display time.

### UX and quality

- Define the visual system and component behavior beyond the accepted references.
- Specify accessibility, responsive behavior, loading, empty, and degraded-network states.
- Select observability, analytics, error-reporting, test, and CI strategies.
- Establish performance and reliability targets.

## 16. Pending Product Decisions That Affect Technical Design

- Initial geographic market or food catalog coverage.
- Whether a newly created plate must initially contain at least two foods.
- Future introduction of data export, account deletion, remote session management, additional languages, or long-term analytics.

