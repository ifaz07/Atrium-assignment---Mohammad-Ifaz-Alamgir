# Atrium Coaching Centre

## Full-Stack Engineering Assignment

**Role** Junior Full-Stack Engineer · **Due** Tuesday 11 August 2026, 23:59 Asia/Dhaka

---

## 1. Scenario

Atrium is a coaching centre operating twelve rooms in `America/New_York`, open 07:00 to 21:00 Monday to Saturday and closed on Sundays. Coaches book a room in order to run a session; participants book a place in that session. Coaches also attend one another's sessions, so the same person is sometimes a coach and sometimes a participant, and nobody can be in two rooms at once.

This is a starter repo you need to work on. You are given what they left behind. It runs, it holds seeded historical data, and it is not in good condition. You are tasked to make it functional with good UI and complete the assignment.

---

## 2. Stack

Required:

- **Backend** — Node, Express, TypeScript
- **Database** — PostgreSQL
- **Frontend** — Next.js, TypeScript

Your choice, but state what you picked and why:

- **Database access** — raw `pg`, Prisma, Drizzle, Knex, anything
- **Email transport** — you do not need a real mail provider, and you should not spend time on one. A local catch-all SMTP server is the least effort and the easiest for us to reproduce: **Mailpit** is a single binary that listens for SMTP on port 1025 and gives you a web inbox on 8025, so you can watch mail arrive. Nodemailer's **Ethereal** test account is the zero-install alternative — it creates a throwaway SMTP account at runtime and returns a preview URL per message. `env.example` already carries an SMTP block pointing at `localhost:1025`. Gmail over OAuth or a hosted provider is acceptable if you prefer it. Whatever you choose, your README must say exactly how to run it, and a marker must be able to see the mail without any credentials of yours
- **Scheduler** — node-cron, BullMQ, a system cron, anything that survives a restart
- **Model provider for the assistant** — Ollama with an open-weights model, or a hosted API. Base URL and model name behind environment variables, and a deterministic stub so tests do not need a live model
- **Testing framework, validation library, UI library**


---

## 3. What you are given

A starter repository — <https://github.com/metaora-arnab/atrium> — containing:

- A public page
- An administrator dashboard with minimal starter functionality
- A migration file carrying the schema and the seeded historical data, spanning several months including the 1 November 2026 daylight-saving change
- An example `.env`
- Setup instructions

It is a GitHub template. Press **Use this template → Create a new repository** to
get your own copy under your own account, with a clean history starting at your
first commit. Do not fork it and do not open pull requests against it.

**None of it has been validated. Verifying it is your job.** We will not tell you what is wrong, how many problems there are, or where to look.Finding these unprompted is assessed, and it is worth more than any single feature you could build instead.

You may change the schema. Migrations are the mechanism and they are read.

---

## 4. What we want

You are turning that starter into something a coaching centre could actually use.
In short:

- **A working booking system.** Coaches book rooms, participants book places, either can cancel, and credits move correctly when they do
- **One login for everyone**, with what a person sees decided by their role
- **An AI assistant** that knows who is asking and answers only what that person is entitled to know
- **Email that actually sends**, and scheduled jobs that run on centre-local time
- **A calendar** each role can read
- **The problems in what you were given, found and fixed** — this counts for more than any single feature you could add

**We want all of it in a good-looking interface — but do not sink your time into
it.** Clean, consistent and obviously deliberate is the bar: readable tables,
sensible spacing, buttons that look like buttons, nothing left blank. It should
look like a product rather than a test harness. It does not need to be original and
we are not marking taste. If you find yourself choosing colour palettes, stop and go
back to the booking rules.

Every item above is specified properly in the sections that follow — the domain
rules, the refund policy, who may see what, the mandatory requirements, and how it
is all marked. Read those before you start building. This section is only the shape
of the thing.

---

## 5. Domain rules

- Three session types: `SHORT` is 45 minutes, `STANDARD` is 60 minutes, `INTENSIVE` is 180 minutes of teaching but holds the room for 210 because of a 30-minute lunch interval in the middle
- Nobody involved in an `INTENSIVE` — coach or participant — may be booked elsewhere during that lunch interval, in any room
- All intervals are half-open. A session ending at 10:00 and one starting at 10:00 do not conflict
- One room holds one session at a time
- No person may hold two overlapping commitments, whether from teaching or from attending
- A session must fit entirely inside opening hours, on a day the centre is open
- Room capacity counts participants and excludes the coach
- A coach may not enrol in their own session
- A cancelled session releases its room and stops counting against everything
- Money is **credits**, always integers, never floating point
- Participants are issued **4000** credits on account creation; coaches are issued **2000**
- A coach spends credits to book a room; a participant spends credits to book a place. Both fees scale with session type and duration. **Define the fee schedule yourself and state it**
- Any refund that does not divide evenly rounds in a direction you chose deliberately and can justify

---

## 6. Booking and cancellation

**Coach**

- Must book a room at least **48 hours** before the session starts
- On cancellation the room fee is refunded by notice given, measured in absolute hours from the cancellation to the session start:
  - 96 hours or more — **100 per cent**
  - 48 up to 96 hours — **50 per cent**
  - 24 up to 48 hours — **25 per cent**
  - Under 24 hours — **nothing**

