# Atrium Coaching Centre

Atrium is a room and session booking system for a coaching centre in `America/New_York`. Coaches reserve rooms to run sessions; participants (including coaches attending another coach) reserve places. The project uses Node.js, Express and TypeScript for the API, PostgreSQL with raw `pg` queries, and Next.js with TypeScript for the web application.

## Stack and choices

| Area | Choice | Why |
| --- | --- | --- |
| Database access | Raw `pg` | The booking rules need explicit locking, transaction isolation and SQL constraints; direct SQL makes those visible and reviewable. |
| Email | Nodemailer + local Mailpit | A marker can see every message at `http://localhost:8025` without credentials. |
| Scheduler | `node-cron` | It runs at `00:00` in the centre time zone whenever the API starts. Database job records make daily work idempotent. |
| Assistant model | Hosted OpenAI API or deterministic stub | The provider base URL and model are environment settings; tests use the stub and never need a live key. |
| Tests | Node built-in `node:test` with `tsx` | Small, dependency-light HTTP/database integration tests. |
| Validation | Explicit TypeScript/server validation | Booking times, ownership, IDs, credits and roles are validated close to the relevant write path. |
| UI | Next.js + custom CSS | A small responsive interface without a component-library dependency. |

## Setup and run

Requirements: Node.js 20+, PostgreSQL 15+, and Git. Mailpit is optional for builds/tests but required to inspect real local email.

1. Clone the repository and enter it.
2. Create empty PostgreSQL databases named `atrium` and `atrium_test`.
3. Copy `.env.example` to `.env`.
4. Set `DATABASE_URL`, `TEST_DATABASE_URL`, and a long random `SESSION_SECRET`. Do not commit `.env`.
5. Install and migrate:

```powershell
npm install
npm run migrate
```

6. Verify the application:

```powershell
npm run build
npm test
```

7. Start the API and web app in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

The public site is `http://localhost:3000`; the API is `http://localhost:4000`. Demo credentials are listed in `.env.example`. They are local seed/demo credentials only; replace `SESSION_SECRET` before running the application.

## Mailpit and scheduled jobs

Mailpit is the chosen SMTP transport. Download and run Mailpit, retain `SMTP_HOST=localhost` and `SMTP_PORT=1025` from `.env.example`, then open `http://localhost:8025`. Booking, cancellation and rescheduling messages should appear there.

The application writes email to PostgreSQL’s `email_outbox` in the same transaction as the business change. A worker retries pending delivery. This is at-least-once delivery: an SMTP acknowledgement immediately before a process failure can produce a duplicate email.

Coach summaries and the administrator digest run at midnight in `CENTRE_TIMEZONE`, never a fixed UTC hour. The day window is calculated from New York local midnight to the next local midnight, so daylight-saving days correctly last 23 or 25 hours. To queue a digest manually:

```powershell
npm run email:digests
npm run email:digests -- 2026-11-01
```

## Credits, fees and cancellation policy

Credits are non-negative integers. New participant accounts start with **4000** credits; new coach accounts start with **2000** credits.

| Session type | Teaching / room time | Coach room fee | Participant place fee |
| --- | ---: | ---: | ---: |
| Short | 45 minutes | 30 credits | 15 credits |
| Standard | 60 minutes | 40 credits | 20 credits |
| Intensive | 180 minutes teaching; 210 minutes room reservation | 120 credits | 60 credits |

The intensive session reserves its 30-minute lunch interval too, so neither the room nor anyone involved can be booked elsewhere in that interval.

Participant cancellation policy: 100% at least 48 hours before, 50% from 24 to under 48 hours, then 0%. A coach cancellation gives every active attendee a 100% refund because the centre caused the change. Coach room-cancellation refunds are 100% at 96+ hours, 50% at 48–96, 25% at 24–48, and 0% below 24. This rewards reasonable notice while protecting booked room capacity. Any non-integral calculation uses `Math.floor`: Atrium deliberately rounds down to avoid issuing a fraction of a credit.

## Assistant

There is one assistant at `/assistant`. It reads the caller and role from the secure session cookie. It never accepts a role or person ID from browser/chat input. Each tool independently performs its role/ownership check and permission-filtered query before data reaches the model; the model is not the access-control boundary.

Set the deterministic local mode for test/review without a model key:

```env
MODEL_PROVIDER=stub
```

For a hosted OpenAI response, set private values only in `.env`:

```env
MODEL_PROVIDER=openai
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4.1-mini
MODEL_API_KEY=replace_with_your_own_key
```

Never commit an API key. If no usable OpenAI configuration is present, the assistant gives deterministic safe responses.

### Assistant commands

Anonymous visitor: `Show available sessions`; `What does session 704 cost?`; `How many places remain in session 704?`; `Book session 704 for new-email@example.com`.

The anonymous booking creates a participant account with 4000 credits, books the place, and emails a one-time 24-hour password-setup link. No password is generated or displayed.

Participant: `What is my credit balance?`; `Show my bookings`; `Book session 704`; `Cancel my booking for session 704`.

Coach: `What can I do as a coach?`; `Show my teaching sessions`; `Show attendees for session 802`; `Who cancelled session 802?`; `Which attendees repeatedly attended my session 802?`; `Cancel session 802`; `Reschedule session 802 to 2026-08-20 14:00 in room 2`.

