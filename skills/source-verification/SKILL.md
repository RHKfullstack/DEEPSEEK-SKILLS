---
name: source-verification
description: Verify a tool, package or claim by running it instead of trusting a README, a downloaded archive, a blog post or a model's memory - the source ladder, the registry facts that prove an artifact is the artifact, the smallest real run that shows a tool works, and the record that says what each source actually proves. Use when choosing a library or tool, when citing a version, flag or API, when a package arrives outside a registry, when comparing two tools or two icon sets, and whenever a claim is about to be repeated without having been observed. A tool is good when it ran here.
---

# Source Verification

**A README is a claim. A blog post is a claim. A model's memory is a claim with better manners.** None of them are a tool that works on this machine, and the most expensive failures in agent work come from a confident sentence built on a page nobody fetched.

The rule this skill enforces: **nothing goes in a report as "it does X" unless a command in this session showed it doing X.** Everything else is labelled.

## Rule V1 — The source ladder

Rank every fact by what it can actually prove, and say which rung you used:

| Rung | Source | Proves | Does not prove |
|---|---|---|---|
| 1 | **A command you ran here** — `--version`, `--help`, a real invocation with exit 0 | that this binary, at this version, does this | that it does it well, or on your data |
| 2 | **The registry, fetched now** — npm / pub.dev / Maven / GitHub API | that this version exists, when it was published, who published it, its hash | that it installs, or that it works |
| 3 | **The project's own repository at a commit** — source, tests, changelog | what the code is meant to do | that the release matches it |
| 4 | **Fetched official docs** | what the maintainer promises | anything at all about your machine |
| 5 | **A blog, a tutorial, a Stack Overflow answer** | one person's past experience | version, flags, or that the tool exists |
| 6 | **Memory** — yours or another model's | nothing | everything |

The failure pattern is a rung-6 sentence wearing rung-1 clothing: "ImageMagick's `convert` will resize it" when `convert` on this machine is the Windows disk tool. Rung 6 plus a confident tone is how a tutorial becomes a destroyed file.

**EVIDENCE: each claim in the report carries its rung.**

## Rule V2 — Registry truth before the first install

A downloaded archive is not a package. Before a dependency enters a project, confirm from the registry — not from the file:

- **the version exists** and the release you are about to use is the one the registry calls `latest` or that you deliberately pinned;
- **when it was published**, and whether that is recent or abandoned (`time` / `dist-tags` / pub `published`);
- **who published it** — an unexpected maintainer or a sudden maintainer change is a supply-chain signal (`senior-supply-chain-audit` owns the rest);
- **the artifact hash matches** — npm `dist.shasum` / `dist.integrity`, pub.dev `archive_sha256`, Maven `.sha1`. A tarball whose hash does not match the registry is not that package;
- **the install source is the registry**, not a link from a chat, a mirror, or a file someone sent.

```powershell
# npm: version, publish time, maintainers, dist hash
npm view <pkg> version time.modified maintainers dist.shasum dist.integrity --json

# verify a downloaded tarball against the registry shasum
$sha = (Get-FileHash .\pkg.tgz -Algorithm SHA1).Hash.ToLower()
# compare with the registry value before you extract anything

# pub.dev: version + archive_sha256
# https://pub.dev/api/packages/<name>  -> latest.version, latest.archive_sha256

# GitHub: the release actually attached to a tag
# https://api.github.com/repos/<owner>/<repo>/releases/latest
```

**EVIDENCE: the registry response fields, and the local hash next to the registry hash.**

## Rule V3 — The smallest real run

A tool that installs is not a tool that works. Run it on the smallest real input and capture the three things nobody writes down:

1. **The exact invocation** — quoting it in the report proves you ran this, not something like it.
2. **The exit code.**
3. **The actual output**, including the warning you were tempted to skip.

Then run **the boundary case that matters** — the empty input, the 300-character title, the odd number of pixels, the file with a space in its name. A tool that works on the happy path and silently mangles the boundary is a finding, not a pass.

```powershell
# the pattern: one command, exit code captured, output quoted
& ffmpeg -version; "exit=$LASTEXITCODE"
& ffmpeg -y -i sample.png -vf "scale=-2:108" out.png; "exit=$LASTEXITCODE"
```

- **`npx --yes <pkg>` is an install, not a probe.** It downloads and caches the package, so say so when you report - you changed the machine. And if the package ships no `bin`, the command fails with "could not determine executable to run": use `npm exec --yes --package=<pkg> -- <bin>` instead, and check the version it printed before believing anything else.

**EVIDENCE: invocation, exit code, and output for both the real input and the boundary case.**

## Rule V4 — Comparing two things needs a measure, not an adjective

"X is better than Y" is not a finding. When the question is quality or similarity, define the measure first, then produce the number:

| Question | The measure |
|---|---|
| Are these two icon sets similar? | geometry: normalise each path, compare stroke and commands, report a distance — not "they look alike" |
| Is this page fast? | the trace: LCP/INP, not an impression |
| Is this library maintained? | publish dates, open issues, last commit — dates, not a feeling |
| Is this API current? | the version in the docs against the version in the registry, today |
| Is this output correct? | a hash, a diff, or a byte comparison against a known-good result |

A comparison without a number is a preference. Say "preference" when that is what it is.

The command behind each row:

