# Senior Work Audit

Audit one concrete unit of engineering work — a commit range, branch, PR, patch, or subsystem — and return a defensible verdict on whether the work does what it claims, is complete, and is safe to integrate.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A change set exists (branch, PR, commit range, working tree, or patch file) and someone claims it is finished.
- You inherit a codebase, a handoff, or an agent-produced diff and must certify it before it lands.
- A defect was reported fixed and the fix must be proven rather than assumed.
- A migration, refactor, dependency bump, or "no behaviour change" claim must be checked.
- Two competing implementations must be compared on evidence.

## When it does not

- There is no artifact yet — that is design review, not a work audit.
- The target is a live running system rather than a change set; use system hardening or an incident process.
- The ask is a first-pass style/design read of fresh code with no completion claim; use code review.
- The change is a pure mechanical regeneration already covered by a green CI run you can inspect (say so, then audit CI instead).

## Core rule

Audit the artifact, not the narrative. Every sentence of a completion report is a hypothesis until a command, a test, or a line of code confirms it. NIST SSDF treats verification as a distinct practice from implementation for exactly this reason; a self-reported "done" is an input, never a result ([NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final), PW.7 and RV.1).

## Phase 1 — Fix the claim and the audit scope

1. Restate the claim as a falsifiable sentence: "Change X makes Y do Z, demonstrated by W."
2. Pin the revision under audit: `git rev-parse HEAD`, `git status --porcelain`, and `git merge-base HEAD origin/main`.
3. Measure the diff: `git diff --stat <base>...HEAD` and `git diff --numstat <base>...HEAD | sort -k1 -nr | head -40`.
4. Profile the blast radius by file type: `git diff --name-only <base>...HEAD | sed 's/.*\.//' | sort | uniq -c | sort -rn`.
5. List touching of high-risk paths — CI config, auth, migrations, infra, lockfiles: `git diff --name-only <base>...HEAD | Select-String 'ci|auth|migrat|deploy|infra|lock|\.env'`.
6. Check for uncommitted or ignored state that changes the result: `git status --porcelain --ignored`.
7. EVIDENCE: claim sentence, base and head SHAs, diffstat, added/deleted line counts, high-risk path list.

## Phase 2 — Reconstruct ground truth from the repository

1. Read the actual changed hunks, not the PR description: `git diff -U10 <base>...HEAD -- <path>`.
2. Walk the history that produced it: `git log --oneline --no-merges <base>..HEAD`.
3. Check for history surgery that hides work: `git log --oneline <base>..HEAD --diff-filter=D` and look for force-push markers in reflog or branch protection logs.
4. Find sibling call sites the change should have updated: search the whole tree for the symbol, not just the diff (`grep -rn "functionName" --include=*.ts .`).
5. Confirm the runtime reality: version files, `package.json` scripts, `Dockerfile` base images, CI workflow names.
6. Detect dead or orphaned additions: new exported symbols with no reference outside tests (`grep -rn "newSymbol" src/ | Select-String -NotMatch 'test'`).
7. EVIDENCE: annotated hunks with `file:line`, call-site inventory, list of unreferenced additions.

## Phase 3 — Verify the claim by execution

1. Reproduce the original failure first, on the pre-change revision, and capture the failure output. A fix that was never shown failing is unproven.
2. Run the project's own declared verification, not a substitute: read the CI workflow or `Makefile`, then run the same commands locally (`npm test`, `pnpm test`, `pytest -q`, `go test ./...`, `cargo test`).
3. Record exit codes verbatim. `echo $LASTEXITCODE` / `echo $?` after the run.
4. Run the narrowest test that covers the claim, then the full suite. A passing narrow test with a failing full suite is a fail.
5. Run the suite on a clean checkout (fresh clone or `git stash` + clean build) to expose hidden local dependencies.
6. Re-verify the fix under the conditions of the original report — same platform, same data shape, same flags. Platform-conditional fixes are the common false positive.
7. EVIDENCE: failing pre-change output, passing post-change output, exact commands, exit codes, environment (OS, runtime version, commit SHA).

## Phase 4 — Audit the diff itself

