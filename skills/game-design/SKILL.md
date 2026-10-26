---
name: game-design
description: Design a game as a system - core loop, progression, economy, balance numbers, online authority and content pipeline - for RPG, MMORPG, and 2D/3D titles. Use when designing or reviewing game mechanics, when building a game from an engine template, when balancing loot or progression, when adding multiplayer to a single-player design, or when the ask is "build a game" and the answer must not be the engine's default template. Start here: load this before any other game skill for the design decisions, then load the domain skill it names.
---

# Game Design

An engine template is a prototype with a title screen. RPG Maker's default project, Unity's starter scene, Godot's template, a tutorial's "player moves and jumps" — all of them are the same thing: **a demo of the engine**, not a design.

A game is a system of decisions that produce a feeling over time. This skill forces those decisions to be made explicitly, written down, and made testable — the same standard the rest of the pack applies to code.

## The family — who owns what

| Skill | Owns |
|---|---|
| `game-design` (this) | the loop, pillars, systems, balance sheet, offline/online decision, slice |
| `game-client-2d` | 2D input, animation, tilemaps, camera, pixel-perfect |
| `game-client-3d` | draw calls, triangles, materials, LOD, physics layers |
| `game-netcode` | the per-system authority table, prediction, reconciliation, lag compensation |
| `game-backend` | accounts, inventory, currency, sharding, persistence |
| `game-quality-gate` | the frame-time threshold and the measurement method |
| `game-assets` | licensing, the credits record, the asset pipeline |

Load this skill first, then the domain skill a phase names. When two could fire, this table decides.

## Phase 0 — The one-paragraph game

Before any asset, scene or script, write these five sentences:

1. **The verb.** What the player does most, in one word (fight, build, explore, manage, solve).
2. **The loop.** verb → reward → spend → stronger → harder verb. If it does not close, it is not a loop.
3. **The session.** How long one sitting is, and what the player has after it that they did not have before.
4. **The failure.** What losing costs, and how the player recovers.
5. **The fantasy.** Who the player imagines themselves to be.

Five sentences that do not close into a loop mean the game is not designed yet. No amount of content fixes a loop that does not close.

**EVIDENCE: `design/one-paragraph.md` with the five answers.**

## Phase 1 — Pillars and one reference

Three pillars maximum — the three things the game must do well, each with a game that proves the standard. A pillar without a reference is an aspiration.

| Pillar | Reference | What is being matched |
|---|---|---|
| e.g. "combat reads in one frame" | a named game | its telegraph timing and hit feedback |
| e.g. "progression is legible" | a named game | its level curve and UI for it |

**Copy the mechanics, never the assets.** Mechanics are studied and reimplemented; art, audio, code and names are not yours unless licensed (see Phase 5).

**EVIDENCE: `design/pillars.md` — three pillars, three references, one sentence each on what is matched.**

## Phase 2 — Systems, written as rules

For each system, write the **rules**, not the content:

- **Combat:** hit resolution (instant, wind-up, projectile), damage formula, mitigation, status effects, telegraph windows.
- **Progression:** XP source, XP curve, what a level grants, the cap and what happens at it.
- **Economy:** every currency source, every sink, and the ratio the player experiences per hour.
- **Loot:** table with weights, pity or guarantee rule, and the drop the player will farm.
- **Difficulty:** the axes that change (accuracy, aggression, resource pressure, pattern complexity) — never "more HP" alone.
- **Death and respawn:** what is lost, where the player returns, what recovers it.

**EVIDENCE: `design/systems.md` — one section per system, rules only, no numbers yet.**

## Phase 3 — The balance sheet — numbers in the repo

A game without numbers is a mood board. Every one of these lives in a table the team can edit:

| Number | Why it is a decision |
|---|---|
| Time-to-kill (TTK) per enemy tier | the pace of combat, in seconds |
| Player DPS at each level band | what "stronger" means numerically |
| XP to next level, per band | the pace of progression, in minutes |
| Currency income and sink per hour | inflation or starvation |
| Drop rate × attempts = expected hours | the grind, stated as time |
| Cooldown and resource costs | the rhythm of the verb |

State the target, the current measured value, and the delta. "We will balance later" is how a game ships with a broken economy.

**EVIDENCE: `design/balance.csv` (or `.md` table) with target vs measured per row, and the formula each number comes from.**

## Phase 4 — Offline vs online — decide the authority

| Question | Offline | Online / MMORPG |
|---|---|---|
| Who owns state | the client | **the server**; the client predicts and reconciles |
| Tick / update rate | frame loop | fixed tick, stated (e.g. 20 Hz) with interpolation |
| Latency budget | none | per action: input → prediction → server ack → correction |
| Persistence | save file, versioned, migratable | player value in a database (`senior-database-design`), hot session state in a store (`game-backend` Phase 4) |
| Anti-cheat boundary | trust the player | never trust the client for damage, loot, currency or position |
| Content delivery | shipped build | patchable manifest + version negotiation |
| Failure modes | corrupt save, crash | desync, rollback, dupe, disconnect mid-trade |

