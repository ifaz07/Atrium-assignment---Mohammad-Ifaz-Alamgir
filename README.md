# Atrium Coaching Centre

I built Atrium as a room and session booking system for a coaching centre in `America/New_York`. Coaches reserve rooms to lead sessions, and participants—including coaches attending another coach's session—reserve places.

I used Node.js, Express, and TypeScript for the API; PostgreSQL with raw `pg` queries for persistence; and Next.js with TypeScript for the web application.

## Technical choices

| Area | Choice | Reason |
| --- | --- | --- |
| Database access | Raw `pg` | It lets me use explicit SQL, locking, transaction isolation, and PostgreSQL constraints for booking rules. |
| Email | Nodemailer + Mailpit | Mailpit provides a local inbox at `http://localhost:8025` for reviewing email flows. |
| Scheduler | `node-cron` | The API starts the daily jobs and runs them at midnight in the centre's timezone. Database job records make a run idempotent. |
| Assistant model | OpenAI-compatible hosted API or deterministic stub | Provider, URL, model, and key are environment variables. Tests use the stub and never require a live model or API key. |
| Tests | Node `node:test` + `tsx` | This provides lightweight integration tests without another test framework. |
| Validation | Server-side TypeScript validation | Each relevant write path validates times, ownership, IDs, credits, and roles. |
| UI | Next.js + custom CSS | This keeps the interface responsive without a component-library dependency. |

## Setup and run

These instructions are for a reviewer starting from a fresh clone. Install Node.js 20+, PostgreSQL 15+, and Git first. Mailpit is optional but recommended for viewing email locally.

Clone the repository and enter it:

```cmd
git clone <YOUR-REPOSITORY-URL>
```

Create separate development and test databases:

```cmd
createdb atrium
createdb atrium_test
```

If `createdb` is not available on PATH, create databases with the same names using pgAdmin or another PostgreSQL client.

Create the local environment file:

```cmd
copy .env.example .env
```

The supplied values work for a local PostgreSQL installation using the default `postgres` username and password. If the local PostgreSQL username or password differs, update only `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` before continuing.

Install dependencies, apply migrations, build, and run the tests:

```cmd
npm install
npm run migrate
npm run build
npm test
```

Start the API and web app in two separate Command Prompt windows:

```cmd
npm run dev:api
```

```cmd
npm run dev:web
```

Open the public site at `http://localhost:3000`. The API runs at `http://localhost:4000`. Demo credentials are listed in `.env.example`.

## Email and scheduled jobs

