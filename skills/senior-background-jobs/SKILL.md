---
name: senior-background-jobs
description: Review and repair Laravel background work — queue jobs, workers, Horizon, retries, failed_jobs, cron and scheduled tasks, Redis-backed queues, dispatch sites and async side effects — before it can duplicate, stall, or silently drop work in production.
---

# Senior Background Jobs

Review the asynchronous half of a Laravel application so it survives duplicate delivery, deploys, worker death, and Redis pressure: prove the delivery contract at the side effect, prove the retry shape, prove the drain path, and prove it with a real worker — not a fake.

> **Stack:** load `stack-php-mysql` for the Laravel/MySQL command set this file assumes.

## When this applies

- A job, listener, notification, broadcast, command, or scheduled task is added or changed.
- A queue driver, connection, worker, Horizon supervisor, or scheduler entry changes.
- A deploy ships code that changes a job class, payload shape, or queue name.
- `failed_jobs` is growing, a job is stuck or duplicated, or a side effect ran twice.
- Someone claims "the queue handles it" or "exactly once" without an idempotency key.

## When it does not

- Synchronous request work only: use `senior-code-review`.
- Schema or backfill safety itself: use `senior-data-migration-safety`; this file covers the job that runs the backfill, not the DDL.
- Host and Redis hardening itself: use `senior-system-hardening`.
- No Laravel application in scope: use the stack-neutral `senior-reliability-review`.

## Core rule

At-least-once is the delivery contract; exactly-once is a property you build at the side effect, never a property of the queue. A job is proven only when a real worker ran it, the worker was killed or restarted by a deploy mid-flight, and the side-effect count stayed correct. `Queue::fake()` proves dispatch, not execution. State in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Inventory the async surface

1. Enumerate every dispatch site and the request path that fires it: `Get-ChildItem app, routes -Recurse -Filter *.php | Select-String -Pattern 'dispatch\(|::dispatch\(|dispatchAfterResponse|Bus::batch|Bus::chain'`.
2. Record the connection and queue per job: `php artisan tinker --execute="echo config('queue.default');"` and read the matching block in `config/queue.php`.
3. Check the transaction coupling: `php artisan tinker --execute="var_export(config('queue.connections.redis.after_commit'));"` — `false` means a job dispatched inside `DB::transaction` can run before the row commits.
4. List the scheduler and the current failed set: `php artisan schedule:list` and `php artisan queue:failed`.
5. Map each job to its side effect: charge, email, webhook, file, external API. A job with no idempotent side effect goes to Phase 2.
6. EVIDENCE: dispatch inventory with `file:line` and queue name per site; connection config excerpt including `retry_after` and `after_commit`; schedule list; failed count.

## Phase 2 — Delivery semantics and idempotency

1. Write the delivery claim per job: "at-least-once, and a duplicate produces N side effects". An "exactly once" claim is a finding until the idempotency key is shown.
2. Prove the guard is in the schema, not in prose: `SHOW INDEX FROM payments;` must show a unique index on the idempotency column; `Get-ChildItem app\Jobs -Filter *.php | Select-String -Pattern 'idempotency|firstOrCreate|updateOrCreate'`.
3. Run the duplicate-delivery test synchronously, so no worker is needed: `php artisan tinker --execute="App\Jobs\ChargeOrder::dispatchSync(42); App\Jobs\ChargeOrder::dispatchSync(42);"`, then `php artisan tinker --execute="echo DB::table('payments')->where('order_id', 42)->count();"`. The count must be 1; 2 is a must-fix.
4. Check the dispatch point against the transaction: a job pushed before commit needs `after_commit => true` or `DB::afterCommit`, or it can run against a row that does not exist yet.
5. EVIDENCE: delivery claim per job; unique-index DDL; two-run count; `after_commit` value and the in-transaction dispatch sites.

## Phase 3 — Retry shape and failure classification

