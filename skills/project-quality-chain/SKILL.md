---
name: project-quality-chain
description: The mandatory chain before reporting any feature, fix or change complete - read the project convention, run the defaults grep, run the project gate, audit, then report with evidence. Use whenever about to say done, finished, complete, shipped, pushed, merged, deployed, or "human na", and whenever the user asks whether something is ready. A reply without the evidence block is not a completion report.
---

# Project Quality Chain

Every other skill in this pack describes one check. This skill describes the **order** and the **proof**, so a change cannot be reported finished by assertion.

The rule: **a completion report without the evidence block is not a completion report.** It is an update.

## When this fires

- Before any reply that says done, finished, complete, ready, shipped, pushed, merged, deployed, or "human na".
- When the user asks "is it ready", "ok na ba", "pwede na".
- When a change touched application code, configuration, schema, or dependencies.
- **Not** for a question, a read, a plan, or an explanation.

## The chain — run in this order

### 1. Convention first

Load `senior-production-defaults`. Do Phase 0: read two existing files of the same layer, and state in the reply what was copied — naming, error shape, response envelope, logging, validation location, test style.

If the layer is new, say so in one sentence and name the pattern introduced. That sentence is the decision record.

### 2. The defaults grep

Run the Phase 3 grep from `senior-production-defaults` over the changed paths. Every hit gets a verdict: **fixed**, **justified**, or **pre-existing and out of scope**.

"I will fix it later" is not a verdict.

### 3. The project gate

Run the project's own verification, not a substitute:

```bash
# use whichever the project declares
pnpm test && pnpm exec tsc --noEmit && pnpm exec eslint .
php vendor/bin/phpunit && php vendor/bin/phpstan analyse && php vendor/bin/pint --test
pytest -q && ruff check . && mypy .
go test ./... && go vet ./...
```

- Record the **exact command** and its **exit code**.
- A gate that is missing is a finding: load `senior-quality-gate` and install it, or report `UNAVAILABLE` with the command you would have run.
- **Warnings do not count as a pass** for the rules this pack cares about. If the gate reports `warn`, it is not gating.

### 4. The audit

Load `senior-work-audit` (and `senior-code-review` for a diff). Produce a verdict in one of the four terms: `VERIFIED`, `VERIFIED WITH CAVEATS`, `UNVERIFIED`, `REGRESSION FOUND`.

- **An audit reports; it does not repair.** If it finds a defect, go back to step 2, fix, and re-run the whole chain. Do not edit the audit's conclusion.
- If the same agent wrote the change, label the audit **self-audit** in the block. That is honest, and it tells the reader how much independence the verdict has.
- On LARGE or HEAVY work, the audit is a teammate or subagent that did not write the change.

### 5. The release gate — only when shipping

If the reply is about deploying, merging to a protected branch, or a migration, load `senior-release-gate` and produce the go/no-go. Otherwise state that the chain stopped at step 4.

## The evidence block

Every completion reply ends with this block, filled in. Not summarised, not implied:

```md
## Delivery check
- Convention: read `path/a.ts`, `path/b.ts` — copied: naming, error shape, logging
- Defaults grep: 4 hits — 3 fixed, 1 justified (pre-existing, out of scope)
- Gate: `pnpm test && tsc --noEmit` → exit 0
- Audit: VERIFIED (self-audit)
- Not checked: e2e (no runner configured), a11y (no axe in CI)
```

Rules for the block:

- **Quote the exit code**, not "tests pass".
- **Name the paths** read for convention.
- **Count the grep hits** and their disposition.
- **List what was not checked.** This line is the most important one: it is the difference between a claim and an audit.
- If a line cannot be filled, the answer is `UNAVAILABLE` plus the command — never blank, never omitted.

## Repair vs report

| Skill | Behaviour |
|---|---|
| `senior-production-defaults` | fixes what the grep finds |
| `senior-quality-gate` | fixes what the gate rejects |
| `senior-code-review` | reports findings, does not fix |
| `senior-work-audit` | reports a verdict, does not fix |
| `senior-release-gate` | go/no-go, does not fix |
| `senior-background-jobs` | repairs, then the chain re-runs from step 2 |
| `senior-reliability-review` | repairs, then the chain re-runs from step 2 |

**Never let an audit fix its own findings and then re-approve them.** The fix returns to step 2, and the chain runs again from there.

## Failure modes

1. **"Done" with no block.** The whole point of this skill; a reply without the block is not finished.
2. **Steps run out of order.** Audit before the gate means auditing unverified code.
3. **Self-audit presented as independent.** Label it.
4. **Warnings counted as passes.** `warn` is a comment, not a gate.
5. **A gate that was not run because it "usually passes".** The one time it does not is the release.
6. **The `Not checked` line omitted.** That line is the residual-risk register; omitting it claims completeness that was never verified.
7. **Re-running only the failing step.** After a fix, the convention and grep steps run again — the fix may have introduced a new default.
8. **Chain applied to a question.** A read-only answer needs no gate; forcing it wastes the user's time and trains them to ignore the block.

## Definition of done

- The five steps ran in order, or the reply states which was skipped and why.
- The evidence block is present with every line filled or explicitly `UNAVAILABLE`.
- The audit's verdict uses one of the four terms.
- Fixes returned to step 2, and the whole chain re-ran after the last fix.
