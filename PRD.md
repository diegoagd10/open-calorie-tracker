# Calorie Tracker — Product Requirements Document

## 1. Purpose

Calorie Tracker is a personal nutrition and water tracking product that lets users record what they consumed on a given day, compare daily intake with self-defined goals, and review any past day from a phone.

This document defines product behavior only. It intentionally excludes architecture, implementation choices, APIs, databases, and vendor selection.

## 2. Product Principles

- Logging should be fast and require as few steps as possible.
- The product should present facts neutrally without judging, coaching, or gamifying behavior.
- Every user's records must remain private and separate from every other user's records.
- The daily log is the primary experience; long-term analytics are not part of version one.
- Failed or incomplete records must never silently distort daily totals.
- Version one must conform to WCAG 2.2 Level AA.

## 3. Users and Access

- Any person with a valid email address may create a private account.
- Email verification is mandatory before the application can be used.
- Sign-in is passwordless: the user enters an email address, receives a sign-in link, and opens it to return authenticated to the application.
- If sending the email fails, the product must show a clear error and offer a resend action.
- After a successful resend, the product must show a brief confirmation.
- A user remains signed in on a phone until signing out on that phone.
- The same account may remain signed in on multiple phones simultaneously.
- The user may sign out of the current phone.
- Remote session management and “sign out all devices” are out of scope.
- Self-service account deletion is out of scope for version one.
- Self-service email-address changes and recovery after losing email access are out of scope for version one.

## 4. First-Time Setup

After email verification, a first-time user must:

1. Choose a US or metric display preference.
2. Manually define daily goals for:
   - Calories
   - Water
   - Protein
   - Carbohydrates
   - Fat
   - Fiber
   - Sugar
   - Sodium
3. Save those settings before entering the daily log.

The product must not request name, age, sex, height, weight, or other health-profile information.

## 5. Daily Navigation and Food Log

- After setup, the product opens on today's log.
- A horizontal date strip allows movement across nearby dates.
- A calendar picker allows the user to open any past date.
- History has no artificial time limit.
- Future dates cannot receive food or water records.
- The date strip only identifies the selected date; it must not score or color-code days as good or bad.
- The daily entry section is named **Food Log**.
- Food and plate cards are ordered newest first.
- Records cannot be moved from one calendar date to another after creation.

### 5.1 Entry times

- An entry created for today uses the current local time.
- An entry added to a past date receives a time one minute after that date's newest existing entry, placing it at the top.
- If the selected past date has no entries, the first entry defaults to 12:00 PM.
- Traveling between time zones must not move historical entries to another date.

## 6. Daily Summary

### 6.1 Calories

- The calorie summary is fixed above the nutrition carousel.
- It shows calories eaten versus the active daily calorie goal.
- It includes a circular progress indicator.
- It represents consumed calories only and never adjusts for exercise or calories burned.

### 6.2 Nutrition carousel

Only nutritional details belong in the carousel. Each page shows three compact cards with consumed amount, goal or maximum, and circular progress:

- Page 1: protein, carbohydrates, and fat.
- Page 2: fiber, sugar, and sodium.

Sugar and sodium are daily maximums. Calories, water, protein, carbohydrates, fat, and fiber are daily targets. Exceeding a value is shown neutrally.

### 6.3 Missing data

- Missing nutrition values display as unavailable, never as zero.
- Known values still contribute to their applicable totals.
- A daily total affected by missing values is visibly identified as incomplete.

## 7. Adding Food

The main Add Food menu contains exactly these choices:

- Saved foods and reusable plates
- Food Database
- Scan Barcode
- Scan Nutrition Label

Exercise logging and meal-photo calorie estimation are not offered.

### 7.1 Food database search

- The user can type a query and filter existing database items.
- Only an existing item can be selected.
- Selecting an item immediately logs one serving.
- If no item matches, the search shows no results and creates no Food Log entry.

### 7.2 Barcode lookup

- A successful scan immediately logs one serving.
- The captured barcode image is retained and shown on the food card.
- A failed attempt creates an error entry in the Food Log.
- A retryable error offers a quick retry action.
- A non-retryable error shows understandable details and can be deleted.

### 7.3 Nutrition-label photo

- A successful photo immediately logs one serving using the values read from the label.
- The captured label photo is retained and shown on the food card.
- The user can open the entry afterward and correct its values.
- A readable label without a recognizable product name is logged as **Unnamed food** without a warning; the name can be edited later.
- Failure behavior matches barcode failure behavior.

### 7.4 Manual creation

- Creating a completely custom food from typed nutrition values is out of scope.
- Every food must originate from a database result, barcode, nutrition-label photo, favorite, or reusable plate.

## 8. Food Entries and Nutrition

