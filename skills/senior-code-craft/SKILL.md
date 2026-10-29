---
name: senior-code-craft
description: Write code a stranger can follow - file skeleton, intention-revealing names, function shape, comments that earn their place, module boundaries and a diff a reviewer can read. Use when writing or restructuring application code and scripts, when a file has grown confusing, when handing work to another developer, and before reporting an implementation complete. This is the writing discipline; senior-production-defaults is what not to ship, senior-code-review is judging a diff.
---

# Senior Code Craft

Code is read far more often than it is written, and the reader arrives with **no memory of what you were thinking**. Every choice below is made for that reader — the next developer, the reviewer, and the version of you who returns in six months.

`senior-production-defaults` decides *what* the code must do. This skill decides *how it is laid out* so the doing is obvious.

## Phase 0 — Read before you write

Open two files of the same layer. Copy their conventions:

1. Import order and grouping.
2. Naming style (camelCase, snake_case, suffixes like `Repository`, `Service`).
3. Where types live, and whether they are inline or separate.
4. Comment density and whether public APIs get doc comments.
5. File length and how responsibilities are split.

**The codebase's convention beats your preference.** A third pattern is a defect even when it is prettier. If the layer is new, state the pattern in one sentence in the reply.

## Phase 1 — The file skeleton

Every file reads top to bottom in a predictable order:

```text
1. File doc comment      one sentence: what this module owns
2. Imports               external, then internal, then types; alphabetical inside a group
3. Constants             named, with units where relevant
4. Types / interfaces    the shape of what flows through the file
5. Public functions      in reading order: entry point first, then what it calls
6. Private helpers       directly below their first caller, not at the bottom
7. Exports               inline or at the end - pick one and keep it
```

Rules:

- **One reason to change per file.** If the filename needs "and", it is two files.
- **No dead code.** No commented-out blocks, no unused imports, no `_old` suffixes.
- **No side effects at import time** except a deliberate entrypoint.
- A file past roughly 300–400 lines is a prompt to look, not an automatic split — look for the second responsibility.

**EVIDENCE: the file, and one sentence naming what it owns.**

## Phase 2 — Names carry the meaning

A name should answer "what is this and why does it exist" without reading the body.

| Rule | Bad | Good |
|---|---|---|
| Domain words, not types | `stringList`, `obj`, `data` | `pendingInvoices`, `parsedConfig` |
| Unit in the name | `timeout`, `price` | `timeoutMs`, `priceCents` |
| Boolean reads as a question | `flag`, `status` | `isVerified`, `hasAccess` |
| Verb for actions, noun for values | `userData()` returning a user | `getUser()` / `user` |
| No invented abbreviations | `usr`, `cfg`, `btn`, `mgr` | `user`, `config`, `button`, `manager` |
| Pronounceable, searchable | `hndlClk`, `x2` | `handleClick`, `retryCount` |
| Consistency across the layer | `fetchUser` in one file, `getUser` in the next | one verb per intent |

**The test:** cover the body and read the signature and the call site. If the name does not say what happens, rename it before writing the body.

## Phase 3 — Function shape

- **One level of abstraction.** A function either orchestrates calls or does one concrete thing — not both.
- **Guard clauses, not nesting.** Return early; never `else` after a `return`. Two levels of indentation is the ceiling.
- **Three parameters maximum.** Beyond that, an options object with named keys.
- **No boolean parameters.** `render(true)` says nothing; `render({ compact: true })` does.
- **Side effects are named.** `saveInvoice`, `sendReceipt`, `writeAudit` — never `processInvoice` when it writes to the database.
- **Pure where it can be.** A calculation that touches IO cannot be tested without a fixture; a pure one can be tested with a table.
- **A function longer than a screen** is a prompt to extract the steps it already names.

```js
// bad: the happy path is buried
function settle(order) {
  if (order) {
    if (order.items.length) {
      if (order.isPaid) {
        if (!order.settled) {
          return runSettlement(order);
        }
      }
    }
  }
}

// good: the guards are the documentation
function settle(order) {
  if (!order?.items.length) throw new Error("empty order");
  if (!order.isPaid) throw new Error("unpaid order");
  if (order.settled) return order;          // idempotent
  return runSettlement(order);
}
```

**EVIDENCE: the function, and the maximum indentation depth it reaches.**

## Phase 4 — Comments that earn their place

Exactly four kinds survive review:

1. **Why.** The reason behind a non-obvious decision — a constraint, a workaround, a business rule.
2. **A warning.** "Must run before `X`", "O(n²) on purpose, n < 10", "do not call this in a loop".
3. **A source.** The ticket, spec, regulation or upstream issue that justifies the code.
4. **A public API doc.** Parameters, return, errors thrown — for anything another module calls.

Never:

