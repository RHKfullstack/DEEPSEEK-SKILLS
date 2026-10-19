# Senior System Hardening

Harden a real, running system — host, container, network, service, or cloud account — by measuring its current state, changing it, and proving the change with re-measurement rather than intention.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- The request is to "harden", "lock down", "reduce attack surface", "remediate findings", or "make this production-safe".
- A standard must be met: CIS Benchmark, NIST SP 800-53 control family, OWASP ASVS level, or a cloud security pillar.
- An audit produced findings that must now be fixed and closed with proof.
- A system is being promoted from dev to production and needs a security baseline.
- Credentials, certificates, or listening services are suspected to be exposed.

## When it does not

- Nothing exists to harden yet — that is design and threat modelling.
- The ask is to review a diff for a security bug; use code review.
- The target is a dependency graph rather than a system; use supply-chain audit.
- The system is mid-incident; contain and restore first, harden afterwards.

## Core rule

Hardening is measurement → change → re-measurement. Every control you claim must be re-read from the live system after the change, because "I disabled it" and "it is disabled" are different facts. CIS Benchmarks are structured exactly this way: a check, a remediation, and a required audit output ([CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks)).

## Phase 1 — Inventory and baseline before touching anything

1. Enumerate the asset: OS and kernel (`uname -a`, `Get-ComputerInfo`), image digest, cloud account and region, service versions.
2. Enumerate listening sockets and their owning process: `ss -tulpn` / `netstat -ano` / `Get-NetTCPConnection -State Listen`.
3. Enumerate outbound reachability and firewall rules: `iptables -S`, `nft list ruleset`, `ufw status verbose`, `Get-NetFirewallProfile`.
4. Enumerate identities and privileged groups: `getent passwd`, `getent group sudo wheel docker`, `Get-LocalGroupMember -Group Administrators`, cloud IAM policy inventory.
5. Enumerate credentials and keys on disk: `.env`, `id_rsa`, `*.pem`, `*.pfx`, `credentials`, `kubeconfig`, cloud CLI config.
6. Enumerate scheduled work: `crontab -l`, `systemctl list-timers`, `Get-ScheduledTask`.
7. Snapshot the baseline into a file so every later claim is a diff against it. EVIDENCE: `baseline.txt` with the outputs above, timestamped, plus the exact commands used.

## Phase 2 — Identity, access, and credentials

1. Force multi-factor authentication on every human and administrative path; verify by attempting a login without the second factor and capturing the denial.
2. Remove standing administrative rights; require just-in-time elevation ([NIST SP 800-53](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) AC-6 least privilege, AC-2 account management).
3. Enumerate accounts with no owner, no login in 90+ days, or shared credentials; disable them and record each one.
4. Rotate every credential that has ever been in a repository, log, or image layer. Rotation is the only remediation; history rewriting is not.
5. Replace static credentials with short-lived federated tokens where the platform supports it (OIDC workload identity, instance roles).
6. Verify secret storage: secrets must come from a manager or injected environment, never from a baked image layer or committed file. ([OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)).
7. Audit key permissions: private keys must be `0600` and owned by the service account — `find / -name "*.pem" -perm /o+r 2>/dev/null`.
8. EVIDENCE: login-denial transcript for MFA, disabled-account list, rotation log with timestamps (never the secret value), `ls -l` output for key modes.

## Phase 3 — Network exposure and transport

1. Reduce the listening set to the minimum; every socket in `ss -tulpn` must have a named consumer and a justification.
2. Bind administrative interfaces to loopback or a private network only — verify with `ss -tulpn | Select-String ':22|:3306|:6379|:9200|:2375'`.
3. Verify no container runtime socket is exposed over TCP without TLS; the Docker daemon on `:2375` is root-equivalent access.
4. Enforce TLS 1.2+ and a modern cipher set; scan the live endpoint: `"Q" | openssl s_client -connect HOST:443 -tls1_2 2>&1 | Select-String 'Protocol|Cipher'`. In PowerShell a piped string closes stdin; `< /dev/null` works only in bash or WSL - state which shell produced the transcript.
5. Verify the certificate chain, expiry, hostname match, and that no self-signed certificate is trusted in production: `"Q" | openssl s_client -connect HOST:443 -servername HOST 2>&1 | openssl x509 -noout -dates -subject -issuer`.
6. Check for cleartext protocols still reachable: HTTP that does not redirect, unauthenticated Redis/Memcached/Elasticsearch, SNMP v1/v2c.
7. Confirm egress is restricted; unrestricted egress turns any foothold into exfiltration ([NIST SP 800-53](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) SC-7 boundary protection).
8. EVIDENCE: post-change `ss -tulpn` output, `openssl s_client` transcript, any external port-scan result against the host.

