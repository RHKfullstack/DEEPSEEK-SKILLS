---
name: client-code-intake
description: Take on a client-supplied codebase without carrying its risk - the three provenance questions, the warranty and indemnity clause, the PROVENANCE.md record, and the re-scope path when the answer is bad. Use when a client hands over a repository or source archive to modify, rebrand, port or extend, before quoting the work, or when you need to decide what you can and cannot deliver on it.
---

# Client Code Intake

A client-supplied repository is not just code — it is an asset with a **chain of title**, and the contractor is the one who ends up shipping it. This skill turns that from a judgement call into a **ten-minute intake** with a written record, so the job can be taken without the contractor absorbing the client's risk.

The rule: **take the work, record the warranty, scope the deliverable.** Refusing is the last resort, not the first move.

## Phase 1 — The three questions, before quoting

Ask in writing, in the same message as the scope. Not as an interrogation — as intake.

1. **"Whose code is this?"** — the client owns it, a vendor sold it to them, or it is open source. Each has a different next step.
2. **"Can you show me the licence or purchase record?"** — a LICENSE file, a vendor agreement, a receipt, a contract. A link to a repository is not a licence.
3. **"What do you need me to do with it?"** — modify, rebrand, port, extend, or maintain. The answer changes what risk the work creates.

| Answer to Q1 | What you need | What you can do |
|---|---|---|
| "It is ours" | their written confirmation | full work |
| "We bought it" | the vendor agreement and what it permits (modify? rebrand? resell?) | work within those rights |
| "It is open source" | the LICENSE file, read | work if the licence permits your use; keep the notices |
| "We found it online" | **stop and use Phase 4** | re-scope, do not start |

**EVIDENCE: the client's written answers, kept with the quote.**

## Phase 2 — The clause that lets you take the job

Add to the statement of work, in the client's language, before signing:

> **Client-supplied materials.** The Client warrants that it owns, or holds sufficient rights to, all code, assets and documentation it supplies, and that the Work may be performed and delivered without infringing any third party's rights. The Contractor relies on that warranty and performs no independent title search. The Client shall indemnify the Contractor against any claim arising from the Client-supplied materials. The Contractor's liability for the Client-supplied materials is limited to the fees paid for the Work.

Three parts, and each one matters:

- **Warranty** — the client states the rights are theirs.
- **Indemnity** — if a rights holder sues, the client covers you.
- **Limitation** — if it still goes wrong, your exposure is the fee, not the damages.

Have your own lawyer review the wording once, then reuse it. This is the standard contractor position, not a special favour.

**EVIDENCE: the signed SOW containing the clause, filed with the project.**

## Phase 3 — The record inside the repository

Create `PROVENANCE.md` at the root of the work, and keep it current:

```md
# Provenance
- Supplied by: <client contact>, <date>, as <repo url / archive name / sha256>
- Client's stated rights: <owned | purchased from X on date | open source, LICENSE: MIT>
- Evidence provided: <path to licence / agreement / receipt>
- Work performed: <modify | rebrand | port | extend>
- Third-party code added by contractor: <library, licence>
```

A one-page record answers the only question that ever gets asked later: **"where did this code come from, and who said it was allowed?"**

**EVIDENCE: `PROVENANCE.md` committed with the first change.**

## Phase 4 — When the answer is "we found it online"

Do not start. Do not refuse and walk away either — offer the three outcomes, in this order:

1. **Get the rights.** The client contacts the original author or vendor and buys a licence, or obtains written permission. Then the project proceeds as Phase 1 "owned" or "purchased". This keeps the job.
2. **Clean rebuild.** Reimplement the same features with original code and licensed assets — the client keeps the product, the timeline grows, and the deliverable is theirs. Quote it as a separate line item.
3. **Decline the specific work.** Only if neither of the above fits. Say plainly what you will not do and what you will do instead, so the relationship survives the refusal.

What a contractor should not do is deliver a modified copy of code with no chain of title and call it the client's problem. The clause protects you from a claim; it does not make the copy lawful toward the rights holder, and the person who ends up explaining that is usually the one who took the money.

**EVIDENCE: the chosen outcome in writing, with the scope change if any.**

## Phase 5 — Scope the deliverable so it stays separable

Whatever the intake outcome, keep your own work separable:

- **New code in its own modules**, not interleaved into the supplied files — a clean rebuild is then a swap, not a rewrite.
- **Your tooling and scripts in your own directory**, with your own licence header if the contract says you retain rights.
- **A clear list of what you touched** — the diff summary is the deliverable's boundary.
- **Do not sign over more than the contract says** — a rebrand does not transfer your framework to the client unless it says so.

**EVIDENCE: the module boundary and the change list, delivered with the invoice.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| Start work, ask nothing | three questions in writing before the quote |
| "The client said it is fine" (verbal) | a written warranty in the SOW |
| A link to a repository as proof of rights | a LICENSE file, agreement, or receipt |
| No record of where the code came from | `PROVENANCE.md` at the root |
| Refusing the whole client | re-scope: rights, clean rebuild, or decline the specific work |
| Your code mixed into theirs | new modules, separable, change list delivered |
| Liability "somewhere in the contract" | warranty + indemnity + limitation, reviewed once |

## Definition of done

- The three questions were answered in writing before the quote.
- The SOW contains the warranty, indemnity and limitation clause.
- `PROVENANCE.md` exists in the repository.
- Any "found it online" answer has a written outcome and a scope change.
- The contractor's own code is separable and listed.

## Failure modes

1. **Verbal assurance** — "the client said they own it" is worth nothing in a dispute.
2. **No record** — a year later, nobody can say where the code came from, and you are the last one who touched it.
3. **Refusing the client instead of the work** — you lose the relationship and the future jobs.
4. **Starting before the answer** — the work is already done when the problem appears, which makes it your problem.
5. **Your code entangled** — a clean rebuild now costs a rewrite.
6. **Scope drift into the rebrand** — "just change the name and art" quietly becomes a derivative-work delivery.

## A note on this skill's authority

This is the standard contractor position on client-supplied materials, not legal advice. Have a lawyer review the clause once for your jurisdiction; the structure — warranty, indemnity, limitation — is what matters, and it is the same structure used by agencies and studios.
