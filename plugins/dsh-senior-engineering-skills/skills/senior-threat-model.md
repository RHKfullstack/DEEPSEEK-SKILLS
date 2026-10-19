# Senior Threat Model

Produce a threat model that changes engineering decisions: a bounded scope, a diagram with real trust boundaries, systematically enumerated threats, ranked risks, and mitigations each mapped to a testable requirement.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A new system, service, integration, or data flow is being designed.
- A significant change alters a trust boundary: new external API, new third-party processor, new authentication path, new tenant model.
- A compliance or review process requires documented threat analysis (NIST SP 800-53 RA-3, Microsoft SDL).
- A security incident revealed a class of threat nobody had considered.
- An AI/LLM feature is being added, which brings a distinct threat set ([OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)).

## When it does not

- The system is already built and running and the ask is to reduce exposure; use hardening.
- The ask is narrow: "is this line injectable" — that is code review.
- The analysis would have no decision attached to it (nobody can change the design). Say so and produce a risk register entry instead.

## Core rule

A threat model is an engineering artifact, not a document. Every threat must end in one of four decisions — mitigate, transfer, accept, or eliminate — with an owner and a verifiable control. Anything else is a list of fears.

## Phase 1 — Scope, assets, and assumptions

1. Define what is in scope and, more importantly, what is explicitly out (adjacent systems, the identity provider, the cloud provider's own control plane).
2. Enumerate assets by value: credentials and keys, personal or regulated data, money movement, availability of the service, and reputation.
3. For each asset, state the properties that matter. For security, those are confidentiality, integrity, non-repudiation, accountability, authenticity and resistance ([ISO/IEC 25010 security characteristic](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010), as rendered by the ISO 25000 portal — a secondary rendering, not the ISO text itself). Availability is a Reliability sub-characteristic, not a security one: name it separately so "the service was up" is never recorded as a security property.
4. List the actors: anonymous internet user, authenticated user, tenant administrator, internal service, operator, third-party integration, and the malicious insider.
5. State assumptions explicitly and mark each one as verified or unverified. "The load balancer terminates TLS and forwards a trusted client IP header" is an assumption with a real consequence.
6. Identify the risk tolerance question for the business owner: what class of harm is unacceptable regardless of likelihood?
7. EVIDENCE: scope statement, asset/property table, actor list, assumption register with verification status.

## Phase 2 — Model the system and its trust boundaries

1. Draw a data flow diagram with four element types only: external entity, process, data store, data flow.
2. Mark every trust boundary — a line that data crosses where the level of trust changes. If a diagram has no boundaries drawn, the model is decorative.
3. Mark the authentication and authorisation decision points; there should be a visibly small number of them.
4. Mark where data changes representation: deserialization, parsing, decryption, template rendering, shell invocation.
5. Mark where data leaves your control: outbound webhooks, third-party APIs, log sinks, analytics, backups, model providers.
6. Keep the diagram at one level of abstraction; a second, more detailed diagram for the highest-risk flow.
7. EVIDENCE: the DFD itself, stored in the repo next to the code, with the boundary list written out.

## Phase 3 — Enumerate entry points and data flows

1. List every entry point with its authentication requirement and its input validation point.
2. List every data flow with its protocol, direction, and the trust level at each end.
3. Include non-obvious flows: health checks, metrics scrapers, admin consoles, debug ports, backup jobs, CI deploy hooks, queue consumers, scheduled jobs, and the supply chain.
4. Include the build and deploy path as a flow into production — it is an entry point with production privilege.
5. Include the human path: how an operator runs a command, and what that command can do if the input is wrong.
6. For each flow that crosses a boundary, name which side validates and which side must not be trusted.
7. EVIDENCE: entry-point table (path, auth, validation, boundary crossed) and flow table.

## Phase 4 — Systematic threat enumeration

1. Apply STRIDE per element, not per system: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege. Walk each DFD element through all six.
2. Apply the OWASP Top 10:2025 and API Top 10 as a checklist over the flows ([OWASP Top 10:2025](https://top10.owasp.org/2025/) — A03 is Software Supply Chain Failures and A10 is Mishandling of Exceptional Conditions, neither of which existed in the 2021 list — and [OWASP API Security Top 10](https://owasp.org/API-Security/)).
3. Apply privacy-specific threats for personal data using LINDDUN: linking, identifying, non-repudiation, detecting, data disclosure, unawareness, non-compliance.
4. For any AI/LLM feature, apply the LLM Top 10: prompt injection (direct and indirect), insecure output handling, training-data poisoning, model denial of service, supply-chain risk, sensitive information disclosure, insecure plugin design, excessive agency, overreliance, model theft.
5. Use attack trees for the two highest-value assets: root node is the attacker's objective, children are alternative means, leaves are concrete preconditions.
6. Map each identified threat to a weakness class so it is actionable: [CWE Top 25](https://cwe.mitre.org/top25/) — CWE-79, CWE-89, CWE-22, CWE-502, CWE-862, CWE-918. Ranks are edition-specific: the [2025 archive](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) shows the 2025 ranks as #1 CWE-79, #2 CWE-89, #3 CWE-352, #4 CWE-862, #5 CWE-787, so re-check the ranks when MITRE rolls the list over.
7. Include abuse cases and not only misuse cases: the legitimate feature used at scale for illegitimate ends (bulk enumeration, credential stuffing, resource exhaustion, scraping).
8. EVIDENCE: threat table with element, STRIDE/other category, weakness ID, and the specific scenario in one sentence.

## Phase 5 — Rank and prioritise

1. Score each threat on likelihood and impact with a stated rationale, not a bare number.
2. Use a transparent method — a documented DREAD-style score or the organisation's existing risk matrix — and apply it consistently.
3. Weight by exposure: an unauthenticated internet-facing path outranks an authenticated internal one at equal technical severity.
4. Weight by detectability: a threat that leaves no trace is worse than one that trips an alert.
5. De-duplicate threats that share a root cause and a single fix; one missing authorization check may produce twelve findings.
6. Re-rank after considering existing controls — a mitigated threat carried forward as "high" hides the real gaps.
7. EVIDENCE: ranked risk register with method, score, rationale, and existing-control column.

## Phase 6 — Mitigations mapped to verifiable controls

1. For each threat, choose mitigate, transfer, accept, or eliminate, and name the owner.
2. Write each mitigation as a requirement that can be verified: not "sanitise input" but "all values reaching the SQL layer are parameterised, verified by a lint rule and a test with a quote character in the payload".
3. Map mitigations to a standard control ID so verification is not inventing its own bar: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) requirement, [NIST SP 800-53](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) control, or a CIS safeguard number from the [18 CIS Critical Security Controls](https://www.cisecurity.org/controls/cis-controls-list).
4. Define the detection for threats that are not fully preventable — the log line, metric, or alert that would reveal exploitation.
5. Define the residual risk for each accepted threat, with a review date.
6. Identify which mitigations are already implemented and which are new work; the model's output is a backlog item list, not a report.
7. EVIDENCE: mitigation table with decision, owner, control ID, verification method, and detection.

## Phase 7 — Record, review, and keep it alive

1. Store the model in the repository beside the code it describes; a wiki page with no owner rots in one quarter.
2. Record the model date, the participants, the scope revision, and the version of the design it applies to.
3. Note the signals for re-modelling: new trust boundary, new data class, new entry point, a shipped feature that invalidates an assumption.
4. Convert mitigations into tracked work items with acceptance criteria, and link them back to the threat IDs.
5. Re-run the model at the design review of the next change that touches a boundary, not on an annual calendar.
6. Reference the architectural decisions the model produced as ADRs so the reasoning survives refactoring ([adr.github.io](https://adr.github.io/)).
7. Confirm the threat IDs are stable and referenced by the tests, tickets, and code comments that implement the mitigations.
8. Confirm the diagram and register are readable by an engineer who joins the team later, with no tribal context required to interpret them.
9. Re-issue the model with a version bump when a boundary changes, and diff it against the previous version in review.
10. EVIDENCE: committed model file, work items linked to threat IDs, ADR list, agreed re-model triggers, version diff.

## Phase 8 — Validate the model

1. Walk the model with someone who did not write it and who knows the system; capture the threats they add and credit them in the document.
2. Cross-check the model against a known incident or a public breach in the same domain, and confirm the model would have surfaced that path.
3. Verify each mitigation exists as a test, lint rule, policy check, or monitoring alert — not as a sentence in a document.
4. Re-score after mitigations land; a model whose top risk never changes is not being used to make decisions.
5. Record the model's limitations: what the participants did not know, and which assumptions carried the most weight.
6. Confirm the model is discoverable from the code it describes, for example linked from the service README.
7. EVIDENCE: review notes, cross-check result, mitigation-to-control traceability, re-scored register, model location.

## Definition of done

- The DFD has drawn trust boundaries and is committed beside the code it models.
- Every threat names a scenario rather than a category, and maps to a weakness or control identifier.
- Every threat ends in mitigate, transfer, accept, or eliminate, with a named owner.
- Accepted risks carry an expiry date and a defined detection.
- The model states the design version it applies to and the triggers that force a re-model.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Scope statement; asset/property table; assumption register |
| 2 | Committed DFD; boundary list; auth decision points |
| 3 | Entry-point table; flow table including build and ops paths |
| 4 | Threat table with category and CWE/LLM/OWASP mapping |
| 5 | Ranked risk register with method and rationale |
| 6 | Mitigation table with owner, control ID, verification, detection |
| 7 | Committed model; linked work items; ADRs; re-model triggers |

## Failure modes a naive reviewer misses

1. **Threat modelling the box, not the boundaries.** Effort goes into enumerating features inside the trusted zone while the actual risk sits at the two lines where unauthenticated input crosses in.
2. **No DFD, or a DFD with no boundaries.** A diagram that connects everything at one trust level produces no boundary threats, which are most of them.
3. **Generic threats instead of scenarios.** "SQL injection" is a category; "the tenant filter is applied in the controller and omitted in the export job" is a threat. Only the second one leads to a fix.
4. **Assumptions left implicit.** The model depends on a header being trustworthy, a network being private, or a queue being internal, and nobody wrote it down — so nobody notices when it stops being true.
5. **Excluding the build and ops path.** The CI token, the deploy role, and the operator's shell are entry points with production privilege and are almost always out of scope on paper.
6. **Mitigation stated as intention.** "We will validate input" is unverifiable and will not be. Every mitigation needs a test or a lint rule.
7. **Ignore-the-insider.** Every actor is external; the malicious or compromised employee, the over-broad service account, and the stale contractor account are unmodelled.
8. **LLM features modelled with a web threat list only.** Indirect prompt injection arrives through retrieved documents and tool output, not through the user's input field, so input validation at the edge misses it entirely.
9. **One-time exercise.** The model is produced for the audit and never revisited, so it describes an architecture that was replaced six months later.
10. **Ranking without rationale.** Scores with no written justification are unarguable, so the loudest stakeholder determines priority instead of the analysis.

## Sources

- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html) — process, DFD conventions, and STRIDE application.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) — the verification bar mitigations map to.
- [OWASP Top 10:2025](https://top10.owasp.org/2025/) — risk classes applied per flow in Phase 4; A03 is Software Supply Chain Failures and A10 is Mishandling of Exceptional Conditions. The [project hub](https://owasp.org/www-project-top-ten/) indexes earlier editions.
- [OWASP API Security Top 10](https://owasp.org/API-Security/) — API-specific threats including object and function level authorisation.
- [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/) — prompt injection, insecure output handling, excessive agency.
- [CWE Top 25](https://cwe.mitre.org/top25/) and the [CWE Top 25 2025 archive](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — weakness IDs that make threats actionable; ranks quoted in this body are 2025 ranks.
- [NIST SP 800-53 Revision 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) — RA-3 risk assessment and SA-11 developer testing.
- [Microsoft Security Development Lifecycle](https://www.microsoft.com/en-us/securityengineering/sdl/) — threat modelling as a required SDL practice.
- [Architecture Decision Records](https://adr.github.io/) — recording the design decisions the model forces.
- [CIS Controls](https://www.cisecurity.org/controls) — safeguard IDs for mitigation mapping; the enumerated list is the [18 CIS Critical Security Controls](https://www.cisecurity.org/controls/cis-controls-list).
- [ISO/IEC 25010](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — the ISO 25000 portal's rendering of the standard, not the ISO text itself; the security characteristics that define each asset's required properties.
