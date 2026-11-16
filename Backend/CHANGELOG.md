# Changelog

What changed, in the order it landed, for the people who have to react to it: a
front end that calls these routes, an operator who sets the environment, or a
newcomer wondering why a file is shaped the way it is.

The rule for this file is one sentence per change plus the reason it was worth
making. Code comments keep what you need _while reading the file_ — the
invariant, the trap, the reason a strange-looking line is correct — and send the
story of what used to happen here. So a comment that begins "this used to"
should be short and point at this file; if it runs to a paragraph, the paragraph
belongs here instead.

---

## 2026-11-16 — a suspension that reaches the listings, and six smaller things

Seven findings from the same kind of read: what happens when two people press the
same button, when the punished account still has posts on display, and when a
number that exists in one DTO does not exist in the route that writes the same
column. One of them is a security hole in the ordinary sense — a suspended scammer
whose "iPhone for sale" stayed in the search results — and the rest are five to
fifteen lines each.

### Suspending an account now takes its public half with it

- **`POST /api/moderation/users/{id}/suspend`** (admin) used to write one row on
  `users` and delete the `sessions`. Everything the account had posted stayed
  `ACTIVE` in the catalogue, and the students who had already written to it stayed
  `PENDING` in a thread nobody could answer again, because the owner could no
  longer sign in. In the same transaction it now sets that owner's `ACTIVE`
  listings to `HIDDEN` and settles the `PENDING` inquiries inside them with one
  `INQUIRY_DECLINED` each, saying `The account behind this listing was suspended.`
  — the same words in the thread and in the notification.
- The settle is `ListingsService.settlePendingInquiries()`, the call a close
  already made, with the response text now passed in so a suspension does not
  claim the listing was withdrawn by its owner. `ModerationModule` already
  imported `ListingsModule` for `listHidden()`, so the direction stayed one-way
  and no cycle appeared.
- `restoreUser()` deliberately leaves the listings hidden. Un-hiding is a decision
  of its own — staff, one listing at a time — so a suspension that turns out to
  have been wrong costs the student a conversation, not a scam back in the search
  results. Closed listings are not touched by any of this, and the hide is
  conditional on the status that was read, so a moderator's hide a moment earlier
  is not rewritten.
- No per-listing notification goes to the suspended owner: the suspension letter
  already says what happened to the account, and the audit trail has one
  `SUSPEND_ACCOUNT` row rather than one per post.

### Two ways a role rule was applied in one place and not another

- **`POST /api/moderation/users/{id}/warn`** never looked at the target's role, so
  a MODERATOR could send an ADMIN an "Official warning" while suspending the same
  account was refused. It now answers `403 PROTECTED_ACCOUNT` — the code
  suspension already uses, not the admin module's `ADMIN_PROTECTED` — before the
  audit row and before the notification. An ADMIN warning an ADMIN is still
  allowed; nobody is above the trail.
- **`POST /api/users/{id}/block`** read the table for an existing block and then
  inserted. A double-click passed the read twice, the unique index stopped the
  second insert, and that request answered `500`. The insert is now wrapped the
  way `create()` and `completeRegistration()` wrap theirs: `isDuplicateKey(error)`
  becomes the same `409 ALREADY_BLOCKED` the read gives.

### Two numbers that were not in the place that needed them

- `MailCooldown` filtered the stale timestamps out of the entry it was using and
  wrote the rest back, which shrinks nothing: the key stayed in the map holding an
  empty array for the life of the process, one per address anybody ever typed into
  a sign-up form, so the bot minting addresses was growing the memory of the very
  gate meant to slow it down. `pruneCooldown()` now deletes the keys whose hour has
  passed, run from `take()` once an hour of traffic rather than once a request, and
  `refund()` drops the key when the refunded claim was the only one.
- **`PATCH /api/admin/users/{id}/profile`** has no body DTO on purpose — the route
  answers `NO_FIELDS` where a DTO with `forbidNonWhitelisted` would answer
  `VALIDATION_FAILED`, and that distinction is documented on the controller — but
  it checked nothing about length, and the `users` columns are `text`, so a
  five-thousand-character name was accepted and stored. `MAX_NAME_LENGTH` and
  `MAX_DEPARTMENT_LENGTH` now live beside `UpdateProfileDto`, which uses them in
  its own decorators, and the admin route refuses an over-long value with
  `400 FIELD_TOO_LONG` before writing anything, including the legal field beside
  it in the same body.

### One body the validation pipe never saw

