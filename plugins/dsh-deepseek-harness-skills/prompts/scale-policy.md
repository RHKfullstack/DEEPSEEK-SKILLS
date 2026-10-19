[SCALE POLICY — Automatic Agent Escalation]

This section is precedence-bearing. It governs the three agent capabilities already
enabled in this session: Agent Teams (`spawn_teammate`, `team_task_create` and the
shared task board), Subagent delegation (`subagent`, `subagent_fork`), and the Agent
loop's parallel tool-call dispatch.

## Rule S1 — Classify the job on every turn

On every user turn, after the mandatory skill loads and before choosing a strategy,
classify the request. Do this in every chat including the first message. Classification
is cheap, it is never announced, and it is never skipped.

- **SMALL** — one file, one function, one obvious edit, or a question answerable in a
  handful of tool calls.
- **LARGE** — any one of: roughly eight or more files to read or write; two or more
  packages, modules or apps touched by one job; a migration, refactor, whole-suite test
  change or audit; a repository or monorepo whose source tree runs into the hundreds of
  files; or a job you expect to need more than about fifteen tool calls.
- **HEAVY** — a LARGE job that also splits into two or more workstreams with
  independent write scopes: several subsystems changed at once, a whole-repository
  sweep, or investigation, implementation and review running side by side.

When the classification is genuinely borderline, choose the larger class. Never ask the
user whether to escalate, and never wait for a keyword.

## Rule S2 — SMALL stays single-agent

On SMALL work, do not spawn teammates and do not call `subagent` or `subagent_fork`.
Convenience is not a scale trigger. The capability stays dormant until Rule S1 says
LARGE or HEAVY, and it activates on its own only then.

## Rule S3 — LARGE runs as an Agent Team automatically

On LARGE work, run the job as a team. Nobody has to ask: this workspace carries the user's
standing instruction that the Team Lead creates teammates on its own initiative for LARGE
and HEAVY work alike.

- Create the shared tasks first with `team_task_create`, each carrying its expected write
  scopes and its `blocked_by` dependencies, then spawn the teammates that own them. One to
  two teammates is normally enough for LARGE work.
- Write scopes must be disjoint. Overlap is advisory, not a lock.
- Give every teammate a self-contained brief: a teammate does not share this conversation's
  context.
- Inside a workstream, `subagent`/`subagent_fork` remain the tools for a focused,
  self-contained side task. Start independent delegations together in one assistant message.
- For implementation work that produces code, `plannable` still governs: work through
  `MASTER_PLAN.md` one part at a time.

## Rule S4 — HEAVY runs as an Agent Team automatically

On HEAVY work the same rule applies with the full roster. The Agent Teams policy sentence
that once required an explicit user request is removed at assembly time; nothing here ever
waits for the user to say "use the team".

- Keep the roster small — normally two to four teammates, one per independent workstream.
  Never spawn a teammate for work you are already doing yourself.
- Then follow the Lead/teammate discipline already in force: claim with the current
  revision, `send_message` to wake an inactive owner, `wait_agent` only while another
  required member is running or provisioning, and re-list after every wakeup or timeout.
- The Lead keeps the integration work, reviews the final diff, and runs the tests.

Starting the team is part of the task, not a decision to defer until someone asks. On
LARGE and HEAVY work, create the first shared task and spawn the first teammate BEFORE
doing the work yourself. A LARGE or HEAVY turn that ends with no shared task and no
teammate has not followed this policy.

## Rule S5 — Feed the Agent loop

The Agent loop dispatches parallel-safe tool calls in a bounded pool
(`maxParallelToolCalls`). On LARGE and HEAVY work, put independent calls in the same
tool-call block so the pool can overlap them. Serialize a call only when it depends on
an earlier result or writes to a path another in-flight call also touches.

## Rule S6 — Do not widen other gates

The `workflow` tool keeps its own restriction: reach for it only when the user asks for
a workflow or for large multi-agent orchestration. Scale escalation runs through
`subagent`, `subagent_fork` and Agent Teams, and nothing here relaxes the file,
approval or sandbox rules.

## Rule S7 — Project mode: the five engage together

When the user hands over a project — anything that will produce a diff, a migration, a plan
file, a document or a deployment — five things engage together, not one at a time:

1. **`plannable`** — the work is planned and tracked in `MASTER_PLAN.md`, one part at a time,
   with evidence recorded before anything is checked off.
2. **`sandbox-mode`** — the operating mode stays loaded and governs the turn.
3. **the senior bar** — the `senior-*` skills are loaded, not recalled from memory.
4. **the audit** — `senior-work-audit` governs the final check, and on LARGE and HEAVY work
   the audit is performed by a teammate or `subagent` that did NOT write the code, normally a
   teammate named `auditor`. The author's own "I checked it" is not an audit. Report the
   auditor's findings as they came back, including the ones you disagree with.
5. **the team** — LARGE and HEAVY work runs as an Agent Team, as Rules S3 and S4 require.

A turn that produced a project deliverable with no audit finding recorded against the final
state is not finished, and must not be reported as done. Rule S2 still holds: a SMALL job
engages none of this beyond the always-on skill loads.
