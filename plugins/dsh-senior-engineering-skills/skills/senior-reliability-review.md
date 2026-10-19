# Senior Reliability Review

Review and repair a service's reliability practice: SLIs derived from user experience, SLOs with an error-budget policy that changes release behaviour, symptom-based alerting with a bounded page load, correlated telemetry, executable runbooks, and incident follow-through that closes.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- Metrics, alerts, dashboards, SLOs, or runbooks are added, changed, or removed.
- A service is unreliable and the cause is unclear, or the same incident is recurring.
- A design must account for on-call cost, failure behaviour, or observability before it ships.
- A postmortem, incident timeline, or action-item register is being written or reviewed.
- An alert fired and nobody acted, or nobody could tell why it fired.

## When it does not

- The service has no users yet and no production traffic; define the SLIs to instrument rather than review a dashboard that does not exist.
- The question is purely about latency or throughput numbers under load; use the performance audit.
- The subject is a batch job with no request boundary; adapt the SLIs to job freshness and correctness and say so explicitly.

## Core rule

An SLI measures the user's experience of the service, an SLO puts a target and a window on it, and the error budget is what makes the target operative — an SLO with no consequence is a dashboard decoration ([Google SRE — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)). Alert on symptoms at the user boundary, not on causes; cause-based pages train people to ignore the pager ([Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)).

State in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Derive SLIs from the user's experience

1. Name the user-visible operations, not the endpoints: checkout, search, publish, sync. Each gets at least one SLI.
2. Choose the SLI type per operation: availability (good requests over valid requests), latency (proportion below a threshold), correctness (the request produced the right result), freshness (data age), durability (records preserved).
3. For each SLI write the exact measurement source and the window: the metric name, the label filters, the aggregation, and whether it is measured server-side, client-side, or from synthetic probes.
4. Measure availability at the closest point to the user that is instrumented, and record where that is. A load-balancer-only measurement misses client failures, DNS, and the CDN.
5. Record how an outage in the measurement pipeline itself appears — a silent gap in a metric series reads as zero errors.
6. Confirm batch and asynchronous work has an SLI (job success, queue age, end-to-end freshness) rather than counting only synchronous requests.
7. EVIDENCE: the SLI table with operation, type, source query, window, and measurement point per row.

## Phase 2 — Define the SLO and make the error budget operative

1. For each SLI, write the target and the rolling window: 99.9% over 28 days, stated in the same units as the SLI.
2. Verify the target is achievable given the measured baseline. An SLO set above current performance is a permanent, meaningless burn.
3. Write the error-budget policy as a decision rule with a named owner: what happens at 50% consumed, at 75%, and at 100% — freeze features, redirect to reliability work, or escalate.
4. Check the policy has been invoked at least once, or record that it has never been exercised and is therefore unproven.
5. Compute the budget in absolute terms for the window so the number is concrete: allowed bad minutes or bad requests per period.
6. Confirm the SLO dashboard shows budget remaining and burn rate, not just a percentage that hides the window.
7. EVIDENCE: the SLO document, the written error-budget policy with thresholds and owner, the computed budget, evidence of a policy invocation or its absence.

## Phase 3 — Audit alerting for symptom, actionability, and load