`PATCH /api/reports/{id}/resolve` and `/dismiss` took `{ note?: string }` inline and
checked it with a hand-written helper. The shape is now `ReportNoteDto`
(`@IsOptional() @IsString() @MaxLength(2000)`), so the pipe answers a non-string or
an over-long note as `400 VALIDATION_FAILED` with `details[].path` = `note` — **the
code for a too-long note changes from `NOTE_REQUIRED` to `VALIDATION_FAILED`**, the
one client-visible difference in this batch. That a closing note is *required* at
all is a rule about the audit trail rather than about the field, so the 5-character
floor keeps `NOTE_REQUIRED` and its own message.

### A reply that no longer lands in a closed thread

`messageInquirer()` checked the status and then wrote by id alone — the one inquiry
write in the file that did not carry the status it had read. An owner replying in
one tab while the thread was settled in another left a message inside a `DECLINED`
or `CANCELLED` inquiry and told the inquirer about it. The write is conditional now,
and `affected === 0` answers `400 INVALID_TRANSITION` before the notification. Which
of the two requests wins is the database's decision, so the new unit test decides it
there rather than racing two HTTP calls that could legitimately arrive one after the
other.

### Docs

`README.md` §10 counts, §12 (`FIELD_TOO_LONG`, `PROTECTED_ACCOUNT` for a staff
action, the `NOTE_REQUIRED` row), the role rules in §7.3 and the closing-note
paragraph in §6; `Instruction.md` §5 rows for suspension, warn, profile correction
and the closing-note ceiling — plus two wrong status codes in the users table
(`ALREADY_BLOCKED` is `409`, `NOT_BLOCKED` is `404`); `distribute.md` §B and the
count lines; `test/README.md` counts.

### Tests

- e2e: 104 → 106. A suspension hides the posts and settles the threads (search
  empty for an anonymous caller, the listing in the staff hidden queue, the
  declined `ownerResponse` and cleared `pendingKey`, one notification, and the
  listing still hidden after the restore); a moderator cannot warn an admin, and
  nothing is written when it is refused; the block double-click answers `201` and
  `409`; the admin's 121-character name is refused with the row untouched; the
  too-long closing note now expects `VALIDATION_FAILED`.
- unit: 69 → 76. Three for the reply that loses the thread — the `where` it writes
  with, the refusal before the notification, and the empty-reply rule that was
  already there — and four for the cooldown: the sweep's rule, the answers it must
  not change, the 50 addresses that become 1, and the refunded claim that leaves no
  key behind.

Nothing here changes a route, a response shape or an existing error `code`, except
the too-long closing note named above.

---

## 2026-11-16 — the searches a student actually asks for, and a close that answers the queue

Five gaps found by reading the flows as a person who has to use them: the tutor,
commuter and group searches could not be filtered at all, a listing could be
closed while students were still waiting on it, and a block stopped working the
moment the search box was involved. Nothing here adds a route, changes a response
shape or renames an error `code`; four of the five add something a client may
send, and the fifth changes what two existing routes do.

### New query parameters on `GET /api/listings`

- **`?listingType=OFFER|REQUEST`** matches `data.listingType`, which is the same
  field name in TUITION and in COMMUTE — so one filter now answers "who is
  offering tuition" and "who needs a lift", case-insensitively (`?listingType=offer`
  is the same request). Anything outside the two words is `400 VALIDATION_FAILED`
  naming `listingType`.
- **`?fromArea=` and `?toArea=`** match the two ends of a commute route as text,
  the way `?location` matches the listing's own location: `?fromArea=mirp` finds
  "Mirpur 10". The value goes through `likePattern()`, so a `%` or `_` typed by a
  student is an honest character rather than a wildcard, and the parameter is
  capped at 120 characters, which is what the posting DTO allows.
- **`?day=SUN`** is membership of a commute post's `days` array, the same
  `jsonb_exists` the `?subject=` filter has always used, and it is case-insensitive
  too. `?day=SUNNY` is `400 VALIDATION_FAILED`.
- **`?skill=` and `?roleNeeded=`** are membership of a group post's `requiredSkills`
  and `rolesNeeded`, exact like `?subject=` and capped at 60 characters. A skill
  nobody has listed yet is an empty page with `meta.total: 0`, not an error.
- **`GET /api/listings/facets/{category}`** answers with the values those filters
  can take: `listingTypes`, `fromAreas`, `toAreas`, `days`, `skills` and
  `rolesNeeded` join the lists it already returned, each derived from the newest
  1000 active posts of that category.

### Closing a listing now settles the threads inside it

