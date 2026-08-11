# Atrium — starter

This is the codebase you have been given. It runs. Read the assignment brief in
[`assignment/ASSIGNMENT.md`](assignment/ASSIGNMENT.md) before you start changing things.

---

## Prerequisites

- Node 20 or later
- PostgreSQL 15 or later, running locally
- Git

Docker is not required and earns no marks. Do not spend time on it.

---

## Setup

```bash
# 1. Create a database
createdb atrium
#    If createdb is not on your PATH, either add the PostgreSQL bin directory to
#    it, or create the database any other way you like — psql, pgAdmin, or your
#    editor's database tool. Only the database needs to exist; step 4 builds the
#    schema.

# 2. Configure the environment
cp env.example .env
#    Edit .env and set DATABASE_URL to your local Postgres

# 3. Install
npm install

# 4. Apply the migration — this creates the schema and loads the seed data
npm run migrate

# 5. Start the API
npm run dev:api

# 6. In a second terminal, start the frontend
npm run dev:web
```

The public page is at `http://localhost:3000`.
The admin dashboard is at `http://localhost:3000/admin`.

Administrator credentials are in `env.example`.

---

## What is here

- A public page
- An administrator dashboard with minimal functionality — sessions can be listed and created
- A migration file carrying the schema and several months of seeded historical data
- A partially passing test suite

Coaches and participants exist as rows in the database but cannot log in. There is no role system. Building one is part of the assignment.

---

## Important

**The seed data is the dataset. Do not replace it.**

You may correct individual records where you have found a problem and can justify the correction in your README. You may not truncate the tables and regenerate clean data, and you may not delete rows to make a constraint apply. The state of that data is part of what you are being asked to assess, and a submission that starts by wiping it has skipped the exercise.

If you change the schema, do it with a new migration. Do not edit the migration you were given.

---

## Setting up your repository

1. On the starter repository on GitHub, press **Use this template → Create a new
   repository**. That gives you your own copy under your own account, with a
   clean history. Do not fork it and do not open pull requests against it
2. Clone your new repository and work there
3. Make it public, or keep it private and add the handles listed in the brief as
   collaborators
4. Send us the URL

Commit as you go. We read the history.

---

## Environment variables

Every variable the application uses is listed in `env.example`. As you add features that need configuration — mail transport, model provider, scheduler — add the variables to `env.example` as well. A marker will set up your project from that file alone.

Do not commit `.env`. Do not commit secrets, API keys or credentials of any kind.