1. Enumerate every rule: `kubectl get prometheusrule -A -o yaml`, or the alerting config in the monitoring stack as deployed.
2. Classify each alert as symptom-based or cause-based. CPU, memory, and disk belong on a dashboard until they demonstrably precede a user-visible failure.
3. Verify multi-window, multi-burn-rate alerting for each SLO so a fast burn pages and a slow burn opens a ticket, instead of one threshold with one window.
4. Check each alert has a severity, an owner, and a runbook link. An alert without a runbook is an interruption, not an alert.
5. Count pages per week per rotation and compare against the on-call load guidance; more than a handful of actionable pages per shift is a defect in the alerting, not in the people ([Google SRE — Being On-Call](https://sre.google/sre-book/being-on-call/)).
6. Find alerts that can never fire: reference a metric that was renamed, a label value that no longer exists, or a threshold outside the possible range. `promtool check rules <file>` for syntax, then confirm each referenced series returns data.
7. Check for alerts that fire constantly and are acknowledged without action; record them as noise with the count.
8. EVIDENCE: the alert inventory with symptom, severity, owner, and runbook per row; the pages-per-week count; the list of un-fireable alerts with the missing series.

## Phase 4 — Verify instrumentation and correlation end to end

1. Confirm every request produces a span, including asynchronous hops: producer and consumer spans across the queue, not just the HTTP boundary ([OpenTelemetry — Traces](https://opentelemetry.io/docs/concepts/signals/traces/)).
2. Capture a real trace from a real request and follow it to the terminal span: `curl -s -D- -H 'traceparent: 00-<trace-id>-<span-id>-01' <endpoint>` and retrieve it from the backend.
3. Check the sampling policy does not discard errors. Head sampling at a low rate is exactly wrong for debugging; use error-biased or tail sampling ([OpenTelemetry — Sampling](https://opentelemetry.io/docs/concepts/sampling/)).
4. Verify a single identifier links log, trace, and metric: the trace id appears as a structured log field, and the log has a field for the new code path rather than a free-text message.
5. Check logs are structured and parseable, and that the fields use the semantic conventions where they exist ([OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/otel/)).
6. Confirm spans carry status and error information, so a failed span is distinguishable from a slow one.
7. Check that the signals model is understood by the team: metrics for aggregates, logs for discrete events, traces for request paths ([OpenTelemetry — Observability Primer](https://opentelemetry.io/docs/concepts/observability-primer/)).
8. EVIDENCE: a captured trace id spanning the async hop; the sampling configuration; a log line containing the correlation field; the span status fields.

## Phase 5 — Dashboards, cardinality, retention, and cost

1. Verify one dashboard answers "is it broken?" within a minute, showing the four golden signals — latency, traffic, errors, saturation — plus saturation of the first bottleneck ([Google SRE — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)).
2. Check the reported latency percentile matches the pain: a mean hides the tail, and a long rolling p99 smooths a ten-minute outage across six hours.
3. Measure metric cardinality and identify the top series counts: `curl -s <prometheus>/api/v1/status/tsdb` and read the series counts per metric.
4. Confirm no unbounded label: user id, request id, session id, full URL, error message text, and per-tenant labels are all cardinality explosions waiting for a bad day.
5. Check retention and downsampling are configured deliberately, and that the retention window covers the SLO window plus one investigation.
6. Check the monitoring stack's own availability is monitored, so a silent collector failure is visible.
7. Check business-level signals exist, not only infrastructure: a green `/health` while checkout fails is the classic blind spot.
8. EVIDENCE: the dashboard query and URL, the four signals present, the top series counts, the label audit, the retention configuration, the business-signal list.

## Phase 6 — Runbooks, on-call, and the incident process

1. Confirm every alert links a runbook that names literal commands or queries and the escalation path. "Investigate the issue" is not a runbook.
2. Read each runbook for the 3 a.m. responder: no implicit context, no missing preconditions, no reference to a person's memory.
3. Confirm a severity table exists with definitions tied to user impact, not to internal sentiment.
4. Confirm an incident-commander role is named in the process, with a communication cadence and a single status channel.
5. Verify the timeline is captured during the incident, not reconstructed from memory afterwards; the timestamps should be machine-sourced where possible.
6. Check the escalation path reaches someone with authority to make a trade-off, and that the contact data is current.
7. Reconcile the reliability process with the security incident lifecycle so one event is not run through two incompatible processes ([NIST SP 800-61r3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)).
8. EVIDENCE: the runbook per alert with literal commands, the severity table, the incident-commander assignment, a captured timeline, the security-process mapping.

## Phase 7 — Review postmortems for action, not narrative

1. Check each postmortem separates the trigger from the contributing causes, and identifies systemic factors rather than stopping at "human error" ([Google SRE — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)).
2. Check the language is blameless, because blame suppresses future reporting and the next incident is discovered later and costs more ([Google SRE Workbook — Postmortem Culture](https://sre.google/workbook/postmortem-culture/)).
3. Verify every action item has a named owner, a due date, and a tracking issue — not an anonymous bullet in a document.
4. Measure the closure rate and the age of open items: recurring incidents with the same action item are the signature of a ceremonial process.
5. Compare against the public corpus of real postmortems for the expected depth of timeline and analysis ([PagerDuty Postmortems](https://postmortems.pagerduty.com/)).
6. Check the postmortem is reviewed in a forum where the people who own the fixes are present, and that the review is recorded.
7. Confirm the fix is verified rather than declared: the failure was re-injected, or the guard's test exists and was shown to fail on the old behaviour.
8. EVIDENCE: the postmortem document, trigger-vs-cause structure, the action-item register with owners and dates, the closure rate, the verification of at least one fix.

## Phase 8 — Drill the alerts and package the review

1. Verify alerts actually fire: inject the failure in staging or run a game day, and record the alert that fired and the time to page ([PagerDuty Incident Response](https://response.pagerduty.com/)).
2. Verify the runbook is followed by someone who did not write it, and record where it broke down.
3. Verify the on-call handover carries the open risks, not just the open tickets.
4. Re-check the SLO after each significant change and record whether the burn rate moved.
5. Record the carried risks: un-fireable alerts, unowned dashboards, unverified runbooks, open action items past due.
6. Label every check that was not executed `PLANNED` or `UNAVAILABLE` with the exact command or drill to run later.
7. EVIDENCE: the drill record with the alert that fired, the runbook walkthrough notes, the burn-rate delta, the carried-risk register, the command log.

## Definition of done

- Every SLI names an operation, a measurement source, and a window, and is measured near the user.
- The error-budget policy is written with thresholds and an owner, and its invocation history is recorded.
- Every alert has a severity, an owner, and a runbook with literal commands, and the page load is counted.
- A real trace was captured across an asynchronous hop, and the sampling policy does not discard errors.
- Every postmortem action item has an owner and a date, and the closure rate is measured.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | SLI table with operation, type, source query, window, and measurement point |
| 2 | SLO document; written error-budget policy; computed budget; invocation history |
| 3 | Alert inventory with symptom/severity/owner/runbook; pages-per-week; un-fireable alert list |
| 4 | Captured trace id across the async hop; sampling config; correlated log line; span status |
| 5 | Dashboard query; four golden signals; top series counts; label audit; retention config |
| 6 | Runbooks with literal commands; severity table; incident-commander assignment; timeline |
| 7 | Postmortem document; action-item register with owners and dates; closure rate; fix verification |
| 8 | Drill record with the alert that fired; runbook walkthrough notes; burn-rate delta; carried risks |

## Failure modes a naive reviewer misses

1. **Cause-based paging.** CPU alerts on a service that is serving fine train the rotation to ignore the pager, so the real page is ignored too.
2. **An SLO with no consequence.** Nobody stops shipping when the budget burns; the SLO is theatre and the dashboard is decoration.
3. **Percentile mistakes.** Reporting the mean while the pain is p99, or a six-hour rolling p99 that averages away a ten-minute outage.
4. **Availability measured at the load balancer**, ignoring client-side failures, DNS resolution, and the CDN, so an outage is invisible to the SLO.
5. **Sampling that discards the errors.** Head sampling at one percent is precisely wrong for debugging the incident you are in.
6. **Infrastructure monitored, business transaction not.** Every pod is green and checkout has been failing for twenty minutes.
7. **Unbounded metric cardinality.** A user id label either explodes the bill or gets dropped silently, and the metric you needed is gone.
8. **Postmortem action items with no owner and no date.** The same incident recurs and the write-up is treated as the fix.
9. **Blame language.** The next near-miss is reported late or not at all, which is how a small outage becomes a data loss event.
10. **Alert and config drift.** The alert references a metric renamed two quarters ago and can never fire, while the dashboard silently shows nothing.
11. **Runbooks written for the author.** Implicit context, missing commands, and an assumed access path that the responder at 3 a.m. does not have.
12. **A silent telemetry gap treated as health.** The collector is down, the series is absent, and every alert that depends on that series evaluates as fine.
13. **An untested alert.** Nobody has ever seen it fire, so the first firing is during a real incident and the routing is wrong.

## Sources

- [Google SRE Book — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — SLI/SLO/error-budget definitions and selection rules.
- [Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) — multi-window, multi-burn-rate alerting.
- [Google SRE Book — Being On-Call](https://sre.google/sre-book/being-on-call/) — on-call load and alert-quality expectations.
- [Google SRE Book — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — the four golden signals and percentile pitfalls.
- [Google SRE Book — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) and the [SRE Workbook chapter](https://sre.google/workbook/postmortem-culture/) — trigger vs cause, blamelessness, and follow-through.
- [OpenTelemetry — Observability Primer](https://opentelemetry.io/docs/concepts/observability-primer/), [Traces](https://opentelemetry.io/docs/concepts/signals/traces/), and [Sampling](https://opentelemetry.io/docs/concepts/sampling/) — signal model, span semantics, and sampling policy.
- [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) — semantic conventions used for correlated fields.
- [PagerDuty Postmortems](https://postmortems.pagerduty.com/) and [PagerDuty Incident Response](https://response.pagerduty.com/) — the public corpus and the response process.
- [NIST SP 800-61r3](https://csrc.nist.gov/pubs/sp/800/61/r3/final) — incident response recommendations to reconcile with the SRE process.