I use Mailpit as the local SMTP server. Download the latest Windows archive from [Mailpit's GitHub releases](https://github.com/axllent/mailpit/releases/latest), extract it, and open PowerShell in the extracted folder that contains `mailpit.exe`. Start it with:

```powershell
.\mailpit.exe
```

Keep that window running, then open `http://localhost:8025` to inspect messages. The supplied `.env.example` already configures SMTP for Mailpit at `localhost:1025`. If Mailpit was added to the Windows PATH, `mailpit` also works from any folder.

Each business transaction writes its email event to PostgreSQL's `email_outbox` in the same transaction. A worker delivers and retries pending messages. This is at-least-once delivery: an SMTP message may duplicate if a process fails immediately after SMTP accepted it.

Coach summaries and the administrator digest run at `00:00` in `CENTRE_TIMEZONE`, not at a fixed UTC hour. I calculate each reporting window from one New York local midnight to the next, so daylight-saving days correctly contain 23 or 25 hours.

To manually queue a digest run:

```cmd
npm run email:digests
npm run email:digests -- 2026-11-01
```

## Credits, fees, and cancellation policy

Credits are non-negative integers. A participant account created by the application starts with **4000** credits; a coach account created by the application starts with **2000** credits.

| Session type | Teaching / room reservation | Coach room fee | Participant place fee |
| --- | ---: | ---: | ---: |
| Short | 45 minutes | 30 credits | 15 credits |
| Standard | 60 minutes | 40 credits | 20 credits |
| Intensive | 180 minutes teaching; 210 minutes reserved | 120 credits | 60 credits |

For an intensive session, the 30-minute lunch interval is included in both the room and everyone’s reservation. No coach or attendee can be booked elsewhere during that interval.

My participant cancellation policy is:

| Notice before session start | Refund |
| --- | ---: |
| At least 48 hours | 100% |
| 24 to under 48 hours | 50% |
| Under 24 hours | 0% |

I chose this policy because it gives participants a full refund with reasonable notice while protecting a coach's ability to fill a late vacancy. If the coach cancels a session, every active attendee receives a **100% refund**, because the attendee did not cause the cancellation.

The required coach room-cancellation policy is 100% at 96+ hours, 50% at 48 to under 96 hours, 25% at 24 to under 48 hours, and 0% under 24 hours. Any fractional refund is rounded down using `Math.floor`, so the system never issues fractional credits.

## AI assistant

I built one assistant at `/assistant`. It derives the caller and role from the secure session cookie. It never accepts a role or person ID from browser or chat input. Every tool performs its own role/ownership check and a permission-filtered query before data reaches the model; the model is not the access-control boundary.

Use the deterministic local/test mode without an API key:

```env
MODEL_PROVIDER=stub
```

To use a hosted OpenAI-compatible response, set these values in `.env`:

```env
MODEL_PROVIDER=openai
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4.1-mini
MODEL_API_KEY=replace-with-your-own-key
```

If hosted-model configuration is absent or unavailable, the assistant continues with deterministic responses.

### Supported assistant commands

| Caller | Example commands |
| --- | --- |
| Anonymous visitor | `Show available sessions`; `What does session 704 cost?`; `How many places remain in session 704?`; `Book session 704 for new-email@example.com` |
| Participant | `What is my credit balance?`; `Show my bookings`; `Book session 704`; `Cancel my booking for session 704` |
| Coach | `What can I do as a coach?`; `Show my teaching sessions`; `Show attendees for session 802`; `Who cancelled session 802?`; `Which attendees repeatedly attended my session 802?`; `Cancel session 802`; `Reschedule session 802 to 2026-08-20 14:00 in room 2` |
| Administrator | `What can I do as an administrator?`; `Show all users`; `Show all coaches`; `Show bookings for Sofia Marino`; `Show all bookings`; `Show all sessions`; `Show attendees for session 393`; `Show the credit balance for Oscar`; `Set Oscar Lindqvist's credits to 2000`; `Deactivate Sofia Marino`; `Activate Sofia Marino`; `Cancel session 393`; `Reschedule session 393 to 2026-08-20 14:00 in room 2` |

An anonymous booking creates a participant account with 4000 credits, makes the booking, and sends a one-time password-setup link that expires after 24 hours. The application never generates or displays a password.

Reschedule dates are interpreted in `America/New_York`. Before a session moves, I validate its room, opening hours, coach availability, and every active attendee’s availability. On success, the session and active bookings move together and every affected attendee is notified.

## Invariants

| Invariant | Database enforcement | Application enforcement and reason |
| --- | --- | --- |
| Valid person/session/enrolment states; non-negative integer credits and fees | `CHECK`, `NOT NULL`, foreign keys, unique constraints | Clear API errors and business-rule messages. |
| Session-type duration | `session_duration_matches_type` constraint | The UI calculates the end time and the server validates opening hours. |
| One room per active interval | GiST exclusion constraint using half-open `[)` ranges | Protects against concurrent writes even if application checks race. |
| One active enrolment per person/session | Partial unique index | Friendly duplicate-booking error. |
| Capacity, own-session enrolment, sufficient credits, and person-time conflicts | Not expressible as a simple row constraint | Checked and locked in serializable booking transactions. |
| Sunday closure, 07:00–21:00 hours, 15-minute starts, and 48-hour coach notice | Requires centre-local time and business context | Validated in application code. |
| Visibility and authorised changes | No database-role model in this local app | Role comes from the server session; queries include ownership filters. |
| Email created with the business write | `email_outbox` insert in the same transaction | Worker retries later SMTP delivery. |

## Transactions and isolation levels

I use PostgreSQL `SERIALIZABLE` for participant/coach place booking, participant/coach cancellation, coach/admin session cancellation, coach/admin rescheduling, anonymous booking with account creation, and password-token redemption. This prevents write-skew and concurrent capacity or overlap races. A PostgreSQL serialization failure returns a conflict response so the caller can retry.

I use `READ COMMITTED` for ordinary reads and outbox delivery state, where competing booking decisions are not coordinated. A later statement can see a newer committed value, so I do not use it for capacity or schedule-conflict decisions. `SERIALIZABLE` cannot guarantee exactly-once effects outside PostgreSQL: an SMTP email can duplicate after a process failure.

## Defects found and corrected

- The starter seed stored fractional credit balances and charges. `002_booking_integrity.sql` converts them to integer credits and adds integer/non-negative constraints.
- Some intensive seed sessions reserved only 180 minutes. I correct them to the required 210-minute room interval and add a duration constraint.
- Cancelled or invalid seed booking relationships blocked integrity constraints. I reconcile those records by cancelling/refunding them rather than deleting history.
- The starter did not enforce active-room overlap. I add a GiST exclusion constraint using half-open intervals, including protection against concurrent requests.
- The starter had no secure login/session schema and used legacy starter password values. I add hashed-session storage and bcrypt demo-password hashes; the API never trusts a role supplied in a request.
- The original `idx_session_created_discipline_status` index did not support calendar and active-booking queries. I add partial active-session, active-coach-time, active-enrolment-by-session, active-enrolment-by-person, outbox, and account-token lookup indexes.

### Query-plan evidence

I ran these queries against two disposable PostgreSQL databases: one with only `001_init.sql`, and one with all migrations applied. The test date was `2026-08-01`. These are the actual `EXPLAIN (ANALYZE, BUFFERS)` results from my local PostgreSQL instance.

#### Calendar query

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.id, s.starts_at
FROM session s
WHERE s.status <> 'cancelled'
  AND s.starts_at >= '2026-08-01'
ORDER BY s.starts_at;
```

Before migration:

```text
Sort  (cost=60.88..62.80 rows=769 width=12) (actual time=0.313..0.340 rows=769 loops=1)
  Sort Key: starts_at
  Sort Method: quicksort  Memory: 49kB
  Buffers: shared hit=15
  ->  Seq Scan on session s  (cost=0.00..24.02 rows=769 width=12) (actual time=0.023..0.170 rows=769 loops=1)
        Filter: ((status <> 'cancelled'::text) AND (starts_at >= '2026-08-01 00:00:00+06'::timestamp with time zone))
        Rows Removed by Filter: 32
        Buffers: shared hit=12
Planning:
  Buffers: shared hit=114
Planning Time: 2.873 ms
Execution Time: 0.391 ms
```

After migration:

```text
Sort  (cost=64.66..66.57 rows=765 width=12) (actual time=0.369..0.450 rows=765 loops=1)
  Sort Key: starts_at
  Sort Method: quicksort  Memory: 48kB
  Buffers: shared hit=19
  ->  Seq Scan on session s  (cost=0.00..28.02 rows=765 width=12) (actual time=0.020..0.175 rows=765 loops=1)
        Filter: ((status <> 'cancelled'::text) AND (starts_at >= '2026-08-01 00:00:00+06'::timestamp with time zone))
        Rows Removed by Filter: 36
        Buffers: shared hit=16
Planning:
  Buffers: shared hit=177 read=4
Planning Time: 4.514 ms
Execution Time: 0.495 ms
```

This small query returns most rows, so PostgreSQL correctly kept a sequential scan and in-memory sort. I do not claim an improvement for this broad calendar query.

#### Active participant-booking query

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT e.session_id
FROM enrolment e
WHERE e.person_id = 2 AND e.status = 'active';
```

Before migration:

```text
Seq Scan on enrolment e  (cost=0.00..71.48 rows=109 width=4) (actual time=0.023..0.308 rows=108 loops=1)
  Filter: ((person_id = 2) AND (status = 'active'::text))
  Rows Removed by Filter: 2924
  Buffers: shared hit=26
Planning:
  Buffers: shared hit=74
Planning Time: 1.655 ms
Execution Time: 0.389 ms
```

After migration:

```text
Bitmap Heap Scan on enrolment e  (cost=5.12..32.74 rows=108 width=4) (actual time=0.132..0.227 rows=107 loops=1)
  Recheck Cond: ((person_id = 2) AND (status = 'active'::text))
  Heap Blocks: exact=26
  Buffers: shared hit=26 read=2
  ->  Bitmap Index Scan on enrolment_active_person_index  (cost=0.00..5.09 rows=108 width=0) (actual time=0.116..0.116 rows=107 loops=1)
        Index Cond: (person_id = 2)
        Buffers: shared read=2
Planning:
  Buffers: shared hit=120
Planning Time: 3.525 ms
Execution Time: 0.299 ms
```

The migration adds `enrolment_active_person_index`. PostgreSQL now uses it instead of scanning all 3,032 enrolment rows, and execution time decreased from `0.389 ms` to `0.299 ms` on this small local dataset.

## Assumptions and design decisions

- I interpret assistant dates as `America/New_York`, because the centre operates in that timezone. Without this rule, the same chat date/time could identify different instants for the user and server.
- I restrict session start times to `:00`, `:15`, `:30`, or `:45` past the hour to make booking and rescheduling predictable. The brief does not require this; if arbitrary start minutes are expected, this validation and the booking controls would need to be relaxed.
- I interpret “an administrator—substantially anything” as including credit management. Credit changes require an authenticated administrator, a specific user identifier, and an integer value.
- I treat deactivation as blocking future login and authenticated access while retaining historical records. If hard deletion were required, the system would need a separate retention/anonymisation policy to preserve booking and audit history.
- The participant cancellation tiers and rounding-down rule are deliberate design decisions because the brief asks me to define and justify them.
- I preserve existing historical seed balances rather than resetting them. I apply 4000/2000 credits only when this application creates an account. I do not claim that pre-existing seed balances were caused by legitimate charges or refunds without confirming that from the data audit.

The intensive lunch interval, coach cancellation tiers, starting credits for newly created accounts, and the requirement to define a fee schedule are assignment requirements, not assumptions.

## Current status

All required features are complete. I verified the application from a clean clone using fresh `atrium` and `atrium_test` databases, manually confirmed the Mailpit email flows, and checked the interface at a 375px mobile width. The project is ready for submission.
