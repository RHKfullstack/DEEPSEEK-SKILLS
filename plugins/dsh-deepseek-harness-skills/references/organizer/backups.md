# Organizer backups — retention, disposition, and the restore drill

The detail behind `## Backups: retention and disposition` in the skill body. Load this module when a
backup is about to be created, when a backup directory is growing, or when a backup is about to be
trusted.

The owner's complaint this module answers: backups are created and never retired, so the directory
grows without limit, eats storage, and nobody can say which copy is the real restore point. The fix is
not a schedule and not a delete command. It is one named disposition per backup, keep-latest retention
with a safety floor (section 3), and a restore drill that turns a hypothesis into a verified copy.

## 1. The record

One file per backup directory: `backups/BACKUPS.md`. One row per backup, no blank cells.

| column | meaning | example |
|---|---|---|
| `name` | file or directory name, ISO-dated | `root-ai-codebase-2026-08-18.zip` |
| `scope` | what a restore of this file brings back | `root-ai source tree` |
| `created` | ISO-8601 date the backup finished | `2026-08-18` |
| `bytes` | measured size | `935219200` |
| `sha256` | checksum at creation | `a1b2c3d4...` (first 8+ chars acceptable in the table) |
| `disposition` | one of keep / supersede / archive / remove | `keep` |
| `retention-role` | `keep` for the primary restore point, `previous` for the fallback copy, `-` when neither | `keep` |
| `superseded-by` | the name of the newer verified backup, or `-` | `-` |
| `verified` | date of the last successful restore drill, or `never` | `2026-10-12` |
| `restore-evidence` | the command run and the compared hash | `unzip -p ... app/Http/Kernel.php \| sha256sum` matched `9f3c...` |
| `next-review` | ISO date this row must be re-examined | `2027-02-18` |

Rules:

- A backup with no row is an incomplete backup. If it is not in the table, it does not exist as a
  restore point and it is not eligible for retention decisions either way.
- A row with an empty `disposition` is a defect. Fill it in the same turn the backup was created.
- `retention-role` answers "why are there two `keep` rows?" without a paragraph of prose: one is the
  primary, one is the previous. A family with no `previous` row is either a family of one copy, or a
  family whose previous copy has already been verified past (section 3).
- Measure, do not transcribe: `Get-ChildItem backups -File | Select-Object Name, Length` and
  `Get-FileHash -Algorithm SHA256 <file>`. Numbers copied from an earlier note are not evidence.

## 2. Disposition vocabulary

Exactly four values. Nothing else, and never blank.

| disposition | Means | Assigned when | Removal gate |
|---|---|---|---|
| **keep** | This is a restore point for its scope: the primary, or the previous copy held as the fallback | It is the newest verified backup of the scope (primary), it is the copy immediately before a not-yet-verified newer one (previous, section 3), or the user named it | Not removable. A `keep` becomes `supersede` only when a newer verified backup of the same scope exists |
| **supersede** | A newer verified backup of the same scope exists, so this one has been replaced | A newer backup of the same scope has passed a restore drill | S3 — confirmed per item, by name. Never removed merely because it is old |
| **archive** | Held for a policy, a contract, or a named date rather than for restore speed | A retention obligation names it, or the user asks to keep a point in time | Not removable by the routine sweep. Moving it to cold storage is S1, journalled |
| **remove** | The backup is unusable or explicitly retired | It failed verification (unreadable, checksum mismatch, wrong scope), or the user retired it by name | S3 — confirmed per item, by name, with the reason quoted |

Non-negotiables:

- **Never silent deletion.** Every removal appears in a plan the user saw, with the name, the size,
  the disposition and the reason.
- **Never the last verified backup of a scope.** If removing an item would leave a scope with no
  verified backup, the item is not planned at all — it is reported as blocking.
- **Never before the replacement is verified.** A `supersede` item is removable only once the newer
  backup has a `verified` date and matching restore evidence in the table.