The per-system split - who owns position, damage, loot, currency - is owned by `game-netcode` Phase 1; this phase decides only offline vs online.

An MMORPG is not a single-player game with a lobby. The authority model changes every system above, and it is cheaper to decide in Phase 0 than to retrofit at launch.

**EVIDENCE: `design/authority.md` — one row per system naming who owns it and what happens on desync or disconnect.**

## Phase 5 — Assets and licensing — the chain or nothing

Every asset carries a license and a source URL in `assets/CREDITS.md`:

| Source | Use |
|---|---|
| CC0 packs (Kenney, Quaternius, OpenGameArt CC0) | safe to ship, keep the record |
| CC-BY 4.0 | credit, licence name + link, changes noted — see `game-assets` Phase 1 |
| Purchased / commissioned | keep the license file with the asset |
| Engine-provided defaults | check the engine's license for redistribution |
| **Leaked or ripped proprietary assets** | **never** — a rename does not change a derivative work |

The full licence schema - attribution text, share-alike and OFL font rules - is owned by `game-assets` Phase 1. This table is the summary.

**Clean-room rebuilds are the legitimate form of "rebuild":** study the mechanics, implement from scratch with original or licensed art — the way OpenRCT2 reimplements its original engine. That is reimplementation. Decompiled or disassembled source is not a legitimate model — it is derived from the original binary and carries the original rights — and leaked or decompiled code is never an asset.

**EVIDENCE: `assets/CREDITS.md` — asset, license, source URL, and what ships with it.**

## Phase 6 — The vertical slice before the content

One complete slice — one level, one enemy set, one shop, one save — that a stranger can play for ten minutes. It proves the loop, the feel and the pipeline before content volume makes a bad loop expensive.

Content scales a working loop. It never fixes a broken one.

**EVIDENCE: the slice's build, a 10-minute play recording or a scripted test, and the three things it proved.**

## Anti-default table — the engine's answer vs the design's answer

| Default | The design replaces it with |
|---|---|
| Engine template scene | the one-paragraph game and a vertical slice |
| "Add XP and levels" | an XP curve with time-to-level per band |
| Random loot from `rand()` | a weighted table with a pity rule |
| No currency sink | sinks stated per hour against income |
| Difficulty = more enemy HP | the four axes, tuned separately |
| Checkpoint respawn with no cost | a stated death cost and recovery path |
| "We will add multiplayer later" | an authority model from Phase 0 |
| Client-authoritative movement | server authority + prediction + reconciliation |
| Copied or ripped assets | licensed assets with a credits record |
| "Balance later" | a balance sheet in the repo with targets |
| Content volume as progress | slice first, then volume |

## Definition of done

- The five sentences close into a loop.
- Three pillars, each with a reference game and what is being matched.
- Every system has rules; every tunable has a number and a target.
- The authority model is decided per system, with the desync behaviour named.
- Every asset has a license and a source URL.
- The vertical slice exists and was played.

## Failure modes a naive reviewer misses

1. **The template shipped as a game.** Menu, pause, save and settings all inherited, never decided.
2. **A loop that does not close.** The reward does not feed the verb, so the game ends when the content ends.
3. **Numbers in code, not in a table.** Balance becomes a programmer task and never happens.
4. **Economy with sources and no sinks.** Inflation arrives at launch, not in testing.
5. **Difficulty as a multiplier.** Every enemy is the same enemy, longer.
6. **Multiplayer retrofitted.** Every system that trusted the client has to be rebuilt.
7. **Asset license with no record.** Legal risk discovered at launch, when rework is most expensive.
8. **Content before the slice.** A hundred levels of a loop nobody has played for ten minutes.
9. **"Feels off" with no measurement.** Frame time, TTK, input latency — measure before tuning.
10. **Copying a game's assets instead of its mechanics.** The mechanics are the study; the assets are the liability.

## Sources — verified live 2026-10-27

- [Godot documentation](https://docs.godotengine.org/en/stable/) — engine reference for 2D/3D implementation.
- [Game Programming Patterns](https://gameprogrammingpatterns.com/) — the canonical patterns (component, state, update, spatial partition).
- [Game Developer (GDC) articles](https://www.gamedeveloper.com/) — postmortems and design analyses.
- [Red Blob Games](https://www.redblobgames.com/) — interactive explanations of pathfinding, hex grids and procedural maps.
- [Gaffer On Games](https://gafferongames.com/) — networked physics, snapshots, prediction and reconciliation.
- [Kenney assets](https://kenney.nl/assets) — CC0 asset packs. [OpenGameArt](https://opengameart.org/) — mixed licences: each asset states its own, so check the row (see `game-assets` Phase 1).
- [OpenRCT2](https://github.com/OpenRCT2/OpenRCT2) — a clean-room reimplementation, as the model for a legitimate rebuild.

**Rule:** verify a source before citing it. A dead link in a design doc is a finding, not a footnote.
