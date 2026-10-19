# Organizer paths — layout, naming, and where an artifact belongs

The detail behind `## The artifact sink` and `## Classification` in the skill body. Load this module
when deciding where a file goes, when a folder has become a junk drawer, or when fixing placement
that already went wrong.

## 1. The sink tree

One sink per run, at the project root, ignored by git:

    <project-root>/.work/<YYYY-MM-DD>-<slug>/
      MANIFEST.md
      raw/
      tmp/
      out/
      logs/
      quarantine/

Worked example, a scrape-and-analyse task run on 2026-10-12:

    .work/2026-10-12-dsh-login-research/
      MANIFEST.md
      raw/challenge_js.bin
      raw/captcha_js.bin
      raw/h01.txt .. raw/h12.txt
      raw/gh_repos.json
      tmp/probe-login.mjs
      tmp/parse-headers.ps1
      out/login-flow-notes.md
      out/endpoints.tsv
      logs/curl-2026-10-12.log
      quarantine/   (empty)

Which directory, decided by one question:

| Directory | Holds | One question that decides it |
|---|---|---|
| `raw/` | untouched captures: response bodies, HAR files, screenshots, downloads, `*.bin` | Is this exactly what the network or the tool returned, unedited? |
| `tmp/` | one-off probes, scratch scripts, throwaway SQL, experiments that may be deleted tomorrow | Will anything but me ever need this file again? |
| `out/` | derived results worth reading: summaries, parsed tables, diffs, notes for the user | Is this my analysis of something in `raw/`? |
| `logs/` | command output, run logs, test-run logs, the journal | Is this a record of what ran rather than a result? |
| `quarantine/` | items moved out of the tree pending a keep/disposable decision (S1 only) | Did this come from outside the sink and is its fate undecided? |

The sink directories are not the project's directories. `.work/`, its subdirectories, and every file
beneath them are protected at every level: the engine's protected-set predicate refuses them, and it
re-checks that predicate at apply time. A plan row naming anything under `.work/` is a defect in the
plan, not a decision to weigh — drop it, list it as protected, regenerate. That includes a sink
subdirectory whose own contents happen to look like scratch: the sink holds the run's record, so it is
never swept by the sweep.

Rules:

1. `raw/` is immutable once written. Corrections are new files, never edits. This is what makes an
   analysis reproducible and what lets the raw capture be deleted on its own schedule.
2. `MANIFEST.md` has one row per artifact: `path | class | safety class | disposition | evidence`.
   The evidence column names the command or observation that decided the class.
