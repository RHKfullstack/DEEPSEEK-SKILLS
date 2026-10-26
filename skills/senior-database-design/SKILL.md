---
name: senior-database-design
description: Judge or design a relational schema before it exists - keys, column types, indexes, constraints, money, time, text, tenancy and the anti-patterns that cost a rewrite. Use when creating a table, reviewing a model or migration for design (not for the safety of applying it), when a query is slow because the index is wrong, or when the question is "is this schema good" rather than "is this change safe".
---

# Senior Database Design

`senior-data-migration-safety` answers **"is this change safe to apply"**. This skill answers a different question: **"is this schema right"**. A migration can be perfectly safe and still add a column that costs a rewrite next quarter.

The schema outlives the code. Code is refactored in hours; a table with the wrong key type is migrated over a weekend with a maintenance window.

## Phase 1 — Read the schema as it is

```sql
SHOW CREATE TABLE orders;                       -- engine, charset, collation, keys
SHOW INDEX FROM orders;                         -- name, column order, cardinality
SELECT table_name, table_rows, data_length, index_length
  FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
 ORDER BY data_length DESC LIMIT 20;           -- where the bytes actually are
```

**EVIDENCE: the `SHOW CREATE TABLE` output for every table the change touches, plus the index list.**

## Phase 2 — Keys

| Decision | Default | When to deviate |
|---|---|---|
| Primary key | `BIGINT UNSIGNED AUTO_INCREMENT` | a distributed writer or a public id needs `CHAR(26)` ULID or `BINARY(16)` UUID |
| UUID as clustered key | avoid | random UUIDs fragment InnoDB's clustered index; use ULID/`uuid_v7`, or keep the random id as a **secondary** unique column beside a bigint PK |
| Natural key from user data | avoid | an email or a username changes; a `user_id` does not |
| Composite PK | join tables only | `(a_id, b_id)` with the higher-selectivity column first |
| `INT` for ids | `BIGINT UNSIGNED` | `INT` overflows at 2.1 billion — a real ceiling for event tables |

**Rule:** every table has a primary key. A table without one cannot be indexed by row identity, cannot be replicated efficiently, and cannot be updated safely.

## Phase 3 — Column types — the four that get decided once

**Money.** `DECIMAL(12,2)` plus a `CHAR(3)` currency column, or a minor-unit `BIGINT` with a documented exponent. `FLOAT`/`DOUBLE` for money is a defect: `0.1 + 0.2 != 0.3` is not a rounding preference, it is a wrong balance. Never mix currencies in one column without the currency beside it.

**Time.** Store **UTC**. `TIMESTAMP` converts with the session timezone and dies in 2038; `DATETIME` stores what you give it, so give it UTC and convert at the edge. A `DATETIME` written with local time is a defect that surfaces once a year, in the migration to another region.

**Text.** `utf8mb4` and a deterministic collation (`utf8mb4_0900_ai_ci` on MySQL 8). `VARCHAR(n)` sized to the actual maximum, not 255 everywhere; `TEXT` only for genuinely unbounded content, because it moves the row out of the buffer pool. Case-insensitive uniqueness on an email needs a normalised column or a functional index, not a `LOWER()` in every query.

**Nulls.** `NOT NULL` with a default where a value always exists. `NULL` is not "unknown" to a unique index — MySQL allows many `NULL`s, so a "unique" nullable column enforces nothing on the rows that matter.

## Phase 4 — Indexes from query patterns, not from intuition

1. **List the queries** the feature will run, with their filters, joins, and sort.
2. For each, design the smallest index that serves it: **equality columns first, then range, then the sort column**. `(tenant_id, status, created_at)` serves `WHERE tenant_id=? AND status=? ORDER BY created_at`; `(status, tenant_id)` does not.
3. **Covering index** when the query reads two or three columns and the table is hot: `(tenant_id, status, created_at, total)` avoids the row lookup.
4. **Cardinality first.** An index on `is_active` alone is almost never used — the optimiser reads the table instead.
5. **Every index is a write cost.** Six indexes on one table means six writes per insert. Drop the ones no query uses; find them with `performance_schema.table_io_waits_summary_by_index_usage` where `count_star = 0`.
6. **Multi-tenant prefix.** In a tenant table, `tenant_id` is the first column of every composite index, or the tenant query scans everyone's rows.

