---
name: stack-index
description: Route any programming language to its executable command set - install, test, lint, type-check, build, coverage and dependency audit - with an honest verification badge on every row. Use whenever a senior-* skill needs a concrete command and the stack is not Laravel/PHP (stack-php-mysql) or React/Vite (senior-frontend-engineering), and when a language is not listed at all.
---

# Stack Index

The senior-* skills are stack-neutral, which in practice means they cite PostgreSQL, Kubernetes and GitHub Actions. This file is the router: it names the command that turns a phase into evidence for **any** language, and it states how much of that command has actually been run.

## The rating rule — no false positives

| Badge | Meaning | How it earns it |
|---|---|---|
| `★5` | **Verified in a real project on this machine.** The command ran, exit 0, output recorded. | the output, the version, the date |
| `★4` | **Documented.** Standard tool for the language, from its own docs, not run here. | doc URL + date checked |
| `★3` | **Derived.** Pattern follows from a sibling tool; syntax unconfirmed for this one. | state the reasoning |
| `★2` | **Blocked.** The tool exists but the environment prevents it — record the blocker, not a pass. | the exact error |
| — | **No badge = not a command.** A guess presented as a gate is the false positive this file prevents. | n/a |

**The runtime being installed does not verify a project command.** `python --version` succeeding proves Python exists; it proves nothing about `pytest`. Those are different claims and they get different badges.

When a check lands on `★3` or below, the phase's evidence gate says `UNAVAILABLE` with the exact command and the reason. Upgrade a badge by running the command, never by asserting harder.

## Verification log — what was actually run (2026-10-21)

| Runtime | Command run | Result |
|---|---|---|
| Python | `python --version` | `Python 3.14.4` ✅ |
| Python | `python -m pytest --version` | `No module named pytest` ❌ → install before claiming |
| Python | `python -m ruff --version` | `No module named ruff` ❌ |
| Python | `python -m mypy --version` | `No module named mypy` ❌ |
| Python | `python -m coverage --version` | `No module named coverage` ❌ |
| Python | `python -m pip_audit --version` | `No module named pip_audit` ❌ |
| .NET | `dotnet --version` | `10.0.402` ✅ |
| .NET | `dotnet format --version` | `UnauthorizedAccessException` on `%USERPROFILE%\.dotnet` — sandbox blocks the home directory. `★2` in a confined session. |
| Java | `java -version` | `java 21 2023-09-19 LTS` ✅ |
| Java | `mvn -version` | not installed ❌ |
| Java | `gradle --version` | not installed ❌ |
| Node | `node --version` | `v24.15.0` ✅ |
| Node | `pnpm --version` | `12.4.2` ✅ |
| Node | `pnpm exec tsc --version` | needs a project; `★4` until run |
| Node | `pnpm exec eslint --version` | needs a project; `★4` until run |

**Reading this table:** every runtime is present, and almost every project command is unproven. That is the honest state, and it is what the gate must report.

## The matrix — one row per language

Columns: install · test · lint · type / build · coverage · dependency audit.
Every row below is `★4` unless a row's note says otherwise. Project commands become `★5` the first time they run in a real project on this machine.