- **`PATCH /api/listings/{id}/status?status=CLOSED` and `POST
  /api/listings/{id}/resolve`** used to leave every `PENDING` inquiry on the
  listing waiting forever: the post was closed, a new inquiry on it was refused as
  `LISTING_NOT_ACTIVE`, and the student who had already asked had no `pendingKey`
  released and no answer. Both routes now decline those threads in the same
  transaction as the close — `DECLINED`, `ownerResponse` "This listing was closed.",
  `pendingKey` cleared, and one `INQUIRY_DECLINED` notification per affected
  student. `ACCEPTED` threads are left alone: two students who already exchanged
  contacts are having a conversation, and ending it is a decision rather than a
  side effect. Reopening the listing revives nothing, and a second close declines
  nobody twice. The writes are conditional on the status just read, the way
  `InquiriesService.applyDecision()` writes, so an owner answering one of those
  threads in another tab and the close cannot both settle it.
- This needed no new module dependency and no schema change: `ListingsService`
  writes the `inquiries` and `notifications` rows through the transaction's own
  `EntityManager`, the same way `ModerationService` has always written the bell
  that belongs to a hide.

### Two places where a block or a report was not what it looked like

- **`GET /api/listings` for a signed-in caller no longer returns the posts of a
  student they have blocked, or of one who blocked them.** The clause is a
  `NOT EXISTS` inside the search statement rather than a filter applied to the
  page afterwards, so `meta.total` counts what is actually shown. An anonymous
  search is unchanged, and `GET /api/listings/{id}` keeps its limited
  `blocked: true` view — a student with a link to a post still reaches the page,
  without the owner's identity or any way to contact them.
- **`POST /api/reports` with `targetType: "LISTING"` on your own listing is `400
  SELF_REPORT`**, the answer the `USER` target has always given. It used to file:
  the report reached a moderator's queue, and the queue row names both the
  reporter and the listing's owner, so the report was never the anonymous tip it
  looked like to whoever sent it.

### Docs

- `README.md` §7.5 gained the filter semantics and the facet keys, and §7.4's
  parameter list is now the whole list. `Instruction.md` §5.C and §5.D gained the
  rows above, and its "Closed twice" row was wrong: it promised `400
  ALREADY_CLOSED` for a second close, a `code` this route has never had (`409
  ALREADY_CLOSED` belongs to the report queue). A second close is `200`, which is
  what the new inquiry-settlement test also pins down.

### Tests

69 unit in 10 suites and 104 e2e in 11, all green — five new e2e rows, each proven
to fail without the change it covers: the three new filter searches answered `400
VALIDATION_FAILED`, the facet lists were absent, a self-listing report answered
`201`, a blocked pair still saw each other's posts, and both close routes left
`PENDING` rows behind with no notification.

---

## 2026-11-15, night — seven audit findings

Findings from an outside read of the tree, each fixed in the shape the file
already uses rather than with a new helper. Two of them answer a request
differently than before, so a front end has to be told; the rest are windows that
closed without changing any single-threaded answer.

### New error `code` — the front end has to be told

- **`400 EMPTY_RESPONSE` on `PATCH /api/inquiries/{id}/message`.** A follow-up with
  no `response` key, or one carrying only spaces, wrote over the owner's last real
  answer and then told the other student there was a new reply with nothing in it.
  It is refused before the write now. `accept` and `decline` still take the field
  absent — an acceptance without a note is a decision, not a message — which is
  why the check sits in `messageInquirer()` and not in the `RespondInquiryDto` all
  three routes share. A literal `""` is answered by the DTO's own `@MinLength(1)`
  with `VALIDATION_FAILED`; both are 400 and neither touches the thread.

### Behaviour an operator can hit

- **The database an e2e run points at is checked before anything else happens.**
  `requireThrowawayDatabase()` in `test/utils/e2e-server.ts` is called both by
  `serverEnv()` for the spawned server and by `test/utils/load-env.ts` for the Jest
  process, which is the one holding the repositories `truncateAll` empties. A name
  that is neither `*_test` nor `scsp_test_*` — `scsp_dev`, `project`, anything
  holding real rows — now stops the run with an error instead of emptying the
  database. Both throwaway shapes pass, including the per-person `scsp_test_a` that
  `distribute.md` §3.3 tells each operator to create.
- **`.env.example` points at `src/config/env.ts`** for the institution constant. The
  comment still named `src/config/institution.ts`, which merged away earlier today.

### Writes that no longer step over a decision made at the same moment

- **`POST /api/listings/{id}/resolve`** wrote by `id` alone after reading the status
  in code, so a moderator's hide landing in that gap was stepped over: the row went
  back to `CLOSED` with `resolved` set on it while `moderation_actions` still
  recorded a standing hide. The `UPDATE` now matches `{ id, ownerId, status:
  Not(HIDDEN) }` and a write that matched nothing is `403 LISTING_HIDDEN` — the same
  clause `setStatus()` has always carried.
- **The 50-active-listing ceiling counted outside its transaction**, so two creates
  from one owner read the same total, both passed, and both wrote. The count moved
  inside, behind a `pessimistic_write` lock on the owner's `users` row: the second
  request now waits for the first to commit and counts again. Two creates by one
  person run one after the other, which is all the load here needs.
