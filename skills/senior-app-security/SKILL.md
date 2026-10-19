---
name: senior-app-security
description: Audit application-level security in a Laravel/PHP + React app - authentication, object-level authorization and tenant scoping, mass assignment, input validation, output encoding and XSS, CSRF/CORS/clickjacking, secrets and debug mode, abuse controls and audit logging. Use on any change touching auth, permissions, uploads, user input, or rendered HTML, and before shipping a login, API endpoint, or multi-tenant query.
---

# Senior Application Security

Application security is not the infrastructure hardening skill. This one asks a narrower, answerable question: **can a request from the wrong user read or change data it should not, and can attacker-controlled input execute?**

That question has exactly two failure modes worth blocking on: a missing object-level authorization check (IDOR/BOLA), and unencoded output reaching a browser (XSS). Everything else is a hardening tier below those.

> **Stack:** load `stack-php-mysql` for the Laravel/MySQL command set. Pair with `senior-threat-model` when the change introduces a new trust boundary rather than a new endpoint.

## When this applies

- A new endpoint, controller action, route, policy, or middleware is added.
- A query, scope, or relationship is added to a multi-tenant or user-owned model.
- A form, upload, webhook receiver, or any handler accepting user input is touched.
- HTML, markdown, or user-supplied content is rendered, stored, or sent to a client.
- A session, token, password, or role mechanism changes.
- `APP_DEBUG`, `.env`, CORS, CSRF exclusions, or a CSP header is touched.

## When it does not

- Host, container, network, or cloud-account hardening: that is `senior-system-hardening`.
- Dependency CVEs and lockfile integrity: `senior-supply-chain-audit`.
- A pure styling or layout change with no input handling.
- A design that does not exist yet: produce a `senior-threat-model` instead of an audit.

## Core rule

**Authentication is not authorization.** "The user is logged in" answers who, never what. Every object read or write needs an ownership or permission decision at the server, and the decision must be observable in the code path — not inferred from the UI hiding a button.

A finding is only a finding when you can point at the line and the request that reaches it. "Looks unsafe" without a path is noise.

## Phase 1 — Inventory the trust boundary

1. Enumerate the routes the change touches: `php artisan route:list --path=<area> -v` and mark each as public / authenticated / role-gated.
2. For each route, name the middleware chain in the code and confirm the auth middleware is actually on the route group, not on a sibling group.
3. List every model the route reads or writes, and for each one state the ownership column (`user_id`, `tenant_id`, `team_id`) — or state that it has none and is intentionally global.
4. Find the render surfaces: which Blade templates use `{!! !!}`, which React components use `dangerouslySetInnerHTML`, which API responses carry user HTML.
5. EVIDENCE: route inventory with auth level; model → ownership column table; render-surface list with `file:line`.

## Phase 2 — Identity and sessions

1. Password hashing: `Hash::make` with bcrypt or `'driver' => 'argon2id'` in `config/hashing.php`. A raw `md5`/`sha1`/`sha256` on a password is a blocker, not a nit.
2. Rehash on login: `Hash::needsRehash($user->password)` and update.
3. Session regeneration on privilege change: `session()->regenerate()` after login, `Auth::logoutOtherDevices($password)` after a password change.
4. Cookie flags in `config/session.php`: `secure` true in production, `http_only` true, `same_site` at least `lax`. A `secure => env('SESSION_SECURE_COOKIE', false)` that is never set in production is a finding.
5. Tokens (Sanctum/Passport): an expiry exists, abilities are scoped per token, and tokens are revoked on password change and logout. A never-expiring personal access token with `['*']` abilities is a finding.
6. JWT (if used): `alg` is pinned server-side, `none` is rejected, expiry and `nbf`/`iat` are validated, and the signing key is not the default sample key.
7. EVIDENCE: hashing driver from effective config (`php artisan about` or `config('hashing.driver')`), session config values, token expiry/abilities, and the exact line regenerating the session.