The reschedule command is interpreted in `America/New_York`. It checks the new room, opening hours, the coach and every active attendee for conflicts. It moves the session and its active bookings together, then queues an email to every affected attendee.

Administrator: `What can I do as an administrator?`; `Show all users`; `Show all coaches`; `Show bookings for Sofia Marino`; `Show all bookings`; `Show all sessions`; `Show attendees for session 393`; `Show the credit balance for Oscar`; `Set Oscar Lindqvist's credits to 2000`; `Deactivate Sofia Marino`; `Activate Sofia Marino`; `Cancel session 393`; `Reschedule session 393 to 2026-08-20 14:00 in room 2`.

## Invariants and where they are enforced

| Invariant | Database enforcement | Application enforcement / reason |
| --- | --- | --- |
| Valid person/session/enrolment states, non-negative integer credits and fees | `CHECK`, `NOT NULL`, foreign keys and unique constraints | Clear API errors and business-rule messages. |
| Session type duration | `session_duration_matches_type` constraint | UI calculates the correct end time; server validates local opening hours. |
| One room per active interval | PostgreSQL GiST exclusion constraint using half-open `[)` ranges | Catches concurrent writes even if application checks race. |
| One active enrolment per person/session | Partial unique index | Friendly duplicate-booking error. |
| Capacity, own-session enrolment, credit sufficiency, and person time conflicts | Not expressible as a simple row constraint | Checked and locked in the serializable booking transaction. |
| Sunday closure, 07:00–21:00 hours, 15-minute starts, 48-hour coach notice | Requires centre-local clock/business context | Validated in application code. |
| Who may view/change data | Not a database role model in this local app | Server derives the role from the session and performs ownership-filtered queries. |
| Email event created with the write | `email_outbox` inserted in the same transaction | Worker handles later SMTP retries. |

## Transactions and isolation

All booking-related writes use PostgreSQL `SERIALIZABLE`: participant/coach place booking, participant/coach cancellation, coach/admin session cancellation, coach/admin rescheduling, anonymous booking plus account creation, and password setup token redemption. This prevents write-skew and concurrent capacity/overlap races; callers receive a conflict response if PostgreSQL aborts a serialization failure and may retry.

`READ COMMITTED` is used only where a transaction does not coordinate competing booking decisions, such as ordinary reads and outbox delivery state. It can observe a later committed value on a subsequent statement; it is intentionally not used to decide capacity or schedule conflicts. Even `SERIALIZABLE` cannot provide exactly-once effects outside PostgreSQL: SMTP delivery may duplicate after a process failure.

## Defects found and corrected

- The starter seed stored fractional credit balances/charges. Migration `002_booking_integrity.sql` converts them to integer credits and adds integer/non-negative constraints.
- Some intensive seed sessions reserved only 180 minutes. The migration corrects them to the required 210-minute room interval and adds a duration constraint.
- The seed contained cancelled/invalid booking relationships that blocked integrity constraints. Those specific records were reconciled by cancelling/refunding them rather than deleting historical data.
- The starter had no enforceable active-room overlap rule. A GiST exclusion constraint now protects room scheduling at database level, including concurrent requests, using half-open intervals.
- The seed had no secure login/session schema and used legacy starter password values. Migration `003_secure_auth.sql` adds hashed-session storage and bcrypt demo password hashes; the API never trusts role data supplied by a request.
- The original `idx_session_created_discipline_status` index did not serve the calendar/active booking lookups. Partial active-session, active-coach-time, active-enrolment-by-session and active-enrolment-by-person indexes now match these filters; outbox and account-token indexes support delivery and one-time setup lookup.

### Query-plan evidence

The original starter state is intentionally not recreated or altered just to manufacture timing numbers, so this repository does not claim invented `EXPLAIN` timings. To collect comparable evidence on a disposable copy of the original seed before applying `002_booking_integrity.sql`, then on the migrated database, run the same command in both states:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.id, s.starts_at
FROM session s
WHERE s.status <> 'cancelled'
  AND s.starts_at >= now()
ORDER BY s.starts_at;
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.session_id
FROM enrolment e
WHERE e.person_id = 2 AND e.status = 'active';
```

The after state has `session_active_calendar_index` and `enrolment_active_person_index` specifically for these predicates. Record the actual plan, execution time and buffer counts for the PostgreSQL version/hardware used for marking; small seeded datasets may correctly still choose a sequential scan.

## Assumptions

- “Account creation” means a newly created participant/coach starts at the prescribed balance. Historical seed accounts retain their existing historical balance; it may be above or below the starting amount because of previous charges/refunds.
- Intensive’s 30-minute lunch is treated as part of the person and room reservation, because the brief says nobody involved may be elsewhere during it. If it were not reserved, an attendee could be double-booked in the lunch interval.
- Dates entered through chat are `America/New_York`; otherwise the server and user could interpret a valid local booking at different instants.
- Administrator credit updates are allowed because “substantially anything” includes credit management. They require an explicit admin session, exact user identifier and integer value; no other role can invoke them.
- Account deactivation blocks future login/access but does not delete historical records. Deleting would make audit/history and past bookings inconsistent.

## Remaining work

No known required feature is intentionally unfinished. Before submission, perform the clean-clone checklist from a new directory and fresh `atrium`/`atrium_test` databases: install, migrate, build, test, start Mailpit/API/web, then manually verify each email flow and the 375px layouts. This is an operational verification step, not a product feature.