- **`VerificationService.issue()` deleted the old digest and inserted the new one as
  two statements**, leaving a window in which the subject had no live link at all —
  the row was gone and its replacement was not — and a failure in that window was
  answered with a mailed link that could never be read back. Both writes are one
  transaction now.

### Tests

69 unit in 10 suites and 99 e2e in 11, all green. Two of the new e2e rows exist to
fail without the fix, and both were proven that way by putting the old line back:
the resolve race answered `201` and left the row `CLOSED`, and the empty follow-up
answered `200` with the `ownerResponse` blanked. The resolve row is the second half
of the rule the existing `refuses to resolve a hidden lost-and-found report` test
cannot reach — that one hides the listing first, so the read in front of the write
is what refuses it.

## 2026-11-15, end of the day — one migration, no generator, five files merged

Nothing here changes a route, a response shape or an error `code`, so a front
end does not need to be told. It changes what an operator types and what a
reader finds when they open a folder.

### Breaking for the operator

- **`npm run db:sql` is deleted, with `src/database/manual-accounts.ts` and
  `src/database/fixtures.ts`.** The generator existed so that nobody had to copy
  an address into SQL by hand; it turned out that nobody wanted the copying
  either, and what it printed was a file whose ids and hashes changed on every
  run. The rows are the tables in README §9 now, and the `INSERT` statements are
  the operator's, which is also what lets them insert three administrators
  instead of four. `test/unit/dummy-data.spec.ts` went with it — it checked the
  constants that no longer exist — so the unit suite is 69 tests in 10 suites.
- **`1794500007000-ReportOpenUniqueness.ts` is folded into
  `1794500000000-InitialSchema.ts`, and one migration is the whole schema.**
  Folding a migration is the one thing the class-name rule in `src/database/README.md`
  says not to do lightly: a database that recorded `InitialSchema1794500000000`
  before those two indexes existed answers "No migrations are pending" and never
  gains them, and a database that recorded the deleted class then fails
  `npm run db:migrate:reverse` with "Could not find migration class". README §9.3
  carries both halves of the fix-up — the two `CREATE UNIQUE INDEX IF NOT EXISTS`
  statements and the `DELETE FROM "migrations"` — and `scsp_dev` and `scsp_test`
  have been converged with it.
- **The duplicate-dismissing `UPDATE` left the code with that migration.** It is
  the one statement in the schema that touches rows, and it only ever mattered to
  a database that already had duplicates; running it is now a human reading README
  §9.3, which is where a statement that dismisses other people's reports belongs.

### Files that are now somebody else's section

| Gone | Where it went | Why |
| --- | --- | --- |
| `src/config/institution.ts` | the foot of `src/config/env.ts` | one constant, read by three callers, that was never a setting |
| `src/database/enums.ts` + `src/database/id.ts` | `src/database/schema.ts` | the id format and the column types are the same document: what a column holds |
| `src/modules/auth/password.ts` | `src/modules/auth/auth.constants.ts` | a file already named for the numbers hashing cannot do without |
| `src/modules/admin/admin-user-row.ts` | `src/modules/admin/dto/admin.dto.ts` | the response shape beside the request shapes it answers |
| `src/modules/reports/report-states.ts` | `src/modules/reports/entities/report.entity.ts` | `OPEN_STATUSES` belongs beside the status column whose index predicate it has to match |

The listings pair — `listing-category.dto.ts` and `listing-filters.ts` — stayed
two files: they are a validator and a query builder that happen to share a
folder, not one rule told in two places.

### Tests

69 unit in 10 suites and 97 e2e in 11, all green, after a rebuild of `dist/`.
The e2e suite does not notice any of this, which was the point: every merge kept
its exports and moved no logic.

## 2026-11-15, later the same day — no rows from a migration, four races closed

### Breaking for the operator

- **`npm run db:migrate` writes no accounts at all.** `InsertAdmins1794500005000`
  and `InsertDummyData1794500006000` are deleted; the rows they wrote are
  constants in `src/database/fixtures.ts`, and `npm run db:sql` prints those
  constants as SQL for a person to read, name a database at, and run (README
  §2.5). Two migrations remain, and both only change tables. The reason is the
  one the `NODE_ENV` allowlist above could not reach: a migration is handed
  whichever `DATABASE_URL` the shell happens to hold, so nothing inside it can
  tell a laptop from a deployment, and a credential is the worst possible row to
  write on that guess. Superseded twice over by the entry above: the generator
  and its constants are gone, the rows are README §9, and one migration remains.
