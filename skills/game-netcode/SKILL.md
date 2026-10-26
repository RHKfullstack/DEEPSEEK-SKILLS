---
name: game-netcode
description: Design and review networked game code - server authority, tick rate, snapshot interpolation, client prediction and reconciliation, lag compensation, and desync recovery. Use when adding multiplayer to a game, when players report rubber-banding or "I hit them and it did not register", before an MMORPG or real-time PvP launch, and whenever the client is trusted with damage, position, loot or currency.
---

# Game Netcode

The network is a **design constraint**, not a feature you add after the gameplay works. Every system that trusted the client has to be rebuilt the day it becomes authoritative — which is why this decision belongs in Phase 0 of `game-design`, not in month nine.

## Phase 1 — Authority, per system

Name every system and who owns it. There is no "the server" in general; there is a table.

| System | Offline | Online |
|---|---|---|
| Position | client | **server**; client predicts and reconciles |
| Damage / hit | client | **server**; client shows a prediction and rolls back |
| Loot / drop | client | **server**; the client is told, never asked |
| Currency / inventory | client | **server**; a client-side change is a suggestion |
| Cooldowns | client | server checks; client shows a timer |
| Chat / presence | n/a | server |
| Cosmetic / emote | client | client, server relays |

Anything the player can gain by lying must be server-owned. Anything that only affects their own screen can stay local.

**EVIDENCE: `net/authority.md` — the table above filled in for this game, plus what happens on a rejected client action.**

## Phase 2 — Tick and interpolation

- **Fixed simulation tick** (e.g. 20 Hz or 30 Hz), independent of render frame rate.
- **Snapshot state** sent at the tick rate; the client **interpolates between two received snapshots** to render at 60+ fps.
- **Buffer** one or two snapshots so a late packet does not stall the visual.
- **Clock sync**: the client estimates server time and renders slightly in the past (interpolation delay), never in the future.
- **Bandwidth budget per player per second**, measured, with the delta-compressed payload sized against it.

**EVIDENCE: the tick rate, the interpolation delay, the snapshot payload size, and the per-player bandwidth number.**

## Phase 3 — Prediction and reconciliation

1. The client applies its input **immediately** and stores it with a sequence number.
2. The server acknowledges the sequence it has processed and sends the authoritative state.
3. The client **rewinds** to the acknowledged state, re-applies unacknowledged inputs, and continues — the classic predict/reconcile loop.
4. **Correction smoothing:** if the difference is small, blend; if large, snap. A hard snap on every packet is the rubber-band players report.
5. **Never predict what you cannot roll back** — loot, currency, permanent state. Predict movement and feel; confirm rewards.

**EVIDENCE: a recorded session with simulated 150 ms latency and 2% loss showing no permanent divergence, plus the rewind count per second.**

## Phase 4 — Combat validation and lag compensation

- **Server-side hit validation** is the default; client "I hit them" is a claim.
- **Lag compensation**: rewind targets to the shooter's view time for hitscan, bounded by a maximum rewind (e.g. 200 ms) so a high-ping player cannot shoot around corners.
- **Rate limits** per action: fire rate, ability casts, movement speed are server-checked against the simulation, not the client's timestamp.
- **Anti-dupe:** every inventory mutation is a transaction with an idempotency key (`senior-background-jobs`), and a trade is a two-phase commit — never two independent writes.

**EVIDENCE: the validation path for one shot, the rewind bound, and the trade transaction boundary.**

## Phase 5 — Failure behaviour, named

| Failure | The design's answer |
|---|---|
| Packet loss | interpolation buffer + prediction |
| 300 ms ping | bounded rewind; the player still sees their own input immediately |
| Desync | server state wins; log the divergence with both snapshots |
| Disconnect mid-trade | transaction rolls back; no partial state |
| Reconnect | session token + state resync, not a fresh character |
| Server tick overrun | degrade: drop cosmetic updates first, never gameplay state |
| Client clock skew | server timestamp is the only truth |

**EVIDENCE: `net/failures.md` with one row per failure and the code path that implements it.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| Client-authoritative movement | server simulation + prediction + reconciliation |
| No interpolation | snapshot interpolation with a delay buffer |
| Snap on every correction | smoothing with a snap threshold |
| Hit = client says so | server validation + bounded rewind |
| `lastWriteWins` inventory | transaction + idempotency key + two-phase trade |
| Reliable-ordered for everything | unreliable for state, reliable for events |
| One big state packet per frame | delta-compressed entity updates within a budget |
| "It works on localhost" | tested at 150 ms and 2% loss |

## Definition of done

- The authority table exists and every reward-bearing system is server-owned.
- Tick rate, interpolation delay and bandwidth are stated numbers.
- Prediction is implemented with rewind, and correction is smoothed.
- One combat action is validated server-side with a rewind bound.
- Every failure in Phase 5 has a code path.

## Failure modes

1. **Trusting the client for anything that can be gained.** The first cheat appears in a week.
2. **No interpolation.** Movement stutters at any packet rate.
3. **Hard snaps.** The player feels the network in their hands — the most common "bad netcode" complaint.
4. **Unbounded rewind.** High-ping players kill around corners.
5. **Reliable state channel.** One lost packet stalls the world.
6. **Trade as two writes.** The dupe arrives before the fix.
7. **Localhost-only testing.** Everything works until the first real player.

## Sources — verified live 2026-10-27

- [Gaffer On Games — Networked Physics (2004)](https://gafferongames.com/post/networked_physics_2004/) — the original predict/reconcile write-up.
- [Gaffer On Games — Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/) — rendering between snapshots.
- [Gaffer On Games — Networked Physics in VR](https://gafferongames.com/post/networked_physics_in_virtual_reality/) — the modern version of the same loop.
- [Godot high-level multiplayer](https://docs.godotengine.org/en/stable/tutorials/networking/high_level_multiplayer.html) — the engine layer under this design.
- [yojimbo](https://github.com/networkprotocol/yojimbo) — a reference reliable-UDP client/server library.