## Phase 3 — Authorization: the object-level check

This phase produces the finding the whole skill exists for.

1. For every route with a route parameter (`/orders/{order}`, `/invoices/{invoice}`), find the authorization call: `$this->authorize('view', $order)`, a policy method, a `can:` middleware, or an explicit ownership query. **Authentication middleware alone is not the check.** Missing = blocker.
2. For list/index endpoints, find the scoping: a policy scope, a global scope, or a `where('tenant_id', ...)`. A `Model::all()` or an unscoped `->get()` on an owned model = blocker.
3. Confirm route model binding is used with scoping (`Route::bind` / `resolveRouteBinding` honoring the tenant), so an ID from another tenant 404s rather than loads.
4. Mass-assignment of a privilege column is authorization too: `is_admin`, `role`, `tenant_id`, `approved` must not be assignable from request input (Phase 4).
5. Roles/gates: a `Gate::before` that returns true for an admin bypasses **every** policy — read it and state what it grants.
6. EVIDENCE: table of `route | parameter | authorization call (file:line) | scoping clause (file:line)`. Any empty cell is a finding with severity.

## Phase 4 — Mass assignment and input validation

1. Every model in the change has `$fillable` (or `$guarded = ['*']` with explicit assignment). `$guarded = []` on a model that a request writes = blocker.
2. `Model::preventSilentlyDiscardingAttributes()` in `AppServiceProvider` (non-production) surfaces silent drops instead of hiding the bug.
3. Validation is a `FormRequest` or `$request->validate()` at the boundary, with an allowlist — `Rule::in`, `exists:`, `unique:`, `after_or_equal`, typed enums. `$request->all()` passed into a model or query is a finding.
4. Uploads: `mimes:`/`mimetypes:`, `max:`, stored outside the web root or via `Storage::putFile` with a generated name, server-side mime check. An original filename used as a path is a path-traversal finding.
5. SSRF: any outbound request built from user input needs a host allowlist; block loopback and private ranges. `Http::get($request->url)` without a check is a finding.
6. SQL: query-builder/Eloquent bindings only. `DB::raw` with interpolated input, or `whereRaw("x = '$v'")`, is a blocker.
7. EVIDENCE: per-field validated rule list; upload handling with the storage path and mime rule; every `DB::raw`/`whereRaw` in the diff quoted.

## Phase 5 — Output encoding and XSS

1. Blade: `{{ $value }}` escapes; `{!! $value !!}` does not. Every `{!! !!}` in the diff must be justified or replaced. Same for `@php echo`.
2. React: `{value}` escapes; `dangerouslySetInnerHTML` does not. If it is used, the value must pass through a sanitizer (DOMPurify) with an explicit allowlist, and the source must be identified. Raw HTML straight from the database window is a blocker.
3. Attribute contexts: `href={value}` with a `javascript:` URL is XSS despite escaping. Validate the scheme against `http/https/mailto`.
4. Markdown/rich text rendered from user input: the renderer must sanitize HTML (a "safe" markdown mode), not just escape the outer template.
5. CSP: a `Content-Security-Policy` header exists on HTML responses with `default-src 'self'`, `script-src 'self'` (nonce or hash if inline is required), `object-src 'none'`, `frame-ancestors 'none'`. A CSP with `unsafe-inline` and `unsafe-eval` in production is a finding, not a mitigation.
6. EVIDENCE: every `{!! !!}` and `dangerouslySetInnerHTML` in the diff quoted with its source; the CSP header as returned by `curl -sI https://HOST/`.

## Phase 6 — CSRF, CORS, clickjacking

