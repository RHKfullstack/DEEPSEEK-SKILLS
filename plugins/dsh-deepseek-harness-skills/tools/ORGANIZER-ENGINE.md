# ORGANIZER-ENGINE — `tools/organizer.mjs`

The enforcing half of the `organizer` skill. The skill body says *what* the agent must do about
agent-created repository litter; this engine is what makes that enforceable instead of advisory:
it classifies litter from evidence, gates every action behind an explicit per-class approval,
re-verifies each target immediately before it touches it, and journals every action with its
inverse so a mistake is recoverable.

Node stdlib only (`node:fs`, `node:path`, `node:crypto`, `node:child_process`). No dependencies.
Node 24, Windows-first (tested on Windows 11 26200, Node v24.15.0). Companion files:
`tools/organizer-test.mjs` (harness) and `tools/organizer-test.txt` (its captured real output).

---

## 1. Command surface

```
node <plugin>/tools/organizer.mjs inventory   --root <dir> [--json]
node <plugin>/tools/organizer.mjs plan        --root <dir> --level <minimal|light|standard|deep|immaculate>
                                              [--scope session|repo] [--out <plan.json>] [--purge] [--json]
node <plugin>/tools/organizer.mjs apply       --plan <plan.json> [--approve-s2] [--confirm <id,id>]
                                              [--only <id,id>] [--json]
node <plugin>/tools/organizer.mjs undo        --journal <journal.json> [--json]
node <plugin>/tools/organizer.mjs disposition --root <dir> --level <level>
                                              [--set <id>=<kept|removed|landed|deferred|accepted>:<reason>]... [--json]
node <plugin>/tools/organizer.mjs doctor      [--json]
```

* `--purge` applies to `plan` only, and only to **backup** items whose retention disposition is
  `supersede`: it turns that reversible quarantine move into an irreversible `purge`, which is the
  only action in this engine that actually frees disk space. Every other item keeps its action, so
  the flag cannot be used to make litter permanently unrecoverable. A purge is still S3 and is
  still confirmed per item by name, and an oversize backup is downgraded to `archive` even here.
* Every command accepts `--json` and then prints **only** one JSON envelope on stdout:
  `{ "schemaVersion": 1, "kind": "<command>", "data": { … } }`. On failure the same envelope is
  printed with an added `error: { code, message }`. Without `--json` the command prints a human
  report; the machine contract never depends on the human view.
* `--json`/`--flag=value` and `--flag value` are both accepted; `--only`/`--confirm` take comma
  lists; `--set` may be repeated.
