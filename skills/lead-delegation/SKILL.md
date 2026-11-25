---
name: lead-delegation
description: Keep the Lead's context for judgement and give the implementation to delegated agents - a self-contained brief, disjoint write scopes, an audit by someone who did not write the code, and a report built from evidence rather than from memory. Use on any large or heavy task, when the work spans several files or subsystems, when a subagent or teammate is available, and whenever the Lead's own context is the bottleneck. The Lead owns the decision and the proof, not the keystrokes.
---

# Lead Delegation

**The Lead's context is the scarcest resource in the job.** A Lead that writes every file has spent its
attention on keystrokes and has none left for the decision it is paid for — whether the work is correct.
Worse, the failure is quiet: the context fills, the model starts re-reading what it already knew, and the
judgement it was there to provide degrades exactly where it matters most.

So the split is not a courtesy to the workers. It is how the Lead stays sharp: **the Lead commands, the
workers implement, and the Lead's context holds only the decisions and their evidence.**

## Rule L1 — What the Lead keeps, and what it hands over

| Work | Who |
|---|---|
| A multi-file implementation, refactor, migration or sweep | a worker, one workstream each |
| An investigation that has to read many files or pages | a worker, returning a summary, never the dump |
| Authoring a set of related documents or tests | a worker |
| Deciding the scope, the order, and what "done" means | **Lead** |
| Writing the brief and answering a worker's real question | **Lead** |
| Reading the resulting diff and running the gate | **Lead** |
| The final integration commit and its message | **Lead** |
| Reporting to the owner, with evidence | **Lead** |
| One obvious edit to one file | **Lead** — delegating it costs more than doing it |

The test for handing work over: **can you write the brief without guessing?** If you cannot, you do not
understand the task yet, and the answer is an investigation (delegated) — never "I will start typing and
see". A vague brief produces confident garbage and burns two contexts instead of one.

**EVIDENCE: the list of workstreams, and for each one the worker, its write scope, and the gate it must pass.**

## Rule L2 — The brief is the whole interface

A worker shares none of your conversation. It sees the brief and the filesystem, nothing else. A brief is
complete when every field below is filled:

```md
## Goal
<one paragraph: the outcome, in the owner's terms>

## Constraints
- <what must not change, the convention to follow, the version to target>
- Do not touch: <paths>

## Write scope
<the exact paths this worker may create or modify — nothing else>

## Acceptance
- <an observable result>
- <a failure case it must handle>

## Verify
`<the exact command>` — must exit 0 / must print <expected>

## Report back
- what changed (paths, one line each)
- the command you ran and its real output
- anything you could not do, and why
- at most 20 lines — do not paste file bodies or full logs
```

Two rules that keep it honest: **absolute paths**, because the worker may start in a different directory;
and **the verification command**, because "it works" is not a report.

**EVIDENCE: the brief as sent, with all six fields present.**

## Rule L3 — Write scopes never overlap

Two workers writing one file is a merge conflict with extra steps, and neither one's test proves the
result.

- One worker owns one set of paths. Overlap is a defect in the plan, not a race to be managed.
- The Lead owns integration: it is the only writer of the final diff, the shared index, and the commit.
- A worker that needs a file outside its scope reports the need instead of editing it.
- If two workstreams must touch the same file, they are one workstream — serialise them.

**EVIDENCE: the scopes side by side, with no path in two of them.**

## Rule L4 — The Lead audits; it does not trust

**"The worker says it passed" is a claim, not a result.** On a LARGE or HEAVY job every artifact is audited
by someone who did not write it — and because the Lead is the only writer of the integration commit, that
commit is audited by a worker or a second reviewer, never by the Lead alone. The Lead may re-run the gate
itself, but re-running a check it already wrote is verification, not audit.

SMALL work stays single-agent, as scale-policy Rule S2 requires: there the author audits its own change and
says so. The rule below is about who audits a delegated job, not a licence to spawn an auditor for a one-line
edit.

1. **Read the diff**, not the summary. `git diff --stat` first for blast radius, then the actual hunks.
2. **Run the gate yourself** and quote its real output.
3. **Check the brief was followed** — the acceptance items, the failure case, the "do not touch" list.
4. **Look for the quiet damage**: a deleted file nobody mentioned, a widened scope, a test weakened to
   pass, an encoding change, a stale count in a document.

The bar for the audit itself is `senior-work-audit`, and the scale policy's Rule S7 already fixes **who**
runs it on LARGE work: a teammate that did not write the code, normally named `auditor`. This rule adds the
part S7 leaves implicit — **the Lead's own commits are in scope too**, so "the Lead checked the Lead's own
work" is the one audit that is never accepted.