- **An administrator's password is no longer their own e-mail address.** The
  generated SQL hashes a fresh `randomBytes(32)` per admin and drops the
  plaintext as the command exits, so nobody — including this repository — can
  tell you what it is. Admins sign in through forgot-password, which works only
  if you can read that mailbox (README §9.1). `ADMIN_EMAILS` itself stays in
  `fixtures.ts` as the list the admin routes protect by role — that file is gone
  too, and the addresses are the table in README §9.1.
- **A deployment that already ran the deleted migration keeps the four weak
  hashes until somebody replaces them.** Every insert is `ON CONFLICT DO
  NOTHING`, which is what makes the file safe to re-run and also what stops it
  from curing an existing row, so the generated SQL carries a commented
  `UPDATE … passwordHash` block for exactly that database. Uncommenting it is a
  human decision with a human in front of the right database, not a step in an
  install. Demo accounts keep the address-as-password rule; those are fixtures,
  and the README says so where it used to advertise them.

### Breaking for a front end

- **Uploads are four files at five megabytes, not eight at eight.** `MAX_FILES`
  and `MAX_BYTES` are exported from `media.service.ts` and the controller's
  multer `limits` now read them instead of repeating them, which is also the fix
  for a request that sent `fileSize` twice and got the larger answer. The hourly
  per-account quota is unchanged at 40 files or 200 MB, and the two ceilings now
  meet exactly: ten full requests is both limits at once.
- **`POST /api/admin/users` answers `409 ACCOUNT_EXISTS` where it answered `500`.**
  Two admin creates for the same address, or one admin and one student completing
  a registration for the same address at the same moment, used to surface the
  database's unique violation through the catch-all filter. Nothing about the
  success path changed.

### New refusals the database backs up

- **One open report per student per target, enforced in the schema.** The check
  was read-then-insert, so a double-click on "report" could produce two rows for
  the same queue; a partial unique index on `(reporterId, listingId)` and
  `(reporterId, reportedUserId)` over `OPEN` and `UNDER_REVIEW` rows is the same
  rule `pendingKey` already gives inquiries, and `reports.service.ts` maps the
  duplicate key to the `409 REPORT_ALREADY_OPEN` it already returned to a slow
  clicker. `ReportOpenUniqueness1794500007000` dismisses the older of any
  duplicates it finds before adding the indexes, because an index cannot be
  added to a table that already breaks it; its `down()` drops the indexes and
  leaves those rows dismissed. That file is now part of `InitialSchema`, and the
  dismissing `UPDATE` is SQL in README §9.3 rather than code.
- **Editing a listing no longer undoes a moderator's hide.** `update()` re-read
  the row with `lock: { mode: 'pessimistic_write' }` inside its transaction, so
  an edit that arrives while a hide is in flight waits for it and then refuses
  with `403 LISTING_HIDDEN`. The old code read the status, checked it in
  JavaScript, and wrote the entity back — and `manager.save()` writes the
  columns whose value it believes changed, which is precisely how a stale
  `ACTIVE` overwrote a `HIDDEN`.

### Tests

75 unit and 97 e2e, all green. Four of the new e2e rows exist to fail without
the change: the two reports fired together, the admin create fired twice, the
concurrent admin `POST /api/admin/users`, and an edit against a hide held open
in an uncommitted transaction — that last one blocks on purpose and proves the
wait by finding the request in `pg_stat_activity` before it lets it through.

## 2026-11-15 — three migrations, and five files fewer

### Breaking

- **`PLATFORM_ADMIN` is gone.** The role was a fourth value in a single
  institution with one administrator group, and the accounts it named were
  written by a boot-time provisioner rather than by a migration — so a fresh
  database had no administrator until somebody ran something. The four
  `23-…-3@student.aiub.edu` addresses are ordinary `ADMIN` rows now, and `Role`
  has three values. How those four rows get written changed later the same day;
  the entry that opens this file supersedes the two bullets below wherever they
  name an `Insert*` migration.
- **`ADMIN_PROTECTED` replaces `PLATFORM_ADMIN_PROTECTED`** (403, same shape) on
  the two admin writes that refuse to change an administrator. A front end that
  special-cased the old code, or the old role in a `roles` array, has to be told.
- **`npm run db:seed` and `npm run db:baseline` are gone**, with the boot-time
  provisioner and `src/database/baseline.ts`. The first wrote the rows the two
  `Insert*` migrations write, so there were two sources of truth for one
  administrator list; the second existed only to label a database the old Prisma
  migrations had already built. Nothing reconciles that case now — make a fresh
  database and migrate it (README §2.4).