3. Every non-trivial folder gets a short note — purpose, what belongs, what does not, owner, and
   what happens to its contents ([organizing-project-folders](https://github.com/FlyFission/nuclear-grade-context-engineering)).
   For the sink, `MANIFEST.md` is that note.
4. `.work/` is in `.gitignore`. Verify with `git check-ignore -q .work`; if it exits non-zero,
   append `.work/` to `.gitignore`.

## 2. Naming

Taken from the platform-safe, sortable naming rules in
[organizing-project-folders](https://github.com/FlyFission/nuclear-grade-context-engineering), which
traces them to [NARA Bulletin 2015-04](https://www.archives.gov/records-mgmt/bulletins/2015/2015-04.html).

- Lowercase letters and digits. The accepted exceptions are files conventionally capitalised:
  `README.md`, `LICENSE`, `CHANGELOG.md`, `Dockerfile`, `MANIFEST.md`.
- ISO-8601 dates as `YYYY-MM-DD`, which sorts correctly as text. Never `10-12-2026`, `Oct12`,
  `12-10-26`, or a bare epoch number.
- One dot only, for the extension. `login-flow-notes.md`, not `login.flow.notes.md`.
- No spaces and no shell metacharacters: no `&`, `(`, `)`, `'`, `"`, `!`, `#`, `$`, `%`, `;`, `,`.
  Use one separator — hyphen — and keep it consistent inside a project.
- Zero-pad sequences so they sort: `h01.txt` .. `h12.txt`, not `h1.txt` .. `h12.txt`.
- A slug is 3 to 40 characters, `[a-z0-9-]`, and derived from the task name. It carries no second
  date and no version suffix.
- Banned junk-drawer names, as folder or file: `misc`, `stuff`, `tmp`, `temp`, `new`, `old`,
  `backup`, `final`, `final-final`, `copy`, `untitled`, `asdf`, bare `utils` or `helpers` with no
  subject. Name the real idea or do not group at all.

## 3. Depth and path length

- Cap nesting near eight levels below the project root; prefer flatter.
- Cap total path length near 255 characters. Windows, and archives extracted on Windows, break
  earlier than POSIX systems do.
- Do not mirror a work-breakdown tree folder-for-folder. Depth is a cost paid by every future
  command, tab-completion and grep.
- Check a candidate path before committing to it:

      ($path.Length)                                  # expect <= 255
      ($path -split '[\\/]').Count - 1                # expect <= 8 below the project root

## 4. Where durable output belongs

The sink is working space. Durable output lives in the project's real tree, and it gets there by an
explicit `keep` in the MANIFEST, copied — not silently moved.

| Kind of output | Home | Never |
|---|---|---|
| A test the project's runner executes | the test tree the project already has: `tests/<area>/<module>.test.<ext>` (or `test/`, `spec/`, `__tests__/`) | the repo root; a second test tree invented beside the first; the sink |
| A file whose **content** is test-like but which sits somewhere other than the test tree | a finding with a proposed route to the test tree, confirmed per item before it moves | the application tree — it must not be reachable by the build |
| A probe or script that merely contains a test-framework word and no test structure | `.work/<run>/tmp/` — a weak signal never promotes a probe to a test | the test tree, where the runner will collect and run something that was never a test |
| A one-off probe or experiment | `.work/<run>/tmp/` | the test tree — a probe is not a test |
| A raw capture or scrape dump | `.work/<run>/raw/` | the repo root; the same folder as its analysis |
| Analysis of a capture | `.work/<run>/out/`; promote to `docs/<area>/` only when the user wants it kept | mixed in with `raw/` |
| A screenshot or test artifact from a finished run | the sink; promote only what the user names | a top-level `test-results/` that grows forever |
| A research note the user asked to keep | `docs/<area>/<topic>.md` | the repo root; the sink |
| A backup archive | the backups directory, with a row in `BACKUPS.md` | the repo root next to source files |
| A generated report | the sink `out/`, or the project's existing reports directory | a new top-level directory per report |

One home per idea. If a fact lives in two places, one of them is wrong and the next reader will
follow the stale one.

## 5. Content signals: is this a test, or a probe?

A filename is weak evidence. What a file *is* lies in its first screen of content, and each runner
below names itself in it. Read the head of the file — the first 4 KB is enough in practice, and a probe
whose only claim to being a test is the word `test` somewhere in it is not a test.

| Stack | Strong signals — the file is test code | Weak signals — corroboration only, never sufficient | Where the runner itself looks |
|---|---|---|---|
| PHP — PHPUnit, Pest | `use PHPUnit\`, `extends TestCase` | `it(`, `test(` beside a `pest.php`, `->assert`, `$this->assert` | `phpunit.xml` `<testsuite>`; the `suffix` attribute decides which names are collected |
| JS/TS — jest, vitest | `describe(`, `beforeEach(`, `jest.`, `vitest`, `@testing-library` | `test(`, `it(`, `expect(` | `testMatch` / `testRegex` (jest), `include` (vitest) |
| JS/TS — playwright, cypress | `playwright`, `cypress`, `page.goto(` in a project with a `playwright.config` | `expect(`, `cy.` calls | `testDir` (playwright), `cypress/e2e` (cypress) |
| Python — pytest, unittest | `import pytest`, `def test_`, `unittest` | `assert ` | the `python_files` convention, `python -m unittest discover` |
| Shell / PowerShell | `Pester` — it names the framework | a `*.Tests.ps1` name, `Invoke-Pester`, `Describe `, `Should -Be`, `-Should`, a shebang script whose body is `echo`/`exit`/`throw` | the `*.Tests.ps1` convention, Pester's own discovery |

**A cmdlet is not a framework.** `Invoke-RestMethod`, `Invoke-WebRequest`, `Invoke-Expression` and
`Invoke-Command` are ordinary production and diagnostic cmdlets: deploy scripts, API clients and
health checks are written with exactly those. A PowerShell file whose only signal is one of them is
production code or a probe, not a test: it keeps its existing class, is additionally flagged `unsure`
because the probe read it and could not decide, stays on disk, and is never routed. The signal for
this stack is `Pester` itself, which is the framework the project's runner collects.

`unsure` is therefore reserved for "the probe looked and could not tell", and the boundary is worth
knowing because it decides which items carry the flag. Only the **backup** and **scrape-raw** rules run
before the probe, so a file they claim is classified by them and records no probe result — it needs
none, its origin is already established. Every rule after them, **junk-named** included, records it: a
junk-named file with a weak probe hit keeps `junk-named` and stays a per-item-confirmed removal
candidate, because the name is the reason it is proposed and a weak word does not veto it — but it is
listed as `unsure` and its reason discloses the weak signal, so the ambiguity is visible on the very
items a person is asked to confirm by name.


The distinct precedent for each row, which is where the "the runner decides, not the filename" rule
comes from:

- [PHPUnit, organizing tests](https://docs.phpunit.de/en/11.5/organizing-tests.html) — a test suite is
  composed of directories and files the configuration names, and `suffix` decides which files count.
- [jest configuration](https://jestjs.io/docs/configuration) — `testMatch` and `testRegex` define what
  the runner will collect.
- [Vitest config](https://vitest.dev/config/) — `include`/`exclude` define the same thing.
- [Playwright test configuration](https://playwright.dev/docs/test-configuration#testdir) — `testDir`
  is the root the runner searches.
- [pytest usage](https://docs.pytest.org/en/stable/how-to/usage.html) — collection is by file and
  function naming convention, and `--collect-only` prints what was collected.
- [Pester `Invoke-Pester`](https://pester.dev/docs/commands/Invoke-Pester) — PowerShell's runner, with
  the same "run what discovery found" behaviour.

Rules:

1. A strong signal decides. A weak signal on its own never does: a script containing `expect(` is
   still a probe and stays in the sink.
2. A test-content file outside the test tree that git tracks, or that another tracked file references,
   is a **finding with a proposed route** — reported, never moved as part of a sweep. A move inside
   the repository changes what the build sees, so it needs a per-item confirmation by name.
3. The route is the test tree the project already has (`tests/<area>/<module>.test.<ext>`). Never
   invent a second tree beside it.
4. After a move, verify the runner actually collects the file. A test that is not collected is a file
   that is resident in the test tree and useless.
5. Because a test's content can be collected and shipped by a build that globs the source tree, the
   placement rule is what keeps test code out of the build output. A file whose content is test-like
   belongs in the test tree or nowhere.

## 6. Empty folders

An empty directory is rarely a neutral fact. It is either residue from a move — something was deleted
or relocated and the folder stayed — or a placeholder whose reason is not written down anywhere. The
owners of both cases lose time: the residue implies a deletion nobody explained, and the anonymous
placeholder is indistinguishable from the residue.

`.gitkeep` exists precisely because the second case is real and git cannot represent the first: a
checkout does not preserve an empty directory, and `git ls-files -- <dir>` returns nothing for one,
because a directory with no entries contributes nothing to the index
([git-ls-files](https://git-scm.com/docs/git-ls-files)). So an empty directory in a working tree is
always a local fact, never a recorded one — which is exactly why the organizer may settle it, and
exactly why the check has to be made against the filesystem rather than against git.

The owner authorizes settling empty folders: a directory with zero entries that nothing uses is
removed as part of the routine sweep. The authorization has conditions, and all seven must hold:

| # | Condition | The command that proves it |
|---|---|---|
| 1 | No entries at all — or every entry beneath it is being moved or purged by this same plan | `Get-ChildItem -Force -LiteralPath <dir>` returns nothing |
| 2 | No tracked file anywhere beneath it | `git ls-files -- <dir>` returns nothing |
| 3 | Not a sink directory, and not the engine's state or quarantine | compare against the sink path and the state directory for this run |
| 4 | Not a directory the framework requires to exist while empty | the list below |
| 5 | Not a junction, symlink, or mount point | `(Get-Item <dir>).LinkType`, `(Get-Item <dir>).Attributes` |
| 6 | Not the project root, and not an ancestor of anything this plan keeps or reports | the plan's kept and reported sets |
| 7 | Not a directory the user named as wanted | the conversation record |

Condition 4, because these are the ones a naive "is it empty?" check would happily delete: `storage/framework/cache`, `storage/framework/sessions`, `storage/framework/views`, `storage/app/public`, `bootstrap/cache`. They are empty in a fresh checkout, and the framework breaks when they are missing. A `.gitkeep`-only directory is **not** empty: the placeholder is an entry, and it is a written statement that the directory must stay.

Settlement is a class **S1** action. It is journalled before it runs, and the journal's inverse
recreates the directory, so the undo is a real command rather than a promise:

    {"action":"settle","from":"C:\\proj\\empty-dir","class":"S1","inverse":{"op":"mkdir"},"undo":"mkdir \"C:\\proj\\empty-dir\""}

Ordering and verification:

1. Settle **deepest first**, and only after every move and purge in the plan has run. A parent only
   becomes a candidate once its children have been settled, which is also the order that proves it.
2. A directory that fails any condition is reported in the plan with the condition that failed, and is
   left in place. It is not settled "anyway" at a deeper level.
3. Verify with `Test-Path -LiteralPath <dir>` returning `False`, or `test -d <dir>` exiting non-zero.
   `git status` will not show the change — an ignored, empty directory is invisible to it.
4. The plan and `MANIFEST.md` record the directory, the condition check, and the journal line.

## 7. Right and wrong placement, from a real tree

The before-state below was measured in the owner's workspace (`C:\xampp\htdocs\root-ai`) on
2026-10-12, before this skill existed. Each row is a placement defect with its correct destination.

| Observed path | Observed size | Why it is wrong | Correct placement |
|---|---|---|---|
| `.dsh-scan-asar.cjs`, `.dsh-scan-asar.js`, `.dsh-scan-asar2.cjs`, `.dsh-scan-extract.cjs` | four scripts | One-off probe scripts at the repo root; the root is not a scratchpad | `.work/2026-10-12-asar-scan/tmp/` |
| `.dsh-asar-index.json` | 121 KB | Derived data at the repo root | `.work/2026-10-12-asar-scan/out/asar-index.json` |
| `.dsh-scan-extract/` | 127 files | An extraction dump at the repo root | `.work/2026-10-12-asar-scan/raw/` |
| `NUL.css` | 7.9 KB | A shell redirect artefact from a Windows run; never a stylesheet | `.work/2026-10-12-<slug>/tmp/` or nothing |
| `user-conversation-check.png` | 193 KB | A screenshot from a finished task sitting in the root | `.work/2026-10-12-<slug>/raw/` |
| `tests/crack_lab.py`, `tests/winter.txt` | one-off files | Scratch mixed into the test tree, where the runner may try to collect it | `.work/2026-10-12-<slug>/tmp/` |
| `tests/ds-login-research/_raw/` | 697 KB + 193 KB + 20 files | Capture and analysis share one folder, so neither can be deleted on its own schedule | capture to `.work/.../raw/`, analysis to `.work/.../out/` |
| `test-results/` | 2 screenshots | A top-level output directory for one finished task, left behind | the sink of the run that produced it |
| `backups/` | 2 files, 922.9 MB | No retention note and no disposition per file | keep the directory, add `BACKUPS.md` with a disposition row per file |

Right and wrong, stated as rules:

| Right | Wrong |
|---|---|
| `.work/2026-10-12-asar-scan/out/asar-index.json` | `.dsh-asar-index.json` at the root |
| `.work/2026-10-12-login/raw/gh_repos.json` | `scrape.json` beside the scraper source |
| `tests/Feature/LoginTest.php` for a real test | `tests/crack_lab.py` for a probe |
| `docs/research/login-flow.md` once the user keeps it | `login-flow-notes.md` at the root |
| `backups/root-ai-codebase-2026-08-18.zip` + a `BACKUPS.md` row | `backup-new.zip`, `backup-old.zip`, no record |

## 8. Fixing placement that already went wrong

Moving an existing file into the sink is an S1 action (reversible, journalled). It is not a licence
to delete, and it still needs a plan the user saw.

1. Inventory at S0 and classify each misplaced artifact.
2. Plan the moves: one row per file, `from`, `to`, safety class, reason.
3. Show the plan. On approval, move one literal path at a time and journal each move with its undo.
4. Verify: the source path is gone, the sink path exists with the same byte size and hash.
5. Re-run the test suite if a file moved out of the test tree — the runner's collection set changed.
6. A misplaced file whose class is `unsure` is left in place and reported, not moved.

Compare before and after with a hash, not with a glance:

    Get-FileHash -Algorithm SHA256 <old-path>, <new-path> | Format-Table Hash, Path

## Sources

- [FlyFission/nuclear-grade-context-engineering](https://github.com/FlyFission/nuclear-grade-context-engineering)
  — earned folders, one disposition rule per folder, ISO-8601 lowercase naming, banned junk-drawer
  names, depth and path-length caps, per-folder notes, and the stage-folder protocol.
- [NARA Bulletin 2015-04](https://www.archives.gov/records-mgmt/bulletins/2015/2015-04.html) —
  platform-safe file and folder naming as the upstream practice for the naming rules above.
- [gitignore](https://git-scm.com/docs/gitignore) — the ignore rule that keeps the sink out of the
  project's history.
- [opum-ai/housekeeping-skills](https://github.com/opum-ai/housekeeping-skills) — treating placement
  repair as a reversible, journalled operation rather than a delete.
- [PHPUnit, organizing tests](https://docs.phpunit.de/en/11.5/organizing-tests.html),
  [jest configuration](https://jestjs.io/docs/configuration),
  [Vitest config](https://vitest.dev/config/),
  [Playwright `testDir`](https://playwright.dev/docs/test-configuration#testdir),
  [pytest usage](https://docs.pytest.org/en/stable/how-to/usage.html) and
  [Pester `Invoke-Pester`](https://pester.dev/docs/commands/Invoke-Pester) — each runner's own
  definition of what it collects, which is the authority for section 5's signal table and for the rule
  that a test the runner cannot collect is not a test in the project's sense.
- [git-ls-files](https://git-scm.com/docs/git-ls-files) — what git owns beneath a path, which is why an
  empty directory is a filesystem fact and cannot be confirmed with `git status`.