## Phase 4 — Host and OS hardening

1. Run the applicable CIS Benchmark with a tool that produces machine-readable output (`oscap`, `lynis audit system`, `cis-cat`, cloud-native benchmark jobs) and keep the report.
2. Patch: confirm no pending security updates (`apt-get -s upgrade` / `Get-WindowsUpdate` equivalent) and that the kernel or OS release is inside vendor support.
3. Disable unneeded services, mount options, and kernel modules: `systemctl list-unit-files --state=enabled`, check `noexec,nosuid,nodev` on `/tmp`, `/var/tmp`, `/dev/shm`.
4. Secure the boot and privilege path: verified boot, disabled interactive root login, SSH `PermitRootLogin no`, `PasswordAuthentication no`, and a modern `KexAlgorithms`/`Ciphers` set.
5. Enforce time synchronisation; unsigned or skewed clocks break TLS, token validation, and audit trails.
6. Restrict local privilege escalation surface: audit setuid binaries and sudoers rules — `find / -perm -4000 -type f 2>/dev/null` and `sudo -l` per account.
7. Verify file-integrity and audit logging is on and writing: `auditctl -l`, `auditd` status, destination reachable.
8. EVIDENCE: CIS/Lynis report before and after, `sshd -T` output, setuid inventory, auditd status.

## Phase 5 — Container and orchestration hardening

