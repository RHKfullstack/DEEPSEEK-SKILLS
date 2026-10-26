---
name: casino-game-math
description: Design and verify iGaming game mathematics - paytable, RTP, hit frequency, volatility, max win and the simulation that proves each number. Use when building or reviewing a slot, crash, dice, roulette or card game, when a client asks for "95% RTP", when a game needs a math model before art, or when a paytable must be certified. Owns the numbers; casino-rng-provably-fair owns fairness.
---

# Casino Game Math

RTP is not a design choice you declare. It is a **property of the paytable and the reel weights**, and it is proved by enumeration or simulation. A game that claims 96% and ships at 91% is not a rounding error — it is a licensing violation and a refund.

## Phase 1 — The model before the art

Every game is a probability model. Write it down before a single symbol is drawn:

1. **Outcome space.** Reels and strip lengths, or the random draw and its range. State whether the outcome is independent per spin (it is, unless you are building a skill-stop or a persistence mechanic).
2. **Weights.** The count of each symbol per strip. The probability of a symbol is `count / stripLength`, not "rare".
3. **Paytable.** Every combination, every line/ways rule, every scatters/wild rule.
4. **Bet model.** Denominations, lines/ways multiplier, and what a "bet" actually costs.
5. **Win cap.** The maximum payout in currency and in bet multiples.

**EVIDENCE: `math/model.md` — strip tables, paytable, bet model, win cap.**

## Phase 2 — RTP: enumerate when you can, simulate when you cannot

- **Exact enumeration** is possible when the outcome space is small enough to walk (dice, roulette, simple 3-reel). Compute `sum(probability × payout) / bet` exactly, as a rational number, then as a decimal.
- **Simulation** is required for 5-reel, ways-pays and bonus features. Run **at least 10 million spins**, report the RTP with a **95% confidence interval**, and show the interval converging as spins increase.
- A single number is not evidence. Ship the **convergence table** (1M, 5M, 10M, 50M) and the standard error.

```text
RTP = Σ (p_i × payout_i) / bet          exact
ŝ   = sample std dev of payout per spin
SE  = ŝ / √n ;  RTP ∈ [mean − 1.96·SE, mean + 1.96·SE]
```

If the simulated RTP interval does not contain the designed RTP, the paytable is not what the design says — the model is wrong, not the simulation.

**EVIDENCE: `math/rtp.csv` — the convergence table with CI per row, and the exact value for enumerable games.**

## Phase 3 — The numbers players feel

| Metric | Definition | Why it matters |
|---|---|---|
| RTP | returned / wagered over infinite play | the regulatory number |
| House edge | 1 − RTP | the operator's margin — say both, never one |
| Hit frequency | spins with any win / total spins | how often it feels like winning |
| Volatility index | std dev of payout / bet | the swing |
| Max win | largest possible payout | the marketing number and the liability |
| Bonus frequency | feature triggers / spins | the pacing of the session |

**Volatility is not a label.** "High volatility" means a measured standard deviation; state the index, the max win, and the fraction of RTP contributed by the top 1% of outcomes. A game whose RTP sits in a 10,000× jackpot has a completely different play experience from one that pays it evenly, at the same RTP.

**EVIDENCE: `math/metrics.md` — the table above filled with measured values from the 10M-spin run.**

## Phase 4 — The simulation harness — reproducible or it did not happen

1. **Seeded** — every run records its seed; the same seed reproduces the same result.
2. **The real engine** — the harness calls the same outcome generator and the same paytable evaluation as production. A re-implemented simulator proves nothing about the shipped code.
3. **Deterministic inputs** — bet level, line count and feature flags are fixed in the run config.
4. **Output** — per-spin log or aggregate histogram, plus: RTP with CI, hit frequency, volatility, max observed win, and the top-10 payouts with their probabilities.
5. **Runtime budget** — state spins per second, so the team can estimate a re-run.

**EVIDENCE: the harness command, the config, the seed, and the output artifact committed or published with the build.**

## Phase 5 — Certification-ready pack

A test lab (GLI, eCOGRA, iTech Labs, Gaming Associates) will ask for the model, not the game:

- the strip tables and probabilities,
- the paytable and the rules,
- the exact RTP derivation or the simulation report with CI,
- the win cap and how it is enforced,
- the bet-level matrix and the RTP per level (many games change RTP per denomination — if yours does, prove each one),
- the version of the engine the report describes.

A report that cannot be reproduced from the committed model is not submittable.

**EVIDENCE: `certification/math-pack.md` — the checklist above, each item linked to its artifact.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| "96% RTP" in the brief, no model | RTP derived from the paytable and proved by simulation |
| RTP from one 100k-spin run | 10M spins with a confidence interval and convergence table |
| A separate simulator written for the report | the production engine, seeded, same paytable code |
| "High volatility" as a label | measured volatility index and the top-1% RTP share |
| Same RTP claim at every bet level | per-level RTP proven when denomination changes the model |
| Max win stated but not enforced | the cap implemented and tested at the boundary |
| Bonus feature simulated approximately | the feature's exact probability, enumerated where possible |
| Unseeded Monte Carlo | seeded runs, reproducible, committed config |

## Definition of done

- The model exists as strips, weights, paytable and bet model.
- RTP is exact or simulated at 10M spins with a CI, and the interval contains the design.
- Hit frequency, volatility index, max win and bonus frequency are measured.
- The harness runs the production engine, seeded, and the output is committed.
- The certification pack reproduces every number from the repository.

## Failure modes

1. **RTP computed on a different engine** than the one that ships — the report is fiction.
2. **Too few spins** — a 100k run has a CI wide enough to hide a 2% error.
3. **CI never reported** — the number looks precise and is not.
4. **Bonus modeled approximately** — the feature is where most of the RTP goes, and the error hides there.
5. **Max win not enforced** — the one-in-a-billion spin pays out and the licence is at risk.
6. **Denomination changes the RTP silently** — different stake, different game.
7. **Unseeded runs** — nobody can reproduce the certification number, including you.

## Sources — verified live 2026-10-27

- [GLI standards](https://gaminglabs.com/gli-standards/) — GLI-19 (interactive gaming) and the RNG/math requirements.
- [Wizard of Odds](https://wizardofodds.com/) — reference derivations for standard games and house edges.
- [Gambler's ruin](https://en.wikipedia.org/wiki/Gambler%27s_ruin) — the basic process behind session-length and volatility intuition.
- [eCOGRA](https://www.ecogra.org/) and [iTech Labs](https://www.itechlabs.com/) — certification bodies and their published test scopes.
- [Gaming Associates](https://www.gamingassociates.com/) — independent test lab, publishes its RNG test methodology.
