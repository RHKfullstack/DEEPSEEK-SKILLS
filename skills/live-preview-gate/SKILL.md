---
name: live-preview-gate
description: Never implement straight into production - build a running preview the owner can open on localhost, show the URL and a screenshot, wait for explicit approval, then ship the approved artifact. Use on every feature, UI change, API change or script that has user-facing behavior, before writing to the production tree, and before reporting anything complete. Preview first, production last; silence is not approval.
---

# Live Preview Gate

**Production is the decision, not the draft.** The owner cannot judge a description, a plan, or a diff — they can judge a page they can click. Implementing straight into the production tree and reporting "done" moves the decision to after the risk has landed.

This skill makes the preview a **gate**: nothing reaches production until a running artifact has been seen and approved.

## Phase 0 — Every change has a preview

| Change | The preview is |
|---|---|
| UI, layout, flow | a served page on localhost, running the real code path |
| API, backend behaviour | a running server plus a request/response transcript |
| CLI, script, job | a dry run on real-shaped input, transcript shown |
| Schema, migration, backfill | a scratch database with seeded data, before/after rows |
| Docs, config only | the rendered diff |

There is no category with "no preview". If nothing can be run, the preview is the exact diff plus its output.

## Phase 1 — Build the preview, not a mockup

- **The same code**, in an isolated environment — a branch, a dev server, or a `preview/` build.
- **Never a hand-written HTML mockup** dressed as the feature. A mockup proves the mockup.
- **Disposable**: `preview/` inside the run's sink, or a scratch branch. Never the production tree.
- **Fixture data, not production data.** Seed a realistic set; never copy live records.
- **No production secrets** in the preview process — use a dev env file with dummy values.

Cross-reference: `organizer` for where the preview directory goes; `senior-production-defaults` for what the preview code must already respect.

**EVIDENCE: the preview directory or branch, and the command that starts it.**

## Phase 2 — Serve it, and give the URL

```bash
# Laravel
php artisan serve --host=127.0.0.1 --port=8000
# Vite / React
npm run dev -- --host 127.0.0.1 --port=5173
# Python
python -m http.server 8000 --bind 127.0.0.1
# static build
npx serve dist -l 8000
```

Rules:

- **Bind to `127.0.0.1`, never `0.0.0.0`** — a preview exposed on the LAN is a production incident in advance.
- **Pick a port and state it**, so the owner can open the exact URL.
- **Start it as a background job** and confirm it is listening before reporting the URL (`Invoke-WebRequest` the route, or `curl -I`).
- The URL in the reply is a **clickable link**: `http://127.0.0.1:8000/invoices`.

**EVIDENCE: the URL, and the HTTP status of the route you asked the owner to open.**

## Phase 3 — Evidence the owner can actually judge

Five things, every time:

1. **The URL**, clickable.
2. **A screenshot** of the main state, saved under the run's `raw/` and shown inline.
3. **What to click** — three to five steps that exercise the change.
4. **What to look for** — the acceptance criteria, in the owner's words.
5. **What is not done yet** — known gaps, so approval is informed.

Plus the diff stat, so they see the blast radius.

**EVIDENCE: `preview/REVIEW.md` with those five items, and the screenshot in the reply.**

## Phase 4 — The approval gate

- The owner approves **explicitly**: "approved", "go", "ship it", "ok na".
- **Record it** in `preview/APPROVAL.md`:

```md
# Approval
- Shown: <what>, at <preview URL>, <ISO timestamp>
- Owner said: "<verbatim>"
- Scope approved: <files/behaviour>
- Not covered by this approval: <anything deferred>
```

- **Ambiguity is not approval.** "Nice", "looks fine", "hmm" → ask one direct question: *"Shall I ship this to production?"* Do not proceed on a compliment.
- **Silence is never approval.**
- Any change to the approved artifact voids the approval — re-preview.

**EVIDENCE: `preview/APPROVAL.md` with the verbatim quote and timestamp.**

## Phase 5 — Production, after approval only

- Ship **the same artifact** that was approved. Not a re-implementation with "improvements".
- If production differs in any way the owner would notice — a different config, a different seed, a flag left off — **say so before shipping**, and re-preview if it is material.
- Then run the normal chain: `project-quality-chain` steps 1–5, including the gate and the audit.
- Keep the rollback path named before the deploy (`senior-release-gate`).

**EVIDENCE: the production change references the approval, and the diff matches what was shown.**

## Phase 6 — Clean up

- Stop the preview server (kill the background job).
- Remove the preview directory under `organizer`'s S1/S2 classes — it is in the sink, so a plain removal inside a shown plan.
- **Keep `APPROVAL.md` and the screenshot** — they are the record of what was approved.

## Anti-default table

| Default | The gate |
|---|---|
| Implementing straight into production | preview first, production after approval |
| "Here is what I will build" (a plan) | a running page the owner can click |
| A mockup HTML file | the real code path, served |
| "Tests pass" as the evidence | the owner's eyes on the running artifact |
| Assuming silence or a compliment is approval | one direct question, then a recorded yes |
| Previewing with production data | fixture data in a disposable environment |
| Leaving the dev server running | stopped at the end, the record kept |
| Re-building after approval | ship the artifact that was approved |
| Binding `0.0.0.0` | `127.0.0.1` only |

## Definition of done

- A preview ran, served on `127.0.0.1`, and the owner was given the URL.
- A screenshot, a click path, the acceptance criteria and the known gaps were shown.
- The approval is recorded verbatim, with a timestamp.
- Production received the approved artifact, and the diff matches what was shown.
- The server is stopped and the preview cleaned up under the organizer's rules.

## Failure modes

1. **Implementing into production first** — the failure this skill exists for; the review becomes archaeology.
2. **A mockup instead of the real path** — approves a page that will never exist.
3. **`0.0.0.0`** — the preview is on the LAN, reachable from another device.
4. **Production data in the preview** — a copy of real records in a disposable folder.
5. **"I thought you approved"** — no record, no quote, no timestamp.
6. **Re-implementing after approval** — the owner approved something else.
7. **A dev server left running** — port occupied, stale process, confusing the next session.

## Sources — verified live 2026-10-30

- [The Twelve-Factor App — Dev/prod parity](https://12factor.net/dev-prod-parity) — why the preview must run the same code with only the environment differing.
- [GitLab Review Apps](https://docs.gitlab.com/ee/ci/review_apps/) — preview environments per change, as the industry pattern.
- [GitHub Actions environments](https://docs.github.com/en/actions/deployment/environments) — required reviewers as an approval gate before a deploy.
- [Laravel deployment](https://laravel.com/docs/11.x/deployment) — what differs between a served preview and production.
- [Vite guide](https://vite.dev/guide/) — the dev server and the `--host` flag used in Phase 2.
- [MDN — setting up a local testing server](https://developer.mozilla.org/en-US/docs/Learn_web_development/Howto/Tools_and_setup/set_up_a_local_testing_server) — the baseline for serving a page locally.
