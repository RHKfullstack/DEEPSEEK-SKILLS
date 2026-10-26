---
name: senior-quality-gate
description: Turn the pack's rules into a gate that fails the build - PHPStan, ESLint, static analysis, CI and pre-commit - and prove it blocks by feeding it a known-bad file. Use when a project has no gate, when a gate has never failed, when "the linter passes" is the quality claim, or before trusting any check that is advisory rather than required.
---

# Senior Quality Gate

A rule in a skill is advice. A rule in the compiler, the linter, or CI is a gate. The difference is not severity — it is whether the defect can reach `main`.

**The law of this skill:** a gate that has never rejected anything is not a gate. It is a decoration, and it fails silently for as long as nobody tests it.

## Phase 1 — Inventory what actually exists

Read the project, do not assume:

```bash
ls phpstan.neon* psalm.xml .eslintrc* eslint.config.* tsconfig.json \
   .pre-commit-config.yaml .husky .git/hooks/pre-commit \
   .github/workflows/*.yml 2>/dev/null
git grep -nE '"?phpstan|eslint|tsc --noEmit|psalm|pint"?' -- package.json composer.json
```

Record per tool: **present / absent / present-but-not-required**. The third state is the dangerous one — a config file that CI does not run is worse than no config, because it produces confidence without coverage.

**EVIDENCE: `gate-inventory.md` — tool, config path, where it runs (local, CI, both), whether it is required.**

## Phase 2 — The gate matrix

| Language | Gate | Setting that makes it a gate |
|---|---|---|
| PHP | PHPStan | `level: 8` (or the highest the project passes now, then ratchet), `paths`, not `excludePaths` for `app/` |
| PHP | Pint | `--test` in CI, so a diff fails rather than silently reformats |
| PHP | PHPUnit | `--fail-on-warning`, `--fail-on-risky`, coverage floor on changed files |
| TS/JS | `tsc` | `--noEmit`, `strict: true`, `noUncheckedIndexedAccess: true` |
| TS/JS | ESLint | `no-empty`, `no-console`, `@typescript-eslint/no-explicit-any: error`, `no-floating-promises` |
| Any | CI | the job is **required** by branch protection — advisory checks are not gates |
| Any | pre-commit | the same commands locally, so the failure arrives before the push |

**Rules for adding a gate:**

1. **Set the threshold to what passes today, then ratchet.** A gate set to a failing level is disabled on day two by whoever needs to merge.
2. **`error`, never `warn`,** for the rules this pack cares about. A warning is a comment.
3. **No blanket exclusions.** An `excludePaths: app/Legacy/*` is a decision — record it with an owner and a date, or it grows until it covers the app.
4. **One command, one exit code.** If the gate needs a human to read output, it is a report, not a gate.

**EVIDENCE: the diff that adds each config, with the current pass/fail state before and after.**

## Phase 3 — Prove the gate blocks

This is the phase that separates a gate from a decoration.

1. Create a deliberately bad file on a scratch branch — the defect the rule exists for. For this pack: a swallowed catch, a `console.log`, an `any`, an unpaginated query.
2. Run the gate. **It must fail, with a non-zero exit code and a message naming the file and rule.**
3. Capture that output verbatim.
4. Remove the probe from the sink under organizer's S1/S2 class, re-run, confirm green.
5. If the gate passed the bad file: the rule is not active, the path is excluded, or the severity is `warn`. Fix that before adding any other rule.

```bash
# example: prove ESLint rejects a swallowed catch
mkdir -p .work/<run>/tmp
printf 'try { risky(); } catch (e) {}\n' > .work/<run>/tmp/__gate_probe.ts
npx eslint .work/<run>/tmp/__gate_probe.ts; echo "exit=$?"     # expect non-zero
# remove the probe from the sink under organizer S1/S2 - it never lives in the source tree
```

**EVIDENCE: the failing output for the probe, and the green run after deleting it.**

## Phase 4 — Wire it where it cannot be skipped

| Layer | What it buys | What it does not |
|---|---|---|
| Editor / lint-on-save | fast feedback | nobody else is protected |
| pre-commit hook | the failing push is stopped locally | `--no-verify` exists |
| CI on the PR | the merge is blocked | only if the check is **required** |
| Branch protection | the gate has teeth | needs a repo admin to set |

The chain is only as strong as its weakest link, and the weakest link is always the optional one. Confirm in the repository settings — not in the YAML — that the job is required. A workflow file that runs on PRs while the branch allows merging with red checks is a report.

**EVIDENCE: the branch-protection setting (screenshot or API output) naming the required checks, plus the workflow file that implements them.**

## Phase 5 — What the gate now guarantees

Write it down, because the next reader will assume more than it says:

| Claim | Enforced by | Not enforced |
|---|---|---|
| No swallowed errors | ESLint `no-empty`, PHPStan level 8 | a catch that logs and continues |
| No `any` | `no-explicit-any: error` | a type assertion that hides the same gap |
| No debug output shipped | `no-console` | a logger call with the wrong level |
| Tests prove the change | coverage floor + failing tests | assertion quality (see `senior-test-adequacy`) |
| No unpaginated query | a project-specific grep in CI | a query that paginates badly |

The gate covers what a rule can express. Everything else stays a review judgement, and pretending otherwise is the failure this skill prevents.

## Definition of done

- Every gate in the matrix is present, at a passing threshold, and required.
- At least one gate has been proven to reject a known-bad file, with the output captured.
- No exclusion list exists without an owner and a date.
- The guaranteed/not-guaranteed table is written down next to the CI config.

## Failure modes a naive reviewer misses

1. **The config nobody runs.** `phpstan.neon` in the repo, CI runs only tests.
2. **Advisory CI.** The job runs, the branch merges red.
3. **Warning-level rules.** `no-console: warn` has never failed a build.
4. **Exclusion creep.** `excludePaths` grew to cover the module that actually breaks.
5. **Proven-never.** The gate was added and never once tested with a known-bad input, so a silent misconfiguration goes unnoticed for months.
6. **Green because empty.** The linter finds no files — wrong `paths`, wrong include — and exits 0.
7. **Locally green, CI red.** A version mismatch between the developer's tool and the pinned CI tool means the gate differs by environment.
8. **The gate that is a person.** "We always review that" is not a check; it is a hope with a meeting.
