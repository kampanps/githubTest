# Library Lending API

A full backend for a library lending system — books, members, loans, reservations and fines —
built as a **CI/CD playground**. The point of the project is not the library: it is having a
codebase with enough real structure that a GitLab CI or GitHub Actions pipeline has something
meaningful to do.

**Express 5 + TypeScript + SQLite (`better-sqlite3`) + Jest + supertest.**

| | |
|---|---|
| Tests | **396** (247 unit, 149 integration) |
| Coverage | ~98% statements, ~96% branches |
| Coverage gate | 85% global / 95% on `src/domain` — a drop fails the pipeline |
| Pipelines | `.gitlab-ci.yml` and `.github/workflows/ci.yml` |

> **Demoing this in a classroom?** [`docs/DEMO-PLAYBOOK.md`](docs/DEMO-PLAYBOOK.md) (ภาษาไทย) is a
> run sheet: five ways to make the pipeline go red on purpose with the real output of each, an
> explanation of what happens when two people grab the last copy at once, and a panic button
> to get back to green.

---

## Quick start

```bash
npm install
npm test
```

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — no build output, just type errors |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm run dev` | Runs the API from source on port 3000 |
| `npm run seed` | Writes sample books and members into `library.db` |
| `npm test` | Both test projects |
| `npm run test:unit` | Unit tests only (pure functions, no I/O) |
| `npm run test:integration` | Integration tests only (real SQLite + HTTP) |
| `npm run test:coverage` | Everything, with the coverage gate applied |
| `npm run ci:*` | Same as above but with `--ci` and a JUnit XML report |

### Poking at it by hand

```bash
npm run seed     # writes 5 books and 3 members into ./library.db
npm run dev      # http://localhost:3000
```

Default keys (from `.env.example`): `admin-secret-key`, `librarian-secret-key`, `member-secret-key`.

```bash
curl localhost:3000/health
curl -H "x-api-key: member-secret-key" "localhost:3000/api/books?limit=2"

# borrow, then look at what the member now owes
curl -X POST localhost:3000/api/loans \
  -H "x-api-key: member-secret-key" -H "Content-Type: application/json" \
  -d '{"bookId":1,"memberId":1}'

curl -H "x-api-key: member-secret-key" localhost:3000/api/members/1/summary
curl -X POST localhost:3000/api/loans/1/return -H "x-api-key: member-secret-key"
```

`library.db` is gitignored — delete it any time to start over, then re-run `npm run seed`.

> `dev` and `seed` pass `--files` to ts-node. Without it ts-node only loads modules that are
> actually imported, so the ambient `src/http/express.d.ts` (which declares `req.role`) is
> never seen and the server refuses to start — even though `tsc` and Jest are both happy,
> because they read `include` from `tsconfig.json`.

---

## Why this shape

Everything below exists because it gives the pipeline something to test.

**A pure domain layer.** `src/domain/` holds the business rules as plain functions with no
database and no Express: fine calculation, borrowing eligibility, ISBN checksums, tier policy.
They are fast to test exhaustively — the 247 unit tests run in about 2 seconds — and they are
held to a stricter coverage threshold than the rest of the code.

**An injected clock.** Services never call `new Date()` directly; they read through
`Clock = () => Date`. Tests freeze it and travel forward, so "this book is 46 days overdue"
is a deterministic assertion rather than a flaky one.

```ts
const harness = createTestHarness();          // now = 2025-01-15T09:00:00Z
await borrow(book.id, member.id);             // due = 2025-01-29
harness.advanceDays(60);
const { body } = await returnLoan(loan.id);
expect(body.fine.amountCents).toBe(22_500);   // exact, every run
```

**In-memory SQLite per test file.** Integration tests open `:memory:`, run the real
migrations, and drive the real HTTP stack through supertest. No cleanup step, no shared state,
no test ordering dependency — and no database service to stand up in CI.

**Two Jest projects.** `unit` and `integration` are separate named projects, so the pipeline
can run them as separate jobs with `--selectProjects`. Unit tests fail fast and cheap;
integration tests only run once they pass.

---

## Architecture

```
src/
  domain/          pure business rules - no I/O, no framework
    policy.ts        tier limits, loan periods, fine rates
    loanRules.ts     "may this member borrow / renew this book?"
    fines.ts         overdue calculation with grace period and cap
    isbn.ts          ISBN-10 / ISBN-13 checksums
    validation.ts    request validation, returns all errors at once
    dates.ts         calendar-day arithmetic in UTC
    pagination.ts    page/limit parsing and page envelopes
    errors.ts        AppError hierarchy -> HTTP status + stable code
  db/              connection, migrations, seed data
  repositories/    one per table; the only place SQL is written
  services/        orchestration + transactions; throws AppError
  http/            Express routers, auth, error handling
  container.ts     composition root - wires repos and services to a db + clock