```powershell
# page speed: the trace, not an impression
npx --yes lighthouse "$url" --preset=perf --output=json --output-path=./lh.json

# is a package maintained: dates, not a feeling
npm view <pkg> time.modified time.created
# GitHub: pushed_at, open_issues_count, archived
# https://api.github.com/repos/<owner>/<repo>

# is the API I am reading current: the installed version against the registry
npm ls <pkg> --depth=0; npm view <pkg> version

# is the output correct: a hash or a byte diff against known-good
Get-FileHash .\out.bin -Algorithm SHA256
fc /b .\out.bin .\expected.bin    # or: cmp -l on a POSIX shell
```

An icon-set comparison is the worked case, and it needs a normaliser rather than an opinion: reduce both `d` attributes to the same command casing and spacing, compare the command vector and the stroke width, and report the distance **plus** the optical bounding box. The earlier audit of this pack is why: it measured an exact `1.506px` pen against the reference and still found the set `0.80x` its optical height. Matching ink weight with the wrong size is a measurable failure, not a judgement call.

**EVIDENCE: the measure, the two values, and the command that produced them.**

## Rule V5 — The record

Every research answer that will be quoted later gets a source table with what each line *does not* prove:

```md
| Claim | Source | Rung | Fetched | Proves |
|---|---|---|---|---|
| ffmpeg is 8.1 here | `ffmpeg -version` | 1 | 2026-11-25 | this binary, this machine |
| `xfade` accepts `offset` | ffmpeg filters doc | 4 | 2026-11-25 | the documented argument |
| the package is 0.1.1 | npm registry | 2 | 2026-11-25 | the version exists and its hash |
```

Rules: **date every fetch**; **link the exact page** (not the domain); **never paste a token, cookie or key** into the table (mask it — `organizer` and `encoding-hygiene` both apply); and **when a source dies**, mark it dead instead of quietly dropping the claim it supported.

**EVIDENCE: the table, with a rung and a date on every row.**

## Rule V6 — When the tool cannot be run here

Some questions need a tool this machine does not have. That is a label, not a licence to guess:

- **`UNAVAILABLE`** + the exact command that would answer it, ready to paste;
- **the closest thing you did verify**, named as such;
- **never** "it should work", "it usually does", or a version you recalled.

A report that says "not verified: no `rsvg-convert` on this machine; this is the command" is more useful than a fabricated success — and it is the only version that stays true when the owner runs it.

**EVIDENCE: the UNAVAILABLE line and the ready command.**

## Anti-default table

| Default | The gate |
|---|---|
| Quoting a flag, version or API from memory | run `--version` / `--help`, or fetch the page now |
| Citing a URL never opened | fetch it, quote the line, date it |
| "It's a popular library, it will work" | the smallest real run, with an exit code |
| Installing from a downloaded tarball or a chat link | registry metadata + hash match first |
| Believing a tutorial written for another OS | `Get-Command` the tool, and check it is the tool you think |
| "X is better than Y" | a measure and two numbers |
| Reporting success without the output | invocation + exit code + output |
| A dead link silently dropped | marked dead, and the claim it supported marked unverified |
| Pasting a token into a source table | masked identifier only |
| Guessing when the tool is missing | `UNAVAILABLE` + the exact command |

## Definition of done

- Every factual claim in the answer carries a rung, and rung 1 was earned by a command in this session.
- Any dependency was checked in the registry, and its artifact hash matched before use.
- The tool was run on real input and on the boundary case, with exit codes quoted.
- Any comparison has a named measure and two values.
- The source table exists, dated, with what each row does not prove.
- Anything unverifiable is labelled `UNAVAILABLE` with the command to settle it.

## Failure modes

1. **The remembered flag** — confident, wrong, and the command fails in the owner's terminal.
2. **The unopened citation** — a URL that 404s, or says the opposite.
3. **The OS mismatch** — a recipe for Linux `sed`/`convert` run on Windows, or the reverse.
4. **The registry gap** — a package whose hash does not match, installed anyway.
5. **The happy-path pass** — works on the demo input, mangles the real one.
6. **The adjective comparison** — "cleaner", "faster", "more modern", with no number.
7. **The silent dead source** — the claim stays, the evidence went.
8. **The guessed success** — reported as done because the tool is popular, not because it ran.

## Overlap — what this skill does not own

- `senior-supply-chain-audit` owns dependency risk, lockfiles, SBOM and CI trust; this skill owns the *first* question — is this artifact what it says it is, and does it run here.
- `client-code-intake` owns the provenance of a client-supplied repository.
- `encoding-hygiene` owns the bytes of what you downloaded; this owns whether it is the right artifact at all.
- `senior-quality-gate` owns turning a check into a build gate; this skill produces the check.

## Sources — verified live 2026-11-25

- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md) — `dist.shasum`, `dist.integrity`, `time`, `maintainers`: the fields Rule V2 depends on.
- [pub.dev API](https://pub.dev/api/packages) — `latest.version` and `latest.archive_sha256`.
- [GitHub REST API — releases](https://docs.github.com/en/rest/releases/releases) — the release attached to a tag, and the published time.
- [SLSA — provenance](https://slsa.dev/provenance) — why an artifact hash plus a build record is the claim worth trusting, and what a bare download proves.
- [MDN — HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching) — why a fetched page must carry the date you fetched it, since the same URL will read differently later.
