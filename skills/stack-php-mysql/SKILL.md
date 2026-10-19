---
name: stack-php-mysql
description: Translate the senior-* audit phases into executable Laravel/PHP + MySQL + Redis + Windows commands. Load alongside a senior-* skill whenever the target is a Laravel, PHP, MySQL, Redis, Livewire/Blade or React/Vite project, so an evidence gate resolves to a real command instead of UNAVAILABLE.
---

# Stack Appendix — Laravel / PHP / MySQL / Redis on Windows

The `senior-*` skills are stack-neutral, which in practice means they cite PostgreSQL, Kubernetes and GitHub Actions. Load this file with any of them when the stack is PHP. Every command here is the concrete substitute for a phase that would otherwise end in `UNAVAILABLE`.

**Rule:** a phase whose evidence gate you cannot run gets marked `UNAVAILABLE` — never `PASSED`. This file exists to reduce how often that happens, not to let you skip it.

## Verification and tests

```powershell
php artisan test                       # Pest / PHPUnit through the app kernel
php artisan test --parallel            # para sa existing suites
php artisan test --coverage --min=80   # PCOV or Xdebug required
php vendor/bin/pint --test             # style gate
php vendor/bin/phpstan analyse --level=8
composer validate --strict
composer audit                         # CVEs against composer.lock
composer show --direct                 # direct deps only
```

Diff-scoped coverage (the `senior-test-adequacy` bar): `php artisan test --coverage-clover build/clover.xml`, then filter to changed files — there is no `diff-cover` equivalent wired in by default, so name the files the change touched and check their lines in the clover XML.

Mutation testing: `php vendor/bin/infection --min-msi=60 --only-covered`. If Infection is not installed, the mutation gate is `UNAVAILABLE` — say so, do not mark it passed.

## Migrations and schema

```powershell
php artisan migrate --pretend        # SQL na i-run, walay touch
php artisan migrate:status
php artisan migrate --force          # production
php artisan migrate:rollback --step=1
php artisan db:show                  # Laravel 11+
php artisan db:table users
```

MySQL inspection (the substitute for `pg_locks` / `pg_stat_activity`):

```sql
SHOW CREATE TABLE orders;                                   -- collation, engine, keys
SHOW INDEX FROM orders;
SELECT * FROM information_schema.INNODB_TRX;                -- running transactions
SELECT * FROM information_schema.INNODB_LOCK_WAITS;         -- who blocks whom
SELECT * FROM performance_schema.events_statements_summary_by_digest
 ORDER BY SUM_TIMER_WAIT DESC LIMIT 10;                     -- top statements
EXPLAIN ANALYZE SELECT ...;                                 -- MySQL 8.0.18+
SHOW VARIABLES LIKE 'slow_query_log';
```

Long locks: `ALTER TABLE` on MySQL 8 is mostly online, but a **type change, a column drop, or a non-concurrent index add on a large table still rebuilds**. For big tables use `pt-online-schema-change` (Percona) or `gh-ost` — both are MySQL tools, not Postgres.

Check the two MySQL defaults that bite Laravel most: `utf8mb4_unicode_ci` on every text column, and `DECIMAL(12,2)` for money (never `FLOAT`/`DOUBLE`, never `INT` cents without a documented reason).

Expand/contract in Laravel terms: migration N adds a nullable column and writes to both → deploy → migration N+1 removes the old column in a **later release**. A migration that renames or drops a column in the same deploy as the code change is a contract violation, not a cleanup.

## Queues and background jobs

This is the phase no `senior-*` skill covers. Check it on every backend change that dispatches a job.

```powershell
php artisan queue:work --tries=3 --backoff=10,60,300
php artisan queue:failed
php artisan queue:retry all
php artisan horizon:status
php artisan horizon:supervisor   # may supervision ba, pila ka process
```

Required evidence per queue change:

- **Idempotency** — the job checks an idempotency key or a unique index before its side effect. Duplicate delivery must not charge twice or send twice.
- **Retry shape** — `$tries`, `backoff()`, `$timeout`, and `$failOnTimeout` set deliberately; a job with the default infinite retry on a permanent error is a finding.
- **`failed_jobs`** — table exists, is monitored, and has a drain path (`queue:retry`). Rows accumulating with nobody watching is a finding.
- **Deploy interaction** — `php artisan queue:restart` runs in the deploy; a worker on old code running a job whose payload changed is a finding.
- **Redis ceiling** — `maxmemory` and `maxmemory-policy` set. `noeviction` with a full queue stops writes; `allkeys-lru` can evict queued jobs. Check with `redis-cli CONFIG GET maxmemory*` and `redis-cli INFO memory`.
- **Payload versioning** — a serialized job already on the queue when the class changes must still deserialize (`__sleep`/`__wakeup` or a versioned DTO), or the deploy is a no-go.