**EVIDENCE: a query → index table, and the `EXPLAIN` for the top three queries showing `type` better than `ALL` and `rows` in the expected range.**

## Phase 5 — Constraints belong in the database

- **Foreign keys on.** `ON DELETE RESTRICT` by default; `CASCADE` only for a child that cannot exist alone (order lines, not orders).
- **Unique where the business says unique.** An application-level "check then insert" is a race; the constraint is the only atomic answer.
- **`CHECK` constraints** for ranges and enums where the engine enforces them.
- **Soft delete × unique**: a unique index on a soft-deleted table blocks re-creating the row. Include the deleted timestamp in the index, or use a nullable `deleted_at` plus a functional unique index — decide deliberately, because this is the classic post-launch bug.
- **JSON columns** only for a genuinely schemaless payload. They cannot be indexed directly (functional index or generated column), and they hide the schema from every reviewer.

## Phase 6 — The executable audit

```sql
-- tables with no primary key
SELECT t.table_name
  FROM information_schema.tables t
  LEFT JOIN information_schema.table_constraints c
    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
   AND c.constraint_type = 'PRIMARY KEY'
 WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE'
   AND c.constraint_name IS NULL;

-- float money
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND data_type IN ('float','double');

-- *_id columns with no foreign key (heuristic: naming convention)
SELECT c.table_name, c.column_name
  FROM information_schema.columns c
  LEFT JOIN information_schema.key_column_usage k
    ON k.table_schema = c.table_schema AND k.table_name = c.table_name
   AND k.column_name = c.column_name AND k.referenced_table_name IS NOT NULL
 WHERE c.table_schema = DATABASE() AND c.column_name LIKE '%\_id'
   AND c.column_name <> 'id' AND k.column_name IS NULL;

-- unused indexes (after a representative period of traffic)
SELECT object_name, index_name, count_star
  FROM performance_schema.table_io_waits_summary_by_index_usage
 WHERE object_schema = DATABASE() AND index_name <> 'PRIMARY' AND count_star = 0;
```

Each row is a finding. "The ORM handles it" is not an answer for a missing FK — the ORM does not run on the replica, in the report, or in the manual fix.

**EVIDENCE: the audit output, and a disposition per row (fixed, accepted with a reason, or out of scope).**

## Definition of done

- Every table has a primary key, and the key type is a decision with a reason.
- Money is exact, time is UTC, text is `utf8mb4` with a sized length.
- Every index maps to a named query; no index exists without one.
- Every `*_id` has a foreign key, or a recorded reason it cannot.
- The tenant column is the first key in every composite index of a tenant table.
- Uniqueness the business relies on is a constraint, not a check in application code.

## Failure modes a naive reviewer misses

1. **UUID primary key on InnoDB.** Every insert lands at a random page; the table fragments and the index doubles.
2. **`FLOAT` for money.** It passes the demo and fails the reconciliation.
3. **Local time in a `DATETIME`.** Works in one timezone, wrong in the second.
4. **`VARCHAR(255)` everywhere.** Hides the real constraint and lets a 254-character name into a UI that expects 40.
5. **Soft delete plus unique.** Re-creating a deleted row throws a constraint error nobody predicted.
6. **No FK "for performance".** The cost is correct data versus a join check; the orphan rows appear months later.
7. **Index per column.** Three single-column indexes where one composite would serve all three queries.
8. **`is_active` index.** Low cardinality, never chosen by the optimiser.
9. **Nullable "unique" email.** MySQL allows unlimited `NULL`s; the duplicate arrives by the hundred.
10. **EAV or comma-separated lists.** Schema-free until the first query needs to filter on a value.
