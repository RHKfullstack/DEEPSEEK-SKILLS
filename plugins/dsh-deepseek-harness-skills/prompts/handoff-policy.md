[HANDOFF POLICY — the checkpoint that survives the context window]

`context-handoff` is the skill that owns the transfer document. These four rules are restated here so they
hold even when its body is not in the context. The point of them is one sentence: **a session that runs out
of room must leave behind everything a fresh session needs, and it must leave it before it runs out.**

## Rule H1 — Keep the checkpoint current; do not wait for the cliff

A handoff written when the window is already full is a memorial, not a transfer. Write and refresh
`HANDOFF.md` at every one of these moments, not at the end:

- a plan part completed (`plannable complete`) — refresh the rolling checkpoint;
- before a long operation: a build, a full test suite, a migration, a deploy;
- before a turn that must end mid-task;
- when the owner says handoff, "padayon sa new chat", "new session", or pastes a handoff back in.

The rolling checkpoint is the whole mechanism: refresh it as you go, and any stop — planned, abrupt, or a
compaction — is already resumable. **You are not writing the handoff at the threshold; you are keeping it
current so the threshold never catches you unprepared.**

## Rule H2 — The trigger is observable; the percentage is not

Do NOT claim a context percentage you did not measure. In this build no tool reports remaining tokens, so
"we are at 70%" is a fabricated measurement and it is worse than no estimate: it changes behaviour on a
number that does not exist.

- **Observed triggers:** the owner's words; a compaction notice; a transcript that is visibly long (many
  large file reads and tool dumps); a long task several steps past its last checkpoint.
- **A usage figure, when one exists,** is quoted with its source. A measured number beats an estimate, and
  both beat silence.
- **When the owner says 50%,** that is the threshold: finalize the handoff now and print the paste block,
  rather than starting another piece of work.

## Rule H3 — The file is paste-ready, or it is not a handoff

A handoff is read by a session that shares none of this conversation. So:

- every reference resolved — no "see above", no "as discussed", no file name without its path;
- every completed item carries the command that proved it and the output observed;
- the next actions are ordered, each with the exact command to run;
- a verify section whose expected output is written down — that section is what catches a stale handoff;
- no secret value anywhere: a masked identifier only, because the owner can locate the secret themselves;
- one file per handoff, rewritten in place with a new timestamp. Appending to stale "Done" rows makes the
  file lie about the state.

Where it lives: `.work/<run>/HANDOFF.md` under the sink by default, exactly where the owner said if they
named a path. Never the repository root and never `NOTES.md` beside the source.

## Rule H4 — Resume continues; it does not re-plan

In the new session, in this order: read the handoff **first**; run its verify commands and compare the real
output with what it claims; check `git status` and the last commits against the files it lists; then
continue at its first next action, in order.

- **Do not re-plan from scratch** — a fresh plan discards the decisions the previous session already paid
  for and usually reaches different ones.
- **Do not redo what the file marks verified** unless verification failed or the tree changed.
- **A mismatch is information** — report the delta before editing anything.

## Precedence and overlap

`organizer` owns **where** the file goes (sink, classification, protected set). `plannable` owns the parts
and `PLAN_EVIDENCE.md`. `project-quality-chain` owns the evidence block that says a change is complete. This
policy owns **only** the transfer document and the resume protocol: a fact that belongs in one of the others
goes there, and the handoff points at it instead of duplicating it.

`sandbox-mode` outranks this section for security-research and capture work, where the conventions apply to
the fixture. Nothing here relaxes the file, approval or sandbox rules.