1. Extract the declared retry contract: `Get-ChildItem app\Jobs -Filter *.php | Select-String -Pattern '\$(tries|backoff|timeout|maxExceptions|failOnTimeout|retryUntil|dontReport)|function failed\('`.
2. Compare worker timeout with `retry_after`: `php artisan tinker --execute="echo config('queue.connections.redis.retry_after');"`. If `retry_after <= timeout`, a long job is reserved and started a second time while the first is still running — that is a duplicate, not a retry.
3. Prove a permanent error fails fast: the job calls `$this->fail($e)` for 4xx, validation, or permanent states; otherwise it burns every `$tries` attempt and sits in `failed_jobs` after the full backoff. `$dontReport` silences reporting only — it does not stop a retry.
4. Confirm the worker launch does not silently override the class: `php artisan queue:work redis --tries=3 --timeout=90 --backoff=10,60,300` — CLI flags win over `$tries` and `$timeout`.
5. EVIDENCE: property table per job with `file:line`; `retry_after` vs `timeout` numbers; the permanent-error branch quoted; worker command from Supervisor or `config/horizon.php`.

## Phase 4 — failed_jobs: growth, drain, alert

1. Measure growth and age, not existence: `SELECT COUNT(*) AS failed, MIN(failed_at) AS oldest, MAX(failed_at) AS newest FROM failed_jobs;` — a count with a stale oldest row is a job nobody is draining.
2. Read the rows: `php artisan queue:failed`.
3. Prove the drain path: `php artisan queue:retry all`, or `php artisan queue:forget <uuid>` for one poison job. `queue:flush` is not a drain; it destroys the evidence.
4. Set retention deliberately: schedule `php artisan queue:prune-failed --hours=168` so a spike is visible for a week instead of forever.
5. Alert on both signals — depth and failures: schedule `php artisan queue:monitor redis:default --max=1000` and a failed-count query; a non-zero exit from the monitor is the alert.
6. EVIDENCE: failed count and oldest age; retry/forget transcript; prune entry in `schedule:list`; the alert definition and where it pages.

## Phase 5 — Concurrency control: unique, overlap, rate limit, batches

1. Inventory the middleware and batch use: `Get-ChildItem app\Jobs -Filter *.php | Select-String -Pattern 'ShouldBeUnique|WithoutOverlapping|RateLimited|Bus::batch|Bus::chain'`; a `RateLimited` job must name a limiter defined with `RateLimiter::for` in `app\Providers` (`Select-String -Path app\Providers\*.php -Pattern 'RateLimiter::for'`) — the middleware string alone is not a limit.
2. Prove uniqueness is active: dispatch twice in one request — `php artisan tinker --execute="App\Jobs\RebuildIndex::dispatch(); App\Jobs\RebuildIndex::dispatch();"` — then check `redis-cli --scan --pattern '*laravel_unique_job*'` and the side-effect count.
3. Check batch state for stuck rows: `SELECT COUNT(*) FROM job_batches WHERE finished_at IS NULL AND created_at < NOW() - INTERVAL 1 HOUR;` — non-zero is a batch with no failure path or a dead worker.
4. Confirm a batch failure has a handler: `Bus::batch(...)->catch(fn (Batch $b) => ...)->finally(...)`; a batch without `catch` fails silently.
5. `withoutOverlapping()` must carry an expiry shorter than the job's worst case (`->withoutOverlapping(10)`), or a crashed job blocks the queue for the default window.
6. EVIDENCE: middleware inventory with `file:line`; double-dispatch result; stuck-batch count; overlap expiry value.

## Phase 6 — Scheduler

1. Read the schedule as the system sees it, not the code: `php artisan schedule:list` — every entry must show its cron expression, next run, and timezone.
2. Prove cron is installed on the production host: `crontab -l | grep 'schedule:run'` on the Linux host (`crontab -l | Select-String 'schedule:run'` in PowerShell), or the Windows Task Scheduler entry. A scheduler with no cron never runs.
3. Check multi-server safety: `onOneServer()` and scheduler `withoutOverlapping()` need a shared cache; `php artisan tinker --execute="echo config('cache.default');"` — a `file` cache on two servers runs every task twice.
4. Check missed runs: compare the last heartbeat row or log timestamp with the schedule interval; a gap larger than one interval means the scheduler stopped and no alert fired.
5. Check timezone: `->timezone('Asia/Manila')` or `schedule_timezone` in `app/Console/Kernel.php` (Laravel 11: `routes/console.php`), and confirm `schedule:list` prints it.
6. EVIDENCE: `schedule:list` output; cron entry; cache driver; last-run timestamps; timezone line.