- **The demo fixtures stopped being gated on `NODE_ENV`.** They had run from a
  migration, `InsertDummyData1794500006000`, for anything that was not exactly
  `production`, and `production` is not the only way to mean it: the TypeORM CLI
  reads `.env` with plain dotenv and checks nothing, so an unset or a mistyped
  `prod` wrote six accounts — one of them a moderator, all of them with their own
  address as the password — into whatever database the command was pointed at.
  The fix that morning was an allowlist; the fix that afternoon was to move the
  inserts out of the migration entirely, which is the same reason in a stronger
  form — a row nobody chose cannot be gated correctly after the fact.

### The schema in three files instead of seven

`ConvertTimestampsToUtc`, `AddAccountRemovalAction`, `SingleInstitution` and
`DropSessionRememberMe` did four things on a fresh database: rewrite timestamps
that were already written correctly, add one enum value, and drop a table and
three columns the first migration had just created. Their end state is in
`InitialSchema` now, and the class name is unchanged on purpose — TypeORM
decides what still has to run by matching the class name against the rows of its
own `migrations` table, so a database that already ran the seven answers `No
migrations are pending` instead of failing on a `CREATE TABLE "users"` with
nowhere to go. Verified by migrating a fresh database and diffing the normalised
schema against the one the seven files build: identical.

### Files that are gone, and why

- `password.service.ts` and `scrypt.ts` are one `password.ts`. The service was a
  twenty-one-line wrapper around two functions the same repository already called
  four ways: injected in `AuthService`, imported plain in `AdminService`, in the
  migrations, and in the tests. A migration does not construct a Nest
  application, so a wrapper could never be the answer there. The parameters and
  the `<salt>:<key>` format are untouched — every stored hash still verifies, and
  the ten migrated accounts were signed in with afterwards to prove it.
  (`password.ts` itself is in `auth.constants.ts` now; the rule it recorded —
  hashing is plain functions, never an injectable wrapper — is why that merge
  needed no call-site changes.)
- `mailed-link.ts` and `mail-cooldown.ts` moved into `mailer.service.ts`, which
  leaves the mail module a module file and one service. The two link builders
  stayed top-level pure functions and `MailCooldown` stayed separately
  injectable; only the file count moved.
- `expired-row-cleanup.service.ts` is gone. Its two deletes are `deleteExpired()`
  on `SessionService` and `VerificationService` — the rows are theirs to delete —
  and the once-at-start-up-then-daily timer is a dozen lines in `AuthModule`.
  Same behaviour and same log line, still observable only at start-up, which is
  why `test/e2e/expired-rows.spec.ts` keeps booting a second server.

Nothing was merged into `AuthService` on the way: it is 368 lines — shorter than
before, because the injected hasher is a call now — and a 700-line file is worse
than a few small ones. The suite is 75 unit tests in 11 suites and 94 e2e tests
in 11 suites.

## 2026-11-14 — security review

Findings were fixed in three phases: critical, high, hardening. Each one ships
with a test that fails without the fix; the suite is 74 unit tests in 12 suites
and 89 e2e tests in 11 suites.

### Breaking for the front end

- **Registration is two calls.** `POST /api/auth/sign-up` took an address, a
  name and a password and created a `PENDING` account in one step, so a script
  could reserve every roll number in the institution and wait for the students
  to arrive — and the password it chose was already stored. Now `sign-up` takes
  `{ email }` only, answers the same neutral sentence whether or not the account
  exists, and mails a one-time token that `POST /api/auth/complete-registration`
  redeems with `{ token, name, password, department? }`. Nothing is written until
  the mailbox has proved it can receive mail. The token is hashed, expires in 24
  hours and is consumed on use; a duplicate at completion is
  `409 ACCOUNT_EXISTS`, not a unique-violation `500`.
- **A mailed link is a page, not a route.** Both links pointed at
  `POST /api/auth/complete-registration` and `POST /api/auth/reset-password` on
  the API — POST-only endpoints — so the first thing a student did with a
  registration e-mail was click into a `404`. They now name
  `<FRONTEND_URL>/auth/<route>?token=…`. With `FRONTEND_URL` unset they fall back
  to `APP_BASE_URL` plus `API_PREFIX`, which keeps naming the API route, so a
  deployment with no front end can still finish by hand.
- **Accepting an inquiry shares a contact only if the owner sends one.** An
  accept used to fall back to `privateContact` on the owner's profile: the button
  said "accept", the notification said "your inquiry was accepted", and neither
  promised a phone number — yet the field the platform keeps off every public
  view went to a stranger anyway. `sharedContact` in the accept body is now the
  only thing that reaches the inquirer, and an accept that names no contact
  shares none (`sharedContact: null`).
- **A hidden listing stays hidden until staff say otherwise.** `PATCH
  `/api/listings/:id/status`` with `ACTIVE` used to let the owner undo a
  moderation hide; it is `403 LISTING_HIDDEN` now, and `unhide` remains a staff
  action.

