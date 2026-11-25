[HANDOFF POLICY — the checkpoint that survives the context window]

`context-handoff` is the skill that owns the transfer document. These five rules are restated here so they
hold even when its body is not in the context. The point of them is one sentence: **a session that runs out
of room must leave behind everything a fresh session needs, and it must leave it before it runs out.**

## Rule H1 — Keep the checkpoint current; do not wait for the cliff

A handoff written when the window is already full is a memorial, not a transfer. Write and refresh
`HANDOFF.md` at every one of these moments, not at the end:

- a plan part completed (`plannable complete`) — refresh the rolling checkpoint;
- before a long operation: a build, a full test suite, a migration, a deploy;
- before a turn that must end mid-task;
- when the owner says handoff, "padayon sa new chat", "new session", or pastes a handoff back in;
- **when the work it describes is finished** — then the file is replaced, not updated (Rule H5).

The rolling checkpoint is the whole mechanism: refresh it as you go, and any stop — planned, abrupt, or a
compaction — is already resumable. You are not waiting for a warning: you are keeping the file current so
no warning is needed.

## Rule H2 — The trigger is an event; the percentage does not exist

There is **no context threshold in this rule** — no 50%, no 80%. A model cannot measure its own window, the
owner's window may be 128k, 262k or a million tokens, and a percentage rule is wrong on most machines and
fires at the wrong moment on the rest.

- **Never quote a context percentage**, not to justify writing the checkpoint and not to justify skipping it.
  "We are at 70%" is a fabricated measurement.
- **Event triggers, all observable:** the owner's words; a compaction notice or a summary of the
  conversation; a plan part completed; a long operation about to start; a turn ending mid-task; the work
  finishing.
- **Scale has nothing to do with it.** The same rule runs on a 128k window and on a million-token one; a
  small window simply reaches a compaction sooner, and the rolling checkpoint already covers that.

## Rule H3 — The file is paste-ready, or it is not a handoff

A handoff is read by a session that shares none of this conversation. So:

- every reference resolved — no "see above", no "as discussed", no file name without its path;
- every completed item carries the command that proved it and the output observed;
- the next actions are ordered, each with the exact command to run;
- a verify section whose expected output is written down — that section is what catches a stale handoff;
- no secret value anywhere: a masked identifier only, because the owner can locate the secret themselves;
- one live file per handoff, rewritten in place with a new timestamp. Appending to stale "Done" rows makes
  the file lie about the state.

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

## Rule H5 — At the end of the work, the content is deleted, not updated

A finished job does not get an updated handoff; it gets a replaced one. The file describes the work that is
open **now**, so when that work closes:

1. **Open the file, delete its content, write the new handoff.** Do not append and do not "update in place" —
   yesterday's Done rows above today's next actions is how a handoff starts to lie.
2. **Nothing carries over by default.** The previous task survives only as a decision in section 7 if it
   still constrains the next job, or as a verify command in section 10 if the state it left must still hold.
3. **If nothing follows,** remove the file inside `organizer`'s S1 rules and say where it went — a closed
   task must not leave a stale document behind.
4. **One live file.** A superseded handoff is an ISO-dated archive recorded as `keep` in the manifest, never
   a second `HANDOFF-final.md` sitting beside the real one.
5. **Say it in the reply:** "the handoff at `<path>` was cleared and replaced with the handoff for
   `<next task>`" — the owner must know the old content is gone before they paste anything.

## Precedence and overlap

`organizer` owns **where** the file goes (sink, classification, protected set). `plannable` owns the parts
and `PLAN_EVIDENCE.md`. `project-quality-chain` owns the evidence block that says a change is complete. This
policy owns **only** the transfer document and the resume protocol: a fact that belongs in one of the others
goes there, and the handoff points at it instead of duplicating it.

`sandbox-mode` outranks this section for security-research and capture work, where the conventions apply to
the fixture. Nothing here relaxes the file, approval or sandbox rules.
