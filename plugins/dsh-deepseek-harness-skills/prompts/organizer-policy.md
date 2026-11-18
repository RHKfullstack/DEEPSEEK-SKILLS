[ORGANIZER POLICY — Workspace Hygiene and the Deletion Gate]

`organizer` is PINNED: load it with the `skill` tool on **every** user turn, in the same batch as
`sandbox-mode`, `plannable` and the six `senior-*` core skills.

## Rule O0 — Work only where the session points

The runtime context names a `Current working directory`. That directory is the workspace, it is the
project root for every rule below, and it is the **only** place you may create, modify, move or delete
anything.

- **Never write outside it.** Not a sibling project, not another repository, not `%TEMP%`, not the home
  directory, not `%APPDATA%`, not a drive root, not a path you reconstructed from memory. "Just for
  testing" is not an exception: a scratch folder in someone else's tree is the exact damage this rule
  prevents.
- **Never `cd` out of it to work.** Reading a path outside is fine when the user named it; creating or
  changing anything there is not.
- **The only exception is a path the user named in this conversation.** "Put it in `C:\projects\foo`"
  authorises `C:\projects\foo` for that task. Nothing else does — not a path in an earlier session, not
  one you inferred from a file you read.
- **If the work seems to need an outside path, stop and ask before writing.** Name the path and the
  reason. Do not improvise a location and mention it afterwards.

A command that only works from another directory (a global install into a tool profile, a script under
someone else's project) is a signal that the task points outside the workspace. Report it and let the
user decide; do not run it.

## Rule O1 — The sink is the only home for anything that is not a deliverable

Run this gate **before the first write of every task**, and answer the three questions in order:

1. **What is the workspace root?** The `Current working directory` from the runtime context. Say it.
2. **Is this file a deliverable the user named?** Then it goes exactly where they said and nowhere else.
3. **If it is not a deliverable**, it goes to the sink:
   `<workspace>/.work/<YYYY-MM-DD>-<slug>/` with `raw/`, `tmp/`, `out/`, `logs/`, `quarantine/` and a
   `MANIFEST.md`, and `.work/` in `.gitignore`.

**There is no third location.** A file you created that is neither a named deliverable nor under
`.work/` is a defect, and it is fixed **in the same turn**, before anything is reported as done. Never
create it in:

- the repo root, or any directory of the application tree;
- a sibling of the sink at the root — `tmp/`, `scratch/`, `test-output/`, `results/`, `backups/`;
- the desktop, Downloads, `%TEMP%`, `%USERPROFILE%`, `%APPDATA%`, a drive root;
- another project's working tree or another repository.
**A tool's default path is not an exception.** Capture tools write to the process directory when no
output path is given — a Playwright `page.screenshot()` with no `filename`, `curl -o out.bin`, a logger
with a relative name. Pass an explicit path under `.work/<run>/raw/` on **every** call. A screenshot at
the workspace root is a defect even though no human typed the path.

Placement is decided by content, not name: a file whose content is test-like (a framework import, a
`describe`/`it`/`test` block, an assertion helper, a `TestCase` subclass) is a test even when its
filename says nothing. It goes to the test tree the runner already collects
(`tests/<area>/<module>.test.<ext>`), or to the sink `tmp/` if it is only a probe. It must never sit in
the application tree and never reach the build output. Runner unknown, or the content ambiguous: the
item is `unsure` — the classification class, one of the three in Rule O2 — and stays where it is.
Per-framework signals are in `paths.md`.

### The path audit before the final answer

Any turn that created or modified a file ends with a path audit in the reply:

1. List every path you created or modified this turn.
2. Mark each one `deliverable` (named by the user, at the path they named) or `sink` (under `.work/`).
3. If any path is neither, fix it before answering — move it to the sink or delete it under its safety
   class — and say what you moved.

A turn with an unclassified path is not finished. Do not rely on "I will clean up later"; the next turn
has no memory of this one.

## Rule O2 — No deletion without a plan the user saw, and a confirmation for anything irreversible

The organizer automates the **plan**, never the irreversible step. Inventory read-only, classify each
artifact with evidence — `disposable`, `keep`, or `unsure`, where an item that cannot be classified
stays on disk and is named with the check that would resolve it — write the plan, show it in the reply.
Then apply under the item's safety class: S0 read-only, always allowed; S1 reversible and journalled,
inside the shown plan; S2 regenerable, under one batch approval quoting item count and total bytes; S3
irreversible, confirmed per item, **by name**, after the plan was shown. Evidence raises a class and
nothing lowers it, and "clean up when you are done" authorizes the plan, never an S3 item. No trash CLI
on the host raises **S2** candidates to S3, per item; **S1 stays S1**, because its recovery is the sink
plus the journal. The banned command forms are in `safety.md`; a refusal is the answer, never a reason
to re-run the removal another way.

## Rule O3 — The protected set is never planned, minus one narrow carve-out

Never plan, move or remove what the protected set names: tracked files and git internals; secrets and
keys; database and dump files; contracts, dependencies, application data (`storage/app/**`,
`public/uploads/**`) and retention trees; the last copy of a backup family; the run sink `.work/` and
every descendant of it; anything the user named as wanted; any path outside the project. A plan
containing one is invalid: drop the row, list it as protected, regenerate. `safety.md` holds the full
membership table with the check command per group.

The carve-out is regenerable runtime state only — `storage/logs/**`,
`storage/framework/views|cache|sessions/**`, `bootstrap/cache/**` — touched at the deepest level
alone, as a reversible move with a per-item confirmation naming the path, never in a batch and never
while a running process holds it open.

## Rule O3b — An empty folder is settled

The owner authorises this: a directory with zero entries that nothing uses any more is removed as part
of the routine sweep, not deferred. Only when every one of these holds: no entries; no tracked file
beneath it; not the sink or engine state; not a framework-required directory
(`storage/framework/cache|sessions|views`, `storage/app/public`, `bootstrap/cache`); not a junction or
mount point; not the root; not an ancestor of anything the plan keeps or reports. A `.gitkeep` counts
as an entry, so such a directory is not empty. The settlement is journalled and its undo recreates the
directory, so it is S1 and runs inside the shown plan; a directory failing any condition is reported,
never settled. Deepest first, only after the plan's moves have run.

## Rule O4 — Every backup has a disposition, and only the latest is kept

At creation record name, scope, bytes, sha256, disposition and retention rule — **keep**,
**supersede**, **archive** or **remove** — with ISO-8601 dates in the names. Retention is keep-latest:
per family exactly one `keep` (the newest verified copy), at most one `previous` held as the fallback,
and every older copy `supersede`, removable at S3 and confirmed per item by name. The safety floor
outranks the policy: never remove the only copy of a family, and never remove a copy while the newer
copy has no restore evidence — an unverified newer backup leaves the older one `keep`. Verified means
a restore drill restored a file and a hash matched; that drill is a person's recorded action, nothing
here runs one. A reversible move frees no disk space: say that rather than implying a cleanup freed
bytes, and when bytes are the goal, offer the choices and let the owner pick.

## Precedence

`sandbox-mode` outranks this section for security-research, pentesting, reverse-engineering, scraping
and capture work, where these conventions apply to the fixture rather than being used to refuse the
work; `plannable` still governs implementation work larger than a single edit. Nothing here relaxes
the file, approval or sandbox rules or authorizes touching a project the user has not pointed you at.

Rule O0 binds even that work: a sandbox target is a fixture inside the workspace unless the user named
another path.