1. Flag scope creep: unrelated files, reformatting, comment churn, whitespace-only hunks (`git diff -w --stat` compared with `git diff --stat`).
2. Flag default-value and constant changes: `git diff -U3 <base>...HEAD | Select-String '^[-+].*(default|timeout|limit|retry|ttl|expiry)'`.
3. Flag silent behaviour changes behind an unchanged signature: changed return type, changed error class, changed ordering, changed null/None handling.
4. Flag removed guard clauses or validation: `git diff -U5 <base>...HEAD | Select-String '^-\s*(if|assert|throw|raise|guard)'`.
5. Flag commented-out code, `TODO`, `FIXME`, and debug output added in this change.
6. Flag error swallowing added to make a test pass: `except Exception: pass`, `catch (e) {}`, `@SuppressWarnings`, bare `recover()`.
7. Flag generated or vendored files in the diff; audit the generator input, not the output.
8. EVIDENCE: per-flag findings with `file:line` and the quoted changed line.

## Phase 5 — Adversarially test the verification

1. Check whether the change also modified its own tests: `git diff --name-only <base>...HEAD | Select-String 'test|spec|__tests__'`. A green suite whose assertions were relaxed proves nothing.
2. Diff the test files and confirm assertions got stronger, not weaker.
3. Look for mock-only tests: if every dependency is mocked, the test detects no integration faults.
4. Look for tests that assert on the same constant the code uses (`assert result == SOME_CONST` where the code returns `SOME_CONST`).
5. Check coverage delta on changed lines only, not global coverage: `git diff --name-only <base>...HEAD` intersected with the coverage report.
6. Check negative-path coverage: for each new branch, is there a failing-input test?
7. Re-run flaky-looking tests repeatedly and count failures: `for i in $(seq 1 10); do npm test -- <suite> || echo "run $i failed"; done`.
8. EVIDENCE: test-file diff, per-branch negative-path inventory, repeat-run failure count.

## Phase 6 — Integration and operational surface

