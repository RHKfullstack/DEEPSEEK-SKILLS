# Senior Release Gate

Decide, on evidence, whether a specific build may go to production: verification is complete, the data changes are safe, rollback exists, the operators can see and steer it, and the deployment mechanics match the plan.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- A release candidate exists and a go/no-go decision is required.
- A deployment is being prepared: production, a tenant upgrade, an on-premise install, or a firmware rollout.
- A change requires a maintenance window, a schema migration, or a flag flip.
- A previously failed release is being retried.

## When it does not

- Nothing is built yet — use design review or threat model.
- The decision is about one pull request's quality; that is code review or work audit.
- The system is failing right now; that is incident response, and the gate applies to the fix-release afterwards.

## Core rule

The gate is a set of checks that each produce an artifact. If a check produces no artifact, it does not belong in the gate; it belongs in a discussion. Release engineering in the SRE model is a repeatable, automated process precisely so the human judgement is spent on exceptions ([Google SRE Workbook](https://sre.google/workbook/table-of-contents/)).

## Phase 1 — Identify and freeze the candidate

1. Record the exact artifact identity: commit SHA, container image digest, package version, and build ID.
2. Verify the artifact was built once and promoted, not rebuilt per environment — a rebuild is a different artifact.
3. Record the version number and confirm it follows the project's semantic versioning or calver rule.
4. Confirm the freeze: no commits to the release branch after the cut, or an explicit list of cherry-picks with their SHAs.
5. Confirm the artifact corresponds to the reviewed commit — squash, rebase, or cherry-pick can make the shipped tree differ from the audited one.
6. Verify the changelog and release notes are generated from the actual commit range, not hand-written from memory.
7. EVIDENCE: artifact identity record, build-to-review SHA mapping, freeze confirmation, generated changelog.

## Phase 2 — Verification evidence

1. Confirm the full CI suite ran on the exact candidate SHA, and that "green" refers to that SHA, not a parent commit.
2. Confirm the required checks are set as required in branch protection — an advisory check that can be bypassed is not a gate.
3. Confirm test categories that matter for this release all ran: unit, integration, contract, migration, and end-to-end smoke.
4. Confirm the security scans passed at the agreed threshold (dependency audit, SAST, image scan, secret scan) and record the tool versions.
5. Confirm the artifact signature and provenance verify: `cosign verify <image>`, `slsa-verifier verify-artifact` ([sigstore.dev](https://www.sigstore.dev/), [SLSA v1.1 levels and tracks](https://slsa.dev/spec/v1.1/levels)).
6. Confirm performance or load evidence exists if the release changes a hot path.
7. Confirm the known-issues list is current and each item is accepted by a named owner.
8. EVIDENCE: CI run URL and SHA, branch protection settings, scan reports with tool versions, verification transcripts.

## Phase 3 — Data and schema safety

> Authority split: when the release contains a migration, `senior-data-migration-safety` owns the measurement bar (lock impact, expand/contract ordering, backfill, restore drill). This phase is the gate summary - a PASS here does not mean that skill's bar was met.

1. Classify each change: additive, transformative, or destructive.
2. Verify the migration pattern is expand/contract so old and new code can run simultaneously during rollout.
3. Verify the migration is idempotent and safe to re-run after a partial failure.
4. Verify no migration performs a long exclusive lock on a large table; check for index creation without concurrency where the engine supports it.
5. Verify the rollback of the schema step, or state explicitly that the schema change is forward-only and why that is acceptable.
6. Verify a backup exists taken after the last schema change and before this one, and that a restore has been tested.
7. Verify the data backfill, if any, is chunked, resumable, and does not run in the same transaction as the schema change.
8. EVIDENCE: migration files reviewed, lock-impact analysis, tested restore log, backfill plan.

## Phase 4 — Configuration, secrets, and flags

1. Diff configuration between the current production state and the target state; every changed key must be intentional and reviewed.
2. Verify every new configuration key has a safe default, or fails fast at startup rather than silently.
3. Verify new secrets exist in the target environment before deployment, not after — a missing secret at boot is an outage ([12-Factor](https://12factor.net/config)).
4. Verify feature flags exist for the risky behaviour, with a documented owner and a kill switch that does not require a deploy.
5. Verify the flags default off in production, and that enabling them is a separate, observable step.
6. Verify no secret value appears in the release notes, changelog, or CI log.
7. EVIDENCE: config diff, secret-presence check output (names only), flag inventory with owners and defaults.

## Phase 5 — Rollback and reversibility

1. Write the exact rollback command or procedure, and confirm it has been executed in a lower environment.
2. State the maximum acceptable time to roll back, and confirm it is shorter than the time an outage would be tolerated.
3. Identify irreversible steps: destructive migrations, sent messages, external API calls, payments, data deletion.
4. Confirm rollback of the application is compatible with the migrated schema (the old code must tolerate the new columns or tables).
5. Confirm the previous artifact version and its configuration are still available and pullable.
6. Define the rollback trigger: the specific metric value, error rate, or symptom that causes an automatic or human rollback.
7. EVIDENCE: rollback runbook, lower-environment rollback rehearsal log, previous artifact digest, defined trigger thresholds.

## Phase 6 — Observability and operator readiness

1. Confirm the release emits or updates the signals needed to see it working: request rate, error rate, latency, saturation, plus one business-level indicator ([Google SRE Book](https://sre.google/sre-book/table-of-contents/), monitoring distributed systems).
2. Confirm dashboards include the new behaviour; a metric nobody can graph is not observability.
3. Confirm alerts exist for the failure modes this release introduces, with thresholds and a runbook link.
4. Confirm logs are structured, correlated by request or trace ID, and do not contain secrets or personal data.
5. Confirm the runbook covers: how to verify health, how to roll back, how to disable the feature, and who to contact.
6. Confirm on-call coverage for the release window and the period after, including the change author.
7. EVIDENCE: dashboard links, alert definitions, runbook file, on-call schedule, log sample with correlation ID.

## Phase 7 — Deployment mechanics and sequencing

1. Confirm the rollout strategy: all at once, rolling, blue/green, or canary — and its blast radius.
2. Verify the canary or rolling step gates on real health signals, not on "pod started".
3. Verify the deployment does not depend on a manual step that only one person knows.
4. Verify it is not being deployed into a known-degraded system; check the current error budget and open alerts first ([Google SRE Book](https://sre.google/sre-book/table-of-contents/) — error budgets and the release freeze that follows their exhaustion are SRE practice; [DORA](https://dora.dev/) measures deployment frequency, change failure rate and recovery time, not budgets).
5. Verify the timing avoids overlapping with another team's migration or a scheduled heavy job.
6. Verify the deploy is reproducible: same command, same inputs, no manual console edits that are not captured in IaC.
7. EVIDENCE: rollout plan, health gate definition, pre-deploy state snapshot, deploy log with timestamps.

## Phase 8 — Go/no-go and post-release verification

1. Record each gate item as PASS, FAIL, or WAIVED WITH OWNER - except verification, data safety, rollback and artifact identity, which have no waiver path and are FAIL-only; any FAIL with no waiver is a no-go.
2. Record the decision, the decider, and the timestamp.
3. Run post-deploy verification: smoke test, health endpoint, key business transaction, and error-rate comparison against the pre-deploy baseline.
4. Watch the defined observation window before declaring success; "deployed" is not "working".
5. Confirm the canary or first slice held for the full window before full rollout.
6. Close the release with a record of what changed, what was observed, and any follow-up work.
7. EVIDENCE: signed gate checklist, post-deploy verification transcript, observation-window metrics, follow-up item list.

## Gate decision vocabulary

- GO — every gate item PASS, or waived by a named owner with a compensating control and an expiry.
- GO WITH CONDITIONS — a bounded, time-limited deviation with a monitoring plan, a rollback trigger, and an owner.
- NO-GO — a FAIL on verification, data safety, rollback, or artifact identity; no waiver path exists for these.
- HOLD — a dependency outside this release is blocking; re-run the whole gate when it clears, not just the failed item.

## Definition of done

- The artifact identity is recorded and the same artifact is promoted through every environment without a rebuild.
- CI, security scans, and signature verification all reference the exact shipped SHA or image digest.
- A tested rollback exists and is compatible with the migrated schema.
- The gate checklist is signed with PASS, FAIL, or WAIVER per item, and the decision is timestamped with its decider.
- Post-deploy verification ran and the observation window closed before success was declared.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Artifact digest/SHA; freeze list; generated changelog |
| 2 | CI run for the exact SHA; branch protection; scan and signature reports |
| 3 | Migration review; lock analysis; restore-test log; backfill plan |
| 4 | Config diff; secret-name presence check; flag inventory |
| 5 | Rollback runbook; rehearsal log; trigger thresholds |
| 6 | Dashboard and alert links; runbook; log sample |
| 7 | Rollout plan; health gate; pre-deploy snapshot; deploy log |
| 8 | Signed gate checklist; post-deploy transcript; observation metrics |

## Failure modes a naive reviewer misses

1. **Green CI on the wrong commit.** The pipeline ran on the branch tip before the last cherry-pick; the shipped SHA has never been tested.
2. **Migration locking a hot table.** An `ALTER TABLE` or non-concurrent index build blocks writes for minutes on a large table and takes the service down during the deploy window.
3. **Forward-only migration with no compatible old code.** The new schema ships, then the rollback restores old code that does not understand the changed columns.
4. **Feature flag defaulting on.** The flag was meant to be off; it ships enabled and turns the canary into the full rollout.
5. **Missing secret discovered at boot.** The config key was added to the template but not to the production secret store, so every new pod crash-loops while the old ones keep serving — until the next restart.
6. **Rollback never rehearsed.** The documented rollback references a script, image tag, or permission that no longer exists; it is discovered during the incident.
7. **Health check that always passes.** The readiness probe checks that the process is up rather than that dependencies are reachable, so the rollout proceeds into a failing state.
8. **Irreversible side effects before verification.** Messages are published, emails sent, or payments taken during the canary phase, so rollback does not undo the business effect.
9. **Deploying into a degraded system.** The release is technically sound but ships while an unrelated dependency is failing, and the new errors are attributed to the release.
10. **Success declared at deploy time.** No observation window, so a slow leak, memory regression, or data corruption surfaces hours later with no change correlation.
11. **Rebuild per environment.** The artifact is built again for production from the same source, so the tested binary and the shipped binary are not provably identical.

## Sources

- [Google SRE Workbook](https://sre.google/workbook/table-of-contents/) — release engineering, canarying, and rollback practice.
- [Google SRE Book](https://sre.google/sre-book/table-of-contents/) — monitoring, alerting, and error budgets.
- [DORA](https://dora.dev/) — deployment frequency, change failure rate, and failed-deployment recovery.
- [SLSA](https://slsa.dev/) — general pointer; the [SLSA v1.1 levels page](https://slsa.dev/spec/v1.1/levels) defines the four Build levels (L0-L3), and the Source track is a separate part of the same specification ([v1.1 spec index](https://slsa.dev/spec/v1.1/)).
- [Sigstore](https://www.sigstore.dev/) — signing and verifying the released artifact; the [Cosign verification docs](https://docs.sigstore.dev/cosign/verifying/verify/) cover the keyless verify flow.
- [NIST SP 800-218, SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) — RV.2 assess, prioritise and remediate vulnerabilities, and RV.3 analyse them for root causes, both before release.
- [12-Factor App — Config](https://12factor.net/config) — config, build/release/run separation, and disposability.
- [CIS Controls](https://www.cisecurity.org/controls) — change and configuration management safeguards; the enumerated list is the [18 CIS Critical Security Controls](https://www.cisecurity.org/controls/cis-controls-list).
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/) — operational excellence and change management.
- [Architecture Decision Records](https://adr.github.io/) — record the delivery decisions made at the gate.