1. Confirm images run as non-root with a read-only root filesystem and no `privileged: true` ([NIST SP 800-190](https://csrc.nist.gov/pubs/sp/800/190/final)).
2. Enumerate every workload requesting `hostPath`, `hostNetwork`, `hostPID`, or added capabilities: `kubectl get pods -A -o json | jq '.. | objects | select(.securityContext?)'`.
3. Verify the container image digest is pinned, not a floating tag, and that the running digest matches the reviewed digest.
4. Confirm namespace-level controls: default-deny NetworkPolicy, Pod Security admission at `restricted` where feasible, resource limits set so a runaway pod does not starve the node.
5. Verify secrets are mounted from a real secret store, not baked into the image or passed as plain env in the manifest.
6. Check the admission layer actually rejects a deliberately bad manifest (a test pod with `privileged: true`) — a policy that has never blocked anything is unverified.
7. EVIDENCE: `kubectl get pod -o yaml` excerpt showing `securityContext`, the admission denial message for the test pod, digest list.

## Phase 6 — Data, transport, and service hardening

1. Verify encryption in transit between every tier, not just at the edge; a TLS front door with cleartext database traffic fails the control.
2. Verify encryption at rest for volumes, buckets, and backups, and record the key owner.
3. Confirm database access is authenticated per service with its own credential and least-privilege grants; shared "app" superusers are a finding.
4. Confirm backups exist, are encrypted, and have been restore-tested recently — an untested backup is a hypothesis.
5. Harden the HTTP layer per the OWASP guidance in use: security headers, request size limits, timeouts, and disabled directory listing ([OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)).
6. Confirm debug endpoints, admin consoles, metrics, and profiling are not publicly reachable (`/actuator`, `/debug`, `/metrics`, `/_profiler`).
7. EVIDENCE: TLS handshake transcripts between tiers, encryption configuration output, restore-test log, HTTP header dump (`curl -sI https://HOST/`).

## Phase 7 — Detection, verification, and change control

1. Verify the hardening produced no functional regression: run the smoke or contract suite and record the result.
2. Verify logging captures authentication events, privilege changes, and control-plane writes, and that the sink is separate from the host.
3. Re-run the benchmark or scanner that produced the original findings and attach the new report showing each finding closed, accepted, or compensating-controlled.
4. Produce a rollback plan for every change, naming the exact command, so a hardening step that broke production can be reversed in minutes.
5. Record residual risk and accepted exceptions with an owner and an expiry date — exceptions without expiry become the permanent posture.
6. EVIDENCE: smoke suite result, before/after benchmark reports, rollback commands, exception register.

## Phase 8 — Sustain the hardened state

1. Encode every change in the configuration-management or infrastructure source, not only on the running host; a manual fix drifts on the next rebuild.
2. Re-run the benchmark automatically after the next deployment and compare the report against the approved baseline.
3. Configure drift detection that reports differences, not only outright failures — a changed control is a finding even when the control still exists.
4. Record each control's owner and review cadence; unowned controls decay silently between audits.
5. Re-verify after every base image, OS, library, or platform upgrade, because hardening baselines are version-specific.
6. Confirm the hardened image or template is what the autoscaler actually launches — check the running digest, not the repository tag.
7. EVIDENCE: IaC or config-management diff, post-deploy scan comparison, drift alert configuration, running digest list.

## Definition of done

- Every claimed control was re-read from the live system after the change, from effective configuration rather than files on disk.
- A before-and-after benchmark report exists for the same scanner, profile, and benchmark version.
- Functional smoke or contract tests pass after hardening, with the result recorded.
- Each exception has an owner, a compensating control, and an expiry date.
- Every change has a named rollback command that has been rehearsed or is trivially reversible.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Timestamped baseline: sockets, identities, credentials, cron, firewall |
| 2 | MFA denial transcript; disabled-account list; rotation log; key permission listing |
| 3 | Post-change socket list; `openssl s_client` transcripts; external scan result |
| 4 | CIS/Lynis before-and-after reports; `sshd -T`; setuid inventory |
| 5 | Pod securityContext excerpt; admission denial message; pinned digests |
| 6 | Inter-tier TLS transcripts; encryption config; restore-test log; header dump |
| 7 | Smoke result; closed/exception finding list; rollback commands |

## Failure modes a naive reviewer misses

1. **Reporting intent as state.** "PasswordAuthentication no" was set in a config file that a cloud-init override rewrites on boot. Always read effective configuration from the running service (`sshd -T`), not the file.
2. **Hardening the wrong layer.** Firewalling the host while the cloud security group still publishes the port directly to the internet. Enumerate every layer that can admit traffic.
3. **Checklist theatre.** A passing CIS score from a tool whose profile is scoped to a subset (level 1 only, or a single module) is reported as full compliance.
4. **Secret rotation without revocation.** A new key is issued but the old key stays valid; the exposure window never closes.
5. **Encryption in transit only at the edge.** TLS terminates at the load balancer and traffic continues in cleartext to the database, a fact usually visible only by capturing inter-tier traffic.
6. **Backups assumed testable.** Backups are configured, never restored; the restore fails on encryption key mismatch or missing IAM permission exactly when needed.
7. **Break-glass removal.** Every standing admin account is deleted, so the next incident is undebuggable. Keep a documented, monitored emergency path.
8. **Control that never blocks.** An admission policy, WAF rule, or network policy that has never been observed rejecting a known-bad input may not be loaded at all.
9. **Drift after the audit.** The hardened container is replaced by an autoscaler using an old image, or a config-management run reverts the change. Verify that the control is enforced at build/template level, not only on the running instance.
10. **Verification that destroys evidence.** Rotating logs, rebuilding hosts, or redeploying before capturing the baseline means the "before" state can never be compared.

## Sources

- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks) — per-platform check/remediation/audit structure.
- [CIS Controls](https://www.cisecurity.org/controls) — prioritised safeguards with implementation groups; the enumerated list is the [18 CIS Critical Security Controls](https://www.cisecurity.org/controls/cis-controls-list).
- [NIST SP 800-53 Revision 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) — AC, SC, AU, CM control families used above.
- [NIST SP 800-190, Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) — image, registry, orchestrator, and host hardening.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — TLS, headers, and transport guidance.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — storage, rotation, and injection of secrets.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) — verification levels to harden against.
- [AWS Well-Architected Framework — Security Pillar](https://aws.amazon.com/architecture/well-architected/) — cloud identity, detection, and infrastructure protection.
- [NIST SP 800-218, SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) — configuration management and protective-technology practices.
- [12-Factor App](https://12factor.net/) — config, backing services, and disposability as hardening constraints.