- **Never unbounded growth.** A sweep that finds a scope over its retention budget produces a plan
  in the same turn. Reporting "backups are getting large" without a plan is the failure this module
  exists to prevent.

## 3. Retention is keep-latest

The owner's policy, stated as a rule: **only the latest backup of a family is kept.** Older copies pile
up, consume storage, and are never read again once a newer copy of the same scope exists. That is the
whole justification, and it is correct — provided the newer copy is real.

| Role | What it is | Disposition | Removable |
|---|---|---|---|
| primary | the newest **verified** copy of the family | `keep` | no |
| previous | the copy immediately before the primary, held as the fallback until a restore drill verifies the primary | `keep` | no |
| superseded | every older copy | `supersede` | yes — S3, confirmed per item, by name |

That is the steady state, and it is deliberately two copies rather than one: the "previous" copy is
not waste, it is the copy that still exists if the newest one turns out not to restore. The owner's
complaint is answered by the third row, not by removing the second.

### The safety floor, which outranks the policy

**Never remove the only copy of a family. Never remove a copy while the newer copy has no restore
evidence.** The second rule is the one that stops this policy from deleting the last good backup: an
unverified newer copy leaves the older one `keep`, because "the newer one exists" is not evidence that
the newer one works.

Applied literally, that means a family with no restore evidence anywhere is left alone:

| Retain restore evidence | evidence for the newest copy | what the family looks like |
|---|---|---|
| none | not recorded | the newest is `keep`/`keep`, the next copy is `keep`/`previous`, and nothing else in the family is proposed for removal — every older copy is `keep` too, with the reason "the newest copy has no restore evidence" |
| recorded | a drill restored a file and the hash matched | newest `keep`/`keep`, the copy before it `keep`/`previous`, every older copy `supersede` and proposed for removal at S3 per item |

Two consequences of the first row that must be stated rather than discovered:

- **A family can legitimately show more than two `keep` rows.** Every copy at or after the previous
  one carries `keep` while the newest is unverified. That is not a stuck sweep; it is the floor.
- **A workspace can go from many removal proposals to none, and that is the fix working.** On this
  owner's repository the age-based rule proposed 143 `supersede` removals (16.4 GiB across 30 backup
  families, 173 files, none of them ever restore-drilled). Under the floor the engine now proposes
  **zero** backup removals at any level, because not one family can prove its newest copy restores.
  Report that as the safety floor holding — never as "the backups are already tidy", and always with
  the next action: record a drill, and the superseded copies become removable.

### How a copy becomes verified

The engine does not drill backups, and nothing in this skill does either. A copy is verified when a
person ran the restore drill in section 6 and recorded the result. Two records are acceptable:

1. The `BACKUPS.md` row: `verified` date, the restore command, and the compared hashes.
2. The machine-readable sidecar the engine reads for retention decisions —
   `<state>/roots/<hash>/restore-evidence.json` under `%USERPROFILE%\.dsh\organizer` (override with
   `DSH_ORGANIZER_STATE`). Its shape:

       {"schemaVersion":1,"root":"<abs root>","verified":{"<rel-path or family>":{"drilledAt":"<iso>","target":"<where it was restored>","note":"..."}}}

   A copy counts as verified only when it, or its family, has a `drilledAt`. A prose file cannot be
   read by the engine, so a claim that lives only in prose does not move the retention decision.

Neither record is a substitute for the other: `BACKUPS.md` is the human record, the sidecar is what
the gate reads.

## 3b. A move is not a byte

Every cleanup here is a **quarantine move**: the file is renamed into the engine's sink on the same
volume. The bytes do not move off the disk and the free-space figure does not change. Say this
explicitly whenever a report might be read as "the cleanup freed 1.3 GiB" — the honest sentence is that
1.3 GiB was quarantined and remains on disk, recoverable by `undo` until the sink is emptied.

When the owner's goal is reclaiming bytes, three paths release them, and the owner chooses rather than
the agent assuming:

1. The backup tool's own retention — the tool that wrote the copy is the tool that should delete it.
2. Deleting the superseded copy by name, after the per-item confirmation its S3 class requires.
3. Having that copy planned as an irreversible `purge` instead of a move — the plan flag that produces
   one is `--purge`, it applies to `supersede` backup copies only, and the copy is still S3 and still
   confirmed per item by name. The journal records `restorable: false`. It is the one path that both
   removes the file and returns the space.
   `--purge` does **not** release the safety floor: an unverified family has no `supersede` copies to
   point it at, so the floor is lifted by recording a restore drill (section 6), not by a flag. An
   oversize backup is likewise never purged — it is proposed for `archive` instead, with the size
   stated as the reason.

Never describe a quarantine as freeing space, and never quietly purge in place of a move to make a
total look better.


## 3c. Retention rules per scope

A scope is what a restore brings back: `root-ai source tree`, `root-ai database`, `agent portable
build`. Each scope carries its own budget and its own review date.

| Scope class | Default retention | Rationale |
|---|---|---|
| Active development tree | the newest verified backup, plus the previous one | One restore point for now, one to fall back to if the newest is found corrupt. Two is the floor, not a target |
| Database or data store | the newest verified backup, plus a dated series at a fixed cadence (for example weekly for 8 weeks) | Data loss is not recoverable from source; the series covers the case where the corruption is only noticed later |
| Release artefact or portable build | one per released version that is still supported | The version the user can still be asked to run |
| Pre-migration or pre-change snapshot | until the change is verified, then `supersede` | It exists to make one specific change reversible |

Rules:

1. The budget is a number the user confirms: total bytes per scope, or a count per scope. Write it
   in `BACKUPS.md` at the top. Without a number, "too many" is an opinion and nothing can be swept.
2. When a scope exceeds its budget, the sweep plans the oldest `supersede` items first, then
   `archive` items for cold storage, and never touches `keep`.
3. A `keep` that is older than the current `keep` of the same scope becomes removable only after the
   newer one is verified. Until then it stays `keep` with `retention-role: previous` — temporarily two
   `keep` rows, which is correct and must be stated plainly (section 3, the safety floor).
4. `next-review` drives the sweep. An item past its review date without a decision is a finding in
   the next inventory whether or not disk space is short.
5. Retention decisions are recorded with the date they were taken, so the next reader can see
   whether the rule was applied or merely intended.

## 4. Naming with ISO dates

    <scope>-<YYYY-MM-DD>[-<qualifier>].<ext>

Examples:

    root-ai-codebase-2026-08-18.zip
    root-ai-database-2026-10-12.sql.gz
    root-ai-agent-1.0.10-portable.exe

Rules:

- The date is ISO-8601 `YYYY-MM-DD`, which sorts as text, so `Get-ChildItem backups | Sort-Object
  Name` lists the set in creation order.
- Banned names, because they carry no information and defeat sorting: `backup.zip`, `backup2.zip`,
  `backup-new.zip`, `backup-old.zip`, `final.zip`, `final-final.zip`, `copy of backup.zip`,
  `2026 backup.zip`.
- One dot for the extension. A qualifier goes before the extension, hyphen-separated.
- A release artefact carries the version the way the project names versions; the date still appears.
  `root-ai-agent-1.0.10-portable.exe` fails the rule and is renamed on the next sweep to
  `root-ai-agent-1.0.10-2026-08-18-portable.exe`, or recorded with a note explaining the exception.
- Renaming an existing backup is S1 and journalled. It changes no bytes, so it needs no restore
  drill — but the `BACKUPS.md` row updates in the same turn, or the table and the disk disagree.

## 5. The 3-2-1 rule

The long-standing baseline for backup resilience: **3** copies of the data, on **2** different
media, with **1** copy off-site ([CISA, Data Backup Options](https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf)).

Applied here so it is executable rather than aspirational:

1. Count the copies for each scope. `keep` plus `supersede` rows are copies; an `archive` row is a
   copy. A row whose file failed verification is not a copy.
2. Two copies on the same disk, in the same directory, are one failure domain. Record the media per
   row so the count is real: local disk, external disk, network share, object storage.
3. The off-site copy is the one that survives the building. If there is no off-site copy, say so
   plainly in the report — an unstated single point of failure is the finding.
4. A scope with fewer than 3 copies is reported with the exact shortfall, not a general worry:
   "root-ai database: 1 copy, local disk only, no off-site".
5. Do not create a third copy to satisfy the count and then never verify it. The count is a
   starting point; the restore drill is what makes the copies real.

## 6. The restore drill

The rule this section enforces: **an untested backup is a hypothesis.** A backup is verified when a
restore has actually restored something and a hash matched.

Procedure. A drill is read-only with respect to the live tree — it restores into the sink, never
over the original.

1. Pick the scope and the backup row you are verifying. Record the name and `sha256` from the table.
2. Restore one representative file into a scratch directory inside the sink:

       Expand-Archive -LiteralPath backups/root-ai-codebase-2026-08-18.zip -DestinationPath .work/2026-10-12-restore-drill/raw -Force

   (for a `.tar.gz`: `tar -xzf <archive> -C .work/2026-10-12-restore-drill/raw <one/member/path>`)

3. Hash the restored file and compare it against the live file, or against the recorded hash for a
   cold backup where no live file remains:

       Get-FileHash -Algorithm SHA256 .work/2026-10-12-restore-drill/raw/<member>, <live-path> | Format-Table Hash, Path

4. Record in `BACKUPS.md`: the `verified` date, the command, and the compared hashes. A drill with
   no recorded command is not evidence.
5. If the archive does not open, the file inside is missing, or the hashes differ: the backup is not
   a restore point. Set its disposition to `remove` with the failure reason, and report it in the
   same turn. Do not quietly leave it in the table as `keep`.
6. For a database backup, the drill is a restore into a scratch database plus one row count and one
   checksum comparison. A database backup that has only ever been written is a hypothesis too.
7. Re-run the drill after any change to the backup tooling, the encryption key, or the storage
   location, because those are exactly the changes that break a restore silently.

What the drill catches, which is the point of running it: an encryption key that no longer matches,
a truncated upload, an archive member that was never included, a permissions change on the
destination, and a backup that has been "succeeding" into a path nobody can read.

## 7. The retention sweep

Run this when a backup directory is growing, at a review date, or on the disk-pressure trigger. It
is the same six-stage lifecycle as the skill body, scoped to the backup directory.

1. **INVENTORY (S0).** List every file with size, mtime and hash; read `BACKUPS.md`; compute per
   scope: copy count, total bytes, oldest and newest `verified` date.
2. **CLASSIFY.** Assign each item exactly one disposition (keep / supersede / archive / remove) and,
   for the `keep` items, its `retention-role` (primary or previous). An item whose fate is genuinely
   unknown is not assigned `remove` — it is listed as `unsure` and left alone, with the specific check
   that would resolve it. Apply the safety floor here: if the newest copy has no restore evidence, no
   copy of that family is classified `supersede`, and the plan says why.
3. **PLAN.** Write the plan with one row per item: name, bytes, disposition, retention-role, reason,
   gate. State the budget and the resulting total for each scope, and state which totals are
   quarantines rather than bytes reclaimed (section 3b).
4. **SHOW.** Print the plan. Quote the reclaimable total and the copy count each scope would be left
   with, and say whether each item is a reversible move or a purge. Do not remove anything before this.
5. **GATED APPLY.** `remove` items are S3: confirmed per item, by name. `archive` moves and
   `supersede` moves are S1/S3 as their class says: journalled with their undo. One target per
   command, resolved path printed first.