* `plan` writes its plan to `--out <path>`, or to `<state>/roots/<rootHash>/plans/<planId>-<level>-<scope>.json`.
  `planId` is a hash of (root, level, scope, every item's rel/kind/class/action/planned), so an
  unchanged tree yields the same plan id — re-planning is stable and diffable.
* Commands are invoked with `spawnSync(process.execPath, [ … ])` in the harness. The engine itself
  spawns nothing but `git` and the tool probes, always as an argument array with `shell: false`.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | ok — the command completed and nothing needs a decision |
| 2 | usage — unknown command/option, missing required flag, unknown id in `--only`/`--confirm`/`--set`, bad level/scope |
| 3 | not found — missing root, plan file, or journal file |
| 5 | drift — at least one item changed since planning and was skipped; `undo` also returns 5 when a restore target is occupied or a quarantine copy drifted |
| 6 | findings — refusals, errors, incomplete scan, or (for `disposition`) unaccounted items |

Precedence when several apply: **2 or 3** (checked before anything is attempted) → **5** (drift) →
**6** (refusals/errors) → **0**. Both signals are always reported per item in `data`; only the exit
code is single-valued.

---

## 2. Safety invariants

A violation of any of these is a defect, not a style choice. They are also stated in-source so a
reviewer reads them next to the code.

| id | invariant | how it is enforced |
| --- | --- | --- |
| **I1** | **No shell deletion.** Every mutation goes through `node:fs`. No path is interpolated into a shell string and nothing is executed through a shell. | The only child process is `spawnSync("git", [args], { shell: false })`. The recorded incident class this exists to prevent — `rm -rf $VAR` with an unresolved variable — is named in the file header. Each plan item carries `shell` (the *equivalent* command, for review) plus `shellExecuted: false`. The harness asserts the executable code contains no `exec*`, no `shell: true`, no `spawn(`, and no deletion idiom. |
| **I2** | **Containment.** Every target is resolved (`realpathSync.native`) and proven strictly inside the containment root before it is touched. | `isInsidePath` compares resolved absolute paths, case-insensitively on Windows. A target that *is*, or that is reached *through*, a symlink or NTFS junction is refused outright (`symlink or NTFS junction (never followed, never removed)`), and a path whose resolved form differs from its lexical form beyond letter case is refused as `path resolves through a link or junction to a different location`. Junctions are never traversed during the walk either. A nested git repository/worktree (a directory carrying its own `.git`) is protected in full, because its tracked set belongs to *that* repository and is not visible here. |
| **I3** | **Protected set.** Never planned at any level, and every exclusion is reported by path with its reason. | `protectionReason()` — see §4. Whole-directory actions are additionally refused when the subtree contains protected, tracked or link/device content (protection is inherited upward for that decision). The SAME predicate is re-decided per item at apply time, on live state, so a hand-edited plan cannot move a protected path (see §5). |
| **I4** | **Re-verify at apply.** `apply` re-checks size + mtime + sha256 (a tree digest for directories) before each action. | Drift ⇒ skip *that* item, keep going, report `status: "drift"` with both fingerprints, and exit 5. Files above the hash cap get a documented partial digest (`head + tail + size + mtime`, `mode: "partial"`); unreadable files fall back to `mode: "meta"` (size + mtime only) and say so. |
| **I5** | **Gates.** S2 needs `--approve-s2`; S3 needs `--confirm <id>` naming that exact item. Refusal is reported, never routed around. | A refusal produces `status: "refused"` with the gate in the reason, and exit 6. `--confirm` for a different id never approves this one. `--only`/`--confirm` ids are validated **before** any action, so a typo cannot half-apply a plan. `apply` also refuses anything the plan did not mark `planned: true` — the level gate is enforced twice. |
| **I6** | **Journal with the inverse.** Every action is journalled so `undo` can restore it and can honestly report what it could not restore. | Each entry records `from`, `to`, `inverse`, the fingerprint verified at action time, `restorable`, and the move method. `undo` restores moves byte-for-byte, marks entries `restored`, and reports purges and missing sink copies as `not-restorable` (exit 6). An occupied destination is a skip, never an overwrite (exit 5). |
| **I7** | **Windows-safe.** Both separators, long paths, read-only files, non-regular filesystem objects, unreadable files. | Relative paths are normalised to `/`; long paths are exercised to >260 characters by the harness; a read-only file is quarantined (clearing the bit only if the rename needs it, recorded as `inverse.modeChanged` and restored by `undo`); reserved device names (`NUL.css`, `CON`, `COM1`…) are always at least S2; non-regular filesystem objects and unreadable paths become reported refusals or `scanErrors`, never a crash. |

### Class table

Evidence **raises** a class; nothing lowers it.

| class | meaning | gate |
| --- | --- | --- |
| **S0** | read-only: report only, nothing is touched | none |
| **S1** | reversible by the journal: the item's origin is recorded by the current session (or the owner asked for it), so the sink + `undo` restores it exactly | none |
| **S2** | the content is not proven disposable from provenance alone: regenerable output, or junk nobody recorded creating | `--approve-s2` (one batch approval) |
| **S3** | the risk of loss is real: unique content, a referenced file, an item above the quarantine cap, or an item whose recovery assumption is absent | `--confirm <id>` naming **that** item |

Raises applied by `computeSafety` (each recorded in `raisedBy` and in `evidence.signals`):

| raise | trigger | to |
| --- | --- | --- |
| `oversize` | item larger than the quarantine cap (default 256 MiB) | +1, and for non-backup items the action becomes an irreversible `purge` (`oversize-purge`) |
| `no-trash-tool` | no `trash`/`trash-put`/`gio`/`recycle` on `PATH` — the recovery assumption for a plain removal is absent | S2 → S3 |
| `git-unavailable` | `git` missing or the root is not a work tree, so tracked protection cannot be established | +1 |
| `untracked-work` | unique uncommitted content | S3 |
| `referenced-by-tracked-file` | tracked code names this file | S3, and the action becomes `report` (see §6) |
| `oversize-purge` | the item will not be quarantined | S3, action `purge` |
| `reserved-device-name` | `NUL`, `CON`, `PRN`, `AUX`, `COM1-9`, `LPT1-9` (any extension) | at least S2 |
| `reference-check-not-run` | the reference check could not be performed (disabled, capped, or `git grep` failed) | +1, with `evidence.referenceCheck: "not-run"` |

Two rules deserve their reasoning spelled out:

* **S1 requires a session record.** A junk-named untracked file that *no* session is recorded as
  creating is **S2, never S1** — the engine will not claim provenance it does not have. The session
  record is read (§7) and the match is recorded in `evidence.sessionCreated`.
* **S2 → S3 without a trash tool.** With a native trash CLI the owner has a recovery path outside
  this engine; without one, an S2 removal would rely on the engine's own sink. So the class is
  raised and each item must be named individually. S1 is deliberately exempt: its recovery *is* the
  sink + journal, which the engine owns and proves by restoring byte-identically.

---

## 3. Plan levels

`--level` is the scope of what the engine is willing to act on. Each item carries `minLevel` (the
lowest level that reaches it) and `levelState` (`planned` | `deferred-by-level` | `no-action`), so a
lower-level plan still *shows* everything it is not touching.

| level | plans | rationale |
| --- | --- | --- |
| `minimal` | items recorded as created by the current session, and nothing else | "clean up after yourself" is the cheapest thing to ask for |
| `light` | + junk-named untracked/ignored files up to 1 MiB, and empty directories | small, obviously-scratch files and folders nothing uses |
| `standard` | + larger junk-named items, test artifacts, **detected test content**, regenerable build output, raw scrape payloads, ignored non-config files | the everyday sweep |
| `deep` | + backups (retention dispositions) and untracked-work landing proposals | items that need a judgement, not just an action |
| `immaculate` | + live runtime output a running app serves from disk (`public/build`, `bootstrap/cache`, `storage/framework`, `storage/logs`) | removing these degrades the running app until it rebuilds, so only the most aggressive level proposes them |

Levels are **monotone**: the harness asserts `planned(minimal) ⊆ planned(light) ⊆ … ⊆ planned(immaculate)`.

---

## 4. Protected set

`protectionReason(rel, context)` returns the reason an entry is excluded, or `null` when it is in
scope. Nothing here is decided by size or age. Reported by path, with the reason, in
`data.protected`; `counts.protectedByReason` groups them so "547 tracked files" reads as one rule.

| protected | reason recorded |
| --- | --- |
| the containment root itself | `the containment root itself is never an item` |
| `.git/**` | `git internals (.git/**)` |
| any path with a `.work` segment | `agent artifact sink (.work/**) is never planned and never walked` |
| any path with a `node_modules` segment | `dependency tree (node_modules/**)` |
| any path with a `vendor` segment | `vendored dependencies (vendor/**)` |
| `docs/**` | `owner-protected documentation root (docs/**)` |
| `storage/app/**` | `runtime application state (storage/app/**)` |
| `.env`, `.env.*`, `.env*` | `environment/secrets file (.env*)` |
| `*.pem *.key *.pfx *.p12 *.jks *.keystore *.ppk *.asc *.gpg *.der *.crt *.cer`, `id_rsa*`, `id_dsa*`, `id_ecdsa*`, `id_ed25519*`, `*vault-keys*`, `authorized_keys`, `known_hosts`, `.netrc`, `.npmrc`, `.pypirc` | `key or credential material` |
| every git-tracked file | `tracked by git (the repository owns this file)` |
| a nested repository or worktree (a directory containing its own `.git`) | `nested git repository or worktree (its own tracked set is not visible here)` |
| the engine state directory, when it lies inside the root | `engine state / scratchpad inside the root (never an item)` |
| the current run's quarantine sink, when it lies inside the root | `this run's quarantine sink inside the root (never an item)` |
| the system temp directory, when it lies inside the root | `system temp directory inside the root (never an item)` |
| anything resolving outside the root | refusal: `resolves outside the containment root` |

The `.work` rule is deliberately matched on a captured segment rather than only the root one, so a
nested sink is protected too. It exists because the doctrine's sink mandates a `raw/` (and `_raw/`)
subdirectory, and `raw` is also a scrape marker — without the rule the engine plans the current
run's own deliverables for removal. A path under `.work/` is therefore never an item and is never
walked.

Two protection modes, both required by "never planned at any level":

* **Not enumerated.** A protected directory is reported as one entry and never walked, so its
  contents can never become items.
* **Whole-directory actions refused.** A directory item whose subtree contains *any* protected,
  tracked or link/device content may not be moved or purged. It is reported as `S0` /
  `action: report` with `evidence.blockedBy` and a `note`, and its unprotected children stay visible
  per item.

### Re-decided at apply time

`apply` re-runs `protectionReason()` for **every** item immediately before it touches anything, on
live state, and refuses with `status: "refused"` and `protectedBy` when the item is protected or
when its reason has changed. The plan file is a reviewable, hand-editable artifact, so an item's
`rel` is a *claim*, not a fact: without this step a hand-edited plan could move `.env`, `id_rsa` or
the sink manifest out of the repository through the documented `--confirm` flow. Git-tracked status
is re-checked in the same place and for the same reason. `apply` also refuses any `action` value it
does not recognise rather than falling through to a different behaviour.

**The action path is derived, never trusted (round-3 audit finding V2-1).** Round 2 ran the
protection check on `item.rel` while every action used `item.path`, and nothing required the two to
agree — so a forged plan whose `rel` was innocuous and whose `path` pointed at `.env`, at key
material, at the `.work/` sink or at a git-tracked file was applied with exit 0 (confirmed on all
five protected classes). `apply` now behaves as follows (`organizer.mjs:3335`):

* the target is `path.resolve(rootReal, rel)`. The plan's own `path` is never the operand;
* `rel` must be present, relative, and resolve inside the root; the root itself is refused;
* the plan's `path` may only **agree** with that derivation (letter case excepted on Windows). When
  the two disagree the item is refused with `rel and path disagree`, exit 6, and nothing moves;
* `protectionReason()` and the git-tracked re-check both run on `relNow` — the same string the
  target was derived from — so "checked" and "acted on" cannot be two different paths.

**The plan's `root` is a claim too (round-4 audit finding V4-3).** Protection is anchored to the
root, so a plan whose `root` is re-pointed at the project's **parent** re-anchors the whole model:
`segments[0] === "docs"` and `=== ".git"` stop matching, and because the parent is not a git work
tree the tracked re-check was *skipped* rather than failing closed. `docs/**`, a git-tracked file
and a nested `.git/config` were all moved at **exit 0**. Two checks close it, and both are
needed because they cover different halves:

* the git-tracked re-check now passes `requireGit`, so a root whose git state cannot be read is
  **refused** — "I cannot prove what is tracked here" no longer reads as "nothing is tracked here";
* `apply` refuses outright when the root is a **strict ancestor of a directory carrying its own
  `.git`** (`findNestedRepository`). A plan cut above a repository was not cut against the tree it
  would change, and the walk already refuses to classify a nested repository for the same reason:
  its tracked set is not visible from here.

**The nesting search is work-bounded, and running out of budget refuses (round-5 audit finding
V5-1).** Round 5 bounded this search at **six levels of depth**, and a depth bound made the guard's
miss *silent one level past its cap*: a repository at level 7 was not found, the fail-closed git
check cannot help because the plan's root **is** a repository with readable git state, and the inner
repository's `docs/**`, its tracked `README.md` and its own `.git/config` all moved at exit 0. A
depth cap was the wrong control for the risk: the exposure is unbounded **work**, not depth, and
depth is already bounded by the filesystem — links are never descended (`dirent.isDirectory()` is
false for a junction), so there is no cycle to run away from.

The search now counts directories **visited** (`DSH_ORGANIZER_NEST_SCAN_DIRS`, default 20,000) and
reports whether it was **exhausted** instead of returning a bare "not found". `apply` refuses when
it was, because *"I ran out of budget"* is not *"there is nothing there"* — the same fail-closed
rule the git re-check follows. A repository at any depth is now found and refused, and a tree too
large to search is refused rather than applied unproven.

**The protection decision runs on the canonical path, and a non-canonical `rel` is refused
(round-3 audit finding V3-1, CRITICAL — the round-3 text here was wrong).** Round 3 decided
protection on `toPosix(item.rel)` — the raw string — while acting on `path.resolve(rootReal, rel)`.
`toPosix` resolves neither `.` nor `..` and folds no case, and `protectionReason` indexes the string
(`segments[0] === "docs"`, `=== ".git"`, an exact tracked key), so for any rel that was not already
canonical those were two different paths. `rel="./docs/guide.md"`, `rel="Docs/guide.md"` (a bare case
variant) and `rel="stage/../README.md"` were applied at **exit 0 with no approval flag at all**,
reaching `move`, `route`, `settle` and — because the forger also controls `action` — an irreversible
`purge`, with the journal recording `safety: "S1"`. Every claim of the form *"checked and acted on
cannot be two different paths"* that stood here was false.

Two things fix it and both are needed (`organizer.mjs`, the `V3-1` block in the apply loop):

* **`relDecided` is canonical.** It is derived from the path the action uses and folded to the
  on-disk spelling of every ancestor (`canonicalRelFor`), so `Docs/guide.md` is decided as
  `docs/guide.md`. `protectionReason()` and the git-tracked re-check both run on that, and both
  report what they checked (`checkedRel`, `checkedPath`).
* **A `rel` that is not already canonical is REFUSED**, not silently normalised: `rel is not in
  canonical relative form`. Every `rel` the engine emits is canonical, so this rejects forgery and
  nothing legitimate; it is also what catches a case-only variant, which normalises to itself. It
  runs *after* the symlink/junction checks, deliberately: `canonicalRelFor` walks the leaf, so a
  target swapped for a junction must be caught as a link first.

A `purge` carries an explicit gate on top: the canonical target must have cleared the protected set,
the plan's class for the item must be `S3`, and that exact id must have been named with `--confirm`.

**Every source and destination passes through ONE gate: `validateOperand()` (round 5).**

Three rounds of findings had the same shape, and naming it is more useful than any single fix:
**F2** hardened `apply` and left `undo`; **V2-1** fixed apply's operand and left the canonical
form; **V3-2** fixed `undo`'s `move` arm and left its `route` arm, which is round 4's **V4-1**.
Each fix was correct; each was narrower than the invariant, because the invariant lived in a call
site instead of in one place. `validateOperand(rootReal, abs, protectionContext, options)` is now
that place. Every operand the engine is about to act on goes through it — apply's target, apply's
route destination, a settle's directory, a purge's target, `undo`'s restore source and `undo`'s
restore destination — and it decides, in this order:

1. **containment**, on the resolved path, so `..` cannot escape;
2. **type** — a symlink or junction is refused, never followed;
3. **link resolution**, when the caller asks for it, followed by a second containment check on the
   real location;
4. **canonical form** — the decision is made on the canonical path, and a caller that supplies the
   claimed `rel` gets a refusal when the string is not already that canonical form;
5. **the protected set**, and the git-tracked re-check, both on the canonical form.

It returns `{ reason, relDecided, realAbs }`; `reason === null` means the operand may be acted on,
and the caller must act on `realAbs` so that what was checked is what is used. **A new arm that
calls it inherits all five checks by construction.** The residual risk is a new arm that does not
call it; the harness asserts each arm's behaviour individually (`G16`–`G24`), which is how the next
gap should be caught.

Four options exist because of specific findings, and they are the only places a caller relaxes the
default: `allowMissing` (a route destination and a directory about to be created are *expected* not
to exist), `followLinks` (apply's target is judged at the location the file is really at, which is
what closes V4-3), `requireGit` (the git-tracked re-check **fails closed** — before round 5 a root
whose git state could not be read simply skipped it, so "I cannot prove what is tracked here" read
as "nothing is tracked here"), and **`containerRoot`** (below).

**`containerRoot`: an out-of-root operand is a different containment root, not a skipped rule
(round-5 audit finding V5-3).** A `move` entry's restore source legitimately lives in the engine's
sink, outside the repository. Round 5 expressed that as *"the sink rule is its location rule"* with
a hand-rolled `isLinkOperand` beside it — and a location rule without the type rule next to it is
precisely the shape of V4-2, and then of V5-2 at the prune root. Copying that pattern is how the
defect would come back. Now the caller passes `containerRoot: <the journal's sink>` and the **type,
missing and canonical rules all run unchanged**; only the protected set is out of scope, and that is
named in the options (`skipProtection: true`) rather than implied by not calling the gate. The
hand-rolled rule is deleted, and the prune walk's root goes through the same gate with the sink as
its container. **The one check that still does not go through the gate is named below**, not left to
be discovered.

### What each guarantee actually covers

Stated per arm, because a guarantee that is only true of one arm is how this build has failed
three times. All of these are asserted in `tools/organizer-test.mjs`; the check ids are named so a
reader can confirm the claim rather than trust it.

| operand | containment | link refused | canonical form | protected set | git-tracked | asserted by |
| --- | --- | --- | --- | --- | --- | --- |
| apply's target (`move`) | yes | yes | yes | yes | yes (fails closed) | `G14`, `G16`, `G17`, `D9` |
| apply's target (`purge`) | yes | yes | yes | yes | yes (fails closed) | `G16`, `G17`, `E4` |
| apply's target (`settle`) | yes | yes | yes | yes | yes (fails closed) | `G5`, `G16` |
| apply's route destination | yes | yes | yes | yes | yes | `G3`, `G8` |
| undo's source (`move`) | sink is the container | yes | yes (no claimed rel) | out of scope (named) | n/a | `G18`, `G20` |
| undo's source (`route`) | yes | yes | yes (no claimed rel) | yes | n/a | `G18` |
| undo's destination (`move`) | yes | parent only | yes | yes | n/a | `G15`, `G18` |
| undo's destination (`mkdir`) | yes | parent only | yes | yes | n/a | `G18` |
| **the prune walk's root** | sink is the container | **yes (leaf and ancestors)** | yes (no claimed rel) | out of scope (named) | n/a | `G19`, `G24`, `G25` |

**The one remaining named exception:** the restore destination's **parent** link check
(`restore parent is a link (never followed)`) is a hand-rolled rule, not a gate call. It asks a
narrower question than the gate — *"would this restore be written through a link?"* — and it cannot
become a gate call unchanged, because a restore directly into the root has the root as its parent
and the gate rightly refuses a containment root as an operand. It reuses the same `isLinkOperand`
predicate, so the file has exactly one definition of "this is a link". The destination itself is
gated on the next line, and the destination's own leaf link is refused by the gate's type rule — so
the qualifier *"parent only"* in the table above means "the last segment is covered by the gate, and
this extra rule covers the directory it lands in".

**What this buys, precisely — and where it stops.** A forged plan or journal can no longer import a
file from outside the sink, displace a protected file into another directory, recreate a protected
directory, act on a protected target through a non-canonical `rel`, act on a root that nests another
repository **at any depth**, act at all when the plan's root was not the tree the plan was cut
against, or delete anything outside its own sink through a link at the prune root. Each of those is
refused at exit 6 with nothing touched, and each has a failing assertion behind it. The nesting
claim is unqualified because its guard is now work-bounded and fails closed rather than
depth-bounded and silent — **round 5's version of this paragraph said "at any depth" while the code
stopped at six levels, and the audit falsified it at level 7.** It is **not** a claim that a journal
cannot be forged at all: a forged entry whose `rel`, inverse, source and destination all describe a
genuine sink copy of an ordinary file will still restore that file, because that is exactly what an
honest entry looks like. The engine authenticates the *shape* of the operation, not the provenance
of the file. And it is not a claim that the gate cannot be left out: one check is still hand-rolled
and named above, and the guard layer — the nesting refusal, the git fail-closed, the search budget —
is asserted behaviourally by `G23`, not by reading the source.

---

## 5. Classification

`kind` is decided by an ordered rule table — first match wins — and every item records the rule that
matched (`rule`), the evidence behind it (`evidence.signals`), and the raises applied (`raisedBy`).
Name patterns are evidence, never the whole decision; every name-based rule also requires the git
state to be untracked/ignored, and three of them require a content probe.

| kind | evidence required |
| --- | --- |
| `test-artifact` | a test-output directory segment (`test-results`, `coverage`, `playwright-report`, `artifacts`), or a `*-check.*` / `screenshot-*` / `capture-*` name that git does not track |
| `test-content` | a **content probe over the file head** (`DEFAULT_LIMITS.headBytes`) that names a test framework or runner, on an untracked file outside the test tree. See "Test content" below |
| `empty-dir` | a directory with no entries, or one whose every entry this same plan is already moving out. See "Empty directories" below |
| `scrape-raw` | a parent directory marker (`_raw`, `raw`, `scrape(s)`, `_captures`) **and** a payload probe: JSON with request/response keys, an HTML document (challenge pages are labelled), a binary blob, or a payload extension that is not a source extension |
| `junk-named` | a name pattern (`agent-scratch-prefix`, `part-scratch-prefix`, `untitled`, `editor-lock`, `finder-copy`, `duplicate-suffix`, `temp-extension`, `run-output-extension`, `runtime-dump`, `check-artifact`, `capture-artifact`, `log-file`, reserved device names) **and** untracked/ignored. The root-only variants are marked as such: `dsh-parity-audit` inside `tests/` is a test suite, `dsh-scan-asar.cjs` at the root is agent scratch |
| `build-output` | a build/cache directory segment (`dist`, `build`, `out`, `coverage`, `.next`, `.cache`, `target`, `test-results`, …), a generated extension (`.map`, `.tsbuildinfo`, `.pyc`, `*.min.js`), or a live-runtime prefix (`public/build`, `bootstrap/cache`, `storage/framework`, `storage/logs` — these become `runtime-cache`) |
| `backup` | a **file** inside a backups directory, or a backup name pattern (`*.bak`, `*~`, `*.sql.gz`, `*-backup*`, dated archives), with age, size and retention class |
| `untracked-work` | untracked content no other rule explains — reported with a `landHint`, never a removal candidate |
| `ignored-other` | ignored content with no recognised regenerable marker: an owner decision, `action: report`. Root-level dot-directories and ignored configuration files inside a source tree are `kept` by policy instead |

The rule table is ordered, and two orderings are load-bearing:

* `test-content` is evaluated **before** `build-output`, so a test file that happens to sit under
  `dist/`, `coverage/` or a live-runtime prefix is recognised as a test and never planned as
  regenerable output. That is what keeps a test from shipping as a deletion candidate.
* A git-tracked file never reaches classification at all (it is protected), so "tracked wins" over
  the content probe is enforced by the protected set rather than by the probe.

### Test content

A file that was never *named* as a test but whose **content** is for testing does not belong in a
production build, so the engine detects it from the file head alone:

| stack | strong signals (decide) |
| --- | --- |
| PHP / PHPUnit / Pest | `use PHPUnit\`, `extends TestCase`, `public function test` |
| JS / TS | `describe(`, `beforeEach(`, `jest.`, `vitest`, `@testing-library`, `cypress`, `playwright` |
| Python | `import pytest`, `def test_`, `unittest` |
| PowerShell | `Pester`, or the framework's own block cmdlets with a quoted name — `Describe 'x' {`, `Context 'x' {`, `It 'x' {` |

**PowerShell needs the block form, not just the word (round-3 audit finding V2-3).** An idiomatic
Pester v5 test is `Describe 'x' { It 'y' { $v | Should -Be 1 } }` and frequently never contains the
literal token `Pester` at all — usually only a comment mentions it. Round 2 required that token, and
its weak marker was `-Should` (a **leading hyphen**), which is not Pester's assertion syntax and
matched nothing Pester ever writes. A real Pester test was therefore not detected, not routed and
not even listed as `unsure`. The signals are now `powershell-pester` (`\bPester\b`, the framework
named outright), `powershell-describe-block` and `powershell-it-block`, which require a **quoted
name** after `Describe`/`Context`/`It` — the shape Pester actually uses, and a shape ordinary
PowerShell does not produce (a cmdlet invocation takes no quoted block). `Should -Be` / `Should -Not`
is recorded as the weak `powershell-should` signal, so it corroborates a block but never decides on
its own — a production script that merely happens to define a `Should` function is not reclassified.

Weak signals **corroborate and never decide**: bare `it(`, `test(`, `expect(`, `->assert`, a Python
`assert`, `Should -<Parameter>`, a shebang plus probe-style body, and the ordinary diagnostic cmdlets
`Invoke-RestMethod` / `Invoke-WebRequest` / `Invoke-Expression` / `Invoke-Command`. A file whose
only signal is weak **keeps its existing rule** (normally `untracked-work` / `report`); the probe is
still recorded in `evidence.testProbe` and in `evidence.signals` as
`content-probe:weak-only:<signal>`, so the report explains itself rather than looking clean by
omission. The uncertainty is expressed as *no reclassification*, which is what makes an ambiguous
hit impossible to remove.

The probe runs **once**, before the build-output and junk-named rules, and that position is
load-bearing in both directions:

* **before `build-output`** — a test file under `dist/` or `coverage/` is recognised as a test and
  never planned as regenerable output;
* **before `junk-named`** — a file that carries a junk name *and* looks like an uncertain test still
  reaches the probe. The name is why it is a removal candidate, so a weak hit does not veto it, but
  the hit is recorded, the item's reason discloses it, and the item is listed as `unsure`. Without
  this position the probe was evicted by the junk-named return, which made the uncertainty
  invisible on the one class of item the engine actually moves.

Both the scraper and backup rules still run first: a file that is already classified as a backup or
a raw payload is explained by stronger evidence, and a weak probe hit inside it is not recorded.

That split is deliberate and was corrected once: `Invoke-RestMethod` was originally a STRONG signal,
which meant a production deploy script or health check whose only "test-like" feature was an HTTP
call got classified as `test-content` and proposed for relocation into the test tree (reported, S2,
reversible — but still the wrong decision). Strong means *names a test framework or runner*; a
cmdlet name is not one.

Dispositions, and never anything else:

* **clearly a test and the project has a test tree** → `action: route-to-test-tree`, `safety: S3`
  (a route changes where a file lives, so it is S3 from the start — see below), `minLevel: standard`,
  destination `tests/<area>/<module>.test.<ext>`, recomputed from the source file at apply time. It
  needs `--confirm <id>` naming that item, the
  journal inverse moves it back, and `undo` restores it byte-for-byte. It is **never** a sink move
  and **never** a purge.

**The route class is S3 (round-3 audit finding V2-2).** Round 2 emitted routes at `S2`, so a single
batch `--approve-s2` relocated any number of files out of the application tree, while this document
and the doctrine both promised a per-item confirmation. The cause was structural: the route raise sat
inside a branch only `MOVE`/`PURGE` could reach, which made its `ROUTE` arm dead code. Routes now
enter that branch (`organizer.mjs:1954`) and additionally carry an unconditional floor to S3
(`organizer.mjs:1993`, recorded in `raisedBy`/`signals` as `route-changes-where-the-file-lives`) so a
route is never S2 on any host, with or without a trash CLI. The no-trash raise is reachable for
routes and recorded as `no-trash-tool` when it fires. **The code is the source of truth for this
class**; this section describes it, and the harness asserts it (`G8`, `G11`).
* **no strong signal** (weak only, including a lone `Invoke-RestMethod`), **no test tree, or the
  destination already exists** → the file keeps its existing rule — normally `untracked-work` /
  `report`, S0 — with the weak signals recorded in `evidence.testProbe` and a
  `content-probe:weak-only:<signal>` entry in `evidence.signals`. It is never routed, never a sink
  move and never a purge, and it is listed in the plan's `unsure` section (see §7).
* Two items that resolve to the same destination are both demoted to `report` — a rename onto an
  occupied path is a data-loss shape, so file order must never decide which one survives.

Honest limit: moving a test file can break its relative imports. The item carries a note saying so,
and the runner must collect the file afterwards; the engine does not rewrite imports.

### Empty directories

An empty folder that nothing uses any more is settled, because the owner authorised it: `kind:
empty-dir`, `action: settle`, **S1** (no `--approve-s2` and no `--confirm` — the removal is
journalled with a `mkdir` inverse, so `undo` recreates the directory), `minLevel: light`.

A directory qualifies when it is empty now, **or** when every entry beneath it is itself being
moved, purged or settled by the same plan. Settles run in a second pass after all moves, deepest
first, and at apply time the directory must *still* be empty (`rmdir`, never a recursive remove). A
directory is **not** `empty-dir` when it is protected, contains a tracked file anywhere beneath it,
is a mount/junction point, is a sink directory, is one of the framework's required directories
(`storage/framework/{cache,sessions,views}`, `storage/app/public`, `bootstrap/cache`), is a parent
of anything the plan keeps or reports, or is one of the plan's own declared route destinations. A
`.gitkeep`-only directory is **not** empty: the placeholder is deliberate.

### Backup retention — keep-latest

Backups are grouped into families (digits and separators normalised) and sorted by mtime, with the
relative path breaking ties so "the newest copy" is never decided by readdir order. The policy is
one `keep`, at most one `previous`, and `supersede` for the rest:

| role | disposition | meaning |
| --- | --- | --- |
| the newest copy | `keep` | it is the backup |
| the copy immediately before it | `keep`, `retentionRole: "previous"` | the fallback, kept until a restore drill verifies the newer copy |
| every older copy | `supersede` | quarantined, S3, confirmed per item by name |

**At most one copy per family carries `previous` (round-3 audit finding V2-4).** In a family with no
restore evidence every older copy is retained, and round 2 labelled *all* of them `previous`, so a
reader — or a script — filtering on `retentionRole === "previous"` saw several fallbacks where the
doctrine allows one, and the item-level field contradicted the family-level `previous`.
`retentionRole` is now exactly `keep` for the newest copy, `previous` for the fallback, and `null`
for every other retained copy (`organizer.mjs:2366`). A copy retained only because the family has no
restore evidence is kept, but it is **not** a fallback and does not claim to be one. The number of
`previous` items across a plan therefore equals the number of families naming a fallback, and the
harness asserts it (`B12c`).

Both safety rules are absolute:

* **Never remove the only copy of a family.** A sole copy is `keep`, whatever its age or size, and
  never reaches the archive question.
* **Never remove a copy when the newer one has no restore evidence.** With nothing verified in a
  family, the newest copy *and* the copy before it are both kept, and every older copy is kept too
  — nothing in that family is proposed for removal at all. "I cannot prove the new backup restores"
  must never be answered by deleting the old one. This is the default on a host that has never
  recorded a drill, and it is why the engine proposes no backup removals until evidence exists.
* An oversize backup is **never** purged by the engine — it is downgraded to `archive` and says why,
  even under `--purge`, because a backup is the owner's only copy of something.

**Restore evidence.** The engine never restores a backup to test it, so "verified" can only ever
mean a drill somebody recorded. That record is an optional file
`<state>/roots/<hash>/restore-evidence.json`:

```json
{ "schemaVersion": 1, "root": "C:\\path\\to\\repo",
  "verified": { "backups/db-2026-09-01.sql": { "drilledAt": "2026-10-01T00:00:00Z", "target": "scratch db" } } }
```

The key may be a single file's rel path or a whole family name. With no file, every copy is
unverified and the policy keeps.

**A quarantine move does not free disk space.** The bytes stay in the sink until the owner deletes
them, so `plan --purge` exists for regenerable backups: it turns a `supersede` move into an
irreversible purge, which *is* the only thing that reclaims bytes. The plan's `retentionPolicy`
block states this in its own words, reports `freesDiskSpace`, and gives per family the keep, the
previous, the count becoming removable and the bytes involved.

A `keep`/`archive` disposition is a policy decision and accounts for the item; a `supersede`/`remove`
**proposal** stays `pending`, so the gate cannot close itself without something having happened.

---

## 6. Reviewability rules

A raw file listing is not a plan, so three rules keep the output readable without hiding anything:

1. **Directory items cover their subtree** when the directory is actionable, or when every artifact
   beneath it has the same kind (one owner decision instead of one per file). Children covered this
   way are counted in `evidence.childCount` / `evidence.subtreeBytes` and marked
   `evidence.coversSubtree`.
2. **Container directories are dropped.** A directory that only holds *other* kinds — a `backups/`
   directory full of individually classified backup files — is not itself a finding; its children
   carry the information. This is why a 15 GiB backups directory is never reported as one
   "backup".
3. **Aggregation.** When ≥25 planned items in one directory share kind, class, action and level, and
   no protected content sits beneath, they collapse into one item carrying
   `evidence.aggregate: { count, bytes, members, omitted }`.

Removal candidates additionally get a **reference check**: one `git grep -l -F -f <patternfile>`
over the tracked tree (patterns and results live in the engine state dir, never in the repository),
then the matched files are read to attribute each hit. `.gitignore` and its siblings are excluded —
a file that names paths in order to *exclude* them is not evidence of use. For kinds where a
reference means "this file is used" (`junk-named`, `ignored-other`, `scrape-raw`, `backup`,
`untracked-work`) a hit demotes the item to `report`/S3. For generated output the reference is
recorded as `evidence.referenceNote` instead, because a build script *must* name the directory it
produces. If the check cannot run at all, candidates are raised a class and carry
`evidence.referenceCheck: "not-run"` — a check that did not happen never reads as clean.

---

## 7. State, sink and journals

Everything the engine writes at run time lives outside the repository, under a per-root state
directory:

```
<state>/roots/<rootHash10>/
    plans/          plan JSON files (when --out is not given)
    sink/<runStamp>/<relPath>    quarantined items, original relative layout preserved
    journals/journal-<planId>.json   every action with its inverse
    tmp/            git-grep pattern files
    session.json    the session record (read-only for the engine)
    dispositions.json   owner decisions from `disposition --set`
    restore-evidence.json   optional restore-drill records that make a backup "verified"
```

* Default `<state>` is `%USERPROFILE%\.dsh\organizer`; `DSH_ORGANIZER_STATE` overrides it.
* `apply` **moves** by default: `renameSync` first (same volume: free and atomic), and only on
  `EXDEV`/`EPERM`/`EACCES`/`EBUSY` does it fall back to copy + delete, recording which method was
  used. A read-only file gets its bit cleared only if the rename requires it, and the change is
  recorded so `undo` restores it. Nothing in the repository is ever the engine's own scratch.
* **Session record** (`<state>/roots/<hash>/session.json`, or `DSH_ORGANIZER_SESSION_RECORD`):

  ```json
  { "schemaVersion": 1, "root": "C:\\path\\to\\repo", "created": ["rel/file.tmp", "rel/dir"] }
  ```

  It is how "this run's own record created it" becomes evidence, and therefore how S1 is reached.
  The engine only reads it; the skill instructs the agent to append what it creates.
* **Journals** are immutable-by-append: `undo` rewrites the same file with `undoStatus: "restored"`
  per entry, so a second `undo` reports `already-undone` instead of restoring twice. Applied state is
  resolved per item **by timestamp**, never by file order, so journals cannot disagree. A journal is
  still a hand-editable file, so every entry is validated at `undo` time as described in §4, and
  `undo` exits **6** when it refuses one.
* **Sink housekeeping.** After a restore, `undo` removes the empty directories the restore left
  behind, deepest first, including the run directory itself — but only when the journal's `sinkDir`
  is strictly inside the sink this engine derives for the journal's root. Round 3 shipped a prune
  that could never delete anything (`rmSync(dir, { recursive: false })` throws `ERR_FS_EISDIR`, and
  the empty `catch` swallowed it) while its comment claimed it pruned; the call is now `rmdirSync`,
  which succeeds on an empty directory and fails loudly on a non-empty one. The unvalidated
  `sinkDir` that the dead code made harmless is now validated before it is used for anything
  (round-3 audit finding V3-5). **Round 5 validated that root for location only, never for type**,
  so a junction planted at that exact position was walked *through* and `rmdirSync` deleted empty
  directories behind it — outside every containment root, unrecoverably; child links were always
  skipped correctly, and the asymmetry was only at the root (round-5 audit finding V5-2). The root
  now goes through `validateOperand` with the sink as its container, so the type rule applies to it
  like every other operand, and an unprunable root simply skips housekeeping.
  **Round 6's version of that fix checked the LEAF only, which left the same defect one path
  component up** (round-6 audit finding V6-1): a junction at `<sinkRoot>\linkanc` with the journal
  naming `<sinkRoot>\linkanc\j1` passes a leaf test *and* the lexical containment test, so the walk
  still deleted empty directories behind the junction. The prune call therefore passes
  `followLinks: true`, which resolves the **whole** path and re-checks containment on the real
  location; for an honest sink the path resolves to itself, and a host whose state directory is
  itself reached through a link merely skips the prune rather than failing. The general rule worth
  keeping: **a `containerRoot` operand inherits the gate's leaf type rule, and needs `followLinks`
  to inherit the ancestor one** — the leaf is not the whole path.
* **Owner decisions** (`dispositions.json`) are keyed by the stable item id and honoured by `plan`:
  `kept`/`accepted`/`deferred`/`landed` suppress the action at every level; `removed` re-plans the
  action and leaves the gates intact.

### Dispositions

`disposition --root <dir> --level <level>` prints every in-scope item with exactly one disposition
and exits 6 while anything is unaccounted for.

| disposition | decided by | meaning |
| --- | --- | --- |
| `kept` | owner, or policy (tool config, a backup inside its window) | it stays; no action |
| `removed` | journal (an applied action), or owner | it is gone; a journal entry proves it |
| `landed` | owner | it now lives at its proper home |
| `deferred` | owner, or the level | a deliberate "not now"; a level deferral is the level's scope, stated with the item's `minLevel` |
| `accepted` | owner | the risk is accepted on the record, with a reason |
| `pending` | nobody yet | **unaccounted** — the only state that fails the gate |

A level deferral applies when the requested level does not *reach* the item (`minLevel` above the
level). It is not a deferral when the level reaches an item that has no action: that is the owner's
decision to make and it stays `pending`. Items already removed are reported separately as `settled`,
and an item that was removed but is present again is reported with `present on disk again
(regenerated since removal)`.

### Item shape

Every command emits the same item view, so `inventory`, `plan`, `apply` and `disposition` can never
disagree about what an item is:

```
id, rel, path (absolute), type, kind, rule, reason,
safety + class (identical), raisedBy, action, minLevel, levelState, planned,
disposition, dispositionSource, dispositionReason,
size, mtime, ageDays, retentionClass, evidence, fingerprint, fingerprintSummary,
shell + shellExecuted:false, routeTarget, retentionRole, restoreVerified, landHint, note
```

Round 2 added three fields to that view: `routeTarget` (the absolute destination of a
`test-content` route, or null), `retentionRole` (`keep` | `previous` | null on a backup row) and
`restoreVerified` (whether a recorded drill covers that copy or its family). It also added `unsure`
plus `unsureReason`: the doctrine's third class, set when the content probe found only weak signals.
An `unsure` item is never planned, stays on disk, and is named in the plan's `unsure` section.

### `unsure` — looked at, not classified

The doctrine classifies an artifact as `disposable`, `keep` or `unsure`, and requires the plan to
carry an "unsure, deferred" section. **The word carries two meanings and they are not the same, so
this contract states which one it uses.** The doctrine's *wide* class is "provenance or referencing
unknown", which in this engine is a `kind` plus a disposition: an item no rule explains is
`untracked-work` with `action: report` and disposition `pending`, and it surfaces under its own kind,
not in the section below. The *narrow* meaning is the flag this engine emits: the content probe read
the file, found only weak evidence, and deliberately did not decide.

`data.unsure` is therefore **not a census of everything uncertain** — it is the narrow set, and an
item appears in it only when the probe actually read the file. The engine emits that section on
every plan (even when empty), and flags each such item with `unsure: true` and an `unsureReason`.

The flag is **evidence-based, never class-based** — a strong-signal `test-content` item carries no
`unsure`, and a weak hit on a *reported* class carries it just as a weak hit on a move candidate
does.

`unsure` records that the probe could not decide; it does **not** mean "left in place". The
`unsureReason` therefore states what the plan actually does with the item:

* a **planned** item (for example a junk-named file that is a per-item-confirmed move) says so, and
  points at the item's own `reason` for what proposes it;
* an **unplanned** item says it is not planned and stays on disk for the owner to decide.

Without that distinction a `--json` reader would be told "kept on disk" about an item the plan
proposes to move, which is the opposite of the truth.

The same "recorded, not acted on" shape applies to the `protected` section: an item the engine could
not classify is visible output, not a silent omission.

Note the distinction from ordinary work: a file that no rule explains at all is ordinary
`untracked-work` and is **not** `unsure`. Only a file the probe actively read and could not decide
about is `unsure`.

`id` is `it-<sha256(relPath.toLowerCase())[0..10]>` — stable across runs, so `--set` and `--confirm`
keep working after a re-plan.

---

## 8. `doctor`

`doctor` reports the host facts that change planning, and exits 6 only when a *required* tool is
missing:

* `git` — its version, or `MISSING` (then tracked protection cannot be established and classes are
  raised one step);
* the trash probes (`trash`, `trash-put`, `gio`, `recycle`) with the version each one answered;
* the consequence of a missing trash CLI, stated as a finding, plus the sink location that provides
  the recovery path instead;
* platform, node version, state directory, and the effective limits.

---

## 9. Environment knobs

| variable | default | effect |
| --- | --- | --- |
| `DSH_ORGANIZER_STATE` | `%USERPROFILE%\.dsh\organizer` | state root: plans, sink, journals, session record, decisions, restore evidence |
| `DSH_ORGANIZER_SESSION_RECORD` | `<state>/roots/<hash>/session.json` | the session record file to read |
| `DSH_ORGANIZER_MAX_HASH_BYTES` | 32 MiB | above this, hashing is documented-partial instead of whole-file |
| `DSH_ORGANIZER_MAX_SINK_BYTES` | 256 MiB | above this an item cannot be quarantined: class raised, non-backup action becomes `purge` |
| `DSH_ORGANIZER_MAX_WALK` | 200000 | walk cap; hitting it truncates the scan and the run reports failure instead of pretending completeness |
| `DSH_ORGANIZER_AGGREGATE_MIN` | 25 | planned items in one directory needed to collapse into one item |
| `DSH_ORGANIZER_NEST_SCAN_DIRS` | 20000 | directories the nesting search may visit before it gives up; reaching it **refuses the plan** rather than applying it unproven (V5-1) |

**Two things to know before you "raise the budget" (round-6 audit observation V6-3).** The refusal
message tells an operator to raise this value, so the parsing is worth stating. Everything that is
not a finite non-negative integer falls back to the default: empty, `abc`, and negative values all
mean 20,000. Two values are surprising and both were measured across seven inputs — every one of
them fails **closed**, and none turns a refusal into a silent pass:

* `"0"` is a **real budget of zero**: the search cannot visit anything, so every plan is refused
  until the variable is removed or set higher.
* `"1e9"` parses as **1**, not a billion — `Number.parseInt("1e9", 10)` stops at the `e` — so a typo
  intended to *raise* the budget tightens it to one directory instead.

Both refuse and both name the budget and the variable, so they are diagnosable rather than silent.
Treat the knob as a decimal integer only.

There is no knob for the restore-evidence file: it is read from
`<state>/roots/<hash>/restore-evidence.json`, and its absence is a valid state meaning "nothing is
verified" (see §5).

---

## 10. Running the tests

```
node <plugin>/tools/organizer.mjs …        # the engine
node <plugin>/tools/organizer-test.mjs     # the harness (add --keep to keep the fixture)
```

The harness builds a throwaway git repository under the system temp directory — never inside a real
project — containing junk-named files, a tracked file, a `.env`, key material, `docs/`, `vendor/`,
`node_modules/`, `storage/app/`, a raw scrape directory, build output, two backup families with
restore-drill evidence for one of them, untracked real work, a read-only file, a >260-character
path, a reserved device name (`NUL.css`), a path over the quarantine cap, 30 files for the
aggregation rule plus a `.gitkeep` that keeps their directory out of the settle path, an empty
directory, a directory emptied only by the plan's own moves, a `.gitkeep`-only directory, the
doctrine's own `.work/` sink, test-content files across four stacks, an ambiguous weak-only file, a PowerShell deploy script and
health check that must NOT be routed plus a real Pester test that must be, a
blocked directory holding protected content, a junction that escapes the root, and files that drift
between plan and apply. It then drives the CLI as a child process and asserts the real behaviour of
every gate, including negative cases (a **forged plan that re-points an item at `.env`, `id_rsa`,
`docs/`, `node_modules/` or `storage/app/`**, a **forged plan whose `rel` is not in canonical
relative form — `./x/../y`, `a/b/../../y`, a case variant, and the same with the `path` field
deleted — against move, route, settle and purge**, a forged unknown action, a forged route escaping the
root, a **forged journal that imports a file from outside the sink, displaces `.env` into `docs/`,
or recreates a protected directory**, a `--confirm` for the wrong id, a drifted item, a recreated
destination, a purge that cannot be
restored, a reference that must not count, a case-mismatched tracked file, and the cases where
the new capabilities must refuse).

Captured output: `tools/organizer-test.txt` — **101 assertion blocks passed, 0 skipped, 0 failed**
(`node v24.15.0`, `win32`). Exit code 0; non-zero if any assertion fails. Round 1 shipped 72 blocks,
round 2 shipped 87, round 3 shipped 90, round 4 shipped 94, round 5 shipped 98, round 6 shipped 99,
round 7 ships **101**: `G25` (a junction that is an *ancestor* of the sink root is never walked
through, V6-1) and `G26` (a nested repository behind an unreadable directory is refused, not assumed
absent, V6-2). Both assert the honest case beside the refusal — `G25` re-runs an honest apply/undo
and requires the emptied run directory to be pruned, and `G26` requires the file inside to survive —
so neither can be satisfied by disabling the feature it guards.
**Whether a round-1 assertion was weakened is not verifiable from this tree** — the round-1 harness
is not on disk, so the 72→87→90→94→98→99→101 delta cannot be diffed, and this document does not
claim it was.

**Coverage is stated per SHAPE and that has not been enough — it has to be per ARM, and a source
regex is not coverage at all.** Round 3's assertions could not see the V3-1 class (a minimal revert
of the canonicalisation left the suite at 2 failures, because `G14` forged a `rel`/`path`
*disagreement* and never a `rel` whose canonical form differs). Round 4's could not see the V4-1
class for the same reason one level down: `G18` built every forged entry by spreading an honest
**`move`** entry, so no assertion touched the `route-to-test-tree` arm, and the engine scored
**94/0/0 while that arm was open**. Round 5 then asserted its two V4-3 guards by **regular
expression over the engine source**, so lifting one of them left the suite failing `G23` alone —
the guard had no behavioural test at all (V5-4). `G18` now exercises both journal arms explicitly,
`G23` drives all three guard behaviours, and `G22` is the control that stops any of it passing by
refusing everything.

The ablation is recorded rather than asserted. Round 7's own, against an engine with only the
round-7 changes lifted (the prune gate back to a leaf-only type check, and an unreadable directory
back to a silent skip):

```
# engine with only the round-7 fixes lifted, harness unmodified
node run-ablation-v7.mjs <ablatedDir>       # evidence\repro-v7\ablation-round7.txt
  harness exit: 1   FAILED: 2 of 101 assertion(s) failed
  FAIL G25 ... FAIL G26 ...
  round-7 assertions that FAILED against the ablated engine: G25, G26
  control (G22) green, as it must be
```

**And each round-7 fix was lifted on its own** (`evidence\repro-v7\ablation-isolation.txt`):

```
both lifted        FAILED: 2 of 101 — G25, G26
only V6-1 lifted   FAILED: 1 of 101 — G25      (G26 stays green)
only V6-2 lifted   FAILED: 1 of 101 — G26      (G25 stays green)
control (G22) green in all three
```

Round 6's ablation, kept as the baseline this round is measured against
(`evidence\repro-v6\ablation-round6.txt`): `FAILED: 2 of 99`, failing `G23`, `G24`, control green.
Round 5's (`evidence\repro-v5\ablation-round5.txt`): `FAILED: 4 of 98`, failing `G18`, `G20`, `G21`,
`G23`, control green.

**One comment was corrected rather than a behaviour changed (round-4 audit finding V4-5).** The note
above `canonicalRelFor` said *"the leaf keeps the name the plan gave it"*, which described the
opposite of what the code does: the leaf is folded to its on-disk spelling when it resolves
(`foldedLeaf = path.basename(leafResolved)`), and it is that folding which makes the caller's
canonical-form comparison see a mismatch for `rel="readme.md"` against `README.md`. The effect was
always the safe direction — the audit confirmed the refusal — so this is precision, not a fix, and
it is recorded here so the comment is not mistaken for a specification of the older behaviour.

The end-to-end attack captures back the same assertions up (all UTF-8 with no BOM):

```
repro-v7-before.txt   engine with ONLY the round-7 changes lifted (the round-6 engine):
                      2/2 attacks ACTED at exit 0 — a junction that is an ANCESTOR of the
                      journal's sinkDir let the prune delete an empty directory outside every
                      root, and a nested repository behind an unreadable directory was applied
                      over, quarantining a file out of a repository the plan was not cut against
repro-v7-after.txt    the same two on the shipped engine: the outside tree is intact and the
                      unreadable directory refuses the plan at exit 6, naming the directory
repro-v6-before.txt   engine with ONLY the round-6 changes lifted (the round-5 engine):
                      7/10 attacks ACTED — an inner repository at nesting level 7 and at level 8
                      had its docs/**, its tracked README.md and its own .git/config moved at
                      exit 0 (3 target classes x 2 depths), and a junction at the sink-root
                      position let the prune delete an empty directory outside every root
repro-v6-after.txt    the same ten on the shipped engine: 10/10 REFUSED or left intact — the
                      nesting is refused at level 2, 7 and 8, and the outside tree survives
```

Round 5's capture, kept because it is the shape this round's material was built from
(`evidence\repro-v5\`):

```
repro-v5-before.txt   engine with ONLY the round-5 changes lifted:
                      6/6 attacks ACTED at exit 0 — the route-arm journal imported an out-of-root
                      file and displaced .env, a junction inside the sink was imported as a link,
                      and a plan re-rooted at the project's parent moved docs/**, a tracked file
                      and a nested .git/config
repro-v5-after.txt    the same six on the shipped engine: 6/6 REFUSED with the target intact,
                      and the .env basename control still refused
```

Capture it byte-exactly — do **not** use a shell redirect. Windows PowerShell's `>` writes
UTF-16LE (with a BOM), which turns a text artifact into a double-byte one without any visible error;
Node writing the file directly reproduces the run. This was not theoretical: a round-3 measurement
capture written with `>` came back as UTF-16 and could not be parsed:

```
node -e "const{openSync,closeSync}=require('node:fs');const{spawnSync}=require('node:child_process');const fd=openSync('organizer-test.txt','w');const r=spawnSync(process.execPath,['organizer-test.mjs'],{stdio:['ignore',fd,'inherit']});closeSync(fd);process.exit(r.status??1)"
```

The captured file is therefore valid UTF-8, without a BOM, with LF line endings, and holds one
`PASS ` line per assertion plus the summary. Its SHA256 is **not** stable run to run, because every
report header names the throwaway fixture directory; the reproducible facts are the assertion counts
and the exit code, not the digest. Closed with the round-7 capture (re-measured, not remembered):

```
bytes=13815  sha256=D07561D6A8577BB20B3D26FA7D058C0B4AF984920916846A9BA9DB8AB30693CF
bom=none  nul=false  crlf=false  PASS lines=101  FAIL lines=0  exit=0  elapsed=191.1 s
```

The elapsed time roughly doubled at round 7 (92.6 s → 191.1 s) because `G26` sets and reverts a real
ACL on a temporary directory, and `G25` creates a junction. That is deliberate: a fixture artefact
that cannot reproduce the condition it describes is not a test.

```
node tools\organizer-test.mjs         # 101 passed / 0 skipped / 0 failed, exit 0
```

---

## 11. Measured against the owner's repository (2026-10-12, round 7)

Every number in this section is a **measurement, not a memory**: the commands below were run
against `C:\xampp\htdocs\root-ai` on **2026-10-12** with the engine at SHA256
`B07CFAF514879D6ED85B4302B90918F96A1D314B632B81E774154EEC9061907C` (209,987 bytes), state dir
redirected to a throwaway directory in `%TEMP%` so the repository was only read. Re-running the same
three commands reproduces these numbers for an unchanged tree; `planId` changes if any item's
rel/kind/class/action/planned changes.

**The evidence folder lives inside the tree `plan` walks, so this count is a snapshot of one tree
state and moves whenever an evidence file is added.** The capture below was taken with **256 files**
under `tests\organizer-skill\evidence\`; round 3's audit found the same effect (its own bundle moved
the count) and reported it as V3-6, and every round since has done it again. **The planId and the
item count belong together and neither is a constant** — quote them with the file count or not at
all. The auditors' bundles are the bulk of the movement: `audit-v3\out\`, `audit-v4\out\`,
`audit-v5\out\` and `audit-v6\` each add an aggregated directory to the planned set. Reproduce with:

```
set DSH_ORGANIZER_STATE=<throwaway dir>
node tools\organizer.mjs inventory --root C:\xampp\htdocs\root-ai --json                              exit 0, 5.4 s
node tools\organizer.mjs plan --root C:\xampp\htdocs\root-ai --level standard --scope repo --json     exit 0, 4.5 s
node tools\organizer.mjs plan --root C:\xampp\htdocs\root-ai --level deep     --scope repo --json     exit 0, 4.2 s
```

Nothing was applied: no `sink/` and no `journals/` directory exists for this root, because `plan`
and `inventory` never create one.

| measurement | value |
| --- | --- |
| discovered / artifacts / actionable | 2321 / 1220 / 640 |
| litter items / backup items / untracked-work items | 649 / 173 / 392 |
| kind totals | build-output 610, untracked-work 392, backup 173, scrape-raw 23, junk-named 11, ignored-other 8, **empty-dir 2**, test-artifact 1, **test-content 0** |
| protected entries (by reason) | 564 — 547 tracked, 6 `node_modules`, 4 `.env*`, 2 `vendor`, 1 nested worktree, 1 `storage/app`, 1 `.git`, 1 key material, 1 `docs` |
| refused (links / devices / outside root) | 0 |
| class totals | S0 = 580, S1 = 2, S3 = 638 (no trash CLI ⇒ S2 removal candidates raised) |
| litter bytes / backup bytes | 6,542,785 B / **17,650,986,563 B (≈16.4 GiB)** |
| reference check | `git grep` over 636 candidate basenames: 9 basenames referenced by tracked files |
| **`--level standard`** | `p-8d5601dc7a`, 1220 items, **43 planned** (S1 2, S3 41), 597 deferred, no truncation |
| **`--level deep`** | `p-ca9d121339`, 1220 items, **43 planned**, 597 deferred |

**The growth is the auditors' evidence, not engine drift.** Round 6 measured 1200 items with
`p-4ddf82b479`; the difference is the closing verification's own `evidence\audit-v6\` bundle (which
the plan aggregates, as it did for the three bundles before it) plus further evidence files from
this round's reproduction folder. `test-content` and route items are still **0**, the planned set is
`{"move":39,"settle":2,"purge":2}`, and the retention policy still proposes nothing:
`{"families":30,"keep":30,"previous":1,"supersede":0,"removableBytes":0}`.

The `retentionRole` fix is measurable on the owner's own data: `{"keep":30,"previous":1,"null":142}`
— one family names a fallback, and the other retained copies of that 144-copy family carry `null`
rather than claiming to be fallbacks:

```
storage/backups/root-ai-#-#-#t#-#-#-#z   copies=144  keepVerified=false  previous=storage/backups/root-ai-2026-10-05T23-24-32-261Z.sql  removable=0
```

No retention outcome changed: `removable` is 0 in every family, because no family on this host has
recorded restore evidence.

The plan's `unsure` section names **10** items on this repository — files the probe read and could
not classify. The four `.dsh-scan-*` scripts appear there (they carry a junk name *and* look
like uncertain tests, which is precisely what the owner should see before confirming them), plus
`root-ai-agent/test-part28.js` and `root-ai-agent/update-plan.js` and five others. None of them is
planned; all stay on disk.

The 39 planned at `standard` are: `.dsh-asar-index.json`, `.dsh-skill-index.json`, the four
`.dsh-scan-*` scratch scripts, `dump.rdb`, `NUL.css`, `test-results/`, `user-conversation-check.png`,
20 raw payloads under `tests/ds-login-research/_raw/`,
`tests/dsh-parity-audit/evidence/pnpm-install.log`, the auditor's own 0-byte `inv-immaculate.err`,
**two empty directories settled at S1** (`root-ai-manager` and `public/storage`), and the two
`dist-app/` build directories. Both `dist-app` directories exceed the 256 MiB quarantine cap
(280,640,641 B and 1,123,699,302 B), so they are proposed as an S3 `purge` needing `--confirm` by
name rather than as a reversible move. Total planned bytes 1,406,425,113 B (≈1.31 GiB), of which
1,404,339,943 B is the two purges.

**Backups: 30 families, 173 files, 16.4 GiB — and the engine proposes removing none of them at any
level.** The retention policy keeps the newest copy of each family and, because *no family has
recorded restore evidence on this host*, keeps every other copy as well. That is the point of the
policy: 143 files that a purely age-based rule would have called `supersede` are retained, because
"I cannot prove the new backup restores" must never be answered by deleting the old one. To release
those bytes the owner records a restore drill in `restore-evidence.json`, and `plan --purge` then
turns the older copies into real byte-freeing purges — remembered: a **move does not free disk
space**, only a purge does.

The much larger footprint lives in `storage/backups/` (≈96 hourly SQL dumps of ~330–360 MB, plus
`.bak` files). That directory is reported by its files, never as one 15 GiB "backup".

---

## 12. What this engine does not do

* It does not decide for the owner. `apply` performs only what a plan already said, and only behind
  the class gates; everything else is reported with a reason.
* It does not land work. `git add` is offered as a `landHint`, never executed — the engine never
  touches the index or the working tree of git.
* It does not fix what a route breaks. Moving a detected test file can break its relative imports;
  the item says so, and the runner must collect the file afterwards.
* It does not run a restore drill, and it cannot tell whether a backup restores. "Verified" means a
  drill somebody recorded in `restore-evidence.json`; without that record it keeps every copy.
* It does not free disk space by moving. Only `--purge` reclaims bytes, and it is offered for
  superseded backups only.
* It does not follow links, junctions, or nested repositories, and it will not act inside a subtree
  that contains protected content (including a `node_modules` segment).
* It does not see a nested repository's tracked set, which is why nested repositories are protected
  wholesale instead of classified.
* It does not verify that a "regenerable" item really does regenerate; that claim is a class
  assumption (S2), and the gate is what makes it the owner's call.
* It does not certify security. It is a cleanup engine with a safety bar; `git`-tracked, secret and
  dependency paths are excluded by rule, and the protection decision is re-run at apply time **on the
  path the action will actually use** (see §4), but the plan is still something a human reads before
  approving.
