# Senior Architecture Review

Review a design or an existing architecture as a set of explicit trade-offs: quality attributes bought and spent, decisions recorded with their rejected options, interface contracts checked against a published rule set, data ownership and failure semantics verified on the real code, and a migration path that is reachable from today's system.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A design document, RFC, or ADR is proposed and someone must decide whether to accept it.
- A new service, integration, datastore, or significant public interface is being introduced.
- Two design options must be compared and a decision recorded rather than argued.
- Coupling, ownership, or failure behaviour in a large existing codebase is under scrutiny.
- A "we will refactor to X" claim needs a migration path that lands incrementally.

## When it does not

- The decision is a local implementation choice inside one module with a reversible outcome; use code review.
- The task is auditing a completed diff rather than a design; use work audit.
- The proposal is an interface-only change already covered by the release gate and contract tests.

## Core rule

A review is a trade-off statement, not a preference: for each significant decision, name the quality attribute it buys and the one it spends ([ISO/IEC 25010](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — the ISO 25000 portal's rendering of the standard, not the ISO text itself). Every decision gets a record containing the options rejected and why, because a decision without alternatives is unusable two years later ([Nygard, Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions); [MADR](https://adr.github.io/madr/), [ADR hub](https://adr.github.io/)).

State in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Fix the question and assemble the artifacts

1. Write the decision to be made as a single sentence with a deadline, and separate it from the decisions already made.
2. Collect the real artifacts: the design doc, the current deployed call graph, the schema, the deploy config, and the last three months of change history.
3. Read the deployed reality, not the diagram: `kubectl get deploy,svc,ingress -A -o yaml`, or the compose and Terraform state that actually runs.
4. Establish the change-frequency map that shows where coupling hurts: `git log --format='%h' --name-only --since='6 months ago' -- src/ | sort | uniq -c | sort -rn | head -30`.
5. Identify the consumers of any interface in scope — internal callers, other services, mobile clients, partners, and scheduled jobs.
6. Classify the decision as a one-way or two-way door: irreversible choices (data model, tenancy, identity, public API shape) get the full review; a reversible one gets a shorter one.
7. EVIDENCE: the decision sentence, artifact inventory with revisions, deployed call graph, change-frequency map, consumer list, one-way/two-way classification.

## Phase 2 — Convert the design into quality-attribute trade-offs

1. For each significant decision, fill one row: decision, attribute bought, attribute spent, and the mechanism that produces the effect.
2. Cover the ISO/IEC 25010:2023 product quality characteristics explicitly: functional suitability, performance efficiency, compatibility, interaction capability, reliability, security, maintainability, flexibility and safety ([ISO 25000 portal rendering](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — a secondary rendering, not the ISO text itself). Silence on an attribute is an unexamined risk, not neutral.
3. Translate every adjective into a number: "fast" becomes a p95 latency and a payload size; "scalable" becomes a concurrency figure and a first bottleneck.
4. Check whether the design's stated benefits depend on a property the current system does not have — the mechanism must exist today or be scheduled.
5. Run the Well-Architected question sets over the design for the pillars in scope ([AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html)); record the questions that produced no answer.
6. For each attribute spent, state the mitigation and its owner.
7. EVIDENCE: the decision-to-attribute table with the trade named per row, the numeric version of each adjective, the unanswered question list.

## Phase 3 — Demand the decision record

1. Confirm an ADR exists for each significant decision, using a template with context, options considered, decision outcome, status, and consequences ([MADR](https://adr.github.io/madr/)).
2. Read the rejected options and the reason each lost. A record without alternatives is a press release and does not constrain the future.
3. Check the record states what would cause the decision to be revisited, so a later reader can tell whether the constraint still holds.
4. Check the status field is current — `proposed`, `accepted`, `superseded by <id>` — and that superseding links both directions.
5. Confirm records live in version control next to the code they govern (`docs/adr/`), so they are diffed in review rather than kept in a wiki.
6. Verify the record cites the evidence it was based on: the load test, the cost model, the vendor limit.
7. EVIDENCE: the committed ADR files with their paths, the rejected-options sections quoted, the supersession links, the cited evidence.

## Phase 4 — Review the interface contracts, not the diagrams

1. Check the error contract is defined and machine-readable: RFC 9457 `application/problem+json` with `type`, `title`, `status`, `detail`, and `instance` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)).
2. Probe the real error shape: `curl -s -D- -H 'Accept: application/problem+json' <endpoint>` and compare the returned media type and body against the document.
3. Lint the specification in CI so drift fails the build: `npx @redocly/cli lint openapi.yaml`.
4. Check HTTP semantics are used as defined — status codes, methods, conditional requests, `ETag`/`If-Match`, `Retry-After` ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)).
5. Check pagination, filtering, sorting, idempotency keys, and rate-limit signalling are specified rather than discovered per endpoint; cite the numbered rule ([Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/), [Google API Improvement Proposals](https://google.aip.dev/), [Google API Design Guide](https://docs.cloud.google.com/apis/design)).
6. Check versioning strategy and deprecation policy against a consumer inventory: who is on v1, when it stops working, and how they are told.
7. Check every resource limit the client must respect is in the specification: page size ceiling, payload ceiling, concurrency, timeout.
8. EVIDENCE: the API contract diff, the rule IDs cited per item, the live error-response capture, the consumer/version inventory.

## Phase 5 — Check data ownership and transaction boundaries

1. Map every table to exactly one writing service. Two writers on one table is a finding, regardless of how the diagram is drawn.
2. Search for cross-service writes: `grep -rn 'INSERT INTO <table>\|UPDATE <table>' services/ --include=*.sql --include=*.ts --include=*.py`.
3. Confirm the aggregate boundary matches the transaction boundary: a business invariant that spans two services needs a saga or a compensating action, not a distributed lock.
4. Confirm no service reads another service's tables directly instead of its interface.
5. Check the consistency model is stated with a bound: "eventually consistent" without a maximum lag is untestable.
6. Confirm identifier ownership and generation (who mints the id, and whether it leaks ordering or tenancy).
7. EVIDENCE: the table-to-writer mapping from schema and code search, the boundary alignment statement, the consistency bound, the id-generation note.

## Phase 6 — Check failure semantics and measure coupling on the code

1. Verify a timeout exists on every outbound call, and read the value: `grep -rn 'timeout' --include=*.yaml --include=*.ts --include=*.go src/ | head -40`.
2. Verify retries use backoff with jitter and a budget, so a retry storm does not amplify the original overload.
3. Verify retried operations are idempotent, or carry an idempotency key that the receiver records.
4. Verify circuit breaking and bulkheads exist, and know the behaviour when a dependency is slow versus down.
5. Measure coupling on the real code, not the intent: `npx madge --circular --extensions ts src/` or `pnpm exec depcruise --validate .dependency-cruiser.js src/` for cycles; `go list -deps ./...` or `cargo tree` for the real graph.
6. Count the modules a typical change touches: `git diff --name-only <base>...HEAD -- src/ | cut -d/ -f1-3 | sort -u | wc -l`. A design needing twelve modules for one feature is coupled whatever the diagram says.
7. Check fan-in on the changed component and confirm the change does not require a synchronized release of its callers.
8. EVIDENCE: timeout/retry/backoff config lines, idempotency mechanism, cycle-detector output, touched-module count for a recent change, fan-in figure.

## Phase 7 — Verify operability, the scale envelope, and the migration path

1. Run the 12-factor checks literally and cite file evidence per item: config in the environment, backing services as attached resources, build/release/run separation, disposability, dev/prod parity ([12-Factor App](https://12factor.net/)).
2. Verify resource requests and limits are declared rather than inherited by luck ([Kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)): `kubectl get deploy -o jsonpath='{.items[*].spec.template.spec.containers[*].resources}'` prints the declared requests and limits per container.
3. State the scale envelope in numbers: the load at which the design breaks, what breaks first, and the recovery behaviour (degrade, shed, queue, or fall over).
4. Check backpressure exists end to end: bounded queues, load shedding, and a defined response when the queue is full.
5. Check the written migration steps reach the target design incrementally, with each step independently deployable and independently revertible. A target unreachable from today's system is a rewrite wearing a design document.
6. Check for the distributed-monolith signature: a shared release train, a shared database, or a synchronous chain where one user action crosses five networks.
7. Write non-functional budgets as measurable numbers with the signal that measures each: p95/p99 latency, error-rate ceiling, payload limits, retention, RPO/RTO.
8. EVIDENCE: per-item 12-factor evidence, the resource declarations, the scale-envelope numbers, the backpressure mechanism, the incremental migration step list, the numeric budgets and their signals.

## Phase 8 — Write the review and the decision

1. Use a fixed document structure with explicit sections for quality goals and risks ([arc42](https://docs.arc42.org/home/)) so reviews are comparable across teams.
2. Keep one diagram vocabulary ([C4 model](https://c4model.com/)) and label diagram elements with the deployed names so the picture can be checked against reality.
3. List findings by severity, each with the artifact it comes from and the number that supports it — never "I would have done X".
4. Record the decision, the owner, the date, and the review trigger that would reopen it.
5. Record what the review did not cover, so a later reader does not mistake silence for approval.
6. Publish the ADR alongside the review so the decision outlives the meeting.
7. EVIDENCE: the review document with its risk and quality-goal sections, severity-ranked findings with citations, the signed decision record, the coverage limits.

## Definition of done

- Every significant decision appears in the trade-off table with an attribute bought and an attribute spent.
- Each significant decision has a committed ADR naming the rejected options and the consequences.
- Interface contracts were checked against a cited rule set and the live error response was captured.
- The scale envelope, the numeric budgets, and the incremental migration path are all written down.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Decision sentence; deployed call graph; change-frequency map; consumer list; door classification |
| 2 | Decision-to-attribute table; numeric versions of adjectives; unanswered question list |
| 3 | Committed ADR files; rejected options quoted; status and supersession links; cited evidence |
| 4 | API contract diff; cited rule IDs; live error-response capture; consumer/version inventory |
| 5 | Table-to-writer mapping; boundary statement; consistency bound; id-generation note |
| 6 | Timeout/retry config lines; cycle-detector output; touched-module count; fan-in figure |
| 7 | 12-factor evidence per item; resource declarations; scale envelope; migration steps; budgets |
| 8 | Review document; severity-ranked findings; signed decision; stated coverage limits |

## Failure modes a naive reviewer misses

1. **Critiquing style instead of trade-offs.** "I would use X" is an opinion; "X buys p95 latency and spends operability, here is the measurement" is a review.
2. **ADRs without alternatives or consequences.** The future reader has no way to tell whether the constraint that drove the decision still exists, so the decision is re-litigated from scratch.
3. **Diagram-driven approval.** The diagram does not match deployed reality; review the config, the manifests, and the call graph instead of the picture.
4. **Ignoring the migration path.** The target design is unreachable from today's system, so it is adopted as a big-bang rewrite or never adopted at all.
5. **The distributed monolith.** Independent deployability was the stated goal; a shared database and a shared release train are the result.
6. **An implicit consistency model.** "Eventually consistent" with no maximum lag is untestable and unalertable, so it is reasoned about by guesswork during an incident.
7. **Chatty interfaces.** A clean-looking resource that hides an N+1 across the network; the coupling is in the call count, not the schema.
8. **No backpressure story.** Unbounded queues convert overload into memory exhaustion and silent data loss, and the design reads as robust because every call is asynchronous.
9. **Versioning by hope.** "We will never break it" with no deprecation mechanism, no consumer inventory, and no sunset date.
10. **Non-functional requirements as adjectives.** "Fast, scalable, secure" has no measurable form, so no observation qualifies as a failure.
11. **Approving the interface without the failure path.** Timeouts, retries, and partial-failure behaviour decide how the system behaves on its worst day, and they are usually not in the document.
12. **Reviewing only the new system.** The interesting risk is the seam between the old and new systems during the transition, which is exactly the part left as "details to be worked out".

## Sources

- [ISO/IEC 25010 quality model](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) — the ISO 25000 portal's rendering of the standard, not the ISO text itself; the quality characteristics used in Phase 2.
- [ADR — Architecture Decision Records](https://adr.github.io/) and the [MADR template](https://adr.github.io/madr/) — decision structure with options, outcome, and consequences.
- [Nygard — Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the original context/decision/consequences record.
- [RFC 9457 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) and [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — the error and protocol contracts.
- [Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/), [Google AIPs](https://google.aip.dev/), [Google API Design Guide](https://docs.cloud.google.com/apis/design) — numbered, citable API rules.
- [12-Factor App](https://12factor.net/) — deployability and operability constraints checked literally in Phase 7.
- [C4 model](https://c4model.com/) and [arc42](https://docs.arc42.org/home/) — diagram vocabulary and review document structure.
- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html) — the pillar question sets used as the review questionnaire.
- [Kubernetes — Managing Resources for Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) — requests, limits, and QoS classes.
