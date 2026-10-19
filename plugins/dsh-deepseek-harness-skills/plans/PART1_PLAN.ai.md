@PlannablePlan v0.1

ID=PART-001
PH=CORE_AUTO_ESCALATE_AGENT_TEAMS_SUBAGENT_AND_AGENT_LOOP_ON_LARGE_HEAVY_WORKSPACES_VIA_DSH_SYSTEM_PROMPT_FOUNDATION
SCN=SCN-001
OUT=prompts/scale-policy.md carries the SMALL/LARGE/HEAVY classifier, the automatic LARGE/HEAVY actions, and the explicit precedence clause
DEP=[]

DICT:
G=goal; CTX=context; C=constraint; F=file; T=task; AC=acceptance; V=verify; DONE=completion; S=stop

G:
- Author the scale policy text that the DSH system prompt will inject, so a LARGE job
  auto-delegates to `subagent` and a HEAVY job auto-runs as an Agent Team.

CTX:
- product: DSH system-prompt scale escalation for the `dsh-deepseek-harness-skills` plugin
- phase: Foundation (part 1/3)
- prior: none (first part)
- next: PART-002 registers this text as a system-prompt section
- request: "make Agent Teams / Subagent / Agent loop auto-activate on large-heavy workspaces, injected in the system prompt, without damaging other prompt sections"
- runtime facts: the plugin injects one global section today (`deepseek-harness:skills-policy`,
  order 150). The app's own Agent Teams policy is `team:policy` at order 600 and opens with
  "create teammates only when the user explicitly asks". Subagent guidance is `tool:subagent`
  at order 2800. Agent loop is `maxParallelToolCalls` (default 10), not a callable tool.
- guidance: v1; rules=baseline.secrets@1,quality.change@1
- basis[baseline.secrets]: "routine default"
- basis[quality.change]: "routine default"
- scope: inspect features before coding; names/dependencies do not prove security scope.

C:
- preserve-existing-work
- avoid-unrelated-edits
- ask-before-new-deps
- the text must contain no `{{` reference group, because the plugin escapes it and the
  renderer throws on a malformed or unknown `{{name}}`
- [baseline.secrets] Keep secrets out of source, plans and logs.
- [quality.change] Preserve conventions and existing behavior.

F:
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\prompts\scale-policy.md (new)

T:
1 Write Rule S1: an always-evaluated SMALL / LARGE / HEAVY classifier with concrete
  thresholds (file count, modules touched, migration/refactor/audit, repo size, expected
  tool-call count) and a "choose the larger class" tiebreak.
2 Write Rule S2: SMALL stays single-agent; no teammates and no `subagent`/`subagent_fork`.
3 Write Rule S3: LARGE starts independent `subagent`/`subagent_fork` delegations in one
  assistant message, self-contained prompts, one delegation per verifiable chunk, and a
  cross-reference to `plannable` for implementation work.
4 Write Rule S4: HEAVY runs as an Agent Team automatically — `team_task_create` with write
  scopes and `blocked_by` first, then `spawn_teammate`; state the precedence over the
  Agent Teams "explicitly asks" sentence and that the gate still governs SMALL and LARGE.
5 Write Rule S5: batch independent tool calls into one block for the Agent loop's parallel
  pool; serialize only dependent or shared-write calls.
6 Write Rule S6: the `workflow` tool keeps its own restriction; nothing here relaxes file,
  approval or sandbox rules.
- [baseline.secrets] Use placeholders and existing secret configuration.
- [quality.change] Handle failures and test changed behavior.

AC:
- `prompts/scale-policy.md` exists, is non-empty, and contains a named rule for each of the
  three classes plus the precedence clause and the workflow clause.
- SMALL explicitly forbids teammates and subagents, so the policy cannot over-spawn.
- The file contains no `{{` sequence, so interpolation cannot throw on it.
- Failure case: a reader who skips S1 cannot tell when to escalate — S1 states explicit
  numeric thresholds, not adjectives.
- [baseline.secrets] A fake secret stays out of changed public outputs; valid config works.
- [quality.change] Failure is understandable; the intended outcome still works.

V:
- `Select-String -Path prompts\scale-policy.md -Pattern '\{\{'` returns nothing (exit 1).
- Read the file and confirm the six rules and the numeric thresholds are present.
- [baseline.secrets] Check changed outputs with a fake secret; record results.
- [quality.change] Run relevant project checks; distinguish passed from unavailable.

DONE:
- append PLAN_EVIDENCE.md#PART-001: summary+files+checks+notes
- run plannable complete PART-001

S:
- if project structure is unclear, inspect before editing
- if acceptance requires product scope outside this part, record a TODO
