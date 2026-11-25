---
name: context-handoff
description: Keep a working conversation resumable by writing a paste-ready HANDOFF.md checkpoint - what is done with its evidence, what is left, the exact next command, and the decisions not to re-litigate. Use before a compaction or a new chat session, when a task runs long, when the owner says handoff, padayon, continue in a new session, or pastes a handoff file back in, and when work finishes and the old handoff must be cleared and replaced. A checkpoint refreshed at every completed part, overwritten rather than appended.
---

# Context Handoff

**An unrecorded conversation is work paid for twice.** The session that knows everything is the session that is about to run out of room: model attention degrades as the window fills (context rot), the harness compacts, and the details that made the work correct are gone exactly when they are needed. The next session then re-reads the repository, re-derives the decisions, and re-runs the checks — or, worse, skips them and claims the state from memory.

This skill owns one artifact: the **transfer document** that lets a fresh session continue without the old conversation. `organizer` owns where files live, `plannable` owns the parts list, `project-quality-chain` owns the completion claim. This skill owns what a stranger needs to pick the work up.

## Phase 0 — The trigger is an event, not a number

**There is no context percentage in this rule.** Not 50%, not 80%, not "the window is getting full". A model has no meter it can read, and the owner's window may be 128k, 262k or a million tokens — a rule tied to a percentage is wrong on most machines, and the number is always a guess. So:

- **Never quote a context percentage**, not to justify writing the handoff and not to justify skipping it. "We are at 70%" is a fabricated measurement.
- **Trigger on events you can actually see.** Every row below is observable:

| Observable event | What you do |
|---|---|
| The owner says handoff, "padayon sa new chat", "new session", "basahon nako ni" | write the **final** handoff now, and print the paste block |
| A compaction notice appears, or the harness summarises the conversation | write the final handoff **before** continuing — the original text is already lost |
| A plan part is completed in `plannable` | refresh the **rolling checkpoint** |
| Before a long operation — build, full test suite, migration, deploy | refresh the checkpoint first; the operation may be the last thing the session does |
| The turn must end mid-task | refresh the checkpoint; the next turn starts from it |
| **The work is finished** | **clear the file and write a new handoff over it** — see Phase 4 |
| A long task has run several steps with none of the above | refresh anyway — it costs one file write |

**`plannable` users:** the checkpoint and `PLAN_EVIDENCE.md` are not the same file. Evidence proves a part was verified; the handoff tells a new session where the work stands and what to do next.

## Phase 1 — Where the checkpoint lives

- **Default (`organizer` rules):** `.work/<YYYY-MM-DD>-<slug>/HANDOFF.md` inside the current run's sink. One file, rewritten in place.
- **When the owner named it:** exactly where they said — `docs/handoff/<YYYY-MM-DD>-<slug>.md` in the project tree, committed, if they want the handoff kept with the project.
- **Never** at the repository root, in `tmp/`, or as `NOTES.md` next to the source. A handoff is a deliverable or it is sink content; there is no third home.

The sink itself is protected — `organizer` never plans a removal inside `.work/`. What goes is the run's `tmp/` and `out/` once the run is finished, so a handoff in a finished run's `out/` is the one at risk. If the owner will need it after the run, put it in the project tree and say so.

**EVIDENCE: the path, and which of the two homes it is in.**

## Phase 2 — The template

Paste-ready means: a new session reads this file and nothing else. Every reference is resolved here — no "as discussed", no "see above", no file name without its path.

````md
# HANDOFF — <project> — <YYYY-MM-DD HH:MM>

## 1. Session identity
- Working directory: <abs path>
- Repository / branch / HEAD: <repo> / <branch> / <short sha>
- What the owner asked for, verbatim: "<quote>"

## 2. Goal in one sentence
<one sentence; if there are two goals, say which is the priority>

## 3. Done, with evidence
| # | What | Evidence (command -> observed result) | Committed |
|---|---|---|---|
| 1 | <change> | `<command>` -> `<output>` | yes <sha> / no |

## 4. In progress
- <exact stopping point: the file, the function, the line, the failing test>
- State: <what works now / what is half-written>