**Participant**

- **Design the equivalent policy yourself.** State the tiers and justify the shape you chose
- State explicitly what happens to a participant's credits when the **coach** cancels a session they had paid to attend. The participant has done nothing wrong

**Marketing page**

- Build a public page setting out both policies, the booking deadlines, the fee schedule and anything else a person could lose money by not knowing
- Write it for someone who has not read this brief
- It is assessed on whether a reasonable participant could make an informed decision from that page alone. One who ignores a clearly stated rule is expected to bear the consequence

---

## 7. Roles and visibility

- **Participant** — sees their own bookings and their credit balance. Nothing whatsoever about any other participant
- **Coach** — sees their own sessions with the full attendee list; sees **other coaches' booked slots as busy periods** so they can plan around them, but **never who is attending those sessions**; sees their own credit balance
- **Administrator** — sees everything

Hiding a field in the interface is not access control. If the data reaches the browser, the rule has already been broken, and this is tested at the API rather than through the screen.

---

## 8. Mandatory requirements

These are not optional and a submission missing any of them is incomplete:

- **Proper authentication** — real login for all three roles, password hashing with a current algorithm, session handling, and no role escalation by editing a request
- **One unified login** — a single sign-in form for everyone, not a separate entry point per role. Where a person lands and what their dashboard shows is decided by the role of whoever signed in
- **Email notifications** — working, on all six paths in Section 9
- **Calendar view** — for every role, honouring Section 7
- **A presentable interface** — to the bar set in Section 4: clean, consistent, nothing left blank. A plain interface done cleanly scores well; an unstyled one does not
- **Mobile responsive** — usable at 375px, with loading, empty and error states handled

### What we look at first

Three things, in this order. If the week gets away from you, protect these:

1. **Your repository and the public page** — sessions listed, and the policy and fee
   information a visitor needs before they book
2. **The unified login, resolving by role** — one sign-in form; a participant, a
   coach and an administrator each land on a different dashboard, seeing only what
   their role is allowed to see
3. **The assistant** — answering from real data, taking a booking, reporting a
   balance, and refusing or omitting whatever the caller is not entitled to

Everything else in this brief still counts and Section 13 is how it is weighted.
But a submission that gets these three genuinely working and stops there is
stronger than one spread thinly across everything.

---

## 9. Email and scheduled jobs

Event-driven:

- Coach cancels a session → administrator and every affected participant notified
- New participant books a coach's session → that coach notified
- Participant changes or cancels a booking → that session's coach notified
- Coach is attending someone else's session → notified of changes to it
- Any coach books a room → administrator notified
- Any coach cancels a room → administrator notified

Scheduled, both running at **00:00 centre-local time**:

- Each coach receives a summary of their bookings for the day ahead. A coach with none receives **no email at all**
- The administrator receives a digest of that day's bookings and attendances

Take the scheduling seriously. A job anchored to a fixed UTC hour fires at 23:00 local after 1 November 2026, and the local day it reports on is 25 hours long on that date and 23 hours long on 8 March. A window built by adding 24 hours to a local midnight is wrong twice a year.

---

## 10. Assistant

**One AI assistant.** A single chatbot that knows who it is talking to —
whether anyone is signed in, and if so in what role — and answers on that basis.
The same question asked by an anonymous visitor, a participant, a coach and an
administrator should come back with different answers, because each of them is
entitled to see different things. Do not build four assistants and do not ask the
user who they are; take it from the session.

What it has to handle in each case:

- **Nobody signed in** — catalogue questions: which sessions are running, when, at what cost, how many places remain. It can also take a booking from a visitor who supplies only an email address. That address becomes their account, and the password must be established through a properly secured flow, not issued or guessed
- **A participant** — searches sessions, books them, cancels them, reviews their own bookings, reports remaining credits. 
- **A coach** — reviews past and upcoming sessions with participant-level detail, including who cancelled and who has attended repeatedly; can cancel or reschedule a session, which must move every affected participant.
- **An administrator** — substantially anything

The governing constraint: **the model must never receive data the caller is not entitled to see.** Every answer comes from a tool running a permission-filtered query, executed as the caller. Filtering inside the prompt is not access control. Assume people will try to talk the assistant into ignoring its instructions, including through data you stored earlier.

---

## 11. Submission

**Deadline: Tuesday 11 August 2026, 23:59 Asia/Dhaka.**

**Submit whatever you have by then.** We would much rather receive partial work on
time than a fuller submission late. A submission that stops in a defensible place
and says so in the README reads better than one that ran over — Section 13 marks
you on where you stopped and why, not on how much you covered.

Late submissions are accepted and will be marked, but they lose marks. Submitting
something incomplete on Tuesday is the better choice.

**Your own GitHub repository.** Create it from the template at <https://github.com/metaora-arnab/atrium> using **Use this template → Create a new repository**, then build on it there. Make it public, or keep it private and add `metaora-arnab` as a collaborator. Send us the URL.


