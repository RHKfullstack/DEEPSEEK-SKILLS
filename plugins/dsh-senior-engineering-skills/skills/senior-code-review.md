# Senior Code Review

Review code at the standard a senior engineer is expected to hold: is it correct, safe under failure, defensible under concurrency, testable, and maintainable by someone who is not the author.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A diff, PR, or file is presented for review before merge.
- You are reading unfamiliar code to judge whether it is sound, not merely to understand it.
- A junior or agent-authored change needs a gate before it reaches a shared branch.
- You must decide whether an existing module is safe to build on.

## When it does not

- The question is whether a completion claim is true; that is a work audit.
- The code path is being evaluated for exploitable weakness in a running system; that is hardening or threat modelling.
- The review target is a dependency you do not own; that is supply-chain audit.
- The change is documentation, comments, or formatting only — read it, do not run this procedure.

## Core rule

Review for correctness first and style last. Google's review guidance is explicit that the reviewer's job is to approve a change that improves overall code health, not to approve a perfect change — and that correctness, tests, and design outrank nitpicks ([Google Engineering Practices](https://google.github.io/eng-practices/review/)).

## Phase 1 — Frame the review before reading line by line

1. Read the change description, the linked issue, and any migration or rollout notes.
2. Read the diff in full once without commenting, to build a model of intent.
3. Identify the risk class: new feature, bug fix, refactor, dependency bump, schema change, config change, or performance work. Each has a different failure signature.
4. Locate the surrounding code — a five-line diff inside a 900-line function must be judged with the whole function in view.
5. Confirm you can build and test the change locally, or that CI evidence exists and is inspectable.
6. EVIDENCE: a one-paragraph statement of what the change does and what could break.

## Phase 2 — Correctness and logic

1. Trace the primary path with concrete inputs, writing the values at each step. Do not accept "looks right".
2. Check the boundary conditions explicitly: empty collection, single element, zero, negative, maximum, off-by-one at loop ends.
3. Check null/None/undefined handling on every newly dereferenced value.
4. Check numeric behaviour: integer division, floating-point equality, overflow, currency represented as float, rounding mode.
5. Check string handling: encoding, trimming, case sensitivity, locale-dependent comparison and sorting.
6. Check time and date handling: timezone-awareness, DST, leap boundaries, monotonic versus wall-clock for durations.
7. Check the error paths of every call the change makes — what happens when the returned value is an error, a timeout, or a signal.
8. EVIDENCE: per-branch table of input → expected → actual, with `file:line` for each concern.

## Phase 3 — Failure behaviour

1. For each external call (network, disk, database, subprocess), name the failure mode and what the code does: retry, propagate, degrade, or corrupt.
2. Verify retries are bounded, have backoff, and are safe to repeat — an unbounded or non-idempotent retry turns a blip into an outage ([Google SRE Book](https://sre.google/sre-book/table-of-contents/), handling overload).
3. Verify timeouts exist and are shorter than the caller's timeout. A missing timeout is a thread-pool leak.
4. Verify error handling preserves context: the original exception or status must survive, not be replaced by a generic message.
5. Flag swallowed errors: `catch (e) {}`, `except: pass`, `_ = err`, log-and-continue on a write that must succeed.
6. Verify partial failure is atomic where it must be: multi-step writes need a transaction, a compensating action, or an explicit reconciliation path.
7. Verify cleanup runs on the failure path, not only on success (defer/finally/using/context manager).
8. EVIDENCE: failure-mode table with the handling code and `file:line` per row.

## Phase 4 — Concurrency, state, and resources

1. Identify every shared mutable structure and the primitive protecting it. Unsynchronised read-modify-write is a race regardless of how fast it looks.
2. Check for check-then-act sequences (TOCTOU) on files, caches, and database rows.
3. Check lock ordering and confirm no path acquires two locks in opposite order.
4. Check that locks are not held across I/O or network calls.
5. Check async/await correctness: un-awaited promises, dropped goroutines without cancellation, `async void`, blocking calls inside an event loop.
6. Check resource lifetime: connections returned to the pool, files closed, subscriptions unsubscribed, listeners removed, threads joined.
7. Check idempotency of anything a queue or webhook may deliver twice.
8. EVIDENCE: shared-state inventory with the protecting primitive named per entry; resource-open/close pairing list.

## Phase 5 — Security-relevant review

1. Input: every new input is validated at the trust boundary against an allowlist, and validation is server-side ([OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) 5.0 V2, Validation and Business Logic — V2 is the validation chapter in ASVS 5.0; the "V5" of 4.0.3 is superseded).
2. Injection: no string-built SQL, shell, LDAP, or template; search the diff for concatenation into a query or command ([CWE Top 25](https://cwe.mitre.org/top25/), CWE-89, CWE-78).
3. Authorization: every new endpoint or handler enforces an ownership/permission check on the object, not merely authentication (OWASP API Security Top 10, broken object level authorisation — [owasp.org/API-Security](https://owasp.org/API-Security/)).
4. Output encoding and deserialization: no unsafe deserialization of untrusted data (CWE-502); encoding applied at the point of rendering.
5. Secrets: no credential, token, or key literal in code, tests, fixtures, or logs. Placeholders only (`API_TOKEN`, `SERVICE_ACCOUNT_KEY`, `sk-REDACTED`).
6. Cryptography: no bespoke crypto, no MD5/SHA-1 for integrity or passwords, correct mode and nonce handling, `secrets` over `random` for tokens.
7. Logging: no secret or personal datum written to logs; no user input rendered into a log in a way that permits log injection.
8. Path and file handling: user-controlled paths are canonicalised and confined (CWE-22).
9. EVIDENCE: finding per item with the vulnerable line quoted and the weakness ID.

## Phase 6 — Tests and verifiability

1. Confirm each new behaviour has a test that would fail if the behaviour were reverted. Mentally revert the change and check the test goes red.
2. Confirm the tests assert on values, not on the implementation's own constants or mocks.
3. Confirm negative-path tests exist: invalid input, missing permission, upstream failure, timeout.
4. Confirm tests are deterministic: no wall-clock dependence without injection, no ordering assumptions, no real network in unit tests.
5. Confirm the test names describe behaviour, so a failure report is actionable.
6. Confirm the change does not weaken existing tests as a side effect.
7. EVIDENCE: test list with the behaviour each covers; the revert-thought-experiment result per test.

## Phase 7 — Interface, compatibility, and design

1. Check the public signature change for backward compatibility — argument order, optionality, return shape, exceptions raised.
2. Check serialized formats (JSON fields, protobuf field numbers, database columns) for additive-only compatibility.
3. Check the abstraction level: does this add a leaky detail to a general interface, or solve a general problem with a special case?
4. Check duplication: is this logic already implemented elsewhere, and if so, is the divergence justified?
5. Check whether the design follows the codebase's existing conventions, or introduces a second way to do the same thing.
6. Check ISO/IEC 25010 maintainability criteria: modularity, reusability, analysability, modifiability, testability (as rendered by the [ISO 25000 portal](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — a secondary rendering, not the ISO text itself).
7. EVIDENCE: interface-change list marked breaking or additive; duplicated-logic citations.

## Phase 8 — Write the review

1. Order comments by severity: correctness and security first, design second, style last, and label each comment.
2. Attach a concrete suggestion or a counter-example to every blocking comment; "this is wrong" without a path forward is not a review.
3. Distinguish blocking (`must fix`) from non-blocking (`consider`, `nit`) explicitly so the author is not guessing.
4. State what you verified and how, so the author knows the review is not purely visual.
5. If you could not verify something, say so and name what would verify it.
6. Summarise the verdict: approve, approve with nits, or request changes — with the reason in one sentence.
7. EVIDENCE: the review text with severity labels and the verification statement.

## Review comment vocabulary

- `must fix` — correctness, security, data loss, or a broken contract; blocks merge.
- `should fix` — maintainability or testability debt that costs more to defer than to fix now.
- `consider` — an alternative worth weighing; the author may decline with a stated reason.
- `nit` — style or naming; never blocks, and never dominates the thread.
- `question` — the reviewer genuinely does not understand the code; answer it here rather than approving in silence.

## Definition of done

- Every blocking comment names a concrete failure scenario or a counter-example.
- Each security-relevant finding carries a weakness ID and the quoted offending line.
- The review states what was verified by execution and what was judged by reading alone.
- The verdict is explicit: approve, approve with nits, or request changes.
- Nothing blocking is left as an unlabelled comment in the middle of a long thread.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Intent statement; risk class; build/test availability |
| 2 | Input → expected → actual table with `file:line` |
| 3 | Failure-mode table with handling code |
| 4 | Shared-state inventory; resource pairing list |
| 5 | Weakness findings quoted with CWE/ASVS IDs |
| 6 | Test-to-behaviour map; revert-thought-experiment result |
| 7 | Breaking vs additive interface changes |
| 8 | Labelled review with verdict and verification statement |

## Failure modes a naive reviewer misses

1. **Reviewing the diff, not the function.** A correct-looking three-line change inside a function that already had the bug beneath it passes review and ships the bug.
2. **Approving on green CI alone.** CI proves the tests the author wrote pass; it does not prove the tests cover the change. Read the assertions.
3. **Ignoring the error branch of the new call.** The happy path is reviewed carefully; the `else`, the `catch`, and the timeout branch are skimmed — and that is where production lives.
4. **Missing the second call site.** A signature or contract change is applied to the visible caller and not to the three others found only by searching the whole tree.
5. **Concurrency assumed away.** "This only runs on one thread" is an assumption about deployment topology, load balancing, or future refactoring, not a property of the code.
6. **Resource leaks on the error path.** Connections, file handles, and locks are released on success and skipped when an exception is thrown between acquisition and release.
7. **Authorization confused with authentication.** The handler checks that the caller is logged in and never that the caller owns the object being accessed.
8. **Seniority bias.** A change from a trusted author or a large generated diff gets a shallower read; both correlate with defects going unnoticed.
9. **Nitpick dominance.** Twenty style comments and no comment on the missing transaction teaches the author that review is about formatting.
10. **Review of the pre-squash revision.** The reviewed SHA differs from the merged tree after rebase; the comment thread describes code that no longer exists.

## Sources

- [Google Engineering Practices — Code Review](https://google.github.io/eng-practices/review/) — reviewer standard, severity, and what to look for.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) — V5 validation and encoding requirements.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — per-weakness remediation detail.
- [OWASP API Security Top 10](https://owasp.org/API-Security/) — object and function level authorisation failures.
- [CWE Top 25 Most Dangerous Software Weaknesses](https://cwe.mitre.org/top25/) — weakness identifiers used in Phase 5; the [2025 archive](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) carries the current 2025 ranks.
- [OWASP Top 10:2025](https://top10.owasp.org/2025/) — risk categories to scan a diff against, including A03 Software Supply Chain Failures; the [project hub](https://owasp.org/www-project-top-ten/) indexes earlier editions.
- [ISO/IEC 25010 — Product quality model](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — the ISO 25000 portal's rendering of the standard, not the ISO text itself; maintainability and compatibility criteria.
- [Google SRE Book](https://sre.google/sre-book/table-of-contents/) — retries, timeouts, cascading failure, and overload behaviour.
- [12-Factor App](https://12factor.net/) — config, statelessness, and disposability expectations for reviewed code.
