---
name: casino-rng-provably-fair
description: Implement and verify casino randomness - crypto-seeded RNG, commit-reveal provable fairness, a player-runnable verifier, and the statistical tests a lab runs. Use when building dice, crash, mines or any game that claims provable fairness, when replacing Math.random with a crypto source, when a player disputes an outcome, or before an RNG submission to GLI, eCOGRA or iTech Labs.
---

# Casino RNG and Provable Fairness

A casino game's only product is trust in a number. That trust is built one of two ways: **a certified RNG** the player cannot see, or **a verifiable outcome** the player can recompute. Claiming either without the mechanism is the default this skill exists to prevent.

## Phase 1 — The randomness contract

Write the contract before the code. Every game states:

1. **Source** — a CSPRNG (`crypto.randomBytes`, `openssl rand`, the platform's crypto module). **`Math.random`, `rand()`, `mt_rand()` are defects** — they are not cryptographic and cannot be certified.
2. **Seeding** — where the entropy comes from, and how much (128 bits minimum for a server seed).
3. **Mapping** — how random bytes become an outcome (rejection sampling, not `% range`, which biases).
4. **Independence** — each outcome independent; no state carried between rounds unless it is part of the game rules and documented.
5. **Logging** — the seed, the outcome and the nonce are recorded, so a dispute can be replayed.

**EVIDENCE: `rng/contract.md` — the five points above, with the exact API call used.**

## Phase 2 — Provably fair: commit, play, reveal

The standard chain, for any game that claims it:

1. **Server seed** — 32 random bytes, generated with a CSPRNG.
2. **Commit** — `SHA256(serverSeed)` published to the player **before** the first bet. The player can verify nothing was changed later.
3. **Client seed** — supplied by the player (a string they choose), so the operator cannot precompute the result.
4. **Nonce** — incremented per bet, so the same seeds never repeat an outcome.
5. **Outcome** — `HMAC_SHA256(key = serverSeed, message = clientSeed + ":" + nonce)` → map to the game's range by rejection sampling.
6. **Reveal** — when the seed is rotated, the plaintext `serverSeed` is published. The player checks `SHA256(serverSeed)` equals the commitment from step 2, and recomputes every outcome.

```text
commitment = sha256(server_seed)
roll       = hmac_sha256(server_seed, client_seed + ":" + nonce) -> uint32 -> game range
verify     = sha256(revealed_server_seed) == commitment
```

**EVIDENCE: the commit endpoint, the reveal endpoint, and one full reproduced round in the verifier.**

## Phase 3 — The verifier the player can actually run

- **Same algorithm, independent implementation** — a small script or web page that takes seeds + nonce and reproduces the outcome. If it imports the server's code, it proves nothing.
- **Published before launch** — the verifier ships with the game, not after a dispute.
- **Open source**, so a third party can read it.
- **Test vectors** — a fixed table of (seeds, nonce, expected outcome) so anyone can check the verifier itself.

**EVIDENCE: the verifier's test vectors pass, and a screenshot or transcript of a real round reproduced from the published seeds.**

## Phase 4 — The statistical tests a lab runs

Even a crypto RNG can be misused. Run these on the outcome stream, per game:

| Test | What it catches |
|---|---|
| Chi-square (uniformity) | a symbol or roll value that is not equally likely |
| Runs test | streaks that are too long or too short |
| Serial correlation | the next outcome depends on the previous |
| Poker / multi-bit test | patterned bytes from the generator |
| Gap test | the distribution of intervals between repeats |
| Entropy estimate | a source that is not random at all |

Run each over **at least 10 million outcomes** and report the statistic, the degrees of freedom and the p-value. A p-value below 0.01 on a repeated test means the stream is not random — investigate, do not retest until it passes.

**EVIDENCE: `rng/statistics.md` — the table above with n, statistic, df and p-value per test.**

## Phase 5 — Where the RNG meets the money

- **Outcome generated server-side.** A client-generated outcome is not an outcome.
- **Seed lifecycle** — a server seed is rotated on a schedule and on player request; the old seed is revealed and archived.
- **Nonce uniqueness** — a repeated `(serverSeed, clientSeed, nonce)` triple must be impossible; enforce with a unique constraint (`casino-wallet-ledger` Phase 2).
- **Crash games** — the crash point derived from the same HMAC chain, published with the round, verifiable after the fact.
- **Retroactive change is the one unforgivable defect**: the commitment is published before the bet, so it cannot be edited afterwards. If the code can change a seed, the fairness claim is false.

**EVIDENCE: the rotation job, the archive of revealed seeds, and the constraint that prevents a nonce reuse.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| `Math.random()` / `rand()` | CSPRNG, 128-bit seed minimum |
| `% range` mapping | rejection sampling (no modulo bias) |
| "Trust us, it is random" | commit-reveal with a published verifier |
| Server seed revealed after the bet only | commitment published before the first bet |
| Verifier imports the server code | independent implementation + test vectors |
| One chi-square test | the six-test battery at 10M outcomes |
| Client-generated outcome | server-side generation, client only displays |
| Seed rotated silently | rotation schedule, revealed seeds archived |
| RTP tested but RNG not | both: the math and the stream |

## Definition of done

- The randomness contract exists, with the CSPRNG call named.
- Commit-reveal is implemented, and a real round was reproduced from published seeds.
- An independent verifier ships with test vectors.
- The six statistical tests ran at 10M outcomes with statistics reported.
- The seed lifecycle and nonce uniqueness are enforced in code.

## Failure modes

1. **`Math.random`** in a game that claims fairness — the whole claim collapses on inspection.
2. **Modulo bias** — a 2.4% skew on a dice roll at some ranges; small, systematic, and detectable.
3. **Commitment published too late** — the operator could have chosen the outcome.
4. **Verifier that calls the server** — proves the server agrees with itself.
5. **Retesting until p > 0.01** — p-hacking the randomness test.
6. **Nonce reuse** — the same seeds reproduce the same outcome, and a player can farm it.
7. **Client-side outcome** — the protocol is broken regardless of how random the client is.

## Sources — verified live 2026-10-27

- [Commitment scheme](https://en.wikipedia.org/wiki/Commitment_scheme) — the cryptographic primitive behind commit-reveal.
- [GLI standards](https://gaminglabs.com/gli-standards/) — GLI-19 RNG requirements and statistical test expectations.
- [Gaming Associates](https://www.gamingassociates.com/) — published RNG test methodology.
- [eCOGRA](https://www.ecogra.org/) and [iTech Labs](https://www.itechlabs.com/) — certification scope for RNG and game fairness.
- [Wizard of Odds](https://wizardofodds.com/) — reference probabilities for standard game outcomes.
