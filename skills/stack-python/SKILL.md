---
name: stack-python
description: Python command set for the senior-* evidence gates - venv, install, pytest, ruff, mypy, coverage, pip-audit - with an honest verification badge and the exact blocker when a tool is absent. Use when the target is a Python project or script.
---

# Stack Python

Load with `stack-index` and the senior-* skill whose phase you are in. This adapter supplies the commands; the senior skill supplies the bar.

## Verified here (2026-10-21)

| Check | Command | Result |
|---|---|---|
| Runtime | `python --version` | `Python 3.14.4` ★5 |
| Test runner | `python -m pytest --version` | **absent** — `No module named pytest` ★2 |
| Linter | `python -m ruff --version` | **absent** ★2 |
| Type checker | `python -m mypy --version` | **absent** ★2 |
| Coverage | `python -m coverage --version` | **absent** ★2 |
| Dependency audit | `python -m pip_audit --version` | **absent** ★2 |

**What this means:** the interpreter is present; **no gate tool is installed**. Until the project installs them, `pytest`, `ruff`, `mypy`, `coverage` and `pip-audit` are `UNAVAILABLE`, not passing. The install command is part of the finding:

```powershell
python -m pip install pytest ruff mypy coverage pip-audit
```

After that install runs in a real project, upgrade the badge to ★5 with the output recorded. Do not upgrade it because the library is popular.

## The command set

```powershell
python -m venv .venv                              # isolate; never install into the system interpreter
.\.venv\Scripts\Activate.ps1                      # Windows
python -m pip install -e .                        # editable install of the project
python -m pip install pytest ruff mypy coverage pip-audit

python -m pytest -q                               # the project's tests
python -m pytest -q -x --maxfail=1                # stop at the first failure, for a fast gate
python -m pytest -q --cov=. --cov-report=term-missing
python -m ruff check .
python -m ruff format --check .
python -m mypy .
python -m pip_audit -r requirements.txt            # or: pip-audit (env scan)
python -m build                                   # build the distributable
```

## Mapping to the senior-* phases

| Phase | Command | Badge |
|---|---|---|
| `senior-test-adequacy` | `pytest --cov`, then mutation: `python -m mutmut run` (extra install) | ★4 |
| `senior-code-review` Phase 3 | the test that exercises the failure path, plus the timeout/retry config | ★4 |
| `senior-performance-audit` | `python -m cProfile -o out.prof script.py`, then `snakeviz out.prof` | ★4 |
| `senior-supply-chain-audit` | `pip-audit` + `pip freeze` lockfile comparison | ★2 until installed |
| `senior-release-gate` | the four above on the candidate commit | ★2 until installed |
| `senior-work-audit` | `pytest -q` on a clean checkout | ★2 until installed |

## Failure modes specific to Python

1. **System interpreter contamination.** Tests pass because a package was installed globally months ago. Verify inside a fresh `.venv` on a clean checkout.
2. **`pytest` collects nothing.** A passing run with `0 tests` is not evidence. Check the collected count.
3. **`mypy` with `ignore_errors`.** A type gate configured to ignore its own findings is a badge, not a gate.
4. **`pip-audit` on the wrong file.** It audits the resolved environment or the lockfile — not `requirements.in`. Audit what is installed.
5. **Windows path and encoding assumptions.** `cp1252` defaults break on non-ASCII; assert `encoding="utf-8"` explicitly.
6. **Mutable default arguments and `datetime.now()` without `tz`.** Both are the classic defects `ruff` catches and a green suite does not.

## Evidence to record

| Phase | Artifact |
|---|---|
| install | `python --version` and `pip list` output |
| test | `pytest -q` summary line, including the collected count |
| lint / type | `ruff check` and `mypy` exit codes |
| coverage | `--cov-report=term-missing` output, and the changed-lines subset |
| audit | `pip-audit` JSON, with the advisory IDs that remain |
| unavailable | the exact `No module named …` line and the install command |
