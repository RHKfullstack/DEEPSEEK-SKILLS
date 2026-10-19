@PlannablePlan v0.1

ID=PART-002
PH=CORE_AUTO_ESCALATE_AGENT_TEAMS_SUBAGENT_AND_AGENT_LOOP_ON_LARGE_HEAVY_WORKSPACES_VIA_DSH_SYSTEM_PROMPT_FOUNDATION
SCN=SCN-002
OUT=index.js registers deepseek-harness:scale-policy at TEAM_POLICY-1 with a finite-order guard, and prompt text is read live per assembly
DEP=[PART-001]

DICT:
G=goal; CTX=context; C=constraint; F=file; T=task; AC=acceptance; V=verify; DONE=completion; S=stop

G:
- Register the scale policy as its own system-prompt section, placed immediately before the
  Agent Teams policy it qualifies, without colliding with any existing section.

CTX:
- product: DSH system-prompt scale escalation for the `dsh-deepseek-harness-skills` plugin
- phase: Foundation (part 2/3)
- prior: PART-001 authored `prompts/scale-policy.md`
- next: PART-003 syncs the three installed copies and renders the whole prompt
- request: "add it to the system prompt, and make sure the existing system prompt does not
  damage the other prompt calls"
- runtime facts: `SystemPrompt.assemble()` sorts sections by `order` then name, renders
  `text` as `typeof section.text === "function" ? section.text(context) : section.text`, and
  drops sections whose rendered text is empty. `SECTION_ORDERS.TEAM_POLICY === 600`.
  `dsh-tool-subagent` already registers `text` as a function, so the function form is
  sanctioned. `SECTION_ORDERS` is private, so order is resolved through
  `ctx.systemPrompt.getSectionOrder("TEAM_POLICY")`.
- guidance: v1; rules=baseline.secrets@1,quality.change@1
- basis[baseline.secrets]: "routine default"
- basis[quality.change]: "routine default"
- scope: inspect features before coding; names/dependencies do not prove security scope.

C:
- preserve-existing-work
- avoid-unrelated-edits
- ask-before-new-deps
- never reuse a section name owned by the harness (`harness:identity`,
  `deployment:persona-prefix`, `deployment:persona-suffix`, `team:policy`, `tool:subagent`,
  ...) — a duplicate within one layer throws during assembly
- `order` must stay finite, or `section()` throws a TypeError
- an unreadable prompt file must degrade to the text captured at import, never to a throw
- [baseline.secrets] Keep secrets out of source, plans and logs.
- [quality.change] Preserve conventions and existing behavior.

F:
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\index.js

T:
1 Add `SCALE_POLICY_URL` and the import-time escaped constant beside the existing three
   prompt constants.
2 Add a `liveText(url, fallback)` helper returning a `() => string` that re-reads and
   re-escapes the file per assembly and returns the import-time fallback on read failure.
3 Register `deepseek-harness:scale-policy` with a unique name and order
   `Number.isFinite(teamOrder) ? teamOrder - 1 : 599`, resolved once in `apply`.
4 Switch the existing `deepseek-harness:skills-policy` section to the same live text so
   future wording edits apply on the next model step instead of needing a restart.
5 Keep both `ctx.skills.register(...)` calls and the `inject` list unchanged.
- [baseline.secrets] Use placeholders and existing secret configuration.
- [quality.change] Handle failures and test changed behavior.

AC:
- `index.js` registers exactly two sections: `deepseek-harness:skills-policy` (150) and
  `deepseek-harness:scale-policy` (599 when TEAM_POLICY is 600); both orders are finite.
- The two section names are absent from the harness SECTION_ORDERS name list, so no
  duplicate-name throw is possible.
- Both section texts are functions, and the scale text is non-empty.
- `node --check index.js` exits 0.
- Failure case: with `TEAM_POLICY` unavailable, the order falls back to 599 instead of NaN.
- [baseline.secrets] A fake secret stays out of changed public outputs; valid config works.
- [quality.change] Failure is understandable; the intended outcome still works.

V:
- `node --check index.js` (also reachable as `npm run harness:check`).
- Run the mock-context harness `tools/plugin-registration-test.mjs`; it asserts the names,
  the orders, the finite-order guard, the function form, and that exactly two skills and two
  sections register.
- [baseline.secrets] Check changed outputs with a fake secret; record results.
- [quality.change] Run relevant project checks; distinguish passed from unavailable.

DONE:
- append PLAN_EVIDENCE.md#PART-002: summary+files+checks+notes
- run plannable complete PART-002

S:
- if project structure is unclear, inspect before editing
- if acceptance requires product scope outside this part, record a TODO
