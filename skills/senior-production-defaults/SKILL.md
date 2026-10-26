---
name: senior-production-defaults
description: Stop the AI shipping framework defaults and tutorial-grade scaffold. Use whenever implementing, generating, scaffolding or extending backend or frontend code - a controller, service, model, endpoint, component, hook or form - and before reporting a feature built. Pairs with senior-code-review (which catches the same defects at review time) and ui-design section 4b (which covers the visual defaults).
---

# Senior Production Defaults

A framework default is a starting point, not a decision. `make:controller`, a generator, a tutorial, or a Stack Overflow answer produces the **shape**; the senior engineer adds the **decisions**. The difference between a demo and production is entirely in what the default left out.

This skill is the build-time counterpart to `senior-code-review`: review catches these in a diff, this prevents them in the diff.

## Phase 0 — Read the project before writing a line

The fastest way to avoid default code is to copy the project's own convention. Do this first, every time:

1. Find **two existing files of the same layer** — controller, service, model, component, hook, test. Read both.
2. Extract and write down: naming pattern, error shape, response envelope, logging call, validation location, test style.
3. Mirror them. A third pattern for the same problem is a defect even when it is "better".
4. If the layer does not exist yet, say so and state the pattern you are introducing — one sentence, in the reply. That sentence is the ADR the next agent will need.

**EVIDENCE: `conventions.md` — the two files read, and the six things copied from them.**

## Phase 1 — Backend defaults that must never ship

| Default | Senior replacement |
|---|---|
| `try { ... } catch { }` — swallowed error | handle it, log with context, or map to a typed error; never discard |
| Controller with no validation | validation at the trust boundary (FormRequest, schema, DTO) before the handler runs |
| `SELECT *` / `Model::all()` | explicit columns, and a limit or pagination on anything user-facing |
| Query inside a loop (N+1) | eager load, batch, or one query with an index behind it |
| String-built SQL | parameter binding; a concatenated clause is a blocker |
| Business logic in the controller | a service/action class, with the transaction boundary named |
| Multi-step write without a transaction | one transaction, or an explicit compensating action |
| `dd()`, `var_dump()`, `print_r()`, `console.log` | the project's structured logger: level, message, context fields |
| Hardcoded config, secret, URL, or magic number | config/env, validated and failing fast at boot |
| Raw exception message sent to the user | a designed error state plus a correlation id in the log |
| `TODO` / `FIXME` / commented-out code shipped | file it, or delete it |
| Write endpoint with no idempotency | idempotency key or unique constraint (see `senior-background-jobs`) |
| Unbounded list endpoint | pagination, with a documented maximum page size |
| No timeout on an outbound call | timeout + bounded retry (see `senior-code-review` Phase 3) |

## Phase 2 — Frontend defaults that must never ship

| Default | Senior replacement |
|---|---|
| `any`, `as any`, `@ts-ignore` to silence the compiler | a real type, or `unknown` with narrowing at the boundary |
| `useEffect` fetching with no cleanup | abort controller, or the project's query library |
| Array index as a React key | a stable id from the data |
| `console.log` left in | removed, or dev-gated behind a logger |
| Inline styles and magic values | design tokens (`ui-design` §2) |
| User-facing copy hardcoded in JSX | the project's copy/i18n source |
| Optimistic update with no rollback | error path restores the previous state |
| Spinner-only loading, no empty, no error | the three states (`senior-frontend-engineering` Phase 4) |
| Props drilled three levels deep | context, store, or query cache — whichever the project already uses |
| A second fetching pattern beside the existing one | mirror the one already in the codebase |
| Unstyled native control on a product-owned surface | `ui-design` §4b |
| Form with client validation only | server validation is the gate; the client is UX |

## Phase 3 — The executable check

Run this on the changed paths before reporting the feature built. Every hit is either fixed or justified in the reply.

```bash
git diff --name-only <base>...HEAD > /tmp/changed.txt     # or: git status --porcelain

git grep -nE 'catch\s*\([^)]*\)\s*\{\s*\}' -- $(cat /tmp/changed.txt)        # swallowed
git grep -nE 'dd\(|var_dump|print_r|console\.log' -- $(cat /tmp/changed.txt) # debug left in
git grep -nE 'SELECT \*|::all\(\)|\.get\(\)\s*$' -- $(cat /tmp/changed.txt)  # unbounded
git grep -nE ': any\b|as any|@ts-ignore' -- $(cat /tmp/changed.txt)          # silenced types
git grep -nE 'TODO|FIXME|XXX' -- $(cat /tmp/changed.txt)                     # deferred
git grep -nE 'catch.*\{\s*$' -- $(cat /tmp/changed.txt)                      # suspicious empty block
```

A hit is not automatically a defect — but it is a line the author must account for. "It was already there" is not an account; the change is in scope.

**EVIDENCE: the grep output, with a verdict per hit (fixed / justified / pre-existing and out of scope).**

## Phase 4 — The empty-file test

For every new file in the diff, answer: **what would a reviewer delete from this file without changing behaviour?** Anything they would delete is default code that was not asked for — a getter nobody calls, a config key nobody reads, an abstraction with one implementation, a comment restating the code.

A minimal diff with decisions beats a large one with scaffolding. If a generator produced it and nobody edited it, it is not finished.

## Definition of done

- The two convention files were read, and the six copied patterns are written down.
- No row of Phase 1 or Phase 2 is present unaddressed in the changed paths.
- The Phase 3 grep ran, and every hit has a verdict.
- Every new file survives the empty-file test.
- Anything not done is named as `PLANNED`, not implied.

## Failure modes a naive reviewer misses

1. **Generator output shipped verbatim.** The resource controller, the CRUD scaffold, the create-react-app component — never edited, so it carries every default.
2. **Two patterns for one problem.** The new code works, but now the codebase has two ways to fetch, validate, or log.
3. **Happy path only.** No empty, no error, no unauthorised, no timeout.
4. **Error swallowed to make the test pass.** `catch {}` around the failing call turns a red test green and leaves the defect.
5. **`any` to silence the compiler.** The type error is the finding; the cast hides it.
6. **Log noise instead of a log line.** Twelve `console.log` calls and no log level, context, or correlation id.
7. **Config hardcoded "for now".** It ships, and production now differs from the repository.
8. **No pagination.** It works with 40 rows and falls over at 40,000.
9. **No transaction.** Two writes, one fails, and the data is half-written with no code path that notices.
10. **"It works" as the bar.** Working is the floor; the senior bar is working under failure, at scale, and in six months by someone else.