6. **VERIFY and REPORT.** Each removed file is absent; each `keep` is present with an unchanged
   hash; the remaining copy count per scope is stated; the `BACKUPS.md` rows are updated.

## 8. Worked example: a real backup directory

Measured before-state in the owner's workspace on 2026-10-12:

    backups/
      root-ai-codebase-2026-08-18.zip          891.9 MB
      root-ai-agent-1.0.10-portable.exe         75.9 MB
      (directory total quoted as 922.9 MB)

No `BACKUPS.md`, no retention note, no disposition, no verified date, no budget. The two files are
the entire record, and the record says nothing about which is the restore point.

The sweep, run in order:

1. Re-measure rather than trusting the quoted numbers: `Get-ChildItem backups -File |
   Measure-Object -Sum Length`, plus `Get-FileHash -Algorithm SHA256` per file.
2. Create `BACKUPS.md`. Two rows. `root-ai-codebase-2026-08-18.zip` is the only source-tree restore
   point, so `disposition=keep`, `superseded-by=-`, `verified=never` until a drill runs.
   `root-ai-agent-1.0.10-portable.exe` is a released portable build, so `disposition=keep` with its
   version recorded, and a `next-review` date.
3. Ask the user for the budget — the total bytes the backup directory may occupy — and record the
   number. Without it, a sweep cannot decide anything.
4. Run one restore drill on the codebase archive: extract one known file into the sink, compare its
   hash with the live file, record the command and the result. Until this runs, both rows stay
   `verified=never` and the report says so.
5. Report: two files, one restore point, zero verified, zero copies off-site, and the exact shortfall
   against 3-2-1. No file is removed by this sweep, because neither file is `supersede` and neither
   failed verification.

That outcome — nothing deleted, everything recorded — is a successful sweep. The complaint was not
"too many files"; it was "nobody knows what these are or when to stop".

## 9. Traps

- **Deleting the old backup the moment a new one is written.** The new one is not verified yet. Two
  copies is the temporary correct state, not waste.
- **Reading "only the latest is kept" as "delete everything else now".** The policy is keep-latest
  *among verified copies*. Unverified families keep their previous copy, and a sweep that proposes no
  removals there is working correctly.
- **Reporting a quarantine as reclaimed space.** The bytes stay on the volume until the copy is
  deleted or purged (section 3b). Quote the two numbers separately or not at all.
- **Counting a failed backup as a copy.** A file that will not open is not a copy; it is a `remove`
  candidate with a recorded reason.
- **Trusting an exit code.** A backup script that exits 0 has written bytes, not a restore point.
- **Trusting a `verified` cell that no drill produced.** The date goes in after the `Get-FileHash`
  comparison, not when the backup completes.
- **Retention with no number.** "Keep the recent ones" is unenforceable. Confirm a budget.
- **Renaming without updating the table.** The disk and `BACKUPS.md` must agree at the end of every
  turn that touched either.
- **Sweeping on a hunch.** The trigger is a measurement — over budget, past review date, or failed
  verification — not a feeling that the folder looks full.
- **Restoring over the original during a drill.** A drill restores into the sink. A drill that
  overwrites the live file is an incident.

## Sources

- [CISA, Data Backup Options](https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf)
  — the 3-2-1 rule: three copies, two media, one off-site.
- [NIST SP 800-34 Rev. 1, Contingency Planning Guide for Federal Information Systems](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final)
  — backup scheduling, retention, and testing a contingency capability rather than assuming it.
- [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) — CP-9 (system backup)
  and CP-4 (contingency plan testing), the control framing behind the restore drill.
- [opum-ai/housekeeping-skills](https://github.com/opum-ai/housekeeping-skills) — the plan-then-apply
  split, per-item confirmation for irreversible removals, and the named-disposition discipline this
  module applies to backups.
- [FlyFission/nuclear-grade-context-engineering](https://github.com/FlyFission/nuclear-grade-context-engineering)
  — ISO-8601 dated, sortable, platform-safe naming for the backup file names above.
