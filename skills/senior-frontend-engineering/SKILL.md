---
name: senior-frontend-engineering
description: Review or ship a React/component/SPA/Vite frontend change — state ownership, React rendering correctness, loading/empty/error states, WCAG 2.2 AA accessibility, Core Web Vitals and bundle budgets, forms, Playwright and visual-regression proof, client security, and i18n — with an executable check behind every claim.
---

# Senior Frontend Engineering

A frontend claim is verified in a browser, not in jsdom. A green unit suite proves a reducer; it does not prove the page renders, focuses, shifts, announces, or loads in time. This skill turns each frontend claim into a command, an assertion, or an explicit browser step, and records the artifact.

> **Stack:** load `stack-php-mysql` for the Laravel/Blade half, and `ui-design` for the visual bar.

## When this applies

- A React/component/SPA/Vite change adds or edits a route, screen, list, form, modal, or data surface.
- Someone claims a UI change is done, a UI defect was reported fixed, or a frontend release gate needs browser evidence.
- The task names accessibility, Core Web Vitals, bundle size, loading states, browser tests, or client security.
- A Blade page's JavaScript island or Vite entry changes.

## When it does not

- The ask is visual taste, tokens, layout rhythm, or a screenshot critique: use `ui-design`.
- The ask is server-side authorization, CSRF, or PHP escaping: use `senior-app-security`.
- The change has no rendered UI (pure API, worker, CLI) or the page is server-rendered HTML with no client state: use `senior-code-review`/`senior-work-audit`, or run Phases 5 and 10 only and say so.

## Core rule

