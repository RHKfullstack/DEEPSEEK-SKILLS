# Senior Data Migration Safety

Review a schema or data change so it survives production: classify the DDL, prove the expand/contract ordering, measure lock impact on production-sized data, make the backfill idempotent, and verify the restore path rather than the backup job.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A migration file, ORM model change, index, constraint, partition, or retention job is added or edited.
- A backfill, data repair, denormalisation, encryption, or re-keying script is proposed.
- A release contains a schema change, or a deploy order between code and data is being decided.
- Someone asks "is this migration safe?" or "how long will it lock?".
- An irreversible change (rename, drop, type change, `NOT NULL` on existing data) is on the table.

## When it does not

- The change touches no persistent state: a pure in-memory refactor or a new read-only view over unchanged tables.
- The "migration" is a test fixture or an ephemeral CI database rebuilt from scratch on every run.
- The engine is an embedded store with a documented atomic file swap and no concurrent readers; record that reasoning as the finding.

## Core rule

Schema change is an engineering artifact with its own release cadence, not a side effect of a deploy ([Martin Fowler, Evolutionary Database Design](https://martinfowler.com/articles/evodb.html)). The safe ordering rule is expand/contract: add the new structure, dual-write, backfill, switch reads, stop writing the old structure, and drop it in a later release ([ParallelChange](https://martinfowler.com/bliki/ParallelChange.html)). Blue/green protects the code, not the data — with a shared database a code rollback leaves the new schema in place ([BlueGreenDeployment](https://martinfowler.com/bliki/BlueGreenDeployment.html)).

State in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Inventory and classify every schema and data change

1. Enumerate the migrations in the change set and their order: `git diff --name-only <base>...HEAD -- '*migrations*' '*migration*' '*.sql'`.
2. Extract the actual statements, not the migration filename: read each file and list every `ALTER`, `CREATE`, `DROP`, `UPDATE`, `DELETE`.
3. Classify each statement as additive (new nullable column, new table, new `CONCURRENTLY` index) or destructive (rename, drop, type change, `NOT NULL` backfill, constraint tightening, default change).
4. Map each destructive statement to the release it lands in. Two releases minimum for anything destructive: one to add and dual-write, a later one to remove.
5. Audit auto-generated migrations by hand. An ORM's generator can emit drop-and-recreate for a rename, silently discarding data.
6. List every object touched beyond the one table: foreign keys, views, materialised views, triggers, grants, and application roles that must be able to use the new column.
7. EVIDENCE: ordered statement list, additive/destructive classification, release mapping, the generated-migration review note, the dependent-object list.

## Phase 2 — Prove the expand/contract sequence across releases

1. Write the six steps explicitly with the migration file and release that owns each: add, dual-write, backfill, read-switch, stop-old-write, drop.
2. Verify both compatibility cells during a rolling deploy: old code + new schema, and new code + old schema. Name the migration that each cell would break on.
3. Confirm no single deploy contains both the code switch and the destructive step.
4. Confirm the read-switch is reversible by a config or flag, not by a redeploy of the previous version.
5. Confirm the drop step carries a date or a release number in the plan, not "later".
6. Search the codebase for every reader and writer of the old structure and confirm each is migrated: `grep -rn '<table>\.<column>' src/`.
7. EVIDENCE: the six-step table with file and release per step, the two compatibility cells, the reader/writer inventory with per-site status.

## Phase 3 — Determine and measure lock impact on production-sized data

1. For each statement, find the documented lock level and rewrite behaviour in the engine's own documentation — for Postgres, which `ALTER TABLE` forms take `ACCESS EXCLUSIVE` and which rewrite the table ([PostgreSQL: ALTER TABLE](https://www.postgresql.org/docs/current/ddl-alter.html), [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)).
2. Clone the table with a production-realistic row count and row width, plus concurrent traffic, then run the migration there and time it. A 1,000-row test proves nothing about a 200-million-row table.
3. Observe blocking during the run: `SELECT * FROM pg_locks WHERE NOT granted;` and `SELECT pid, wait_event_type, wait_event, query FROM pg_stat_activity WHERE state <> 'idle';`.
4. Set `lock_timeout` in the migration session so the statement fails fast instead of queueing every subsequent query behind it ([PostgreSQL: Lock Management](https://www.postgresql.org/docs/current/runtime-config-locks.html)).
5. Create indexes with `CREATE INDEX CONCURRENTLY`, and confirm the migration runner does not wrap DDL in a transaction that breaks `CONCURRENTLY` ([PostgreSQL: CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)).
6. Record the wall-clock duration and the peak blocking window, and compare both against the service's acceptable degradation.
7. EVIDENCE: engine-doc citation per statement, measured duration and lock observations on production-sized data, the `lock_timeout` and `CONCURRENTLY` lines from the migration.

## Phase 4 — Make the backfill idempotent, resumable, and rate-limited

1. Read the backfill script and identify its batch key, batch size, and commit boundary. One transaction over the whole table produces a WAL burst and a rollback longer than the migration.
2. Prove idempotency by running it twice on the clone and comparing row counts; the second run shows zero changed rows.
3. Prove resumability by killing the job mid-run and restarting it; the record count must continue from where it stopped without double-applying.
4. Confirm the transform is deterministic and free of wall-clock or `random()` input, or that such input is materialised before the batch loop.
5. Rate-limit the batch: sleep between batches or throttle on replica lag, and record the parameter.
6. Confirm the backfill handles rows written concurrently with it — new rows created after the batch cursor passed, and rows updated during the swap.
7. EVIDENCE: batch parameters from the script, two-run row counts, the kill/restart transcript, the throttle setting.

## Phase 5 — Budget for bloat, WAL, and replication lag

1. Treat a bulk `UPDATE` as a capacity event, not only a data event: every touched row leaves a dead tuple ([PostgreSQL: Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)).
2. Measure dead tuples and table size before and after on the clone: `SELECT n_dead_tup, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables WHERE relname = '<table>';`.
3. Confirm autovacuum settings can absorb the write rate, or schedule an explicit `VACUUM (ANALYZE)` after the batch window.
4. Estimate WAL volume for the change and confirm the archive and replica links can carry it; check replica lag during the test run.
5. Confirm the change does not hold a long-lived snapshot that blocks vacuum on a busy table.
6. Record the disk-growth headroom needed at peak, not only at the end state.
7. EVIDENCE: dead-tuple and size measurements before/after, autovacuum settings or the manual vacuum step, WAL estimate, observed replica lag, disk headroom figure.

## Phase 6 — Verify reversibility, or declare it irreversible

1. Run the down-migration after the up-migration on the clone, then compare the schema (`pg_dump --schema-only` diff) and a sample of rows against the pre-migration snapshot.
2. Where a down-migration does not exist, state that plainly in the release record: the change is forward-only and the rollback plan is a restore.
3. Confirm a restore-based rollback has a measured duration, since it sets the worst-case recovery time.
4. Verify the backup was taken immediately before the change and that its timestamp is inside the release window.
5. For a type change or column drop, confirm the old values exist somewhere retrievable (a shadow column, an archive table, or the verified backup) before the destructive step runs.
6. Record the explicit decision and its owner for any irreversible step, rather than leaving it implicit in the migration tool's behaviour.
7. EVIDENCE: down-migration result with schema and row comparison, or the irreversibility statement; backup timestamp; the owner decision.

## Phase 7 — Verify the restore path, not the backup job

1. Restore the most recent backup into a scratch database: `pg_restore --clean --if-exists -d <scratch> <dump>` ([pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)).
2. Run a real query against the restored database and compare a checksum or row count against the source. "Backups exist" is not a recovery capability ([Google SRE — Data Integrity](https://sre.google/sre-book/data-integrity/)).
3. Time the restore and record the number; it is the RTO the migration inherits.
4. Confirm the backup was taken with a tool and flags that capture everything this change touches — roles, extensions, sequences, large objects.
5. Confirm the backup is stored somewhere the application role and its credentials do not reach, so an application-level compromise does not also destroy the recovery path.
6. Re-run the restore drill after the change lands, because the schema moved.
7. EVIDENCE: the restore command, its query output, the measured duration, the backup tool and flags, the storage-location note.

## Phase 8 — Gate the next migration and record the release order

1. Add a migration linter to CI so the next engineer is gated too: [Squawk](https://squawkhq.com/) for Postgres, [strong_migrations](https://github.com/ankane/strong_migrations) for Rails, [Flyway](https://documentation.red-gate.com/flyway) for versioned ordering and dry runs.
2. Confirm the linter job is required by branch protection, not advisory.
3. Write the deploy order as a table the deployer will see: migration, then service A, then service B, with the compatibility cell each step depends on.
4. For a very large table, document the online schema-change path and cut-over: [gh-ost](https://github.com/github/gh-ost) with a throttle tied to replica lag, and the pause/abort procedure.
5. Record the abort criteria in advance: the lag threshold, the blocking duration, and the error rate that triggers a cut-over abort.
6. Attach the evidence bundle from Phases 3 through 7 to the release record so the on-call responder has the numbers.
7. EVIDENCE: the CI linter configuration line, branch-protection proof, the deploy-order table, the gh-ost throttle parameters and abort criteria.

## Definition of done

- Every destructive statement is split across at least two releases, or carries a written owner decision.
- Lock level and duration were measured on production-sized data, not asserted from the schema shape.
- The backfill ran twice with the second run showing zero changes, and survived a restart.
- The restore drill was executed against the latest backup and a query was run on the restored data.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Ordered statement list; additive/destructive classification; release mapping; dependent-object list |
| 2 | Six-step expand/contract table; the two rolling-deploy compatibility cells; reader/writer inventory |
| 3 | Engine-doc citation per statement; measured duration and lock observations; `lock_timeout`/`CONCURRENTLY` lines |
| 4 | Batch parameters; two-run row counts; kill/restart transcript; throttle setting |
| 5 | Dead tuples and table size before/after; autovacuum settings; WAL estimate; replica lag; headroom |
| 6 | Down-migration result with schema/row comparison, or the irreversibility statement; backup timestamp |
| 7 | Restore command and its query output; measured duration; backup flags; storage-location note |
| 8 | Linter configuration; branch-protection proof; deploy-order table; gh-ost throttle and abort criteria |

## Failure modes a naive reviewer misses

1. **"It was instant on my machine."** The development database has 1,000 rows and one connection; the production table has a hundred million rows and continuous writes.
2. **Lock-queue pileup.** The DDL waits behind a long-running application transaction and every subsequent query queues behind the DDL. The outage is caused by the lock request, not the migration.
3. **A single-transaction backfill** on a large table: WAL explosion, replica lag, and a rollback that runs longer than the migration itself.
4. **`NOT NULL` or a volatile default added in the same step as the column**, which forces a full table rewrite on engines that do not have a fast path for it.
5. **Dropping the old column in the same release as the code change**, which removes the rollback path and the data at the same time.
6. **Blue/green with a shared database.** The code rolls back, the schema does not, and the old build meets a schema it was never tested against.
7. **A generated migration reviewed as generated code.** A rename emitted as drop-plus-add discards the column values with no warning at review time.
8. **A backfill that is not idempotent**, so a retried job double-applies a transformation and the second pass corrupts the rows the first pass fixed.
9. **Vacuum and bloat ignored.** The migration reports success, and the database is slow and out of disk headroom for a week.
10. **Backups verified by job exit code.** The first real restore happens during the incident, against a file nobody has ever opened.
11. **Foreign keys, grants, and role privileges forgotten.** The column exists, the application role has no privilege on it, and the deploy fails after the schema changed.
12. **Readers outside the service.** BI extracts, CDC streams, replication slots, and a data warehouse schema all depend on the old shape and are discovered after the drop.

## Sources

- [Martin Fowler — Evolutionary Database Design](https://martinfowler.com/articles/evodb.html) — versioned, incremental schema change as an artifact.
- [Martin Fowler — ParallelChange (expand/contract)](https://martinfowler.com/bliki/ParallelChange.html) — the ordering rule that makes a rename safe across deploys.
- [Martin Fowler — BlueGreenDeployment](https://martinfowler.com/bliki/BlueGreenDeployment.html) — what it does and does not protect, including the shared-database case.
- [PostgreSQL — ALTER TABLE](https://www.postgresql.org/docs/current/ddl-alter.html) — which forms rewrite and which lock exclusively.
- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) and [Lock Management](https://www.postgresql.org/docs/current/runtime-config-locks.html) — lock levels and `lock_timeout`.
- [PostgreSQL — CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) — `CONCURRENTLY` and its transaction constraint.
- [PostgreSQL — Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) — dead tuples and bloat from bulk updates.
- [PostgreSQL — pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) — backup and restore commands used in the drill.
- [Google SRE Book — Data Integrity](https://sre.google/sre-book/data-integrity/) — defence in depth and restore verification.
- [gh-ost](https://github.com/github/gh-ost) — online schema change with replica-lag throttling and cut-over.
- [Squawk](https://squawkhq.com/) and [strong_migrations](https://github.com/ankane/strong_migrations) — CI gates against lock-taking and rewriting DDL.
- [Flyway](https://documentation.red-gate.com/flyway) — versioned migration ordering, dry runs, and repeatable migrations.