- Primary tracked values are calories, protein, carbohydrates, fat, fiber, sugar, and sodium.
- Additional available values may appear under **Other nutrition facts**.
- Ingredients are not extracted, stored, requested, or displayed.
- A user may edit an entry's name, measurement, quantity, calories, and nutritional values.
- Measurements may include servings, packages, grams, ounces, and units supplied by the selected food.
- Changing quantity or measurement recalculates that entry proportionally.
- An edit affects only the current logged entry and never changes the food database, favorites, reusable plates, or other historical records.
- Duplicate food entries are allowed because they may represent separate consumption events.
- An Undo action after logging is not required.

### 8.1 Card images

- A database item without an image uses a text-only card.
- A nutrition-label entry shows its captured label photo.
- A barcode entry shows its captured scan image.
- A scan image cannot be removed independently from its entry.
- Deleting the entry also removes its attached image.

## 9. Plates

- Grouping foods into a plate is optional.
- A plate may contain only successful food entries from one calendar day.
- Pending and failed entries cannot be grouped.
- Creating a plate requires a custom name; preset meal categories are not provided.
- A plate appears as one text-only Food Log card showing combined calories, protein, carbohydrates, and fat.
- Opening a plate reveals its component foods and their values.
- Plate and daily totals recalculate when a component is edited or removed.

### 9.1 Plate time

- When created, a plate takes the latest time among the foods being grouped.
- That time becomes the plate's own time and does not change automatically when its contents later change.
- The plate time may be edited directly.

### 9.2 Plate changes

- After a plate exists, a new food may be logged directly inside it through the normal food options.
- An existing standalone Food Log entry cannot later be moved into an existing plate.
- A plate containing one remaining food remains a plate.
- Removing the final food automatically deletes the empty plate.
- Plates cannot be ungrouped into standalone food cards.
- Deleting a logged plate deletes that occurrence and all foods contained in it.
- Deleting a saved reusable plate affects future reuse only; already logged plates remain unchanged.

## 10. Favorites and Reusable Plates

- An individual food can be saved as a favorite.
- A complete plate can be saved for reuse.
- Reusing a saved item logs its saved quantities and nutritional values.
- Saved items may be removed without changing previously logged occurrences.

## 11. Water Tracking

- The water tracker records plain water only; other beverages are logged as foods.
- A user can enter an exact water amount.
- Quick options are:
  - Glass: 8 fl oz
  - Bottle: 16 fl oz
  - Large bottle: 24 fl oz
- The US preset sizes remain the underlying amounts when metric display is selected; they are displayed as conversions rather than replaced with different preset sizes.
- The daily summary shows total volume, the equivalent number of 8 fl oz glasses, and progress toward the daily water goal.
- Water sits outside the nutrition carousel and has its own Log Water action.
- Every water log retains its amount and time.
- Opening the water summary reveals individual water events for editing or deletion.

## 12. Goals

- Goals are entered and maintained manually; the product does not calculate or recommend them from health or activity data.
- Goal changes take effect from a user-selected date onward.
- Past days retain the goals active on those dates.
- The product must present progress factually without a Health Score, coaching, judgment, or moral warnings.

## 13. Offline and Error Behavior

- Users can view recent records and log food or water while offline.
- New food-database searches may be unavailable offline.
- An offline barcode or label scan immediately creates a visible **Pending** entry and preserves the captured image.
- Pending scans are processed when connectivity returns.
- If later processing fails, the entry changes to the standard retryable or non-retryable error state.
- Failed entries have no usable nutrition data and do not affect daily totals.
- If competing offline changes cannot be reconciled, both are preserved as separate entries so the user can delete the unwanted duplicate.

## 14. Explicitly Out of Scope for Version One

- Exercise, steps, and calories burned
- Apple Health, watch integrations, and Health Score
- AI analysis of meal photos
- Fully manual food creation
- Ingredient tracking
- Meal categories
- Moving records between dates
- Plate ungrouping
- Reminders and notifications
- Streaks, badges, points, challenges, and gamification
- Weekly or monthly progress reports
- Social features, groups, sharing, public profiles, and leaderboards
- Subscriptions, payments, advertisements, or paid feature limits
- Data export
- Self-service account deletion
- Self-service email-address changes and recovery
- Remote session management
- Name, age, sex, height, weight, and health-profile data

## 15. Pending Product Decisions

- Which geographic market or food catalog coverage should be prioritized first.
- Whether any additional languages beyond English should be added after version one.
- Whether excluded lifecycle capabilities such as export and account deletion should enter a later release.

## 16. Acceptance Summary

Version one is successful when a verified user can set personal goals, log food through the approved sources, optionally organize foods into plates, record water, use the product across phones and during temporary connectivity loss, and accurately review today's or any past day's intake without health scoring, exercise tracking, reminders, or social features.
