---
name: casino-wallet-ledger
description: Build and audit an iGaming wallet - double-entry ledger, bet and settlement lifecycle, bonuses with wagering requirements, reconciliation with payment providers and the fraud signals that protect the money. Use when building a wallet, player balance, deposit or withdrawal flow, a bonus engine, or when balances must be explainable to a regulator or an auditor.
---

# Casino Wallet and Ledger

A balance column is not a wallet. The moment a player disputes a balance, a regulator asks for the movement history, or a bonus rule is applied retroactively, only a **double-entry ledger** answers. The default — `balance = balance + amount` — cannot answer any of them.

## Phase 1 — Double-entry, or nothing

Every movement is two entries that sum to zero:

| Account | Type | Example |
|---|---|---|
| Player cash | liability | the player's withdrawable balance |
| Player bonus | liability | bonus funds, not withdrawable until wagered |
| House / revenue | revenue | the operator's share of a losing bet |
| Game liability | liability | unsettled bets and pending wins |
| Payment gateway | asset/liability | deposits in flight, withdrawals in flight |
| Bonus expense | expense | bonus granted |

Rules:

1. **`SUM(entries) = 0` per transaction** — enforce it in code and assert it in a test.
2. **Append-only.** A correction is a new reversing entry, never an `UPDATE` on a ledger row.
3. **Every row carries**: `transaction_id`, `account_id`, `amount` (signed, minor units), `currency`, `created_at` (UTC), `reference` (bet id, payment id, bonus id), and the actor.
4. **Minor units for money** — integers, never floats (`senior-database-design` Phase 3).
5. **One currency per ledger** — no cross-currency rows; conversion is its own transaction.

**EVIDENCE: a test that asserts the sum is zero for every transaction, and one dispute resolved by walking the ledger.**

## Phase 2 — Bet and settlement lifecycle

```text
bet      : debit player cash -> credit game liability        (idempotency key = bet id)
settle   : debit game liability -> credit player cash (win) + credit house (loss)
void     : reverse both legs, same reference, new transaction
rollback : only before settle; after settle it is a correction
```

- **Idempotency key** on every request — a retried bet must not debit twice (`game-backend` Phase 2).
- **Server-authoritative** — the client sends "bet 100 on this game"; the server decides the outcome and the settlement.
- **No partial settle** — the win and the house share are one transaction.
- **Balance check inside the transaction** — `UPDATE ... WHERE balance >= 100`, never read-then-write.
- **Unsettled bets are liability** — a crash or a game provider failure must leave the money in `game liability`, not lost.

**EVIDENCE: a concurrent test firing the same bet id twice (one debit), and a provider-timeout test that leaves the bet unsettled, not lost.**

## Phase 3 — Bonus engine — where the money leaks

A bonus is a contract with conditions. State all five before writing code:

| Rule | Must be explicit |
|---|---|
| Wagering requirement | `×35` on what base: deposit, bonus, or deposit + bonus |
| Game contribution | slots 100%, live casino 10%, table games 0% |
| Max bet while wagering | the cap that makes the bonus unprofitable to abuse |
| Max cashout | the ceiling on bonus winnings |
| Expiry and forfeiture | what happens at the deadline, and on withdrawal request |

**Abuse rules that are not optional for a real operator:**

- one bonus per **player**, not per account — link by KYC identity and device, not email;
- bonus funds tracked separately from cash, so the ledger can void them;
- the wager counter is a ledger-derived number, not a mutable column;
- a withdrawal request freezes the bonus and forfeits the un-wagered remainder.

**EVIDENCE: the five rules in a config file, and a test that wagers the exact threshold and then cashes out.**

## Phase 4 — Reconciliation — daily, and it must balance

| Check | Frequency |
|---|---|
| Ledger sum per account = reported balance | every deploy, per player on demand |
| Provider (game aggregator) totals vs internal | daily, per game and per currency |
| PSP settlement files vs ledger deposits/withdrawals | daily, with an exception queue |
| Bonus liability vs the ledger bonus account | daily |
| Ledger total vs bank/total float | a limit the licence sets — know it |

A mismatch is a finding, not a rounding: name the transaction ids, do not "adjust the balance". An adjustment without a reversing entry is a cover-up.

**EVIDENCE: two consecutive daily reconciliation runs, with a documented exception path.**

## Phase 5 — Fraud and abuse signals

- Multi-account detection by payment instrument, device fingerprint, IP, and KYC identity — **not email**.
- Bonus abuse patterns: minimum deposits, maximum bonus, then a withdrawal attempt below the wagering threshold.
- Chargeback and payment-fraud velocity per player and per instrument.
- Collusion in multiplayer games (poker, live casino): same-table frequency, bet patterns, account graphs.

Log the signal, never auto-ban on a single rule (`game-backend` Phase 5). A false ban is a regulatory complaint.

**EVIDENCE: the signal table, and one review workflow that ends in a recorded decision.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| `balance = balance + amount` | double-entry ledger with zero-sum transactions |
| `UPDATE` to fix a mistake | reversing entry |
| Float money | integer minor units |
| Bonus tracked as a balance | separate bonus account, voidable |
| Wagering counter as a column | derived from the ledger |
| One bonus per account | one per KYC identity, with device and instrument checks |
| Reconciliation "when needed" | daily, with an exception queue |
| Adjusting a balance to match the provider | find the transaction, then correct with a reversing entry |
| Auto-ban on a fraud signal | log and review |

## Definition of done

- Every transaction sums to zero, asserted by a test.
- The bet/settle/void lifecycle is implemented with idempotency keys and a concurrency test.
- The five bonus rules are configuration, not code, and tested at their thresholds.
- Two consecutive reconciliations passed, with the exception path written.
- Fraud signals are logged with a review workflow.

## Failure modes

1. **Lost update** on the balance — the classic dupe, and the first thing an attacker tries.
2. **Non-idempotent bet** — a retried request debits twice.
3. **Bonus in the cash balance** — the player withdraws the bonus.
4. **Wagering counter drift** — the column and the ledger disagree, and nobody knows which is right.
5. **Silent balance adjustment** — the regulator's question has no answer.
6. **Reconciliation skipped** — the leak compounds for a month before it is found.
7. **Auto-ban** — a paying player is locked out on a weak signal.

## Sources — verified live 2026-10-27

- [GLI standards](https://gaminglabs.com/gli-standards/) — GLI-19 wallet and audit-trail requirements.
- [Malta Gaming Authority](https://www.mga.org.mt/) — player-funds and AML obligations.
- [UK Gambling Commission](https://www.gamblingcommission.gov.uk/) — license conditions on customer funds and reporting.
- [Wizard of Odds](https://wizardofodds.com/) — reference for game-level house edge, which the ledger must reproduce in aggregate.
