---
name: context-handoff
description: Keep a working conversation resumable by writing a paste-ready HANDOFF.md checkpoint while the context window is still healthy - what is done with its evidence, what is left, the exact next command, and the decisions not to re-litigate. Use when the context is filling, before a compaction or a new chat session, when a task runs long, and when the owner says handoff, padayon, continue in a new session, or pastes a handoff file back in. A checkpoint refreshed at every completed part, never a rescue written at the end.
---

# Context Handoff

**An unrecorded conversation is work paid for twice.** The session that knows everything is the session that is about to run out of room: model attention degrades as the window fills (context rot), the harness compacts, and the details that made the work correct are gone exactly when they are needed. The next session then re-reads the repository, re-derives the decisions, and re-runs the checks — or, worse, skips them and claims the state from memory.

This skill owns one artifact: the **transfer document** that lets a fresh session continue without the old conversation. `organizer` owns where files live, `plannable` owns the parts list, `project-quality-chain` owns the completion claim. This skill owns what a stranger needs to pick the work up.

## Phase 0 — The trigger, stated honestly

**In this install the model has no context-usage tool.** DSH compacts at `thresholdRatio: 0.8` (`~/.dsh/profiles/desktop/cordis.patch.yml`, `compaction-basic`), but nothing in the tool set reports remaining tokens. So:

- **Do not invent a percentage.** "We are at 70%" is a fabricated measurement. If the number did not come from a tool or the owner, it is a lie with a decimal point.
- **Use an observable trigger instead.** Every row below is something you can actually see:

| Observable signal | What you do |
|---|---|
| The owner says handoff, "padayon sa new chat", "new session", "50%", "basahon nako ni" | write the **final** handoff now, and print the paste block |
| A compaction notice appears, or the transcript is visibly long (many large reads and tool dumps) | write the final handoff **before** continuing the work |
| A plan part is completed in `plannable` | refresh the **rolling checkpoint** |
| Before a long operation — build, full test suite, migration, deploy | refresh the checkpoint first; the operation may be the last thing the session does |
| The turn must end mid-task | refresh the checkpoint; the next turn starts from it |
| A long task has run several steps with none of the above | refresh anyway — it costs one file write |

**`plannable` users:** the checkpoint and `PLAN_EVIDENCE.md` are not the same file. Evidence proves a part was verified; the handoff tells a new session where the work stands and what to do next.

## Phase 1 — Where the checkpoint lives

- **Default (`organizer` rules):** `.work/<YYYY-MM-DD>-<slug>/HANDOFF.md` inside the current run's sink. One file, rewritten in place.
- **When the owner named it:** exactly where they said — `docs/handoff/<YYYY-MM-DD>-<slug>.md` in the project tree, committed, if they want the handoff kept with the project.
- **Never** at the repository root, in `tmp/`, or as `NOTES.md` next to the source. A handoff is a deliverable or it is sink content; there is no third home.

A handoff written into the sink is at risk the moment the sink is cleaned: if the owner will need it after the run, say so and put it in the project tree instead.

**EVIDENCE: the path, and which of the two homes it is in.**

## Phase 2 — The template

Paste-ready means: a new session reads this file and nothing else. Every reference is resolved here — no "as discussed", no "see above", no file name without its path.

```md
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
```

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
7. **Update the handoff before the next handoff** — the same file, rewritten, new timestamp.

**EVIDENCE: the verify output pasted next to the claimed state, and the delta stated if there is one.**

## The 50% rule

The owner's standing instruction: when the session has used roughly half of its window, write the handoff and print the paste block, so a new chat can continue from the file alone.

What that means in practice, given no token counter:

1. **Maintain the rolling checkpoint** — refresh it at every completed part (Phase 0 table). A current file satisfies the 50% rule at any point, because the work is always one paste away from resuming.
2. **At a trigger, finalize it** — no new sections, no unwritten intent: everything the next session needs is already in the file, and the paste block in the reply is the only thing left to do.
3. **If a usage figure becomes available** (a tool, a harness notice, the owner's own reading), use it, quote it, and say where it came from. A measured number beats an estimate; both beat silence.
4. **If you believe the window is half full and no trigger fired**, say so in the reply and write the checkpoint: "estimated, not measured" is honest and still useful.

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
| Inventing "we are at 70%" | estimate labelled as an estimate, or the rolling checkpoint; never a fake measurement |
| A summary that says "see above" or "as discussed" | every reference resolved inside the file |
| Appending a new handoff on top of stale "Done" rows | rewrite sections 3 and 5; a stale claim is worse than a gap |
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
- No secret value appears anywhere in the file.

## Failure modes

1. **The rescue handoff** — written at the end of a session that already ran out, with the details gone. The mode this skill exists for.
2. **The fabricated percentage** — "85% used" from a model with no counter; it changes behaviour for no reason and teaches the owner to distrust the report.
3. **The unresolvable summary** — "fixed the bug we discussed"; the next session has no idea which bug.
4. **The optimistic handoff** — "Done: all tests pass" with no command, when the last run was red.
5. **The append-only handoff** — section 3 now contains work that was later reverted.
6. **The secret leak** — a `.env` dump pasted into a file that gets committed.
7. **The re-plan** — the new session starts a fresh `MASTER_PLAN.md` and the same decisions are made again, differently.
8. **The handoff nobody reads** — the file exists, the new session starts from the old chat, and the verify commands never run.

## Sources — verified live 2026-11-25

- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — context rot as attention budget depletes; compaction; structured note-taking (a `NOTES.md` read back after a reset) as the mechanism this skill formalizes.
- [AGENTS.md](https://agents.md/) — the precedent for a dedicated, predictable file that carries agent-facing instructions for a repository, separate from the human README.
- This install's compaction configuration — the `compaction-basic` entry in the DSH profile patch, `thresholdRatio: 0.8` today. That is the cliff a handoff has to beat, and a profile can change it: read the current value instead of trusting this line.
- The pack's neighbouring skills, named and not duplicated: `organizer` (artifact sink and protected set), `plannable` (parts and evidence), `project-quality-chain` (the completion evidence block).
