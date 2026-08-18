# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- pnpm workspace and package manager
- Ionic React client written in TypeScript
- Safari-installed Progressive Web App with an iOS-first experience and iPhone as the primary device
- Node.js and Express 5 API written in TypeScript
- SQLite 3.37 or newer for the approved authentication persistence model
- Same-origin client and API in version one

App Store and Capacitor packaging are not part of version one.

## Users

People who want to privately record daily food and plain-water intake from a phone, compare intake with goals they define themselves, and review any past day. A valid email address is the only identity information required.

## Product Purpose

Calorie Tracker provides a fast, neutral daily record of consumed food, nutrition, and water. Version one succeeds when a verified user can establish personal goals, log from approved sources, use the product across phones and temporary connectivity loss, and accurately review today or any past day without health scoring, coaching, or gamification.

## Positioning

The product is a factual personal log rather than a coach: users define their own goals, missing data remains visibly unknown, and the interface does not score, judge, or moralize intake.

## Operating Context

- Primary use is on a phone, with iPhone as the optimization target.
- Authentication is passwordless. A user enters an email address, opens a single-use magic link, and returns to a persistent device session.
- The same account may stay signed in on multiple phones. Sign-out affects only the current phone.
- Email verification is required before first-time setup or the daily log.
- Version one is English-only.
- Food and water records must remain useful during temporary connectivity loss, though new catalog searches may be unavailable offline.

## Capabilities and Constraints

- Authentication uses 15-minute, single-use magic links with explicit resend, delivery-failure, expiry, superseded-link, and replay behavior.
- The approved authentication API has five `/v1/auth` endpoints and uses a persistent host-only `__Host-session` cookie.
- First-time setup is a mandatory gate after verification and before the daily log.
- Every user-owned record is private and isolated to one account.
- The product must not request name, age, sex, height, weight, or other health-profile information.
- Remote session management, sign-out-all-devices, self-service account deletion, and email-address recovery are outside the approved version-one authentication boundary.
- The transactional-email provider, deployment target, supported iPhone/iOS matrix, and automated accessibility test strategy remain open decisions.

## Brand Commitments

- Product name: Calorie Tracker.
- Voice is concise, factual, neutral, and nonjudgmental.
- The authentication experience uses a dark, distinctly iOS-native visual language. It should rely on familiar iPhone hierarchy, grouped surfaces, one system-like tint, and touch-first controls rather than desktop document or Microsoft-style interface patterns.

## Evidence on Hand

- `PRD.md` is the product behavior authority.
- `TDD.md` contains the approved authentication API, session policy, and SQLite persistence model.
- No logo, custom typeface, photography, customer proof, or production brand assets exist in the repository. Future work must not fabricate them as established assets.

## Product Principles

- Make frequent logging and sign-in actions require as few steps as possible.
- Present facts neutrally, without coaching, judgment, or gamification.
- Keep every account's data private and strictly isolated.
- Never let failed, pending, or incomplete records silently distort totals.
- Preserve useful local behavior during temporary connectivity loss.

## Accessibility & Inclusion

Version one must conform to WCAG 2.2 Level AA. Authentication must remain operable with keyboard and assistive technology, expose status and errors in text rather than color alone, support mobile text scaling, and maintain touch targets suitable for phone use.
