@PlannablePlan v0.1

ID=PART-003
PH=CORE_AUTO_ESCALATE_AGENT_TEAMS_SUBAGENT_AND_AGENT_LOOP_ON_LARGE_HEAVY_WORKSPACES_VIA_DSH_SYSTEM_PROMPT_FOUNDATION
SCN=SCN-003
OUT=all three plugin copies are hash-identical and a real-render harness proves the assembled prompt renders unchanged with the scale section immediately before team:policy
DEP=[PART-002]

DICT:
G=goal; CTX=context; C=constraint; F=file; T=task; AC=acceptance; V=verify; DONE=completion; S=stop

G:
- Prove the injected scale policy reaches the assembled prompt without damaging any existing
  section, and that the change is present in every copy the running app can load.

CTX:
- product: DSH system-prompt scale escalation for the `dsh-deepseek-harness-skills` plugin
- phase: Foundation (part 3/3)
- prior: PART-001 authored the text; PART-002 registered the section
- next: COMPLETE — run plannable verify
- request: "review it so the automatic call really happens on large files every chat, and
  make sure the existing system prompt does not damage other prompt calls"
- runtime facts: the plugin exists in three places — the source package
  `C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills`, and the installed copies under
  `profiles\desktop\node_modules` and `profiles\web\node_modules`. The desktop profile is the
  live one. `readFileSync` runs at module import, so a newly registered section needs one
  desktop-app restart; after that the live text reader picks up wording edits per model step.
- reference: the real renderer is `@deepseek-ai/dsh-system-prompt/lib/index.js` inside
  `app.asar` (SECTION_ORDERS, interpolate, comparePromptSections, renderPrompt).
- guidance: v1; rules=baseline.secrets@1,quality.change@1
- basis[baseline.secrets]: "routine default"
- basis[quality.change]: "routine default"
- scope: inspect features before coding; names/dependencies do not prove security scope.

C:
- preserve-existing-work
- avoid-unrelated-edits
- ask-before-new-deps
- never edit `app.asar` or the packed app; the layer owned by this plugin is the only edit
  surface
- do not hand-edit `cordis.patch.yml` in the profile root: the desktop settings surface owns
  that file and may rewrite it
- [baseline.secrets] Keep secrets out of source, plans and logs.
- [quality.change] Preserve conventions and existing behavior.

F:
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\index.js (source)
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\prompts\skills-policy.md
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\prompts\scale-policy.md
- C:\Users\admin\.dsh\profiles\desktop\node_modules\dsh-deepseek-harness-skills\ (installed, live)
- C:\Users\admin\.dsh\profiles\web\node_modules\dsh-deepseek-harness-skills\ (installed)
- C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills\tools\system-prompt-render-test.mjs (new)

T:
1 Copy only the changed files (`index.js`, `prompts\skills-policy.md`,
   `prompts\scale-policy.md`) from the source package into both installed copies.
2 Write `tools/system-prompt-render-test.mjs` that ports the real `interpolate`,
   `comparePromptSections` and `renderPrompt` plus the real SECTION_ORDERS values, imports
   the edited `index.js` with a mock Cordis context, and renders the plugin sections mixed
   into the real harness sections.
3 Assert: all four harness sections still render; the scale section renders non-empty and
   is immediately followed by `team:policy`; `interpolate` throws on neither plugin section;
   and a deliberately unknown `{{not_a_variable}}` still throws, proving the check is real
   and not vacuous.
4 Hash-compare the three copies for the changed files.
- [baseline.secrets] Use placeholders and existing secret configuration.
- [quality.change] Handle failures and test changed behavior.

AC:
- The renderer output contains `harness:identity`, `team:policy`, `tool:subagent`,
  `deployment:persona-suffix` and both plugin sections, in that relative order.
- The scale section index is exactly `team:policy` index minus one.
- The negative control throws `unknown prompt variable`, so the non-throw assertions mean
  something.
- All three copies hash-identical for `index.js`, `prompts\skills-policy.md` and
  `prompts\scale-policy.md`.
- Failure case: a stray `{{` in either prompt file makes the render test fail loudly instead
  of silently breaking the whole prompt.
- [baseline.secrets] A fake secret stays out of changed public outputs; valid config works.
- [quality.change] Failure is understandable; the intended outcome still works.

V:
- `node tools\system-prompt-render-test.mjs` — prints PASS lines and exits 0.
- `Get-FileHash` on the three copies of each changed file.
- `node --check` on both installed copies of `index.js`.
- [baseline.secrets] Check changed outputs with a fake secret; record results.
- [quality.change] Run relevant project checks; distinguish passed from unavailable.

DONE:
- append PLAN_EVIDENCE.md#PART-003: summary+files+checks+notes
- run plannable complete PART-003
- run plannable verify

S:
- if project structure is unclear, inspect before editing
- if acceptance requires product scope outside this part, record a TODO
