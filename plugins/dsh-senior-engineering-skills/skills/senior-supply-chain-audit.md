# Senior Supply Chain Audit

Audit everything your build pulls in and everything your pipeline is allowed to do: direct and transitive dependencies, lockfile integrity, build provenance, artifact signatures, and CI permissions.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- Adding, bumping, or removing a dependency, or reviewing a lockfile change.
- A vulnerability advisory affects a package in the tree and impact must be determined.
- You must attest where a build artifact came from (SLSA level, signed provenance, SBOM).
- The pipeline or build runner's permissions, secrets, or trigger surface are under review.
- A repo is being assessed for adoption or vendoring.

## When it does not

- The dependency is not used by any build path (unused dev tooling in a throwaway branch) — record it and move on.
- The task is writing application code; supply chain is a separate concern unless a new package is being added.
- The target is a running system's configuration rather than its build inputs; use hardening.

## Core rule

A dependency is code you ship but did not write and will not review line by line — so its identity, integrity, and provenance must be established mechanically. SLSA frames this as build levels of increasing resistance to tampering: L1 provenance exists, L2 the build runs on a hosted build platform, L3 the build is hardened — with separate Build and Source tracks ([SLSA v1.1 levels and tracks](https://slsa.dev/spec/v1.1/levels)). Cite the level and the track you actually claim, because a Source-track claim says nothing about how the artifact was built.

## Phase 1 — Inventory the real dependency graph

1. Establish the package manager(s) in use and their lockfiles: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Pipfile.lock`, `go.sum`, `Cargo.lock`, `packages.lock.json`.
2. List direct dependencies only: `npm ls --depth=0`, `pnpm list --depth 0`, `pip list --not-required`, `go list -m all | head`.
3. List the full transitive closure and its size: `npm ls --all --json | jq '[.. | objects | select(.resolved?)] | length'`, `go list -m all | wc -l`.
4. Count duplicate versions of the same package, which signal version conflicts: `npm ls <pkg>` for a suspect, or parse the lockfile for repeated names.
5. Identify packages with install-time execution: search lockfiles and manifests for `postinstall`, `preinstall`, `prepare`, `install` scripts (`grep -n '"postinstall"' package.json`, `npm ls --json | jq` on `scripts`).
6. Identify non-registry sources: `git+`, `http://`, tarball URLs, `file:`, local paths, forks. Each is a supply-chain decision, not a convenience.
7. EVIDENCE: lockfile list with hashes, direct count, transitive count, install-script package list, non-registry source list.

## Phase 2 — Known-vulnerability triage

1. Run the ecosystem scanner against the lockfile: `npm audit --json`, `pnpm audit --json`, `pip-audit`, `osv-scanner -r .`, `govulncheck ./...`, `cargo audit`.
2. Correlate with a vulnerability database that is not the package manager's own: Open Source Vulnerabilities ([osv.dev](https://osv.dev/)).
3. For each finding, establish reachability: is the vulnerable function actually called from your code path? An unreachable advisory is a lower priority but still a record.
4. Check whether the vulnerable code is even installed — dev-only and optional dependency findings are not production exposure.
5. Check exploitability preconditions: required configuration, network position, attacker-controlled input into the API.
6. Re-scan after remediation and confirm the specific advisory ID disappears, not just that the count dropped.
7. EVIDENCE: raw scanner JSON, per-advisory reachability verdict, post-fix scan showing the advisory ID gone.

## Phase 3 — Lockfile and resolution integrity

1. Verify a lockfile exists and is committed for every application; a library may publish ranges, an application must pin.
2. Verify the lockfile is not in `.gitignore` and is not regenerated in CI from ranges (that reintroduces unpinned resolution).
3. Verify CI installs with the frozen flag: `npm ci`, `pnpm install --frozen-lockfile`, `pip install --require-hashes`, `poetry install --no-update`, `go mod verify`.
4. Verify integrity hashes are present for every resolved entry (`integrity` in npm lockfiles, `--hash` in requirements files).
5. Diff the lockfile in the change set and review each added or changed entry, not the line count: `git diff <base>...HEAD -- <lockfile> | grep '^[+-]  "'`.
6. Check for a dependency that resolves to a different publisher or scope than its name implies (typosquatting: `reqeusts`, `lodahs`, `crossenv`).
7. Check for packages published very recently with a version jump, no repository, or a single maintainer — the classic hijack signature.
8. EVIDENCE: lockfile diff reviewed line by line, integrity field present per entry, frozen-install command from the CI config.

## Phase 4 — Provenance, signing, and artifact identity

1. Determine the SLSA level actually achieved, not claimed: who can modify the build definition, whether the build runs in a hosted isolated runner, whether provenance is generated and non-forgeable, and whether the claim is a Build-track level or a Source-track level. The [SLSA v1.1 levels page](https://slsa.dev/spec/v1.1/levels) tabulates the four Build levels — L0 no guarantees, L1 provenance exists, L2 hosted build platform, L3 hardened builds; the Source track is defined separately in the same specification, see the [v1.1 spec index](https://slsa.dev/spec/v1.1/).
2. Verify build provenance exists and is signed: `slsa-verifier verify-artifact <artifact> --provenance-path <file> --source-uri <repo>`.
3. Verify signatures with the transparency log rather than a local key alone: `cosign verify --certificate-identity <id> --certificate-oidc-issuer <issuer> <image>` ([sigstore.dev](https://www.sigstore.dev/); the [Cosign verification docs](https://docs.sigstore.dev/cosign/verifying/verify/) cover the keyless and transparency-log checks).
4. Verify container image digests are pinned everywhere (manifests, compose files, IaC) rather than floating tags.
5. Verify the published artifact checksum matches what the pipeline produced — `sha256sum <artifact>` against the published checksum file.
6. Verify SBOM generation and that the SBOM matches the deployed artifact (compare package count and digests, not just presence).
7. EVIDENCE: verifier command output, cosign verification transcript, digest list, checksum comparison, SBOM file with its generation command.

## Phase 5 — Build and CI pipeline permissions

1. Enumerate the pipeline's token permissions. For GitHub Actions, read the workflow `permissions` block; default should be `contents: read`, with write scopes granted per job and justified.
2. Check that long-lived cloud credentials are not stored as CI secrets where OIDC federation is available.
3. Check trigger surface: which events can run untrusted code with secrets in scope — `pull_request_target`, `workflow_run`, `issue_comment`, `repository_dispatch`.
4. Verify that forked-PR workflows are denied secrets and denied write access to the repository.
5. Check third-party actions are pinned by commit SHA, not a mutable tag: `grep -rn 'uses:' .github/workflows/ | grep -v '@[0-9a-f]\{40\}'`.
6. Check the runner trust boundary: self-hosted runners on public repos can be a direct path to the internal network.
7. Check secret exposure in build logs — masking prevents display, not exfiltration by a malicious step.
8. EVIDENCE: workflow `permissions` excerpts, action pinning grep output, trigger inventory, OIDC configuration.

## Phase 6 — Non-registry and hidden code

1. Inventory vendored code (`vendor/`, `third_party/`, `node_modules` committed) and record how it is updated.
2. Inventory Git dependencies and forks, and record why the upstream was not usable.
3. Inventory downloaded binaries, model weights, and installers referenced by URL; verify their checksums are pinned in the build.
4. Inventory container base images and record the update path for OS packages inside them.
5. Run a repository score against a public health checker for comparison and evidence: `scorecard --repo=github.com/ORG/REPO --checks=Branch-Protection,Pinned-Dependencies,Token-Permissions,Signed-Releases` ([OpenSSF Scorecard](https://github.com/ossf/scorecard)).
6. Check for build steps that fetch at build time over the network without integrity verification — the most common hidden dependency.
7. EVIDENCE: vendored/git/binary inventory with checksum pin status; scorecard JSON output.

## Phase 7 — Policy, remediation, and continuous control

1. Define the remediation policy in writing: severity thresholds, maximum time-to-fix, and who owns an exception.
2. Apply the minimum fix that removes exposure: upgrade, patch, pin to a fixed version, or vendor a patch — and record which was chosen and why.
3. Where an upgrade is impossible, record compensating controls (input validation, disabled feature, network restriction) with an owner and expiry.
4. Add the check to CI so the control does not regress: a failing audit job on high severity, and a lockfile-diff requirement.
5. Enable dependency update automation with review, not auto-merge, for production paths.
6. Verify the branch protection that makes the control effective — a check that is not marked required is advisory, not a gate.
7. Verify the audit job runs on the default branch and on pull requests, not only on a nightly schedule nobody watches.
8. Verify a package maintainer has no direct push to the protected branch and therefore no way to merge around the check.
9. Re-run the whole procedure after any change to the package manager, build tool, or registry configuration.
10. EVIDENCE: written policy, remediation diff, CI job definition, branch protection settings screenshot or API output.

## Phase 8 — Package the evidence

1. Generate the SBOM from the same lockfile that the build resolved, and store it as a release artifact next to the image or package.
2. Store the vulnerability scan report per release, including the scanner name and version, so a later reader can interpret the result.
3. Store the provenance and signature verification transcript for the shipped artifact, with the exact verifier command.
4. Record the approval decision for each newly added direct dependency: who approved it, why it was needed, and what it replaces.
5. Keep the exception register in the repository so it is reviewed in pull requests instead of living in a private document.
6. Re-verify the SBOM against the deployed artifact — a mismatch means the artifact is not the one that was scanned.
7. EVIDENCE: SBOM file, per-release scan JSON, verification transcript, dependency approval record, exception register file.

## Definition of done

- The resolved dependency set was scanned, not the manifest version ranges.
- Every advisory has a reachability verdict and a disposition of fix, accept, or not-applicable.
- Artifact provenance and signatures verified, or the gap is recorded as a finding with an owner.
- CI enforces the control at a threshold that fails the build, and that check is required by branch protection.
- Every exception has an expiry date, and the expiry is enforced by something other than memory.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Lockfile hashes; direct/transitive counts; install-script list |
| 2 | Scanner JSON; per-advisory reachability verdict; post-fix scan |
| 3 | Lockfile diff review; frozen-install command from CI |
| 4 | Provenance verification output; cosign transcript; digests; SBOM |
| 5 | `permissions` blocks; action pinning grep; trigger inventory |
| 6 | Vendored/Git/binary inventory; scorecard output |
| 7 | Policy text; remediation diff; CI check definition; branch protection |

## Failure modes a naive reviewer misses

1. **Scanning the manifest, not the lockfile.** The manifest says a safe range; the lockfile resolves to the vulnerable version. Always scan the resolved set.
2. **Counting findings instead of checking reachability.** A vulnerability in a package you import but whose vulnerable function you never call gets treated as critical, while a genuinely reachable one hides in the noise.
3. **Dev-dependency exposure ignored in reverse.** Dev dependencies run arbitrary install scripts with full network and filesystem access on the build machine, which is often more privileged than production.
4. **Lockfile regenerated in CI.** `npm install` instead of `npm ci` silently re-resolves ranges, so the reviewed lockfile is not what was built.
5. **Action pinned by tag.** `uses: org/action@v3` is mutable: the maintainer, or anyone who compromises the account, can repoint the tag at new code that runs with your secrets.
6. **`pull_request_target` with a checkout of the fork.** This pattern hands untrusted code your secrets and a write token — the single most exploited CI misconfiguration.
7. **Provenance that is self-asserted.** A provenance file generated by the same job that builds, with no isolation and no signing, proves nothing about tampering.
8. **Transitive depth assumed shallow.** A direct dependency of 6 packages can pull 400 transitive ones; the audit scope is the closure, not the manifest.
9. **Typosquat accepted because it resolved.** It installed, so it looked legitimate; the name is one character from the intended package and it exfiltrates environment variables at install time.
10. **Exception without expiry.** A documented risk acceptance from two years ago is indistinguishable from an unaddressed finding, and both are reported as "known".

## Sources

- [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/) — general pointer; the [SLSA v1.1 levels and tracks](https://slsa.dev/spec/v1.1/levels) page defines the Build and Source tracks and their levels.
- [Sigstore](https://www.sigstore.dev/) — keyless signing and transparency-log verification; the [Cosign verification docs](https://docs.sigstore.dev/cosign/verifying/verify/) cover the specific verify flow.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) — automated checks for pinned dependencies, token permissions, branch protection.
- [NIST SP 800-218, SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) — PS.1 through PS.3 for software supply chain integrity.
- [Open Source Vulnerabilities (OSV)](https://osv.dev/) — advisory database and scanner for resolved dependency sets.
- [OWASP Cheat Sheet Series — Vulnerable Dependency Management](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html) — inventory, scanning, and remediation workflow.
- [CIS Controls](https://www.cisecurity.org/controls) — control 16, application software security, and supply-chain safeguards; the enumerated list is the [18 CIS Critical Security Controls](https://www.cisecurity.org/controls/cis-controls-list).
- [NIST SP 800-190](https://csrc.nist.gov/pubs/sp/800/190/final) — container image provenance, registry trust, and base-image control.
- [CWE Top 25](https://cwe.mitre.org/top25/) and the [2025 archive](https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html) — current 2025 ranks for ranked weaknesses. Dependency-specific classes are CWE-1104 (use of unmaintained third-party components) and CWE-1395 (dependency on a vulnerable third-party component).