### New refusals, same response shape

- `403 LISTING_HIDDEN` (above).
- `409 ACCOUNT_EXISTS` at `complete-registration`.
- `400 VALIDATION_FAILED` with `details[].path` naming `imageUrls[i]` or `image`
  when a link is not https under `CLOUDINARY_BASE_URL`, or — for a listing — not
  inside `<CLOUDINARY_UPLOAD_FOLDER>/<your id>/`. Before this, any URL was
  accepted, so a caller could point a hundred listings at their own server or
  another student's pictures at their own listing.
- `400 UNSUPPORTED_MEDIA` when the uploaded **bytes** are not JPEG, PNG, GIF,
  WebP or AVIF. The route believed `file.mimetype`, a line the sender writes
  inside the multipart body, so a script announced as `image/png` was stored and
  handed back as an image URL. A genuine image whose declared type was wrong now
  uploads, because the declaration is not consulted at all.
- `400 NOTE_REQUIRED` when a report-closing note is missing, under 5 characters,
  **or over 2000**. The ceiling matters because the note is written three times
  per request — the report, `moderation_actions`, the notification — and read
  back on every queue page after it.
- `429` from the six auth routes, each with its own ceiling: 5 sign-ins a minute;
  5 requests that mail a link an hour (`sign-up`, `resend-verification`,
  `forgot-password`); 10 requests that consume one (`complete-registration`,
  `reset-password`). The baseline stays `THROTTLE_LIMIT` per IP for everything
  else. No `code` key, because no `429` from this API has ever had one.
- `429` from `POST /api/media/images` past 40 files **or** 200 MB per account per
  rolling hour. Eight files at eight megabytes was the ceiling for one call and
  above it there was only the IP throttle, so one session could fill a Cloudinary
  account billed by storage and transfer.
- `503 MEDIA_DISABLED` (unchanged) still comes before both upload checks, so a
  misconfigured server never spends an hour's quota on a file it cannot store.

### Two routes stopped distinguishing addresses

`POST /api/auth/resend-verification` and `POST /api/auth/forgot-password` answer
the same `200` and the same sentence whether or not the address exists. They
already did; there was no test that would notice if they stopped, and now there
is (`test/e2e/auth.spec.ts`).

### Headers, docs and the address rule

- `helmet()` on every response, `X-Powered-By` disabled, and `/api/docs` plus
  `/api/docs-json` are ordinary `404`s when `NODE_ENV=production`. Only the
  Swagger page is served as HTML, which is why `Content-Security-Policy` is the
  one helmet default switched off.
- The institution rule is `^\d{2}-\d{5}-\d@student\.aiub\.edu$`, anchored on both
  ends and applied after trim + lower-case. It was a suffix test on
  `emailDomain()`, which took `split('@')[1]` — the text between the first `@`
  and the second — so `"a@student.aiub.edu@x"@evil.example` matched, and any
  `+tag` on the end of a real address matched too. Both are refused by
  construction now, along with a subdomain above ours.
- Sessions are HS256 on both sides now: naming the algorithm only while signing
  leaves verification accepting whatever the library supports, and the `iss`
  claim is checked rather than only written.
- `sessions` and `verifications` rows past their own expiry are deleted at boot
  and once a day. The refusal was never the problem — an expired row is
  unreachable to anyone but its holder — the row was.

### Settings

| Change | Setting |
| --- | --- |
| added | `FRONTEND_URL` — the origin mailed links point at; optional, with the fallback above |
| added | `CLOUDINARY_BASE_URL` — the only image origin a listing or profile may store |
| added | `TRUST_PROXY_HOPS` — how many proxies stand in front, default 0, so `X-Forwarded-For` is ignored unless you mean it |
| removed | `SEED_PASSWORD` from `.env.example` — the value it published is a credential anybody with the repository holds, so `PUBLISHED_DEFAULT_PASSWORD` in `src/database/platform-admins.ts` names it only to refuse it, and `NODE_ENV` is now a required setting because the seed's production guard reads it |
| upgraded | `nodemailer` 10 — the twenty-two SMTP and `addressparser` advisories are gone; `npm audit --omit=dev` reports zero |

### Undecided, for a human

- Accounts that were already sitting `PENDING` when the two-step registration
  landed cannot finish: their token was written by the old flow, a fresh
  `sign-up` for that address answers the neutral sentence, and
  `complete-registration` would then meet `409 ACCOUNT_EXISTS` because the row is
  still there. An admin clears it with `POST /api/admin/users/:id/verify` or
  removes the account with `POST /api/admin/users/:id/remove`. Deciding which, per
  address, is the migration question this change deliberately did not answer.