## 5. Next actions, in order
1. <action> — `<exact command>`
2. <action> — `<exact command>`

## 6. Files touched
| Path | Why | Status |
|---|---|---|
| <path> | <one line> | committed / modified / new / pushed |

## 7. Decisions made, and why
- <decision> — because <reason>. Do not re-litigate: <what was rejected>.

## 8. Open questions and blockers
- <question only the owner can answer>
- <blocker> — <what was tried> — <what is needed>

## 9. Do not redo, do not touch
- Verified already: <checks that passed and their commands — do not re-run blindly, but re-verify if the tree changed>
- Protected: <files, secrets, databases, branches that must not be touched>

## 10. How to verify this state
```sh
<command>   # expected: <output the new session must see>
```

## 11. Resume line
Paste this into the new session:

> Read `<path>/HANDOFF.md` first. It is a handoff, not a summary: run its section 10
> commands, compare the result with section 3, then continue at section 5 in order.
> Do not re-plan from scratch and do not redo section 9.
````

Section 10 is the one that catches a stale handoff — it is the difference between a document that claims a state and a check that proves it.

**EVIDENCE: all eleven sections present, and one verify command whose expected output is written down.**

## Phase 3 — The resume protocol

Follow this in the new session, in order. Skipping step 2 is how a session "continues" work that was never there.

1. **Read the handoff first**, before any other file. Not a summary of it — the file.
2. **Run section 10's verify commands** and compare the real output with section 3. A mismatch is information: report it before editing anything.
3. **Check section 6 with git** — `git status --porcelain`, `git log --oneline -3`, `git diff --stat`. The handoff says what the last session believed; git says what is on disk.
4. **Continue at section 5, item 1.** In order. Not at item 3 because it looks more interesting.
5. **Do not re-plan from scratch.** A new plan discards the decisions in section 7 and the owner pays for them twice.
6. **Do not redo section 9** unless step 2 failed or step 3 shows the tree changed.
7. **Replace the handoff before the next handoff** — the same file, its old content gone, a new timestamp.

**EVIDENCE: the verify output pasted next to the claimed state, and the delta stated if there is one.**

## Phase 4 — When the work is done: clear the file, write a new handoff

**A finished job does not get an updated handoff. It gets a replaced one.** The handoff describes the work that is open right now; once that work closes, its sections are history, and a file that mixes finished work with the next job is a file the next session has to archaeology its way through.

The rule, in order:

1. **Do not append.** Open the file, delete everything in it, and write the new handoff into an emptied file. An "update" that leaves yesterday's Done rows above today's is how a handoff starts to lie.
2. **Nothing carries over by default.** Every section is written fresh: new identity, new goal, new Done rows, new next actions. The previous task survives in exactly two ways — as a **decision** in section 7 if it still constrains the next job, and as a **verify command** in section 10 if the state it left must still hold. Anything else is deleted, not summarised.
3. **A finished task that nothing follows** leaves one of two states, never a stale document: either the next task is already known and the file holds that handoff, or the file is removed and the owner is told the work is closed. Deleting is `organizer`'s S1 move inside the sink — journal it, and say where it went.
4. **One file, one handoff.** Never `HANDOFF.md` plus `HANDOFF-old.md` plus a note. If a superseded handoff must be kept, it is an archived copy with an ISO date in the name, recorded as `keep` in `organizer`'s manifest — not a second file sitting beside the live one.
5. **Say it in the reply.** "The handoff at `<path>` was cleared and replaced with the handoff for `<next task>`" — the owner must know the old content is gone before they paste anything.

**EVIDENCE: the file's first line carries a new timestamp, and nothing from the previous task survives except a decision or a verify command that still applies.**

## Handing off to a person, versus a session

| Receiver | What to add |
|---|---|
| A new chat session | the file as-is, and the section 11 line in the reply |
| A human picking the work up | three lines at the top: what it is, where it stands, what they must decide |
| A subagent or a teammate | nothing — they get their own self-contained brief; the handoff is for a context you will not see again |
| Another machine or repository | the file plus the branch and HEAD; the paths in section 1 must be portable |

