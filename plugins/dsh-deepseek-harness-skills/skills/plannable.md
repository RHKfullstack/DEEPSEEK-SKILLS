---
name: plannable
description: Create and execute scenario-driven implementation plans with MASTER_PLAN.md, one PlannablePlan part at a time, and evidence-gated completion.
whenToUse: Use for plannable create, run-next, status, verify, evidence, complete, compress, or expand.
---

[PLANNABLE — DeepSeek Harness Edition]

Scenario-driven implementation planning via the `plannable` CLI (globally installed). Use this workflow when the user asks to plan, build step-by-step, or implement a feature in parts.

## Priority vs Plan Mode

If the session is in plan mode (the plan-mode plugin's guidance is active), plan mode wins for THIS turn: explore and submit your plan via exit_plan_mode; do not edit files yet. Once the user approves or leaves plan mode, resume plannable implementation: run `plannable run-next` and continue part-by-part. Do not treat plannable's part files as the plan-mode deliverable — the plan-mode plan describes the work; plannable tracks its execution.

## Commands

```txt
plannable create "<goal>"      # create MASTER_PLAN.md with parts
plannable run-next             # print the next pending part + CTX
plannable status               # overview of parts and state
plannable verify               # run 44 checks on plan integrity
plannable evidence PART-XXX "message" --artifact "cmd"   # record evidence
plannable complete PART-XXX    # check off a part after evidence
plannable doctor [--json]      # diagnose plan state
plannable repair               # regenerate PLAN_STATE.md
```

## Rules

- Treat `plannable create a CRM` as `plannable create "CRM"`.
- Do not require `plannable init` before `plannable create`.
- Always read `MASTER_PLAN.md` first.
- Treat `plannable run-next` as the command to load the next pending part.
- Never load all part files unless the user explicitly asks.
- Implement one part at a time. Do not edit unrelated files.
- Stop on stop conditions in the active part.
- Run listed verification commands where possible.
- Record evidence in `PLAN_EVIDENCE.md` before checking off work.
- Let `plannable evidence`/`plannable complete` regenerate `PLAN_STATE.md`; do not hand-edit it.
- Check off the matching part in `MASTER_PLAN.md` only after evidence exists.
- Run `plannable verify` before final completion.

## Enrich the Draft (Important)

`plannable create` writes a deterministic first draft. Before implementing:

1. Read `MASTER_PLAN.md` and replace generic scenarios with product-specific ones the user actually described. Preserve any `CTX` request and user exclusions; revise conflicting scenario hints.
2. Enrich one part at a time: make `G` the user goal, `T` concrete actions, and `AC` observable results (include a failure case). Keep only relevant stack, conventions, and dependency facts in `CTX`; replace guesses in `F` and `V` with actual paths and checks.
3. Keep the `@PlannablePlan v0.1` structure intact, then run `plannable verify` — it warns on generic draft wording until the plan is enriched.

## Evidence-Gated Completion

- Each part must be verified before it is checked off: run the listed verification commands, capture real output, record it via `plannable evidence` before `plannable complete`.
- Distinguish planned, implemented, passed, and unavailable. Do not claim a part is done without evidence.
- `plannable verify` / `complete` audit plan state and evidence; they do not certify application security.