1. Config and flags: does the change require new environment variables, and are they documented and defaulted safely? (12-Factor, config in the environment — [12factor.net/config](https://12factor.net/config)).
2. Schema and migration: is the migration forward-only, is it reversible, is it safe to run while old code is still live (evolutionary database design and expand/contract — [martinfowler.com/articles/evodb.html](https://martinfowler.com/articles/evodb.html))?
3. Observability: does new behaviour emit a log, metric, or trace that would let an operator see it in production? Silent new failure paths are invisible.
4. Backwards compatibility: does any external caller, stored payload, or serialized record break (ISO/IEC 25010 compatibility characteristic, as rendered by the [ISO 25000 portal](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — a secondary rendering, not the ISO text itself)?
5. Rollback: can this change be reverted without data loss? Name the exact revert command and any irreversible step.
6. Dependencies: any new package, and is it audited (hand off to the supply-chain audit if so)?
7. Licensing: does a new dependency's licence fit the project's distribution model? An incompatible licence is a release blocker, not a footnote.
8. Resource growth: does the change add a background loop, cache, subscription, or timer whose size or fan-out is unbounded?
9. Old-client and old-record compatibility: if a previously deployed client, a stored record, or a message already on a queue still reaches this code, does it still parse?
10. Cross-service ordering: does this change require a specific deploy order between services, and is that order written down where the deployer will see it?
11. EVIDENCE: config diff, migration revert test, named log/metric line, revert command, new-dependency list, licence and resource notes.

## Phase 7 — Verdict and residual risk

1. State the verdict in one of four terms: VERIFIED, VERIFIED WITH CAVEATS, UNVERIFIED, REGRESSION FOUND. This verdict is about the *change*; test sufficiency is `senior-test-adequacy`'s INADEQUATE. Both can hold at once - a regression found in a change whose tests are adequate is REGRESSION FOUND, not INADEQUATE.
2. List what is proven versus what is merely claimed, as two separate lists.
3. Record residual risk as "risk — likelihood — impact — what would detect it".
4. Record what you did not check and why, so the next auditor is not misled.
5. Note DORA-style delivery signals only as observations, never as proof: a fast merge is not a safe merge ([DORA](https://dora.dev/)).
6. EVIDENCE: the written verdict, the proven/claimed split, and the residual-risk register.

## Phase 8 — Write the audit report

1. Lead with the verdict and the single highest-severity finding; the procedure goes after the conclusion.
2. Give every finding a severity, a `file:line`, the observed behaviour, the expected behaviour, and the command that demonstrates it.
3. Separate defects from preferences. A preference is not a finding and must not dilute the defect list.
4. State the audited revision in the report header, including any dirty or untracked files present in the working tree.
5. List every command run with its exit code, so the audit is reproducible by the next reader.
6. Note the environment: OS, runtime and tool versions, and whether the run was on a clean checkout.
7. EVIDENCE: the report itself — verdict, cited findings, and the full command log.

## Definition of done

- Every claim in the report is backed by command output or a code citation, never by the completion report.
- Pre-change failure and post-change success are both captured for any fix under audit.
- The residual-risk register names what was not checked and by whom it should be checked.
- The verdict uses one of the four defined terms and names the audited SHA.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Claim sentence; base/head SHAs; diffstat; high-risk path list |
| 2 | Annotated hunks with `file:line`; call-site inventory |
| 3 | Failing pre-change output; passing post-change output; commands and exit codes |
| 4 | Flagged lines quoted with `file:line` |
| 5 | Test-file diff; negative-path inventory; repeat-run failure count |
| 6 | Config/migration/rollback evidence; new dependency list |
| 7 | Written verdict; proven vs claimed split; residual-risk register |

## Failure modes a naive reviewer misses

1. **Auditing the description instead of the diff.** The PR text says "adds validation"; the diff adds validation on one endpoint and none on the two that share the handler. Read every hunk.
2. **The fix changed its own test.** Assertions were weakened, an expected value updated, or a test skipped in the same change. A suite that was edited to pass is not evidence.
3. **The bug was reproduced as a symptom, not a cause.** Wrapping a failing call in try/except, or adding a null check at the call site rather than fixing the producer, makes the report go green while the defect remains.
4. **Local-only green.** An uncommitted file, a global tool version, a populated cache, or a `.env.local` makes the suite pass only on the author's machine. Verify on a clean checkout.
5. **Default-value drift.** A one-character change to a timeout, retry count, batch size, or feature default is the highest-impact, lowest-visibility diff line there is.
6. **Generated files as camouflage.** A regenerated client or lockfile produces thousands of lines that push the three meaningful hunks out of view in review tooling; audit the generator input.
7. **Reviewed commit is not merged commit.** Squash, rebase, or cherry-pick means the SHA you audited is not the SHA that ships. Compare the merge commit's tree, not the branch head.
8. **Passing narrow coverage with a broken suite elsewhere.** The targeted test passes while an unrelated suite fails; the integration is broken and the report says done.
9. **Tests that never fail.** Assertions written against the same mock or constant the implementation returns will stay green through any refactor.
10. **Environment-conditional correctness.** Fixes verified on Linux/macOS that touch path separators, line endings, case-insensitive filesystems, signal handling, or locale will behave differently on the platform actually running it.

## Sources

- [NIST SP 800-218, Secure Software Development Framework (SSDF) v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) — PW.7 review, RV.1 verification practices.
- [Google Engineering Practices — Code Review](https://google.github.io/eng-practices/review/) — what a reviewer must actually confirm.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) — testable verification requirements and levels.
- [OWASP Top 10:2025](https://top10.owasp.org/2025/) — the current edition (A03 Software Supply Chain Failures, A10 Mishandling of Exceptional Conditions); risk classes to check when a change touches input, auth, or serialization. The [project hub](https://owasp.org/www-project-top-ten/) indexes earlier editions.
- [CWE Top 25 Most Dangerous Software Weaknesses](https://cwe.mitre.org/top25/) — concrete weakness names for findings; the [2025 archive](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) carries the current 2025 ranks.
- [DORA — Research and delivery metrics](https://dora.dev/) — change failure rate and lead time as observations.
- [ISO/IEC 25010 — Product quality model](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — the ISO 25000 portal's rendering of the standard, not the ISO text itself; compatibility, maintainability, reliability criteria.
- [12-Factor App — Config](https://12factor.net/config) — configuration belongs in the environment, not the diff.
- [Google SRE Book — Table of contents](https://sre.google/sre-book/table-of-contents/) — release engineering and monitoring chapters.
- [Evolutionary Database Design](https://martinfowler.com/articles/evodb.html) — expand/contract schema evolution that keeps old code running.
