# Senior Test Adequacy

Judge whether a test suite actually verifies the change under review: falsify it by reverting, measure coverage on the changed lines, score assertion quality and mutation survival, prove determinism, and report confidence as a defensible statement instead of a green badge.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A completion claim rests on "tests pass" and someone must decide how much that is worth.
- Tests were added, edited, deleted, skipped, or quarantined inside the diff under review.
- A defect shipped through a green suite, or a regression reappeared after being reported fixed.
- The suite is slow, flaky, order-dependent, or fails only in CI.
- A new package, service, or consumer contract is introduced and the verification strategy must be set before code is written.

## When it does not

- There is no claim to verify and no test code in scope — that is code review or an architecture review.
- The change is documentation, formatting, or generated output with no executable behaviour; record the gap and move on.
- The suite is a deliberate smoke test labelled as such; record the limit rather than grading it as a full verification.

## Core rule

Coverage is a negative indicator, not a target: low coverage proves code is untested, high coverage proves nothing about whether the tests catch a defect ([Martin Fowler, TestCoverage](https://martinfowler.com/bliki/TestCoverage.html)). The question to answer for every change is falsification — if this change were reverted with the tests kept, would the suite fail? — and the evidence is the failing output, not the pass count. NIST SSDF treats verification as a distinct practice with its own evidence ([NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final), PW.7, RV.1).

State this in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Fix the claim and the verification target

1. Restate the claim as one falsifiable sentence: "Test T proves behaviour B of change C, demonstrated by output O."
2. Pin the revision: `git rev-parse HEAD`, `git status --porcelain`, `git merge-base HEAD origin/main`.
3. Separate changed tests from changed source: `git diff --name-only <base>...HEAD | Select-String 'test|spec|__tests__|_test\.'`.
4. Build a behaviour-to-test map by name for each changed behaviour. A behaviour with no named test is an explicit gap, not an implied pass.
5. Read the CI workflow and name the job and command that actually runs this suite: `Select-String -Path .github/workflows/*.yml -Pattern 'run:'`. Confirm path filters and `if:` conditions do not skip it for this change.
6. Classify each suite by resource access — small (no network, no database, no clock), medium (local process), large (external systems) — per the [Google test-sizes taxonomy](https://testing.googleblog.com/2010/12/test-sizes.html).
7. EVIDENCE: claim sentence, head SHA, changed-test and changed-source lists, behaviour-to-test map, CI job name and command, taxonomy table.

## Phase 2 — Falsify the change by reverting it

1. Revert the source hunk only, keep the tests, run the suite, and confirm it fails: `git stash push <source.paths>` then run the suite.
2. Capture the raw failing output and the exit code, not a summary of them.
3. Restore the source and re-run to confirm the pass: `git stash pop`, re-run, record the exit code.
4. If the suite passes with the source reverted, the tests do not verify this change — record a finding naming the test and the reverted hunk.
5. For a defect fix, run the new regression test against the pre-fix revision (`git worktree add <dir> <pre-fix-sha>`) and confirm it fails there. A regression test that never failed on the old code is unproven.
6. For flag-gated behaviour, run the suite with the flag off and the flag on; both configurations are part of the claim.
7. EVIDENCE: failing-with-revert output and exit code, passing-restored output and exit code, the exact commands, pre-fix regression-test failure.

## Phase 3 — Measure coverage on the diff, not the repository

1. Python: `pytest --cov=<pkg> --cov-branch --cov-report=term-missing --cov-report=xml`.
2. Go: `go test -coverprofile=cover.out -covermode=atomic ./...` then `go tool cover -func=cover.out`.
3. JS/TS: `nyc --reporter=text --reporter=lcov npm test`; C/C++: `gcovr --txt --branches`.
4. Restrict the report to changed lines with a diff-coverage tool: `diff-cover coverage.xml --compare-branch=origin/main`. The repository percentage hides the untested new branch.
5. Report branch coverage alongside line coverage; a covered line with an unexecuted branch is untested logic.
6. Compare changed-file coverage against a pre-change baseline of the same files — a jump in untouched files means the metric moved for unrelated reasons.
7. EVIDENCE: the scoped coverage report, the branch percentage, the exact command, and the threshold the project claims to enforce.

## Phase 4 — Score assertion quality and mutation survival

1. Count assertions and mock constructions per changed test; record the ratio.
2. Flag tests whose only assertion is a mock interaction (`mock.assert_called_once()`, `expect(spy).toHaveBeenCalled()`, `verify(mock)`). That verifies wiring, not behaviour.
3. Flag tests asserting a value the implementation returns from the same constant, and tests asserting on a log line rather than on state.
4. Run mutation testing on the changed module only and record the module score: [PIT](https://pitest.org/) (JVM), [Stryker](https://stryker-mutator.io/) (JS/TS/.NET/Scala), `mutmut` (Python), `cargo-mutants` (Rust).
5. List the surviving mutants. Each survivor is a precise, named untested logic path — this is the most actionable artifact the audit produces.
6. Identify equivalent mutants explicitly rather than padding the score; report the denominator with the score ([mutation-testing.org](https://mutation-testing.org/)).
7. EVIDENCE: assertion inventory with quoted lines, mock-only test count, mutation report for the changed module with killed percentage and the survivor list.

## Phase 5 — Prove taxonomy, hermeticity, and determinism

1. Confirm "small" tests genuinely touch no network, database, clock, or filesystem: enable socket blocking (`pytest-socket --disable-socket`), or grep for `requests.`, `HttpClient`, `Connection`, `new Date()`.
2. Replace doubles at the boundary under test with the real dependency where the boundary is the subject: [Testcontainers](https://testcontainers.com/) for databases, queues, and browsers. A "database test" against an in-memory fake verifies no SQL.
3. Run the suite twice in a row and compare results and durations; a second-run pass after a first-run fail is state leakage.
4. Randomise order: `pytest -p randomly` ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly)), `go test -shuffle=on ./...`, `jest --randomize`. Any failure that appears in one ordering is hidden coupling.
5. Run in parallel where the project allows (`pytest -n auto` via [pytest-xdist](https://github.com/pytest-dev/pytest-xdist)) and run the race detector: `go test -race ./...`, `cargo test` under ThreadSanitizer.
6. Vary the clock and timezone: `TZ=Pacific/Kiritimati`, a frozen clock and a real clock. Record which tests change behaviour.
7. Inventory timing-based synchronisation: grep for `time.sleep`, `Thread.sleep`, `cy.wait(`, `setTimeout(` in tests. These are flake sources, not synchronisation.
8. EVIDENCE: taxonomy table with hermeticity proof, two-run comparison, shuffled-order result, parallel/race-detector result, timezone variant, sleep inventory.

## Phase 6 — Cover the negative, edge, and failure paths

1. Enumerate every branch added by the change and locate the failing-input test for each. Coverage of the branch without a negative test is partial.
2. Boundary inputs: empty, single element, maximum size, unicode and encoding edge cases, duplicate keys, null.
3. Concurrency and idempotency: duplicate submission, two writers on one record, retried request with the same idempotency key.
4. Failure injection for any retry, queue, or failover path: [Toxiproxy](https://github.com/Shopify/toxiproxy) for latency and connection resets, [Chaos Mesh](https://www.chaos-mesh.org/) for pod and network faults, or a fault-injecting fake at the boundary.
5. Assert on recovery: after the injected failure the system must reach the defined terminal state, not merely log an error.
6. Confirm the error path is asserted on state or exit code rather than on a log string.
7. EVIDENCE: per-branch negative-path inventory naming the test or the gap, the injected-failure test with its recovery assertion, concurrency test result.

## Phase 7 — Audit cross-boundary contracts and the suite's honesty mechanisms

1. Where a consumer depends on the changed shape, run consumer-driven contract tests ([Pact](https://docs.pact.io/)) or a schema-compatibility check. A producer's green unit suite coexists with every consumer broken.
2. Prove serialization and query round-trips against the engine version actually deployed, not an older local build.
3. Count skips, `xfail`, `only`, and quarantined tests: `pytest -rs`, grep for `@pytest.mark.skip`, `it.only`, `t.Skip`.
4. Count tests that pass only on retry (`pytest-rerunfailures --reruns 3`): a retried pass is a race that was observed.
5. Audit coverage exclusions (`# pragma: no cover`, `/* istanbul ignore */`, `coverage omit`). A growing exclusion list is a shrinking control.
6. Audit CI for silent exclusions: `continue-on-error: true`, `if: false`, a matrix row that never runs, a cached result reused across revisions.
7. EVIDENCE: contract test result or the statement that no consumer contract exists, skip/xfail/quarantine counts, retry-only pass count, exclusion list size, CI condition excerpt.

## Phase 8 — Verdict and evidence package

1. Give the verdict in one of four terms: VERIFIED, VERIFIED WITH CAVEATS, UNVERIFIED, or INADEQUATE. INADEQUATE judges the *tests*, not the change: adequate tests over a broken change still fail the work audit. When both skills run, `senior-work-audit`'s REGRESSION FOUND governs the change and this verdict governs test sufficiency - report both rather than collapsing them.
2. Split the evidence three ways: behaviours proven by falsification, behaviours proven by coverage only, behaviours with no test.
3. Name the specific tests that would have to fail to catch a regression in the changed module, and state whether each exists.
4. Record flake rate with the repeat count: failures over runs, per suite.
5. Record suite wall-clock time; a feedback loop too slow to run during development is a verification risk of its own.
6. Label every unexecuted check `PLANNED` or `UNAVAILABLE` with the exact command to run later — an unavailable check is a legitimate terminal state, not a pass.
7. EVIDENCE: the written report — verdict, three-way split, named tests, flake rate, timings, and the full command log with exit codes.

## Definition of done

- The falsification experiment was run and its failing output is quoted for every core behaviour claimed.
- Coverage is reported on changed lines with branch data, not as a repository percentage.
- Mutation survival is recorded for the changed module with the surviving mutants listed by name.
- Determinism is demonstrated by a repeat run, a shuffled-order run, and one environment variation.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Claim sentence; head SHA; changed-test/source lists; behaviour-to-test map; CI job and command |
| 2 | Failing-with-revert output; passing-restored output; both exit codes; pre-fix regression failure |
| 3 | Diff-scoped coverage report with branch percentage and threshold |
| 4 | Assertion inventory; mock-only count; mutation report with survivors listed |
| 5 | Taxonomy + hermeticity proof; repeat run; shuffled run; race/parallel result; sleep inventory |
| 6 | Per-branch negative-path inventory; injected-failure test; concurrency result |
| 7 | Contract result; skip/xfail/quarantine counts; retry-only passes; exclusion list; CI conditions |
| 8 | Verdict; three-way evidence split; named tests; flake rate; command log with exit codes |

## Failure modes a naive reviewer misses

1. **Coverage as a proxy for correctness.** A line is executed without anything being asserted, so 100% line coverage coexists with a suite that would pass on any implementation.
2. **The fix edited its own test.** An expected value updated, an assertion weakened, or a test skipped in the same change. A suite adjusted to pass is not evidence.
3. **Over-mocked tests that break on refactor and pass on bugs** — the exact inverse of the purpose of a test.
4. **Asserting the mock, not the code.** The test verifies that the collaborator was called with the arguments the implementation happens to use, so any behavioural regression survives.
5. **Blindly regenerated snapshots** (`jest -u`, `--update-snapshots`). The regression moves from "detected" to "committed" in one flag.
6. **A green suite because the tests never ran.** Path filters, `if:` guards, a required status check pointing at a job that was renamed, or a cached result.
7. **Happy-path-only suites.** The incident lived in the error path; the suite exercises the success path and one generic exception.
8. **Time, ordering, and locale dependence.** Passes alone, fails in the full suite; passes in UTC, fails in Asia/Manila.
9. **Integration tests that stub the boundary they claim to verify** — a "real SQL" test against an in-memory fake exercises the fake's dialect.
10. **Flakiness absorbed by retries or quarantine with no owner**, so the failure rate becomes the new normal and the race stays in production.
11. **Mutation score measured on the whole repository**, where a legacy module's survivors drown out the three meaningful survivors in the changed file.
12. **Coverage exclusions growing in the same change** that needed coverage most; the number goes up and the verification goes down.

## Sources

- [Martin Fowler — The Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) — test distribution and the cost of brittle high-level tests.
- [Martin Fowler — TestCoverage](https://martinfowler.com/bliki/TestCoverage.html) — coverage as a negative indicator.
- [Google Testing Blog — Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html) — small/medium/large by resource access.
- [PIT Mutation Testing](https://pitest.org/) and [Stryker Mutator](https://stryker-mutator.io/) — mutation score as the falsification measure for JVM and JS/TS/.NET/Scala.
- [Mutation Testing](https://mutation-testing.org/) — equivalent mutants and score interpretation.
- [Testcontainers](https://testcontainers.com/) — real dependencies instead of doubles at the boundary.
- [Pact — contract testing](https://docs.pact.io/) — consumer-driven contracts across a changed shape.
- [Hypothesis](https://hypothesis.readthedocs.io/en/latest/) — property-based input search with retained counterexamples.
- [pytest documentation](https://docs.pytest.org/en/stable/) — the reference runner used in the commands above.
- [pytest-randomly](https://github.com/pytest-dev/pytest-randomly) and [pytest-xdist](https://github.com/pytest-dev/pytest-xdist) — order randomisation and parallel execution.
- [Toxiproxy](https://github.com/Shopify/toxiproxy) and [Chaos Mesh](https://www.chaos-mesh.org/) — deliberate fault injection for retry and failover paths.
- [NIST SP 800-218 SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) — PW.7 and RV.1, verification as a distinct practice with evidence.