- A comment that restates the code (`// increment i`).
- Commented-out code — git remembers it.
- `TODO` without an owner and an issue.
- Decorative section banners — the function names already do that job.

**EVIDENCE: every comment in the diff is one of the four kinds, or it is deleted.**

## Phase 5 — Module boundaries

- **Imports only at the top**, grouped, no circular imports.
- **Explicit public surface.** A barrel/`index` file only where a package boundary needs one; exporting everything hides what is safe to change.
- **Types next to what they describe**, or in one shared types module — one policy for the whole project.
- **Configuration in one place.** Environment reads belong in the config module, not scattered through the call stack.
- **A shared helper moves only at the third use.** Two copies is a coincidence; three is a pattern.

**EVIDENCE: the import list, and one sentence on where the module's public surface ends.**

## Phase 6 — The diff a reviewer can follow

- **One change per commit.** Formatting is its own commit; a rename is its own commit.
- **No drive-by edits** in files the change does not need.
- **Order the reading**: types → implementation → tests → docs.
- **Commit message says what and why**, not "fix" or "update". Conventional Commits if the project already uses them.
- **Each commit reverts cleanly on its own.**

**EVIDENCE: `git log --oneline` for the change, and the diff stat per commit.**

## Phase 7 — Tests as documentation

- **Names read as sentences:** `it("rejects a transfer above the daily limit")`.
- **Arrange–Act–Assert**, separated by blank lines so the three parts are visible.
- **One behaviour per test** — a failing test should point at one thing.
- **Fixtures are named for the scenario** (`overdueInvoice`), not `data1`, `mock2`.
- **A test that needs a comment to explain it** is a naming problem in the code under test, not in the test.

**EVIDENCE: three test names from the diff, read aloud.**

## Phase 8 — The five-minute test

Hand the file to someone who has never seen the project. Within five minutes they should answer:

1. **What does this file own?**
2. **Where does execution start?**
3. **What happens on the error path?**
4. **What would break if I changed X?**

If any answer needs a guided tour, the file is organized for the author's memory rather than the reader's lack of it.

**EVIDENCE: the four answers, from someone who is not you — or the honest note that no one was available and the file was read cold.**

## Anti-default table

| Tutorial default | The craft |
|---|---|
| `function doStuff(a, b, c)` | `settleInvoice(invoice, { at })` |
| Four levels of nesting | guard clauses, two levels maximum |
| A comment above every line | a comment where the *why* is non-obvious |
| An 800-line file | split by responsibility, named for it |
| `data`, `temp`, `flag`, `arr` | domain words with units |
| Commented-out code | deleted — git has it |
| Imports scattered mid-file | grouped at the top |
| Magic number `86400` | `SECONDS_PER_DAY = 86_400` |
| One commit touching twelve files | one change per commit, revertible |
| Test named `test1` | `it("rejects a transfer above the daily limit")` |
| Helper extracted on first use | extracted at the third |

## Definition of done

- The file skeleton is applied, and the file has one reason to change.
- Names are domain words; units are in the name; booleans read as questions.
- Functions take at most three parameters and nest at most two levels.
- Every comment is one of the four kinds; no commented-out code remains.
- The diff is one change per commit and each reverts alone.
- The five-minute test was run on the file.

## Failure modes

1. **Organized for the author's memory** — clever ordering that only makes sense if you wrote it.
2. **Clever one-liners** that need a comment to be understood.
3. **Deep nesting** that hides the happy path in the middle.
4. **Comments that repeat the code**, and rot the moment the code changes.
5. **The "while I was there" commit** — unreviewable, and it hides the real change.
6. **Naming by type** (`stringList`, `objectArray`) instead of by meaning.
7. **Tests that assert nothing** — `expect(result).toBeDefined()` passes for every bug.
8. **Premature abstraction** — a base class for two implementations, a factory for one.

## Sources — verified live 2026-10-29

- [Google style guides](https://google.github.io/styleguide/) — per-language conventions with rationale.
- [Airbnb JavaScript style guide](https://github.com/airbnb/javascript) — the most cited JS conventions, with examples.
- [PEP 8](https://peps.python.org/pep-0008/) — Python layout, naming and import rules.
- [The Zen of Python (PEP 20)](https://peps.python.org/pep-0020/) — the principles the rules serve.
- [Laravel contribution guide](https://laravel.com/docs/11.x/contributions) — the conventions a Laravel codebase already expects.
- [Refactoring Guru — code smells](https://refactoring.guru/refactoring/smells) — the named symptoms, with fixes.
- [Martin Fowler — CodeSmell](https://martinfowler.com/bliki/CodeSmell.html) — the origin of the term.
- [Naming cheatsheet](https://github.com/kettanaito/naming-cheatsheet) — a compact naming reference across paradigms.
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) — the commit-message format when a project uses it.