Every claim ends in an artifact: a JSON report, a failing-then-passing test, a trace, or a recorded measurement — never "looks right in the browser". A check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`. Write every artifact under `.work/<YYYY-MM-DD>-<slug>/out/` and cite its path in the report. Numbers are measured in this run; a budget with no recorded baseline is not a gate. Visual judgement belongs to `ui-design`; this skill judges behaviour that can be asserted.

## Phase 1 — Fix the claim and inventory the surface

1. Restate the claim as a falsifiable sentence: "Change X makes route R render/do Z for state S, demonstrated by command or browser step W."
2. Pin the revision: `git rev-parse HEAD`, `git status --porcelain`, and list changed frontend files: `git diff --name-only <base>...HEAD -- src resources '*.blade.php' index.html 'vite.config.*'`.
3. Map every touched data surface to its endpoint: route → component → `GET/POST` URL. A surface with no endpoint is static and still needs Phases 4–5.
4. Record the declared browser matrix and breakpoints: `node -e "console.log(JSON.stringify(require('./package.json').browserslist || null))"` plus the CSS breakpoints. If none is configured, write "no matrix configured" as a finding — do not invent one.
5. Record the project's own scripts: `node -e "console.log(JSON.stringify(require('./package.json').scripts, null, 2))"`.

EVIDENCE: `surface-inventory.md` — claim sentence, SHA, changed-file list, surface→endpoint map, browser/breakpoint matrix, script table.

## Phase 2 — State ownership: local vs server vs URL

1. Table every state atom: value, owner (URL | server cache | local component | global store), writer(s), and whether it is derived. Two writers on one atom is a finding.
2. Find mirrored state: `git grep -nE 'useState\(props\.|useEffect\(\(\) => \{[^}]*set[A-Z]' -- src`. `useState(prop.x)` or `useEffect(() => setX(prop.x), [prop.x])` is a finding — derive it instead.
3. Filters, pagination, sort, and tab belong in the URL when the state is shareable or back-button sensitive. Assert with Playwright: change the filter, read `page.url()`, `page.goBack()`, and assert both the URL and the list match.
4. One cache owner per resource: `git grep -nE 'fetch\(|axios\.|useQuery\(|useSWR\(' src`. Two components fetching the same endpoint with no shared cache is a finding; record the query keys if a cache library is present.
5. Assert one request per resource per screen, not one per row: count requests in the Playwright network log for the primary route.

EVIDENCE: `state-ownership.md` — ownership table, mirror-state grep output, URL/back-button test, fetch inventory.

## Phase 3 — React rendering correctness

1. Run the hook rules as errors: `npx eslint src --rule 'react-hooks/rules-of-hooks: error' --rule 'react-hooks/exhaustive-deps: error' --max-warnings=0` (requires `eslint-plugin-react-hooks`; if absent, record the install as a finding before the run).
2. Audit every disable: `git grep -n 'eslint-disable.*react-hooks/exhaustive-deps' src` — each line needs a comment naming the invariant it protects, otherwise it is a finding.
3. Keys: `git grep -nE 'key=\{(index|i|idx)\}' -- '*.jsx' '*.tsx'`. An index key on a reorderable, filterable, or appendable list is a finding; assert a stable `id`.
4. StrictMode: assert the entry wraps the app (`git grep -n 'StrictMode' src/main.*`); fetch effects must abort (`AbortController`) and clean up. Run the route and assert one request and no duplicate toast after mount.
5. Error boundary: a test renders a throwing child inside the route boundary and asserts the fallback; Playwright aborts the route and asserts the error UI, not a blank page. `Suspense` needs a defined fallback.
6. Zero unhandled failures: in Playwright register `page.on('pageerror')` and fail the test if it fires; assert the console error list is empty during the primary flow.
7. Cleanup: unmount the component in a test and assert no `setState`/console warning; timers, listeners, and subscriptions are cleared.

EVIDENCE: `react-correctness.md` — lint output, disable-audit result, key grep, boundary test, pageerror count, cleanup test.

## Phase 4 — Loading, empty, and error states

1. For every surface from Phase 1, name four states — loading, empty, error, success. A missing state is a finding, not a follow-up.
2. Every state is actionable: the error has a retry control and no stack/JSON dump; the empty state says what to do next; the loading skeleton reserves the final dimensions.
3. Prove the states with Playwright route interception: `delay` → skeleton, `fulfill({status:500})` → error plus a retry that re-issues the request, `fulfill({json:{data:[]}})` → empty copy. Capture one screenshot per state.
4. Reserve layout: `<img>` carries `width`/`height` or `aspect-ratio` (`git grep -nE '<img' src`), and the skeleton has the final `min-height`. Assert `layout-shift` entries via `PerformanceObserver` and cumulative CLS < 0.1 on the route.
5. No blank flash on navigation: assert the route shows its loading state before data resolves, not an empty container.
6. **No platform default on a product-owned surface.** Run `git grep -nE 'window\.(confirm|alert|prompt)\(|<select|type="date"|type="file"' <changed paths>`. Every hit is either replaced by the project's component or listed as a platform-owned surface with the reason it must stay native — a `confirm()` before a delete is a finding even when it works.

EVIDENCE: `states-matrix.md` — surface×state table, three screenshots per surface, CLS number, retry test result, native-control grep output with a verdict per hit.

## Phase 5 — Accessibility, WCAG 2.2 AA

1. `npx @axe-core/cli http://localhost:5173 --tags wcag2a,wcag2aa,wcag22aa --exit` on every touched route; save the JSON and require zero violations and zero incomplete results. Include it in CI on the preview build.
2. Route change moves focus: Playwright clicks the nav link and asserts `document.activeElement` is the route `<h1>` (or `<main tabindex="-1">`) and that `document.title` changed.
3. Modal: focus moves into the dialog, Tab cycles inside it, Escape closes it, and focus returns to the trigger. All four are Playwright assertions.
4. Async results announce: the result or validation summary sits in `aria-live="polite"` or `role="status"`; assert the live region exists and its text updates after submit.
5. Labels: every input has a `<label for>` or `aria-label`; `page.getByLabel(...)` resolves; axe's label rule passes.
6. Contrast: 4.5:1 for normal text, 3:1 for large text and UI boundaries. Axe checks the flat cases; for text over images or gradients, open DevTools, read the ratio, and record it.
7. Keyboard-only: Tab through the primary flow with Playwright, assert every control is reachable, no trap outside modals, and `:focus-visible` computes to a visible outline (`outlineWidth > 0`).

EVIDENCE: `a11y-report.json` (axe), focus/modal/keyboard Playwright results, contrast readings, keyboard path notes.

## Phase 6 — Client performance and bundle