**AI is encouraged.** Use whatever tooling you like. Submit the raw transcripts alongside — we read those too, for how you decomposed the problem and what you did when the tool got something wrong. You remain responsible for every line, and you will be asked to defend it.

**Setup instructions that actually work.** A marker with only Node and PostgreSQL installed will clone your repository, follow your README, and run it. If it does not come up, it is not marked. Keep `.env.example` current with every variable you add, and commit no secrets.

**A README**:

- Setup and run instructions, verified from a clean clone
- Defects you found in the schema, the indexing and the seed data, with root causes. Include `EXPLAIN (ANALYZE, BUFFERS)` before and after for anything you made faster
- Your credit and fee schedule
- Your participant cancellation policy and its justification
- Which invariants you enforced in the schema, which in application code, and why for each
- The isolation level each write path runs under, and which anomaly that level does not prevent
- Every assumption you made where this brief was ambiguous, and what breaks if you are wrong
- What is unfinished and why you stopped there

**A video walkthrough**, under 10 minutes — see Section 12.

### How to submit

Email **hr@metaora.ai** with the subject line:

```
Atrium submission — <your full name>
```

Use that subject exactly. It is how we find your submission, and a mail that does
not match it can be missed.

In the body, give us four things:

1. **Your GitHub repository URL.** If it is private, add `metaora-arnab` as a
   collaborator before you send, or we cannot read it
2. **A Loom/Drive link to your video.** Record it on Loom and paste the share link — do
   not attach a file, as a ten-minute recording will not survive email. Check the
   link opens while you are signed out of Loom. If Loom will not give you a single
   recording of the length you need, Google Drive or YouTube as unlisted is fine
   instead; a working link matters more than which tool made it
3. **Two or three lines** on what you did not finish and where you stopped

Send questions to **hr@metaora.ai** if needed.

**The timestamp of that email is your submission time.** Sending the repository
link on time and the video an hour later is fine — tell us it is coming and we will
wait for it.

**We will reply to confirm we have it**, normally within a few hours and always by
the morning after the deadline. If you have not heard from us, assume something went
wrong in transit and mail us again rather than waiting. A submission we never
received cannot be marked, and we would rather field a duplicate than lose your work.

---

## 12. Video walkthrough

10-15 minutes. Screen recording with your voice over it, explaining how the
system works. No editing required and no production value expected; we are
watching it run and listening to you explain it.

Ten minutes is not long, so do not demonstrate anything twice and do not narrate
code line by line. Show it working, say why it works, move on.

### What we want to see working

Three things, in this order. These are the ones we care about most:

1. **Your repository and the public page.** Show us the repo, then the public page
   running — sessions listed, and the policy and fee information a visitor needs
   before they book
2. **The unified login, resolving by role.** One sign-in form. Log in as a
   participant, then a coach, then an administrator, and show that each lands on a
   different dashboard seeing only what their role is allowed to see
3. **The assistant, answering by role.** Ask it the same kind of question as an
   anonymous visitor, then signed in as a participant, then as a coach, and show
   the answers differ because the caller differs. Show it actually doing the work —
   answering from real data, taking a booking, reporting a balance — and refusing
   or omitting what the caller is not entitled to

Then, with whatever time is left: anything else you are pleased with, and what you
did not finish and why.

**You do not need to prove the internals on camera.** We will not ask you to walk
through query plans, isolation levels or your access-control implementation in the
video — those come up in the technical interview, where we can ask follow-up
questions properly. Put the detail in your README and spend the ten minutes
showing the system work.

If you ran out of time on whole sections, spend the freed minutes on the parts you
did build rather than stretching to fill ten.

---

## 13. Marking

| Component | Marks |
|---|---|
| Booking, cancellation and refund correctness | 20 |
| Database knowledge and best practies | 20 |
| Access control across interface, API and assistant | 25 |
| Email notifications and scheduled jobs | 15 |
| Written justification and the marketing page | 12 |
| Interface, mobile responsiveness and setup that works | 8 |
| **Total** | **100** |
| Defects found and fixed that were not pointed out to you | up to +30 |

You will be asked to explain your own code, without AI assistance, for 45 minutes. Three specific lines you changed will be selected. A requirement will then be changed and you will modify your own code while we watch.

---

## 14. What happens next

| When | What |
|---|---|
| **Tuesday 11 August**, 23:59 Asia/Dhaka | Your submission is due — repository URL, README and video |
| **Wednesday 12 – Thursday 13 August** | Second-round technical interview, for candidates taken forward. This is the 45-minute conversation described in Section 13: your own code, no AI assistance, then a requirement changes and you modify it while we watch |
| **Friday 14 August** | Final interview |

Slots inside those windows are arranged individually once we have read your
submission. If you are taken forward we will contact you with a time; if you are
not, we will tell you that too, and we will tell you why.

Everything technical gets discussed properly in the interviews, so do not worry
about compressing an explanation into the video or the README that would be better
had as a conversation.

**Thank you for taking part.** This is a real piece of work and we know it asks a
lot of your week. Whatever the outcome, the repository is yours to keep and to show
to anyone.

Questions are welcome, and a good one early counts in your favour. Mail
**hr@metaora.ai** and we will answer within a working day.