## Transactions, isolation, concurrency

```php
DB::transaction(function () { ... }, attempts: 3);   // retries on deadlock
$order = Order::whereKey($id)->lockForUpdate()->first();   // SELECT ... FOR UPDATE
```

- MySQL default isolation is **REPEATABLE READ**. A non-locking read inside a transaction returns the snapshot from the first read — so read-modify-write without `lockForUpdate()` loses updates under concurrency.
- Anything that reads a row, decides, and writes it needs either `lockForUpdate()`, an optimistic version column, or a unique constraint that makes the second writer fail loudly.
- Locks held across an HTTP/SMTP/queue call are a finding — external latency inside a transaction multiplies lock hold time.
- Deadlock (`SQLSTATE 40001`) is expected under load: retryable, not a crash. A deadlock that surfaces to the user is a finding.
- Duplicate submits need an idempotency key or a unique index, not a UI-level disable.

## Auth, authorization, mass assignment

```powershell
php artisan about                     # driver, env, debug flag
php artisan route:list --path=api
```

- Hashing: `Hash::make` defaults to bcrypt; Argon2id is `'driver' => 'argon2id'`. Never MD5/SHA for passwords.
- Mass assignment: every model sets `$fillable` (never `$guarded = []`). A request that reaches `::create($request->all())` is a finding.
- Authorization: `Policy` + `$this->authorize()` or `Gate` on **every** object read/write — authentication alone is not authorization (BOLA).
- Tenant scoping: a global scope or a mandatory `where('tenant_id', ...)`; a query that can be reached without it is a finding.
- Sessions: `SESSION_SECURE_COOKIE=true`, `http_only`, `same_site=lax`, session ID regenerated on login.
- Rate limits: `throttle` middleware on login, register, password reset, and any OTP endpoint.
- `APP_DEBUG=false` in production — a stack trace on a public page leaks credentials and query shape.

## Deploy

```powershell
php artisan down --retry=60
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache; php artisan route:cache; php artisan view:cache
php artisan queue:restart
php artisan up
```

Order matters: `config:cache` **after** the env is final (a stale cache ignores `.env` changes), `queue:restart` **after** the code swap, `migrate` **before** new code serves traffic when the migration is additive, **after** when it is destructive. `php artisan optimize:clear` is the first diagnostic when "the config did not change".

## Secret scan (the `baseline.secrets` check)

```powershell
Get-ChildItem -Recurse -File -Include *.php,*.env*,*.json,*.yml,*.js,*.ts |
  Where-Object { $_.FullName -notmatch '\\vendor\\|\\node_modules\\|\\.git\\' } |
  Select-String -Pattern 'sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|DB_PASSWORD=\S{4,}|APP_KEY=base64:' |
  Select-Object Path, LineNumber
```

`.env` is never committed, never in a build artifact, never in a log. `APP_KEY` rotation invalidates every session and encrypted column — treat it as a data migration, not a config change.

## Frontend (React/Vite/Blade)

```powershell
npm ci
npm audit --omit=dev
npm run build                          # vite build
npx vite-bundle-visualizer             # chunk graph
npx lighthouse http://127.0.0.1:8000 --preset=desktop --output=json
npx playwright test
npx @axe-core/cli http://127.0.0.1:8000
```

`npx` needs Node; if it is absent the check is `UNAVAILABLE`. A UI change is not verified by `php artisan test` — jsdom-style tests never render, so the browser step is mandatory.

## Windows notes

- PowerShell has no `<` input redirection and no `/dev/null`. Use `` $null `` and `2>$null`, or run the command inside WSL/Git Bash and say which shell produced the output.
- `curl` is an alias for `Invoke-WebRequest` in PowerShell 5; use `curl.exe` or `Invoke-WebRequest` explicitly.
- Long paths and `vendor/` symlinks: run artisan from the project root, not from `public/`.

## Which section to read for which skill

| senior-* skill | Primary section |
|---|---|
| `senior-code-review` | Transactions, Auth, Queues (for dispatched jobs) |
| `senior-test-adequacy` | Verification and tests, Frontend |
| `senior-data-migration-safety` | Migrations and schema |
| `senior-performance-audit` | Migrations (EXPLAIN), Queues (Redis), Frontend |
| `senior-release-gate` | Deploy, Migrations, Queues (deploy interaction) |
| `senior-threat-model` | Auth, Secret scan |
| `senior-supply-chain-audit` | `composer audit`, `npm audit`, Secret scan |
| `senior-work-audit` | Verification and tests, Deploy |
| `senior-system-hardening` | Secret scan, Windows notes (laing stack ang hardening mismo) |
| `senior-reliability-review` | Queues (failed_jobs, queue age), Deploy (logs) |
| `senior-architecture-review` | Transactions (boundaries), Migrations (ownership) |
