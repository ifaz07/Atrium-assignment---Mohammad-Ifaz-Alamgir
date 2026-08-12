# Baseline audit findings

This document records defects confirmed in the untouched starter application.

## Finding 1: Refund rounding test fails

- Location: `api/src/credits.ts:33`
- Evidence: `npm test` fails `a refund of part of a credit`; `Math.round(30 * 0.25)` returns `8`, while the supplied test expects `7`.
- Expected: Credits are integers and partial refunds follow a documented rounding direction.
- Actual: The refund calculation rounds upward for a 7.5-credit refund.
- Root cause: `Math.round` rounds halves upward.
- Planned fix: Choose, document, and test a consistent rounding policy. The intended policy is to round down.

## Finding 2: Password hashing is unsuitable for authentication

- Location: `api/src/auth.ts:13`
- Evidence: `hashPassword` uses a single SHA-256 digest with no password-specific work factor or salt.
- Expected: Passwords use a current password-hashing algorithm.
- Actual: Passwords are hashed with SHA-256.
- Root cause: The starter uses a general-purpose cryptographic hash instead of a password-hashing algorithm.
- Planned fix: Migrate authentication to Argon2 or bcrypt and provide a safe password-setting flow.

## Finding 3: Any signed-in person can read every person's private data

- Location: `api/src/routes/people.ts:7`
- Evidence: The route requires only a valid session and selects every person's email, role, credit balance, and active state.
- Expected: Participants can access only their own bookings and balance; role-specific data is enforced at the API boundary.
- Actual: Any signed-in user can request the entire people list.
- Root cause: No role or ownership authorization is applied to the route.
- Planned fix: Replace this endpoint with role-scoped responses and enforce authorization server-side.

## Finding 4: Any signed-in person can read all session attendees

- Location: `api/src/routes/sessions.ts:68`
- Evidence: The session-detail route requires only a valid session and returns attendee names, emails, charges, refunds, and cancellation timestamps.
- Expected: Only the session's coach and administrators can see its attendee list.
- Actual: Any authenticated user can retrieve the full attendee list for any session ID.
- Root cause: No role or ownership authorization is applied before loading attendees.
- Planned fix: Restrict detail fields and attendee queries by caller role and session ownership.

## Finding 5: Any signed-in person can create a session for any coach

- Location: `api/src/routes/sessions.ts:108`
- Evidence: The create route requires only a valid session and accepts `coach_id` from the request body.
- Expected: Only an authorized coach may book a room for themselves, with administrators following explicitly defined rules.
- Actual: Any authenticated caller can create a session and charge the supplied coach.
- Root cause: The caller's role and identity are not checked against `coach_id`.
- Planned fix: Derive the coach from the authenticated session, enforce role checks, and validate booking rules transactionally.

## Finding 6: Any signed-in person can edit any session

- Location: `api/src/routes/sessions.ts:172`
- Evidence: The update route requires only a valid session and accepts changes to room, coach, status, and session times.
- Expected: Only authorized administrators or the relevant coach can reschedule according to the business rules.
- Actual: Any authenticated caller can edit any session.
- Root cause: No role or ownership authorization is applied to the update route.
- Planned fix: Add authorization and revalidate every invariant during rescheduling.

## Finding 7: Any signed-in person can cancel any session

- Location: `api/src/routes/sessions.ts:216`
- Evidence: The cancellation route requires only a valid session and does not verify that the caller owns the session or is an administrator.
- Expected: Only the session's coach or an administrator can cancel it.
- Actual: Any authenticated caller can cancel any session and trigger credit changes.
- Root cause: No role or ownership authorization is applied to cancellation.
- Planned fix: Enforce authorized cancellation and make all refunds and updates transactional.

## Finding 8: Credits are stored as decimal values

- Location: `migrations/001_init.sql:7`
- Evidence: `person.credits`, session fees, and enrolment charges/refunds use `numeric(10,2)`; seed values include fractional credits.
- Expected: Credits are always integers.
- Actual: The schema permits decimal credits.
- Root cause: The starter schema models credits as currency-like decimals.
- Planned fix: Add a migration that converts credit columns to integer values using the documented rounding policy.

## Finding 9: Seed data contains sessions outside centre opening hours

- Location: `migrations/001_init.sql:186` and `migrations/001_init.sql:604`
- Evidence: The session at line 186 ends at 21:30 in America/New_York; the session at line 604 runs from 03:00 to 04:00 in America/New_York.
- Expected: Sessions run only Monday through Saturday from 07:00 to 21:00 America/New_York.
- Actual: Seeded scheduled sessions occur outside those hours.
- Root cause: The seed data was not validated against centre-local opening rules.
- Planned fix: Correct confirmed invalid records in a new migration and enforce opening-hour validation for future writes.

## Finding 10: Seed data contains a Sunday session

- Location: `migrations/001_init.sql:557`
- Evidence: The scheduled session is on Sunday, 1 November 2026 in America/New_York.
- Expected: The centre is closed on Sundays.
- Actual: A scheduled Sunday session exists.
- Root cause: The seed data was not validated against the weekly closure rule.
- Planned fix: Correct the record in a new migration and enforce the closure rule for future writes.

## Finding 11: Seed data contains an overlapping room booking

- Location: `migrations/001_init.sql:626` and `migrations/001_init.sql:767`
- Evidence: Two scheduled sessions in Room 5 overlap from 08:30 to 09:15 America/New_York on 15 September 2026.
- Expected: A room has at most one active session at a time.
- Actual: Two scheduled sessions occupy the same room concurrently.
- Root cause: The schema has no exclusion constraint preventing room-time overlaps.
- Planned fix: Correct the invalid record in a new migration and add an active-session room-range exclusion constraint.

## Finding 12: Seed data contains intensive sessions with the wrong room duration

- Location: `migrations/001_init.sql:262` and `migrations/001_init.sql:905`
- Evidence: Each intensive session lasts 180 minutes, not the required 210 minutes of room occupancy.
- Expected: Intensive teaching lasts 180 minutes but holds its room for 210 minutes.
- Actual: The seeded sessions occupy their rooms for 180 minutes.
- Root cause: The seed data encodes teaching duration rather than required room duration.
- Planned fix: Correct confirmed records in a new migration and enforce duration by session type.