```

The dependency arrow only ever points inward: `http -> services -> repositories -> db`,
and everything may depend on `domain`.

### Business rules worth knowing

| Tier | Max loans | Loan period | Max renewals | Renewal length |
|---|---|---|---|---|
| STANDARD | 3 | 14 days | 2 | +7 days |
| PREMIUM | 10 | 30 days | 3 | +14 days |
| STAFF | 20 | 60 days | 5 | +30 days |

- **Fines**: 5.00 per day late, first day forgiven, capped at 500.00 per loan.
  All money is stored in integer cents — never floats.
- **Borrowing is blocked** when the member is suspended, their membership has lapsed,
  they owe 200.00 or more, they are at their tier limit, they already hold that title,
  no copy is on the shelf, or the last copy is being held for someone else's reservation.
  The checks run in that order, so the error you get back is the most useful one.
- **Renewal is blocked** when the loan is already returned or overdue, the member is
  suspended or owes fines, the renewal limit is reached, or someone else is queued.
- **Reservations** are a FIFO queue. Returning a book promotes the person who has been
  waiting longest to `READY`, and nobody else can take that copy while it is held.

---

## API

Every `/api/*` route needs an `x-api-key` header. Keys map to roles in `src/config.ts`.

| Method | Path | Role |
|---|---|---|
| `GET` | `/health`, `/ready` | none — unauthenticated for CI probes |
| `GET` | `/api/books`, `/api/books/:id` | any |
| `POST` `PATCH` | `/api/books`, `/api/books/:id` | admin, librarian |
| `DELETE` | `/api/books/:id` | admin |
| `GET` | `/api/books/:id/reservations` | any |
| `GET` `POST` | `/api/members` | admin, librarian |
| `GET` | `/api/members/:id`, `/:id/summary`, `/:id/fines` | any |
| `POST` | `/api/members/:id/suspend`, `/activate`, `/renew-membership` | admin, librarian |
| `GET` `POST` | `/api/loans` | any |
| `GET` | `/api/loans/overdue` | admin, librarian |
| `POST` | `/api/loans/:id/return`, `/api/loans/:id/renew` | any |
| `POST` `GET` `DELETE` | `/api/reservations` | any |
| `POST` | `/api/fines/:id/pay` | any |
| `POST` | `/api/fines/:id/waive` | admin |

Errors always come back in the same envelope:

```json
{
  "error": {
    "code": "LOAN_LIMIT_REACHED",
    "message": "STANDARD members may hold at most 3 loans at a time",
    "requestId": "b9c1…"
  }
}
```

Status codes are used deliberately, which gives the tests something precise to assert:
`400` validation, `401` no/bad key, `403` wrong role, `404` missing, `409` state conflict,
`422` business rule violation.

---

## The pipelines

Both files run the same four things. They are written to exercise different CI features
rather than to be minimal.

```
build ──┬── unit ── integration ──┬── coverage gate
        └───────────────────────  └── verify build artifact
```

### `.gitlab-ci.yml`

- three stages: `build` → `test` → `quality`
- `unit_tests` and `integration_tests` sit in the same stage, so they **run in parallel**
- npm cache keyed on `package-lock.json`, `pull-push` in build and `pull` everywhere else
- `dist/` passed downstream as a job artifact, then loaded by `verify_build_artifact`
- JUnit XML uploaded via `artifacts:reports:junit` → the pipeline's **Tests** tab
- Cobertura uploaded via `artifacts:reports:coverage_report` → **line-by-line coverage in MR diffs**
- `coverage:` regex scrapes the percentage onto the job list and MR widget
- `verify_build_artifact` uses `rules:` to run on the default branch only

### `.github/workflows/ci.yml`

- five jobs wired with `needs:`, so the graph view shows the real dependency chain
- `unit` runs as a **matrix** across Node 20 and 22 with `fail-fast: false`
- `concurrency` cancels in-flight runs when you push again to the same branch
- `actions/setup-node` with `cache: npm`
- artifacts uploaded with `if: always()` so a red run still gives you the reports
- the coverage job writes a markdown table to `$GITHUB_STEP_SUMMARY`
- `verify-artifact` installs with `--omit=dev` and loads the compiled bundle,
  which catches a devDependency accidentally imported by production code

> The workflow file must sit at `.github/workflows/` in the **repository root**.
> Anywhere else and GitHub Actions ignores it without saying anything.

### Things to try breaking

The pipeline is only interesting if you can make it fail on purpose:

| Change | Which job goes red | Measured |
|---|---|---|
| Pass the wrong type to `findByIsbn` | `build` — nothing else even runs | `error TS2345` |
| Change `FINE_PER_DAY_CENTS` to `600` | `unit`, then `integration`, then `coverage` | 4 of 396 tests |
| Drop the `- 1` from `reserveCopy`'s UPDATE | `integration` only — unit stays green | 22 of 149 integration tests |
| `npx jest --coverage --coverageThreshold '{"global":{"statements":100}}'` | `coverage` — tests pass, exit code 1 | 247/247 pass, job red |
| `import` a devDependency from `src/` | `verify-artifact` only | `Cannot find module` |

Each one is walked through with its full output in
[`docs/DEMO-PLAYBOOK.md`](docs/DEMO-PLAYBOOK.md), including how to undo it.

---

## Notes

- `node:20` is used as the CI image rather than `node:20-alpine`: `better-sqlite3` ships
  prebuilt binaries for glibc, and on musl it would have to compile from source.
- Coverage uses the V8 provider — no Babel instrumentation, so it is fast.
- `src/services/types.ts` is excluded from coverage; it contains only type declarations
  and compiles to nothing executable.
- `legacy-task-api/` is the small Task API this workspace started from, kept for reference.
  Nothing in the current project depends on it.