1. Budgets for this skill: field p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (the web.dev "good" thresholds); lab LCP ≤ 2.5 s, TBT ≤ 200 ms (Lighthouse's green threshold) as the lab stand-in for INP, and CLS ≤ 0.1; initial-route JS ≤ 200 KB gzip and no single task > 200 ms — the last two are this skill's defaults, so record the baseline first and justify any raise.
2. Lighthouse CI is a regression gate, not a diagnosis: commit `lighthouserc.cjs` asserting `largest-contentful-paint`, `total-blocking-time`, and `cumulative-layout-shift` as `error`, then run `npx @lhci/cli autorun --collect.numberOfRuns=3` against the production build.
3. Bundle: `npm run build`, then `npx vite-bundle-visualizer`; record each initial chunk's gzip size and assert the budget. Non-initial routes use `React.lazy`/dynamic `import()`.
4. Images: every content image has dimensions and `srcset`/`sizes`; the LCP image is not lazy and carries `fetchpriority="high"`; below-fold images use `loading="lazy"`.
5. Fonts: `font-display: swap` (or `optional`), the primary woff2 preloaded, and no third-party font origin without `preconnect`; assert no invisible text in a throttled screenshot.
6. Long tasks: record a DevTools Performance trace of the primary flow and assert the longest task ≤ 200 ms; the trace file is the artifact.
7. Field data: if RUM exists, assert `web-vitals` LCP/INP/CLS beacons arrive; if not, mark field metrics `UNAVAILABLE` and name the instrumentation — never present lab numbers as field evidence.

EVIDENCE: `perf-report.md` + `lighthouse-report.json` + bundle treemap; baseline and after numbers, budget pass/fail, longest task.

## Phase 7 — Forms and validation UX

1. Build the field table: field → label → `autocomplete` token → error id → `aria-describedby` → `aria-invalid`. A field missing any column is a finding.
2. Assert the server error maps back to the field, and focus moves to the summary or first invalid field; client validation is UX, never the only validation.
3. Assert the pending state: submit disables the control or sets `aria-busy="true"`, and a double click produces exactly one request (Playwright request count).
4. Assert `autocomplete` is present and correct: `email`, `current-password`, `new-password`, `name`, `one-time-code`. Auth fields must not set `autocomplete="off"`.
5. Assert a failed submit preserves the typed values.

EVIDENCE: `forms-matrix.md` — field table, double-submit count, server-error mapping test, pending-state assertion.

## Phase 8 — Browser-level verification: RTL vs Playwright vs visual regression

1. Map every claim to a layer: RTL for logic, callbacks, and state transitions; Playwright for navigation, upload, back-button, focus, and network failure; visual regression for CSS/layout refactors. jsdom green is not UI evidence.
2. Run the primary flow in Chromium and WebKit: `npx playwright test --project=chromium --project=webkit` (configure both projects first).
3. Prove back-button and upload explicitly: change a filter, go back, assert state restored; upload a fixture and assert the preview and the request payload.
4. Network failure in a real browser: `page.route` abort/500 and assert the Phase 4 error state and retry.
5. Visual regression: commit baselines per route × breakpoint and diff them; `--update-snapshots` only with a reviewed diff. The visual diff report is the artifact.
6. Assert zero `pageerror` and zero console errors during the flow; run axe inside Playwright (`@axe-core/playwright`) so the hydrated DOM is the one audited.

EVIDENCE: `browser-test-map.md` — claim→layer table, Playwright trace, WebKit result, visual diff report, console error list.

## Phase 9 — Client security

1. Sinks: `git grep -nE 'dangerouslySetInnerHTML|\.innerHTML\s*=' src`. Every hit sanitizes with DOMPurify (or is removed) and has a payload test: submit `<img src=x onerror=alert(1)>` and assert it renders as text; a Playwright dialog listener must never fire.
2. URL schemes: `git grep -nE 'href=\{[^}]*\}' src` and assert an allowlist (`http`, `https`, `mailto`, `tel`, relative); test `javascript:alert(1)` input.
3. Token storage: `git grep -nEi 'localStorage.*(token|jwt)|sessionStorage.*(token|jwt)' src` is a finding; prefer an httpOnly, Secure, SameSite cookie. If localStorage is a deliberate decision, record it with the XSS blast radius.
4. CSP is a response header, not a comment: `curl -sI http://localhost:4173 | grep -i content-security-policy`; assert `script-src` uses a nonce or hash and has no `unsafe-inline`, and that `connect-src` names the API.
5. Vite entry: no inline script in `index.html` without the nonce; nothing wider than `script-src 'self'`.
6. Third parties: every `<script src="https://...">` in `index.html` has `integrity`/SRI or is self-hosted; record the count.
7. Server-side escaping, CSRF, and cookies belong to `senior-app-security`; this phase owns the client sinks above.

EVIDENCE: `security-findings.md` — sink list with payload results, CSP header, token-storage decision, third-party count.

## Phase 10 — i18n basics

1. No hardcoded user-visible strings: `npx eslint src --rule 'i18next/no-literal-string: error'` (requires `eslint-plugin-i18next`); if the plugin is absent, record `UNAVAILABLE` and the install command.
2. Plurals resolve through ICU or `Intl.PluralRules`: test counts 0, 1, 2 and assert distinct strings.
3. Dates and numbers use `Intl.DateTimeFormat`/`Intl.NumberFormat` with an explicit locale; pin the locale in a test and assert the output.
4. RTL-safe layout: `git grep -nE 'margin-(left|right)|padding-(left|right)|\bleft:|\bright:' src` is a finding; use logical properties (`margin-inline-start`, `inset-inline-end`). Toggle `dir="rtl"` in a test and assert no overflow.
5. `<html lang>` is set and changes with the locale; assert `document.documentElement.lang`.

EVIDENCE: `i18n-report.md` — literal-string lint, plural/date test output, RTL grep and dir test, lang assertion.

## Definition of done

- The claim is pinned to a SHA, and every touched surface has a loading/empty/error/success matrix proven in a browser.
- State ownership has one writer per atom, no props→state mirror, and one cache owner per resource.
- axe on the touched routes reports zero violations and zero incomplete results at wcag2a/wcag2aa/wcag22aa, and focus, modal, and live-region assertions pass.
- Lighthouse CI and the bundle budget pass against a recorded baseline; field metrics are measured or explicitly `UNAVAILABLE` with the instrumentation named.
- Playwright (Chromium + WebKit) and visual-regression evidence exist for the primary flow; any jsdom-only claim is labelled as such.
- Every client-security sink has a payload test, and the live response carries a CSP without `unsafe-inline`.
- No user-visible string literal remains, and RTL-sensitive layout uses logical properties.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | `surface-inventory.md` — claim, SHA, changed files, surface→endpoint map |
| 2 | `state-ownership.md` — ownership table, mirror grep, URL/back-button test |
| 3 | `react-correctness.md` — hook lint, key grep, boundary and error tests |
| 4 | `states-matrix.md` — four-state matrix, screenshots, CLS |
| 5 | `a11y-report.json` — axe violations, focus/modal/keyboard results |
| 6 | `perf-report.md` + Lighthouse JSON + bundle treemap |
| 7 | `forms-matrix.md` — ARIA wiring, double-submit count, server-error mapping |
| 8 | `browser-test-map.md` — claim→layer map, trace, WebKit, visual diff |
| 9 | `security-findings.md` — sinks, payload results, CSP header, tokens |
| 10 | `i18n-report.md` — literal-string lint, plural/date, RTL, lang |

## Failure modes a naive reviewer misses

1. **"The tests pass" as UI proof.** jsdom does not lay out, focus, scroll, or load a font; without Phase 8 there is no browser evidence.
2. **Index keys on a reorderable list.** React reuses the wrong DOM node, and input state lands in the wrong row.
3. **States only on the happy path.** The error and empty states are written after the demo, so the retry path is never executed.
4. **Axe run once on the home page.** The changed route, the modal, and the hydrated DOM are what get audited.
5. **Lighthouse score chasing.** The gate compares against a committed baseline; a score with no baseline and no budget is decoration.
6. **CSP with `unsafe-inline` plus a nonce.** The nonce does no work; the header is present and the policy is absent.
7. **A token in localStorage because "it is an SPA".** Any XSS becomes session theft; the cookie story must be explicit.

## Sources

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — the AA success criteria used in Phase 5.
- [web.dev — Core Web Vitals](https://web.dev/articles/vitals) — LCP/INP/CLS thresholds and the field-versus-lab distinction.
- [axe-core CLI](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli) — the `--tags` and `--exit` flags used in Phase 5.
- [Playwright](https://playwright.dev/docs/intro) — browser projects, route interception, and traces.
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) — the assertion config used as the Phase 6 gate.