| Language | Install | Test | Lint | Type / build | Coverage | Audit |
|---|---|---|---|---|---|---|
| **Python** | `python -m venv .venv` → `.venv\Scripts\pip install -e .` | `pytest -q` | `ruff check .` | `mypy .` | `coverage run -m pytest` | `pip-audit` |
| **C# / F# (.NET)** | `dotnet restore` | `dotnet test` | `dotnet format --verify-no-changes` | `dotnet build -warnaserror` | `dotnet test --collect:"XPlat Code Coverage"` | `dotnet list package --vulnerable` |
| **Java (Maven)** | `mvn dependency:resolve` | `mvn test` | `mvn checkstyle:check` | `mvn compile` | `mvn verify` (JaCoCo) | `mvn org.owasp:dependency-check-maven:check` |
| **Java/Kotlin (Gradle)** | `./gradlew dependencies` | `./gradlew test` | `ktlint` / `detekt` | `./gradlew build` | `./gradlew jacocoTestReport` | `./gradlew dependencyCheckAnalyze` |
| **Node / TS** | `pnpm install --frozen-lockfile` | `pnpm test` | `pnpm exec eslint .` | `pnpm exec tsc --noEmit` | `pnpm exec vitest run --coverage` | `pnpm audit --prod` |
| **Go** | `go mod tidy` | `go test ./...` | `go vet ./...` + `staticcheck ./...` | `go build ./...` | `go test -coverprofile=cover.out ./...` | `govulncheck ./...` |
| **Rust** | `cargo fetch` | `cargo test` | `cargo clippy -- -D warnings` | `cargo check` | `cargo llvm-cov` | `cargo audit` |
| **Ruby** | `bundle install` | `bundle exec rspec` | `bundle exec rubocop` | `bundle exec srb tc` (Sorbet) | SimpleCov | `bundle audit check` |
| **PHP** | `composer install` | `vendor/bin/phpunit` | `vendor/bin/pint --test` | `vendor/bin/phpstan analyse` | `vendor/bin/phpunit --coverage-text` | `composer audit` |
| **C / C++** | `cmake -B build` | `ctest --test-dir build` | `clang-tidy` | `cmake --build build` | `gcov` / `lcov` | `conan` / `vcpkg` + OSV |
| **Kotlin** | `./gradlew dependencies` | `./gradlew test` | `ktlint` / `detekt` | `./gradlew build` | JaCoCo | `dependencyCheckAnalyze` |
| **Swift** | `swift package resolve` | `swift test` | `swiftformat --lint` | `swift build` | `swift test --enable-code-coverage` | `swift package show-dependencies` |
| **Scala** | `sbt update` | `sbt test` | `scalafmt --test` | `sbt compile` | `sbt coverage test` | `sbt dependencyCheck` |
| **Elixir** | `mix deps.get` | `mix test` | `mix format --check-formatted` | `mix compile --warnings-as-errors` | `mix test --cover` | `mix hex.audit` |
| **Dart / Flutter** | `dart pub get` | `dart test` | `dart analyze` | `dart build` | `flutter test --coverage` | `dart pub outdated` |
| **R** | `Rscript -e 'renv::restore()'` | `Rscript -e 'testthat::test_dir("tests")'` | `Rscript -e 'lintr::lint_dir()'` | `R CMD build` | `covr::package_coverage()` | `oysteR::audit` |
| **Lua** | `luarocks install --only-deps` | `busted` | `luacheck .` | n/a | `luacov` | `luarocks` + OSV |
| **Perl** | `cpanm --installdeps .` | `prove -lr t/` | `perlcritic` | `perl -c` | `Devel::Cover` | `cpan-audit` |
| **Haskell** | `cabal build --only-dependencies` | `cabal test` | `hlint .` | `cabal build` | `cabal test --enable-coverage` | `cabal audit` |
| **Clojure** | `clojure -P` / `lein deps` | `lein test` | `clj-kondo --lint src` | `lein compile` | `cloverage` | `lein nvd` |
| **Shell** | n/a | `bats tests/` | `shellcheck **/*.sh` | `bash -n script.sh` | `kcov` | n/a |
| **PowerShell** | `Install-Module` in manifest | `Invoke-Pester` | `Invoke-ScriptAnalyzer -Path .` | parse via `[scriptblock]::Create` | `Pester` + `-EnableExit` | n/a |

## Any language not listed

Derive the seven commands from four questions and write the answers down. Every matrix row was produced this way.

1. **What resolves dependencies?** The lockfile name, and the install command that honours it (`--frozen`, `--locked`, `ci`).
2. **What runs the tests?** The project's own runner, discovered from a config file — never a guess.
3. **What rejects bad code without running it?** A linter and, where the language has one, a type checker or a compile step with warnings as errors.
4. **What reports dependency risk?** The ecosystem audit tool, or `osv-scanner -r .` when the language has none.

Record each answer as `★3` until it is run.

## How a senior-* skill uses this

| senior-* phase | Command family |
|---|---|
| code-review Phase 3 (failure behaviour) | test runner + timeout/retry configuration |
| test-adequacy | test, coverage, mutation tool |
| performance-audit | the language's profiler, not the DB one unless the DB is the bottleneck |
| supply-chain-audit | install + audit + lockfile |
| release-gate | build + coverage + audit, all on the candidate SHA |
| work-audit | the project's own declared verification, not a substitute |

## Rules

1. **The project's own commands win.** A `Makefile`, `package.json` script, `justfile`, or CI workflow is the verification; this table is the fallback.
2. **One badge per row, not per file.** A `★5` file can hold a `★4` line; mark the line.
3. **A missing toolchain is `UNAVAILABLE`**, with the install command recorded — never a fabricated pass.
4. **Never mix stacks.** A PHP command does not verify a Node change; say which runtime produced each artifact.
5. **A version bump invalidates the verification, not the command.** Re-run and re-date.