## Anti-default table

| Default | The gate |
|---|---|
| Writing the handoff at the end | the end is where sessions die; refresh at every completed part |
| Quoting a context percentage, anywhere, ever | the trigger is an event you can see; a 128k window and a 1M window follow the same rule |
| Writing the handoff "when the window looks full" | write it at the event, not at an imagined fullness |
| **Updating** the handoff when the work is done | **clear the file and write a new one** — nothing carries over except a still-binding decision or a still-passing verify |
| Appending new work on top of stale "Done" rows | the append makes the file a log; a log is not a handoff |
| Two handoff files that disagree | one live handoff; a superseded one is an ISO-dated archive recorded in the manifest |
| A file path with no absolute path | section 1 carries the working directory; section 6 carries full paths |
| Pasting tokens, cookies, keys or `.env` values into the handoff | masked identifier only — the owner can locate it themselves |
| Resuming by re-reading the whole old conversation | read `HANDOFF.md`, verify, continue |
| Resuming by re-planning | continue at section 5 in order |
| Claiming the resumed state from the handoff alone | run section 10 first, quote the output |
| Two handoff files that disagree | one file per handoff; the newer one supersedes and says so |

## Overlap — what this skill does not own

- `organizer` — where the file goes, the sink, the classification of artifacts, the protected set.
- `plannable` — `MASTER_PLAN.md`, the parts, `PLAN_EVIDENCE.md`, the check-off rule.
- `project-quality-chain` — the evidence block that says a change is complete.
- `senior-work-audit` and the other `senior-*` skills — the verdict on the work itself.
- This skill — **only** the transfer document and the resume protocol. If a fact belongs in one of the others, it goes there and the handoff points at it; it is not duplicated here.

## Definition of done

- `HANDOFF.md` exists at a named path, with all eleven sections and a timestamp.
- Every "Done" row carries the command that proved it and the output observed.
- Next actions are ordered, each with the exact command to run.
- Section 10's verify commands were run, and the result matched — or the mismatch is written down.
- The section 11 resume line is in the reply, ready to paste.
- When the work it described has closed, the file was **cleared and replaced**, not updated — and the reply said so.
- No secret value appears anywhere in the file.

## Failure modes

1. **The rescue handoff** — written at the end of a session that already ran out, with the details gone. The mode this skill exists for.
2. **The invented threshold** — "the window is 50% full" from a model with no counter; it fires on small windows and never fires on large ones, and it teaches the owner to distrust the report.
3. **The unresolvable summary** — "fixed the bug we discussed"; the next session has no idea which bug.
4. **The optimistic handoff** — "Done: all tests pass" with no command, when the last run was red.
5. **The carried-over handoff** — the work finished, the file was "updated", and yesterday's Done rows are still sitting above today's next actions.
6. **The append-only handoff** — section 3 now contains work that was later reverted.
7. **The two-handoff folder** — `HANDOFF.md`, `HANDOFF-final.md` and a note, which of them is true is now a question.
8. **The secret leak** — a `.env` dump pasted into a file that gets committed.
9. **The re-plan** — the new session starts a fresh `MASTER_PLAN.md` and the same decisions are made again, differently.
10. **The handoff nobody reads** — the file exists, the new session starts from the old chat, and the verify commands never run.

## Sources — verified live 2026-11-25

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — context rot as attention budget depletes; compaction; structured note-taking (a `NOTES.md` read back after a reset) as the mechanism this skill formalizes.
- [AGENTS.md](https://agents.md/) — the precedent for a dedicated, predictable file that carries agent-facing instructions for a repository, separate from the human README.
- This install's compaction configuration — the `compaction-basic` entry in the DSH profile patch, `thresholdRatio: 0.8` today. Reaching it is the moment the conversation becomes a summary, which is why the checkpoint has to already exist; the handoff rules themselves do not depend on this number, so they behave the same on a 128k window and on a million-token one.
- The pack's neighbouring skills, named and not duplicated: `organizer` (artifact sink and protected set), `plannable` (parts and evidence), `project-quality-chain` (the completion evidence block).
