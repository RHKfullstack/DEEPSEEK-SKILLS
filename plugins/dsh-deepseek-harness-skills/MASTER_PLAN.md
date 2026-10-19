# MASTER_PLAN.md

## Product Goal

Make the DSH **system prompt itself** escalate automatically on large/heavy workspaces. The
`dsh-deepseek-harness-skills` plugin must inject a precedence-bearing _scale policy_ so the
Agent, without being told, delegates with `subagent`/`subagent_fork`, runs HEAVY jobs as an
Agent Team (`spawn_teammate` + `team_task_create` shared board), and batches independent tool
calls for the Agent loop's parallel pool — while leaving SMALL work single-agent and leaving
every pre-existing system-prompt section undamaged.

## Product Scenarios

### SCN-001: A large workspace auto-delegates without being told
Given a request that spans ~8+ files, 2+ modules, or a repository-wide sweep,
When the system prompt is assembled for that turn,
Then the scale policy is present and classifies the job LARGE, so the model starts
`subagent`/`subagent_fork` delegations in one assistant message instead of reading every file
itself.

### SCN-002: A heavy workspace runs as an Agent Team without an explicit request
Given a HEAVY job (two or more workstreams with independent write scopes),
When the Lead plans the turn,
Then the scale policy overrides the Agent Teams sentence "create teammates only when the user
explicitly asks", so the Lead creates shared tasks with write scopes first and spawns teammates
on its own initiative.

### SCN-003: Small work stays single-agent and no other prompt section is damaged
Given a one-file fix,
When the system prompt is assembled,
Then the scale policy still renders but forbids teammates and subagents, and every
pre-existing section still renders: no duplicate section name, no malformed `{{variable}}`
reference, and the scale section sorts immediately before the Agent Teams policy.

## Phase 1: Core Auto Escalate Agent Teams, Subagent And Agent Loop On Large/heavy Workspaces Via DSH System Prompt Foundation

- [x] Part 1: Read `plans/PART1_PLAN.ai.md`
  - Scenario: SCN-001
  - Outcome: `prompts/scale-policy.md` exists with the SMALL/LARGE/HEAVY classifier, the automatic LARGE/HEAVY actions, and the explicit precedence clause
  - Evidence: recorded

- [x] Part 2: Read `plans/PART2_PLAN.ai.md`
  - Scenario: SCN-002
  - Outcome: `index.js` registers `deepseek-harness:scale-policy` at `TEAM_POLICY - 1` with a finite-order guard, and prompt text is read live per assembly
  - Evidence: recorded

- [x] Part 3: Read `plans/PART3_PLAN.ai.md`
  - Scenario: SCN-003
  - Outcome: all three plugin copies are hash-identical and a real-render harness proves the assembled prompt renders unchanged with the scale section immediately before `team:policy`
  - Evidence: recorded

## Planning safeguards

Routine secret handling and behavior checks are included in each part. Before coding, inspect this project and add applicable safeguards using the installed skill references. Record owner decisions and unknowns here. These are planned checks, not proof of application security.

### Owner decisions and unknowns

- **Decision (user, this turn):** the user gives standing authorization to auto-create Agent
  Teams on large/heavy workspaces, overriding the runtime's "explicitly asks" gate. The gate
  still governs SMALL and LARGE work.
- **Unknown:** the desktop app must be restarted once for a newly registered prompt section to
  appear; after that, wording edits apply on the next model step without a restart.
- **Non-goal:** the packed `app.asar` is never edited, and `cordis.patch.yml` is not hand-edited
  (the desktop settings surface owns that file and may rewrite it).