## Phase 7 — Worker ops and deploy interaction

1. Status: `php artisan horizon:status` and `php artisan horizon:supervisor-status supervisor-1` when Horizon is installed; otherwise `supervisorctl status` on the host, the Supervisor program (`command=php ... queue:work`), and `Get-Process php`.
2. Prove the deploy restarted the workers: `php artisan tinker --execute="echo cache('illuminate:queue:restart');"` — the value must be at or after the deploy timestamp. Horizon deployments run `php artisan horizon:terminate`; plain workers need `php artisan queue:restart`.
3. Prove payload compatibility across the deploy: a job queued before the class change must still deserialize. Dispatch, stop the worker, rename the job class or a serialized property in the deployed code, start the worker, run `php artisan queue:work --once`, then read `php artisan queue:failed` — `__PHP_Incomplete_Class`, a typed-property error, or `ModelNotFoundException` is a deploy defect.
4. Bound worker memory: `--memory=128` on `queue:work`, `memory_limit` in `config/horizon.php`, plus `--max-jobs` or `--max-time`; an unbounded worker grows until the OOM killer restarts it mid-job. Supervisor's `stopwaitsecs` must exceed the longest job's timeout, or it kills the job mid-run.
5. Prefetch and priority: `queue:work` reserves one job per pop and has no prefetch setting, so the real control is worker count (`numprocs` in Supervisor, `maxProcesses`/`minProcesses` and `balance` in `config/horizon.php`) plus explicit queue order (`--queue=high,default`); a high-priority queue appended after `default` is not a priority.
6. EVIDENCE: Horizon/worker status; restart timestamp vs deploy time; post-deploy deserialize test; memory limits; queue order.

## Phase 8 — Redis: eviction and persistence

1. Read live config, not the `.env` template: `redis-cli CONFIG GET maxmemory`, `redis-cli CONFIG GET maxmemory-policy`, `redis-cli CONFIG GET appendonly`, `redis-cli INFO persistence`, `redis-cli INFO memory`.
2. Eviction: `allkeys-lru` or `allkeys-random` on the database that holds queues can evict a queued job; `noeviction` with full memory makes `LPUSH` fail. The queue needs its own database or instance with `noeviction` and a `maxmemory` sized for the backlog.
3. Persistence: `INFO persistence` must show `aof_enabled:1` with `appendfsync everysec`, or a recent `rdb_last_bgsave_status:ok`; with neither, a Redis restart silently drops every queued job.
4. Enumerate the real keys, including the Laravel prefix: `redis-cli --scan --pattern '*queues:*'`, then `redis-cli LLEN <key>`, `redis-cli ZCARD <key>:delayed`, `redis-cli ZCARD <key>:reserved`.
5. Record whether cache and queue share a database: `php artisan tinker --execute="var_export(config('database.redis'));"` — sharing one is a finding until eviction policy and `maxmemory` are shown safe.
6. EVIDENCE: CONFIG GET output; persistence status; key lengths; Redis connection-to-database map.

## Phase 9 — Observability

1. Depth: `php artisan queue:monitor redis:default --max=1000` — record the current size and whether the threshold exits non-zero.
2. Delayed and reserved backlog: `redis-cli ZCARD <key>:delayed` and `redis-cli ZCARD <key>:reserved`; a growing `:delayed` is a scheduler or rate-limit pile-up, a growing `:reserved` is slow or hung jobs.
3. Oldest failed job: `SELECT MIN(failed_at) FROM failed_jobs;`. Oldest pending job: read the head payload with `redis-cli LINDEX <key> 0` and inspect its fields; if none is a push timestamp, age is `UNAVAILABLE` unless Horizon's `Wait` metric is installed — do not invent an age.
4. Failure rate per hour: `SELECT DATE_FORMAT(failed_at,'%Y-%m-%d %H:00') AS hour, COUNT(*) FROM failed_jobs GROUP BY hour ORDER BY hour DESC LIMIT 24;`.
5. Processing time: Horizon's `Wait` and `Runtime` per job, or a duration the job itself records; without either, `UNAVAILABLE`. Horizon metrics only exist if `Schedule::command('horizon:snapshot')->everyFiveMinutes()` is in `routes/console.php` — confirm it in `php artisan schedule:list` before trusting the dashboard.
6. EVIDENCE: depth and exceeded flag; delayed and reserved counts; oldest-failed age; hourly failure table; wait/runtime source.

