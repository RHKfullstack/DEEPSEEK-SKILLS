---
name: casino-compliance
description: Build an iGaming product that a regulator can license - jurisdiction gating, KYC and AML, responsible gambling controls, audit trail and bonus terms. Use when a client says "build a casino/sportsbook", when choosing a licence, when adding deposits or withdrawals, when a bonus has terms attached, or before an application to a licensing authority.
---

# Casino Compliance

The licence is not paperwork collected at the end. It is a **set of features that must exist in the build**: age verification before the first bet, a self-exclusion that actually blocks, a limit the player cannot lift instantly, and an audit trail that answers "who changed this and when".

Building the game and adding compliance later is the default that fails an application.

## Phase 1 — Jurisdiction first — it changes the feature list

Before a line of UI, write the matrix:

| Item | What the licence decides |
|---|---|
| Target markets | which countries you may accept players from — and which you must block |
| Licence | Curacao, Malta (MGA), UK (UKGC), Isle of Man, Gibraltar, Philippines (PAGCOR), a local state licence |
| Products allowed | slots vs table games vs live casino vs sportsbook vs crash |
| Player funds | segregated, trusted, or unprotected — stated in the terms |
| Age | 18 or 21, and the proof required |
| Bonus rules | caps, wagering, and whether a bonus is allowed at all in that market |
| Reporting | what the regulator receives, and how often |
| Advertising | what claims are lawful, and where affiliates may promote |

**A feature that is legal in one market and illegal in another must be gated by jurisdiction, server-side**, not by a UI toggle. Geolocation plus licence check on every session, and a market with no licence means no access — not a warning.

**EVIDENCE: `compliance/jurisdictions.md` — the matrix, and a server-side gate that returns a refusal for an unlicensed country.**

## Phase 2 — KYC and AML — before the money moves

| Gate | Rule |
|---|---|
| Age | verified before the first real-money bet; a self-declared date of birth is not verification |
| Identity | document + liveness, or a government e-ID; stored with the verification result, not the document itself unless lawful |
| PEP / sanctions | screening at sign-up and on a schedule |
| Source of funds | triggered at a threshold set by the licence, not a fixed number invented by the team |
| Monitoring | transaction pattern rules, with a case-management queue |
| Record keeping | five years is the common floor — confirm for the licence in Phase 1 |

**A player must not withdraw before identity is verified** in most licences. Build the withdrawal path so KYC is a blocking state, not a banner.

**EVIDENCE: the gate order in the deposit/withdrawal state machine, and one refusal path per gate.**

## Phase 3 — Responsible gambling — controls that work

| Control | The requirement |
|---|---|
| Deposit limit | player-set, applied immediately, decrease immediate, increase after a cool-off |
| Loss / wager limit | daily, weekly, monthly, with the same asymmetry |
| Session reminder | a reality check at a stated interval, with a summary of time and net result |
| Time-out | a player-initiated break, 24h to 6 weeks, that blocks play and marketing |
| Self-exclusion | a long block (6 months to 5 years), irreversible during the term, **and it must block marketing too** |
| National exclusion | check the jurisdiction's register where one exists (e.g. GAMSTOP in the UK) |
| Age and vulnerability | flags for young players and known vulnerability, with a documented escalation |
| Staff training | a named owner for the policy, and a record that staff were trained |

**The default bug:** a limit that applies on the next session, or a self-exclusion that blocks login but not the affiliate emails. Both fail an audit.

**EVIDENCE: a test per control, including that a self-exclusion blocks play *and* marketing, and that a limit decrease is immediate.**

## Phase 4 — The audit trail and the regulator's questions

Every one of these must be answerable from the database, for any player, at any date:

1. Who registered, from where, with what verification.
2. Every deposit and withdrawal, with the payment method and status.
3. Every bet, outcome, settlement — with the RNG seed where fairness is claimed.
4. Every limit, exclusion, and the actor who set it.
5. Every bonus grant, the terms at that moment, and the wagering progress.
6. Every admin action: who changed a balance, a limit, a bonus, a KYC status.
7. Every complaint, and its resolution.

**Log the terms version with the bonus grant** — a bonus judged by today's terms rather than the ones in force when it was granted is a regulatory finding.

**EVIDENCE: `compliance/audit-map.md` — one row per question above, naming the table and the retention period.**

## Phase 5 — Bonus terms and marketing

- **Terms before the claim**, in plain language, with the five rules from `casino-wallet-ledger` Phase 3.
- **The terms version is recorded on the grant** (Phase 4).
- **Advertising claims** must be verifiable — "96% RTP" needs the certification, "biggest win" needs the data.
- **Affiliates are the operator's responsibility** — a compliance page, a monitoring rule, and a takedown path.
- **No marketing to a self-excluded player** — enforced at the send, not filtered by the list afterwards.

**EVIDENCE: the terms text, the version recorded on a grant, and a marketing send that refuses an excluded recipient.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| "Add a casino UI" with no licence decision | jurisdiction matrix before the first screen |
| Geolocation in the client | server-side gate per session |
| Self-declared age | verified identity before the first bet |
| KYC as a banner | a blocking state in the withdrawal path |
| Limits that apply tomorrow | immediate on decrease, cool-off on increase |
| Self-exclusion blocking login only | blocks play **and** marketing |
| Bonus judged by current terms | terms version recorded at grant |
| Audit trail from application logs | a queryable record per question in Phase 4 |
| Affiliate marketing unmanaged | compliance page, monitoring, takedown path |

## Definition of done

- The jurisdiction matrix exists and the server refuses an unlicensed market.
- Age and identity verification block the first bet and the first withdrawal.
- Every responsible-gambling control has a test, including self-exclusion blocking marketing.
- The seven audit questions are answerable from the database with a stated retention.
- Bonus terms are versioned and recorded on the grant.

## Failure modes

1. **Client-side geolocation** — trivially bypassed; the regulator sees an unlicensed player.
2. **KYC after withdrawal** — the money has left, and the identity is unknown.
3. **Self-exclusion that misses email** — the player is excluded from play and still receives offers.
4. **Limit increase without cool-off** — the control is decorative.
5. **Bonus terms changed after the grant** — a complaint the operator loses.
6. **Audit trail in application logs** — no query, no retention, no answer.
7. **Affiliate claims unchecked** — the operator carries the fine.

## Sources — verified live 2026-10-27

- [Malta Gaming Authority](https://www.mga.org.mt/) — licence conditions, player funds, AML.
- [UK Gambling Commission](https://www.gamblingcommission.gov.uk/) — LCCP, social responsibility, self-exclusion.
- [PAGCOR](https://www.pagcor.ph/) — Philippine licensing framework.
- [GAMSTOP](https://www.gamstop.co.uk/) — the national self-exclusion scheme to integrate against in the UK.
- [BeGambleAware](https://www.begambleaware.org/) and [NCPG](https://www.ncpgambling.org/) — player-facing support resources to link, not to paraphrase.
- [GLI standards](https://gaminglabs.com/gli-standards/) — GLI-19 audit-trail and reporting expectations.