- `removeUser()` cannot reach a registration link that is still unspent. It
  deletes the rows keyed to the account — `<purpose>:<user id>`, which is every
  password-reset link it has outstanding; one of those, clicked afterwards,
  would already answer the neutral unknown-account refusal rather than setting a
  password on a row that is gone. But a registration row is keyed to an
  **address**, because the account did not exist when the link was mailed, so
  deleting the account leaves it live for the rest of its 24 hours. Clicking it
  then creates a brand new account for that address — a new id, no listings, no
  history, nothing carried over — which is closer to the student signing up again
  than to the account coming back. Whether an address should be able to do that
  after an administrator has deleted it is a product question, not a security
  one, so this change left it alone.

## 2026-11-14 — readability, no behaviour change

- **`@IsAuthenticated()` is gone.** Six routes carried it and no guard read it:
  `SessionGuard` looks only at `@Public()`, and everything that is not `@Public()`
  already needs a valid session. A marker that cannot lock anything out or let
  anything in is worse than nothing on a route list a newcomer reads.
- **`MediaService.destroy()` is gone.** Its only caller was the sentence that
  explained why it existed. Files still are not deleted from Cloudinary — that is
  §11 of the README, and now it names no phantom route.
- **`MIN_PASSWORD_LENGTH` has one home.** It was exported from `scrypt.ts` as a
  floor "advertised to clients" that nothing imported, and re-declared in the DTO
  file that actually enforces it. `hashPassword()` checks no length, so the
  number stays where the check is.
- **`sessions.rememberMe` is dropped** (migration `1794500004000`). A column from
  the auth provider this project replaced, read by nothing and written by
  nothing, which is how a nullable column hides in every review: no insert fails
  without it and no query asks for it. Session length is one constant in
  `auth.constants.ts`. A `scsp_dev` that still carries the column runs the same
  code.
- **Three services over 450 lines split along the seam that was already there.**
  `ReportsService` (487 lines) kept the student's writes and handed the staff
  worklist to `ReportWorklistService`; `ListingsService` (598) kept the rules
  about who may change a listing and handed the response card to
  `ListingCardService` and the search query to `listing-filters.ts`;
  `AdminService` (606) kept the five writes that change an account and handed the
  directory, the single-account view and the dashboard counts to
  `AdminDirectoryService`. Nothing was rewritten on the way — the moved bodies
  are verbatim, which is the only reason this is filed under no behaviour change
  rather than under the security phases. `ListingsService` at 361 lines,
  `AdminService` at 405, `ReportsService` at 203.
- **`src/modules/auth/` has a README of its own**, the only module folder with
  one, because a session is two things — a signed token and a row — and the
  relationship between them was prose in §6 rather than a picture. Drawing it
  found a sentence the root README had been repeating in two places: "Cookie
  sessions only, no bearer tokens". `SessionService.extractToken` has read an
  `Authorization: Bearer` header all along, and `session-tokens.spec.ts` tests
  it. Both rows now describe the credential the code accepts, which is the same
  signed token either way and not a second kind of token.

## 2026-11-13 — the course-template layout

`src/common/` is split by concern (`guards/`, `decorators/`, `dto/`, `pipes/`,
`interceptors/`, `filters/`, `validators/`, `helpers/`), feature modules moved
under `src/modules/`, and the Postgres connection moved to
`src/providers/database/postgres/`. No route, column or error changed.

## 2026-11-12 — the stack rewrite, and one institution

- Prisma → TypeORM (`1794500000000-InitialSchema` records the shape Prisma left
  behind, deliberately unrenamed), Better Auth → this project's own scrypt hashes
  plus JWT cookies backed by `sessions`, Zod → class-validator DTOs, Arcjet →
  removed with the re-add recipe in README §6.1.
- `SEED`-created demo administrators were replaced by the four addresses in
  `src/config/platform-admins.ts`, provisioned at boot outside `NODE_ENV=test`.
- **The institution rule moved out of the database**
  (`1794500003000-SingleInstitution`): `approved_domains` is gone, the rows that
  used to decide who may register were dropped with it, and the answer is one
  regular expression in `src/config/institution.ts` — since merged into the foot of
  `src/config/env.ts`, because it was never an environment setting.
- `1794500001000-ConvertTimestampsToUtc` rewrites the timestamps that were stored
  as local time. An offset-less `timestamp` column is filled from the session's
  own zone — Asia/Dhaka here — and read back as if it were UTC, so every `now()`
  comparison against one was six hours out even though the application always
  wrote UTC. Nothing in the schema is `timestamptz`'s weaker sibling now.

## 2026-11-07 → 2026-11-11 — before the rewrite

Initial commit, then the first NestJS scaffold with Prisma, Better Auth, Zod and
Arcjet, and the first Jest configuration. Nothing in this range is reachable
from the current code except through the migrations above.