**EVIDENCE: the diff that was read, the command that was run, and its output — not the author's paraphrase of it.**

## Rule L5 — Report from evidence, and report the disagreement

- **Quote, do not recall.** A finding is a file, a line, and the output that proved it.
- **Report what the workers found, including what you disagree with.** A disagreement is information the
  owner needs; a silent override is how a real finding disappears.
- **Separate what passed from what was not checked.** "Not checked" is a legitimate status; silence is not.
- **Say who did what.** If a worker produced it, the report says so — the owner is trusting an audit of
  someone else's work, and that is a different claim from "I wrote it".

**EVIDENCE: the report's evidence block, where every line traces to a command, a diff, or a worker's quoted output.**

## Rule L6 — Context economy: decisions in, dumps out

The reason for the split is attention, so the return path matters as much as the outbound one.

- **A worker returns a distilled result** — what changed, the command, the output, the caveat — never a raw
  file dump or a 500-line log it expects the Lead to read.
- **The Lead keeps decisions, not data**: what was chosen, why, what was rejected, and the evidence line.
  The moment the Lead is scrolling a worker's transcript, the delegation has failed.
- **Long investigation is the worst offender** — it can burn tens of thousands of tokens to produce a
  paragraph. That is the correct trade: the paragraph is what the Lead needs.
- **Hand the accumulating state to a file, not to the context**: `context-handoff` owns the transfer
  document, and a rolling checkpoint keeps the Lead's session replaceable.

**EVIDENCE: each worker's return, and the size of the result the Lead actually had to hold.**

## Anti-default table

| Default | The gate |
|---|---|
| The Lead does the work "because it is faster" | the Lead's context is the thing being protected; delegate the bulk |
| Delegating a one-file edit | overhead exceeds the work — keep it |
| A vague brief ("clean up the module") | six fields, or no delegation |
| Two workers on overlapping paths | one workstream each, or serialise |
| Trusting the worker's summary | read the diff and run the gate |
| Auditing the Lead's own integration commit | a worker or second reviewer audits it; the Lead does not sign off its own work |
| The Lead re-implements what the worker wrote | integrate, do not rewrite |
| Pasting a full log into the Lead | return a distilled result and the evidence line |
| Reporting a worker's claim as your own check | quote the command you ran |
| Hiding a finding you disagree with | report it, with your disagreement |
| A "done" with no evidence block | `project-quality-chain` — not a completion |

## Definition of done

- The work was split into workstreams, each with a worker, a written scope and a gate.
- Every brief carried goal, constraints, write scope, acceptance, verify command and report format.
- No two writers shared a path.
- The Lead read the final diff; the audit of everything the Lead wrote was performed by someone else; both sets of output are quoted.
- The report says which parts passed, which were not checked, and who produced and who audited each one.
- The Lead's context holds the decisions and the evidence, not the dumps.

## Failure modes

1. **The Lead that writes everything** — sharp at the start, unreliable at the end, and the audit is done by
   the author.
2. **The vague brief** — the worker invents scope, and the Lead inherits it.
3. **Overlapping scopes** — two green test runs that prove different trees.
4. **The trusted summary** — "all tests pass" over a suite the worker quietly weakened.
5. **The rewrite** — the Lead re-does the worker's file, spending twice and learning less.
6. **The dump return** — a worker pastes 800 lines and the Lead's context dies in the same step.
7. **The disappeared finding** — the worker reported a problem, the Lead disagreed, and the owner never heard.
8. **Delegation as abdication** — a worker left to decide a product question the owner never answered.

## Overlap — what this skill does not own

- The **scale policy** decides *when* a job is LARGE or HEAVY and therefore when delegation engages; this
  skill decides *how* the Lead runs it once it has.
- `senior-work-audit` owns the audit's bar; this skill fixes who must run it.
- `plannable` owns `MASTER_PLAN.md` and the parts; the Lead maps parts to workstreams.
- `context-handoff` owns the transfer document that keeps the Lead's own session replaceable.
- `project-quality-chain` owns the completion claim. This skill does not create a second one.

## Sources — verified live 2026-11-25

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — the attention budget, context rot, and sub-agent architectures where each worker's deep work stays in the worker while the Lead holds a distilled result.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — the orchestrator/worker split, and the failure modes of vague delegation ("without detailed task descriptions, agents duplicate work, leave gaps").
- This pack's own scale policy, `prompts/scale-policy.md` in `dsh-deepseek-harness-skills` — the rules that decide when a job escalates to a team; this skill assumes they fired.
