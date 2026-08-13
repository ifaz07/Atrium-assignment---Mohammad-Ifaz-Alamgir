# Atrium Coaching Centre

Atrium is a booking system for coaches, participants and administrators. It uses Node.js, Express and TypeScript for the API, PostgreSQL with raw `pg` queries for persistence, and Next.js with TypeScript for the web application.

## Local setup

Requirements are Node.js 20 or later, PostgreSQL 15 or later and Git.

1. Create PostgreSQL databases named `atrium` and `atrium_test`.
2. Copy `env.example` to `.env`.
3. Set `DATABASE_URL`, `TEST_DATABASE_URL` and a private `SESSION_SECRET` in `.env`.
4. Run `npm install`.
5. Run `npm run migrate`.
6. Run `npm run dev:api`.
7. In another terminal, run `npm run dev:web`.

The public site is available at `http://localhost:3000` and the API at `http://localhost:4000`.

## Local email with Mailpit

Mailpit is the chosen SMTP transport because reviewers can inspect every email without credentials or delivery to real addresses.

1. Download the Windows Mailpit binary from the Mailpit releases page at `https://github.com/axllent/mailpit/releases`.
2. Extract it and run `mailpit.exe`.
3. Keep the default SMTP settings from `env.example`: host `localhost` and port `1025`.
4. Start the Atrium API.
5. Book or cancel a session in Atrium.
6. Open `http://localhost:8025` to inspect the recipient, subject and body.

The API stores email in a PostgreSQL outbox in the same transaction as the booking change. A background worker sends pending messages and retries temporary failures. Delivery is at-least-once, so a duplicate is possible if SMTP accepts a message immediately before the process loses its database connection.

Daily coach summaries and the administrator digest run at midnight in `CENTRE_TIMEZONE`. The scheduler also checks the current centre date when the API starts, and database job records prevent duplicate daily runs. To demonstrate the same job without waiting until midnight, run:

```powershell
npm run email:digests
```

To run a specific centre-local date:

```powershell
npm run email:digests -- 2026-11-01
```

Automated tests use an in-process deterministic mail sender and never require Mailpit or an internet connection.
