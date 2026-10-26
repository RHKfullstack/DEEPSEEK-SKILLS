---
name: game-backend
description: Build the server side of an online game - accounts and sessions, authoritative player state, inventory and currency without dupes, matchmaking and world sharding, persistence and save versioning, rate limits and audit. Use when building a game server, adding accounts or a shop, designing inventory or trading, sharding an MMO world, or reviewing a backend that will hold player value. Owns accounts, inventory and persistence; load with game-netcode for online play.
---

# Game Backend

A game backend is a web backend with two hostile constraints: **every client is an attacker**, and **the state has real value** (time spent, purchases, rank). The defaults that are tolerable in a CRUD app — trust the request, write and hope, no idempotency — become dupes and cheating here.

## Phase 1 — Identity

- **Account** separate from **character**. A player may have many characters; the account holds the wallet, the entitlements, and the ban state.
- **Sessions** are short-lived tokens, refreshed; the game client never holds a long-lived credential in a save file.
- **Device and platform identity** (Steam, PSN, mobile) map to one account via a linking table, with an explicit unlink path.
- **Recovery** is designed, not an afterthought: email plus a support path, no security questions.
- Cross-link: `senior-app-security` Phase 2 for hashing, session flags and token expiry.

**EVIDENCE: `backend/identity.md` — account/character split, session lifetime, linking table, recovery path.**

## Phase 2 — Player state — the dupe boundary

Every mutation that grants value is:

1. **Server-authoritative** — the client sends an intent, the server decides.
2. **Transactional** — the inventory write and the currency write succeed or fail together.
3. **Idempotent** — a request id, so a retried packet does not grant twice (`senior-background-jobs`).
4. **Audited** — who, what, when, before and after, for every value-bearing change.

| Operation | The rule |
|---|---|
| Grant item | one transaction, unique constraint on `(player_id, grant_id)` |
| Trade | two-phase: reserve → commit, both sides locked in a deterministic order |
| Shop purchase | idempotency key from the payment provider, not the client |
| Craft / consume | check and decrement in one statement (`UPDATE ... WHERE qty >= n`) |
| Mail / gift | claim is idempotent; the mail row is not deleted, it is marked claimed |

**Never** `SELECT qty` then `UPDATE qty = <computed>` — that is a lost update under concurrency, and the exploit script is ten lines.

**EVIDENCE: the transaction boundary and idempotency key for each row above, plus a concurrent test that attempts the same grant twice.**

## Phase 3 — Matchmaking, lobbies, shards

- **Matchmaking** is a queue with a widening rule (skill band, latency band, time waited) — three numbers, stated.
- **Lobby** state is server-owned and has an owner migration path when the host leaves.
- **World sharding** (MMORPG): shard by region or by instance; the player's shard is server state, never client-chosen without a check.
- **Handoff** between shards/instances is a transaction on the player record plus a session token — a drop mid-handoff must be resumable, not a lost character.

**EVIDENCE: the matchmaking bands, the lobby ownership rule, and the handoff failure path.**

## Phase 4 — Persistence and save versioning

- Schema design: `senior-database-design` (keys, indexes, money as `DECIMAL`, UTC time).
- Schema change: `senior-data-migration-safety` (expand/contract, backfill, restore drill).
- **Save version** in every player record. Loading an old save runs the documented upgrade chain; a save from the future is rejected, not guessed at.
- **Hot data** (session, presence, matchmaking queue) in Redis; **durable value** (inventory, currency, progression) in the relational store, with the Redis copy never authoritative.
- **Backups** with a restore drill — a game database without a tested restore is one bad migration from closure.

**EVIDENCE: the save-version field, the upgrade chain, and where each data class lives.**

## Phase 5 — Abuse controls

- **Rate limits per action**, server-side: fire rate, trade frequency, chat, login attempts.
- **Anomaly checks** that log, never auto-ban: value created per hour, trade velocity, movement speed impossible for the class.
- **Chat and name filters** with a report path.
- **Audit log** append-only, queryable per player — the only way to answer "where did this item come from".

**EVIDENCE: the rate-limit table, one anomaly query, and a sample audit row.**

## Phase 6 — Operating a live game

| Event | The prepared answer |
|---|---|
| Deploy during live | rolling restart per shard; the world drains before the swap |
| Hotfix | feature flag or server-side data, never a client patch for a balance number |
| Rollback | the previous server build stays deployable; the schema is expand/contract so it can |
| Economy correction | a scripted, audited grant/deduct, never a manual SQL statement |
| Incident | player-facing status, compensation policy stated in advance |

**EVIDENCE: the restart procedure, the rollback path, and the compensation policy.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| Client sends "I got the item" | server grants, client is told |
| `SELECT` then `UPDATE` | conditional update / transaction / row lock |
| No idempotency | request id with a unique constraint |
| Sessions that never expire | short tokens + refresh |
| Redis as the source of truth for value | Redis for hot state, relational for durable value |
| One character per account | account → characters, wallet on the account |
| Save with no version | version field + upgrade chain |
| Auto-ban on anomaly | log + review; bans are a human decision |
| Deploy whenever | scheduled, shard-drained, rollback tested |

## Definition of done

- Every value-bearing operation is transactional and idempotent, with a concurrency test.
- Sessions expire; the client holds no long-lived credential.
- Save versioning and the upgrade chain exist.
- Rate limits and an audit log are in place.
- Deploy, rollback and economy-correction procedures are written.

## Failure modes

1. **Lost update on inventory** — the classic dupe, and the first thing an attacker tries.
2. **Non-idempotent purchase** — a retried payment grants twice; the refund is manual.
3. **Redis as truth** — a flush or eviction becomes a rollback of player value.
4. **No save version** — a schema change silently corrupts old characters.
5. **Auto-ban on anomaly** — false positives ban paying players; the support cost dwarfs the cheat.
6. **Manual SQL corrections** — no audit trail, and the second correction fixes the first one's mistake.
7. **Deploy at peak** — the shard handoff drops sessions mid-trade.

## Sources — verified live 2026-10-27

- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — authentication, session, access control.
- [Redis data types](https://redis.io/docs/latest/develop/data-types/) — the hot-state primitives.
- [PostgreSQL documentation](https://www.postgresql.org/docs/) — transactions, isolation, `SELECT ... FOR UPDATE`.
- [Godot high-level multiplayer](https://docs.godotengine.org/en/stable/tutorials/networking/high_level_multiplayer.html) — the client side of this contract.