## Phase 10 — Testing: fake versus real worker

1. List what the suite proves: `Get-ChildItem tests -Recurse -Filter *.php | Select-String -Pattern 'Queue::fake|Bus::fake|assertPushed|assertDispatched'`. `Queue::fake()` asserts dispatch only — it does not serialize the job, run middleware, apply retries, or execute the side effect.
2. Round-trip the payload, which the fake skips: `php artisan tinker --execute="$j = new App\Jobs\ChargeOrder(42); echo strlen(serialize($j));"`. A closure property throws "Serialization of 'Closure' is not allowed" — that job fails on a real worker and passes the fake.
3. Run the real worker once and assert the side effect: `php artisan tinker --execute="App\Jobs\ChargeOrder::dispatch(42);"`, then `php artisan queue:work --once --queue=default --tries=1`, then `php artisan tinker --execute="echo DB::table('payments')->where('order_id',42)->count();"` — 1 is pass, 0 is a broken job, 2 is a missing idempotency guard.
4. Run it twice (duplicate delivery) and keep the same count; then run the failure path with the downstream unavailable and confirm it lands in `failed_jobs` instead of vanishing.
5. Put the real-worker test on a dedicated test queue and Redis database so it never consumes production jobs.
6. EVIDENCE: fake-test inventory; serialize output or exception; real-worker transcript and counts; duplicate-run counts; failed-path result.

## Definition of done

- Every job with a side effect has an idempotency key or unique index, proven by a two-delivery test with the same key.
- Every job declares `$tries`, `$backoff`, and `$timeout`, and `retry_after` is greater than `timeout`; defaults are recorded as accepted, not assumed.
- `failed_jobs` has a count, an oldest age, an alert, and a named drain procedure — nothing relies on `queue:flush`.
- A real worker ran the job, the worker was restarted, and the side-effect count stayed correct.
- The `queue:restart`/`horizon:terminate` timestamp is newer than the deploy, and a queued payload survived the class change.
- The Redis queue sits on an eviction-safe database with persistence enabled, or the risk is recorded with an owner.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Dispatch inventory with `file:line`; connection config; `after_commit`; schedule list |
| 2 | Delivery claim; unique-index DDL; two-run count; in-transaction dispatch sites |
| 3 | Retry property table; `retry_after` vs `timeout`; permanent-error branch; worker command |
| 4 | Failed count and oldest age; retry/forget transcript; prune entry; alert definition |
| 5 | Middleware inventory; double-dispatch result; stuck-batch count; overlap expiry |
| 6 | `schedule:list`; cron entry; cache driver; last-run timestamps; timezone |
| 7 | Worker status; restart timestamp vs deploy; deserialize test; memory limits; queue order |
| 8 | Redis CONFIG GET; persistence status; queue key lengths; DB map |
| 9 | Queue depth; delayed/reserved counts; failure-rate table; wait/runtime source |
| 10 | Fake-test inventory; serialize bytes or exception; real-worker transcript; counts |

## References

- [Laravel Queues](https://laravel.com/docs/11.x/queues) — retry/backoff/timeout, `failed_jobs`, uniqueness, batches, `queue:restart`.
- [Laravel Horizon](https://laravel.com/docs/11.x/horizon) — supervisors, balancing, metrics, `horizon:terminate`.
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) — AOF/RDB and what survives a restart.
- [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/) — `maxmemory-policy` and key eviction behaviour.