1. State-changing POST/PUT/PATCH/DELETE forms carry `@csrf` or the API uses token/session auth with CSRF enabled. The `VerifyCsrfToken` `$except` list is reviewed: every entry is a deliberate decision, and an API route group excluded wholesale is a finding.
2. CORS: `config/cors.php` — `allowed_origins` is an allowlist, not `*`; `supports_credentials` true with `*` origins is a browser-blocked misconfiguration that pushes teams to disable security, so treat it as a finding.
3. Clickjacking: `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`.
4. EVIDENCE: the `$except` list quoted, the effective CORS config, and the three response headers from a real response.

## Phase 7 — Secrets, debug mode, and config

1. `APP_DEBUG` is false in production. A public stack trace leaks credentials, query shape, and file paths.
2. `.env` is outside the document root and never committed; `public/` contains no `.env`, `.git`, `storage/logs`, or source maps.
3. `APP_KEY` rotation is a data migration, not a config change: encrypted columns and sessions break. State the blast radius before rotating.
4. `php artisan config:cache` runs after the env is final; a stale cache silently ignores new values.
5. Logs: no password, token, full card number, or session ID written. Laravel's `$dontFlash` covers validation; custom logging is audited by hand.
6. EVIDENCE: `php artisan about` output for env/debug; a directory listing of `public/`; grep of the diff for `Log::` calls carrying credentials.

## Phase 8 — Abuse controls and audit trail

1. Rate limits on login, register, password reset, OTP, and any expensive endpoint: a `RateLimiter::for('login', ...)` definition and `throttle:login` on the route.
2. Account enumeration: login and reset return the same message and similar timing whether or not the account exists.
3. Authorization failures are logged with the actor, the object, and the route — an IDOR attempt that leaves no trace is undetectable.
4. Audit trail for privilege changes (role grants, admin actions, settings) exists and is append-only.
5. EVIDENCE: throttle definitions quoted; the two enumeration responses compared; a sample log line for a 403 with actor and object.

## Definition of done

- Every route with an object parameter has a named authorization call and a scoping clause, quoted with `file:line`.
- `$guarded = []` and unvalidated `$request->all()` do not exist on any path the change touches.
- Every `{!! !!}` and `dangerouslySetInnerHTML` is either absent or sanitizer-justified.
- Session cookie flags, `APP_DEBUG`, and the CSRF `$except` list are read from effective config, not assumed.
- Login, reset, and any expensive endpoint have a rate limit, and enumeration is tested from the response pair.
- A 403 produces a log line with actor and object.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with the exact command that would run it.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Route inventory with auth level; model → ownership table; render surfaces |
| 2 | Hashing driver; session flags; token expiry/abilities; regenerate call |
| 3 | `route → authorization (file:line) → scoping (file:line)` table |
| 4 | Validation rules per field; upload storage + mime rule; raw SQL quotes |
| 5 | Every unescaped render quoted; CSP header from the live response |
| 6 | CSRF `$except` list; CORS allowlist; frame headers |
| 7 | `artisan about` output; `public/` listing; log-call grep |
| 8 | Throttle definitions; enumeration response pair; sample 403 log line |

## Failure modes a naive reviewer misses

1. **The route group got the auth middleware, the action did not get the policy.** The endpoint is "protected" and another tenant's record still loads.
2. **`findOrFail($id)` in place of a scoped query.** 404 is not authorization — it is a query that happened to miss.
3. **Validation on the controller, `$request->all()` in the model.** The validated request is passed whole and the unvalidated keys ride along.
4. **Escaping applied in the transport instead of at the render.** A JSON endpoint returns raw HTML that a client inserts with `innerHTML`.
5. **CSRF excluded "because the SPA"** while the SPA still authenticates with a session cookie.
6. **CSP present but neutered** by `unsafe-inline` plus a nonce, so the nonce does no work.
7. **A rate limit that counts successful logins only**, leaving failed attempts unbounded.
8. **Authorization in the UI.** The button is hidden, the route is open.
9. **`Gate::before` admin bypass** that silently grants every ability to the first role checked.
10. **Secrets rotated in `.env` but still valid in the old deployment**, so the exposure window stays open.
