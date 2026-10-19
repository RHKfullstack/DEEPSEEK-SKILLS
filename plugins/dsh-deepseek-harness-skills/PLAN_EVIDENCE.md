# PLAN_EVIDENCE.md

> **NOT the organizer evidence.** This file is the plan evidence for an earlier, unrelated project
> (the scale-policy / Agent Teams build), last written 2026-10-03.
>
> The evidence for the organizer skill lives in the plan project at
> `C:\xampp\htdocs\root-ai\tests\organizer-skill\PLAN_EVIDENCE.md` (round 2) and
> `C:\xampp\htdocs\root-ai\tests\organizer-skill\v1\PLAN_EVIDENCE.md` (round 1).
>
> This header was added on 2026-10-12 because the round-2 audit (finding V2-7) found that two files
> named `PLAN_EVIDENCE.md` made round-1 citations resolve to the wrong one. The file was not moved:
> it is part of this package's own history.

Project: Auto Escalate Agent Teams, Subagent And Agent Loop On Large/heavy Workspaces Via DSH System Prompt

## Evidence Log

### PART-001

Authored prompts/scale-policy.md (4136 bytes, 76 lines). Six rules: S1 always-evaluated SMALL/LARGE/HEAVY classifier with numeric thresholds (8+ files, 2+ modules, migration/refactor/audit, hundreds-of-files repo, >15 tool calls) plus a choose-the-larger-class tiebreak; S2 SMALL stays single-agent and forbids teammates and subagent/subagent_fork; S3 LARGE auto-starts subagent/subagent_fork delegations in one assistant message and cross-references plannable; S4 HEAVY auto-runs as an Agent Team, creates team_task_create scopes/blocked_by before spawn_teammate, and states the precedence over the Agent Teams 'explicitly asks' sentence while keeping that gate for SMALL and LARGE; S5 batches independent tool calls for the Agent loop parallel pool; S6 preserves the workflow gate and the file/approval/sandbox rules. Zero brace characters, so harness interpolation cannot throw on this section.

Artifacts:
- pwsh in C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills: Get-Item prompts\scale-policy.md -> 4136 bytes / 76 lines; Select-String -Pattern '\{\{' -> 0 matches; Select-String -Pattern '[{}]' -> 0 matches; Select-String -Pattern '^## Rule S\d' -> S1,S2,S3,S4,S5,S6; Get-FileHash -Algorithm SHA256 -> A2D7C58F76D51A98579F0F206F201716FF1A1E2A3C230F46C0D6BF887B7CEFA7

### PART-001

Correction to the hash in the previous evidence line: after PART-002's test caught that Rule S4 paraphrased instead of quoting the sentence it overrides, S4 was edited to quote it verbatim - 'create teammates only when the user explicitly asks to use Agent Teams or teammates'. Final content: 4131 bytes, sha256 41E95B6E26FFB037FF3435D375024ACD2B7074952495D0095BD1EB47CF7FDE3C. No braces are present, so the harness interpolate() step cannot throw on this section.

Artifacts:
- pwsh: Get-FileHash prompts\scale-policy.md -Algorithm SHA256 -> 41E95B6E26FFB037FF3435D375024ACD2B7074952495D0095BD1EB47CF7FDE3C (4131 bytes); node tools\plugin-registration-test.mjs -> PASS scale policy quotes the sentence it overrides

### PART-002

index.js now registers a second global prompt section 'deepseek-harness:scale-policy' whose order resolves through ctx.systemPrompt.getSectionOrder('TEAM_POLICY') - 1, so it renders immediately before the Agent Teams policy (order 600) it qualifies, with a literal 599 fallback when that table key is absent (a non-finite order throws in SystemPrompt.section and would take the plugin's other sections down with it). Both section texts are now functions that re-read and re-escape the prompt file per assembly - the same form @deepseek-ai/dsh-tool-subagent already uses - so wording edits reach the next model step without an app restart; a read failure degrades to the import-time text instead of throwing. Section names stay plugin-owned (harness:identity / deployment:persona-* / team:policy / tool:* are never reused), the two skills and the inject list are unchanged, and prompts/skills-policy.md gained rule 8 pointing at the scale policy. index.js sha256 DCE33F115A358CB87F0D2421B40BC0B553BA7C2A78240E3F0A3AFBA42EDD49DA; prompts/skills-policy.md sha256 8EB05A7C5FA2896F9B9057455965D61B9F094067DC61EFAE242A1403078FD3BB.

Artifacts:
- pwsh in C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills: node --check index.js -> exit 0; node tools\plugin-registration-test.mjs -> PASSED: 18 checks, exit=0 (two sections registered at 150 and 599, both finite, both text-as-function and non-empty, names unique and not harness-owned, two skills unchanged, fallback to 599 with getSectionOrder missing and with TEAM_POLICY unknown)

### PART-003

Synced index.js, prompts/skills-policy.md and prompts/scale-policy.md into all three plugin copies (source C:\Users\admin\.dsh\plugins\dsh-deepseek-harness-skills, live C:\Users\admin\.dsh\profiles\desktop\node_modules, and C:\Users\admin\.dsh\profiles\web\node_modules); hashes are identical across the three: index.js=identical:DCE33F115A358CB8; prompts\skills-policy.md=identical:8EB05A7C5FA2896F; prompts\scale-policy.md=identical:41E95B6E26FFB037. Added tools/plugin-registration-test.mjs (18 checks) and tools/system-prompt-render-test.mjs (14 checks), both passing on the source copy AND on the live desktop copy AND on the web copy. The render test rebuilds the whole system prompt with the real harness renderer ported verbatim from @deepseek-ai/dsh-system-prompt/lib/index.js inside app.asar (SECTION_ORDERS, comparePromptSections, renderPrompt, interpolate) plus the verbatim team:policy opening sentence, and proves: nothing throws, no section is dropped, every pre-existing harness section still reaches the prompt, model/cwd variables still interpolate, the scale section sorts immediately before team:policy in the assembled text (order 599 vs 600), skills-policy stays before plan:policy, no duplicate name, and three negative controls still throw (unknown variable, malformed reference, unregistered variable). The escape layer is also proven end to end: escape turns a bare placeholder into the neutral form, which then interpolates instead of throwing. TWO LIMITS: (1) the new section needs one DeepSeek Harness restart to load, because index.js reads the prompt files at module import - that step is IMPLEMENTED, not PASSED; every wording edit AFTER that restart applies to the next model step with no restart, because both sections now render text through a per-assembly function. (2) the session store at C:\Users\admin\.dsh\sessions was checked and does not persist the assembled system prompt, so there is no post-restart log assertion to make; after restart the check is to open a chat and confirm the SCALE POLICY section is cited. app.asar and the profile cordis.patch.yml were not touched.

Artifacts:
- pwsh: Get-FileHash on 3 copies x 3 files -> all identical (index.js=identical:DCE33F115A358CB8; prompts\skills-policy.md=identical:8EB05A7C5FA2896F; prompts\scale-policy.md=identical:41E95B6E26FFB037); node tools\plugin-registration-test.mjs -> PASSED 18 checks (source, desktop, web); node tools\system-prompt-render-test.mjs -> PASSED 14 checks (source, desktop, web); node --check index.js -> exit 0 on all three
