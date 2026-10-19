# Senior Performance Audit

Find and prove performance problems rather than guessing at them: define the measurement, capture a baseline, apply USE per resource, profile for the dominant stack, inspect the queries and the query count, test the cache for correctness, characterise overload and memory growth, and re-measure with the same command.

> **Stack:** for a Laravel/PHP + MySQL/Redis or React/Vite target, also load `stack-php-mysql` - it supplies the executable command for each phase below. Do not label a check `UNAVAILABLE` before checking that file.

## When this applies

- Someone asks to make something faster, cheaper, or more scalable, or reports a latency or throughput problem.
- A cache, index, denormalisation, pool size, or concurrency limit is about to be added.
- A design requires a load envelope, a capacity number, or a cost estimate.
- A p99 regression, a timeout, or an out-of-memory event must be explained.
- A frontend is slow for real users, or a Core Web Vitals budget is being set.

## When it does not

- The problem is reliability under failure rather than speed under load; use the reliability review for SLOs, alerting, and incident practice.
- The change is unmeasured micro-optimisation inside code that no profile has flagged; require the profile first.
- The system has no reproducible environment and no way to replay production-like load; record that as the finding, since numbers from an unrelated environment are worse than no numbers.

## Core rule

Measure before changing anything and keep the raw output. For every resource check utilisation, saturation, and errors — the saturated resource is the one to fix and everything else is a distraction ([Brendan Gregg — The USE Method](https://www.brendangregg.com/usemethod.html)). Separate time spent *on* a resource from time spent *waiting* for it, because that decides whether the answer is code or capacity ([TSA Method](https://www.brendangregg.com/tsamethod.html)). Profile for the dominant stack instead of the suspected one ([Flame Graphs](https://www.brendangregg.com/flamegraphs.html)).

Load tests run against a locally started instance or a designated staging target you own; never against a host outside your control.

State in every report: a check that was not executed is `PLANNED` or `UNAVAILABLE`, never `PASSED`.

## Phase 1 — Define the measurement before touching anything

1. Write the measurement definition: the exact operation, the endpoint or function, the load shape (concurrency, dataset size, read/write mix, request distribution), the environment, and the target number.
2. State the target as a percentile and a threshold: p95 under 200 ms at 300 requests per second, not "faster".
3. Pin the environment: host or instance class, CPU and memory limits, container limits, database version, and whether the data is cold or warm (`drop_caches` vs a warmed buffer pool).
4. Record the revision and the configuration under test — commit SHA, feature flags, pool sizes, cache state.
5. Choose the tool and commit to it for the before-and-after runs: [k6](https://k6.io/docs/), [Locust](https://locust.io/), [Vegeta](https://github.com/tsenart/vegeta), `wrk`, `hey`.
6. Define the pass and fail criteria in advance, including the guardrail metric that must not regress (usually error rate, saturation, or cost).
7. EVIDENCE: the written measurement definition, the environment description, the pinned revision and config, the chosen command, the pass/fail criteria.

## Phase 2 — Capture the baseline and reproduce the load shape

1. Run the baseline and save the raw output and the full result file, not a screenshot: `k6 run --out json=baseline.json script.js`, `vegeta attack -rate=300 -duration=5m -targets=targets.txt | tee baseline.bin | vegeta report`.
2. Check the load generator is not the bottleneck: watch its own CPU, memory, and network, and confirm the target's saturation exceeds the generator's.
3. Reproduce the real distribution, including the hot keys and the skew. A uniform synthetic load misses the tail that hurts, because the popular item is what gets contended.
4. Use a production-like dataset size. A tiny dataset keeps everything in cache and hides the I/O path entirely.
5. State the cache state for every run — cold start, warm, or steady state — and keep it identical between before and after.
6. Run long enough to leave the warm-up window out of the numbers, and report both the warm-up and the steady-state figures.
7. EVIDENCE: the baseline raw output and result file, the generator's own resource usage, the load profile definition, the dataset size, the cache state, the run duration.

## Phase 3 — Apply USE per resource

1. Build the table for CPU, memory, disk, network, and the connection pool: utilisation, saturation, errors, per resource.
2. CPU: `top -H`, `mpstat -P ALL 1 10`, container CPU throttling (`container_cpu_cfs_throttled_periods`), and load average relative to the CPU limit.
3. Memory: RSS against the limit, page-fault rate, swap activity, and the container's OOM-kill count.
4. Disk: IOPS and throughput against the device limit, `iostat -x 1`, await and queue depth, and the filesystem's free inodes.
5. Network: bandwidth, retransmits, and connection churn: `ss -s`, `netstat -s`.
6. Connection pool: active versus idle versus waiting, queue wait time, and queue timeout count.
7. Flag exactly one saturated resource per experiment. If several look saturated, the first one in the dependency path is the bottleneck and the rest are downstream effects.
8. EVIDENCE: the per-resource USE table with the saturated resource flagged, each measurement with its command and window.

## Phase 4 — Profile for the dominant stack

1. Capture a profile under load rather than on a microbenchmark: [async-profiler](https://github.com/async-profiler/async-profiler) for the JVM, `perf record -F 99 -g -p <pid>` for native, [cProfile](https://docs.python.org/3/library/profile.html) plus a flame output for Python, `py-spy record` for a running process.
2. Render and read the flame graph: `flamegraph.pl` over the folded stacks ([FlameGraph](https://github.com/brendangregg/FlameGraph), [Flame Graphs](https://www.brendangregg.com/flamegraphs.html)). Read the widest frames, not the deepest ones.
3. Name the dominant stack and quantify it as a percentage of samples, then confirm it accounts for the observed latency.
4. Check lock contention explicitly: monitor contention counts, `perf lock`, mutex profile, thread dumps under load.
5. Check garbage collection and allocator pauses: GC pause histogram and the allocation rate, because p99 spikes are frequently pauses rather than slow statements.
6. Build a thread-state or wait breakdown so time on-CPU is separated from time blocked on I/O, a lock, or a connection ([TSA Method](https://www.brendangregg.com/tsamethod.html)).
7. Keep the profiler's own overhead in mind and prefer sampling profilers on production-like hosts over instrumenting profilers in the load path.
8. EVIDENCE: the profile capture and flame graph with the dominant stack named and quantified, the lock-contention evidence, the GC pause data, the wait breakdown.

## Phase 5 — Inspect the database work

1. Get the actual plan for the hot queries with `EXPLAIN (ANALYZE, BUFFERS)`, and read the row estimates against the actual rows, the node types, and the buffer hits versus reads ([PostgreSQL — EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html), [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)).
2. Find the top queries by total time and by calls: `SELECT queryid, calls, mean_exec_time, total_exec_time, rows FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;`.
3. Check for sequential scans on large tables and for index scans returning far more rows than needed.
4. Check for missing indexes on filter and join columns, and for duplicate or redundant indexes that slow every write.
5. Count the queries per request — the N+1 detector. A single fast query issued 1,000 times is the classic regression that a slow-query log never shows.
6. Check the plan changes with data volume: a plan that is fine at 10,000 rows and switches to a nested loop at 10 million is a time bomb.
7. Check statistics freshness and any recent schema change that invalidated a plan.
8. EVIDENCE: the `EXPLAIN (ANALYZE, BUFFERS)` output for each hot query, the top-queries list with calls and mean time, the queries-per-request count, the index audit.

## Phase 6 — Check pools, caching correctness, and memory growth

1. Do the pool arithmetic: pool size multiplied by replica count against the database's `max_connections`, including migration jobs, admin sessions, and sidecars.
2. Determine the behaviour when the pool is exhausted: fail fast with a clear error, or hang until the request times out. Record which.
3. Review the cache as a correctness component before a performance one: key design and collision risk, invalidation trigger, TTL rationale, and whether an authorization decision is ever served from a shared cache.
4. Test the invalidation path explicitly: write, update, then read and confirm the new value is served.
5. Check stampede protection: a lock, a single-flight, or a jittered TTL for hot keys that expire together.
6. Bound the cache: maximum entries, maximum memory, and the eviction policy, tested by filling it.
7. Watch memory under steady state with an allocation-focused tool: `tracemalloc` for Python ([tracemalloc](https://docs.python.org/3/library/tracemalloc.html)), heap dumps for the JVM, `pprof` for Go — and classify the growth as application, pool, or client library.
8. EVIDENCE: the pool arithmetic and the exhaustion test result, the invalidation test, the stampede protection code, the cache bounds, the allocation profile over the soak.

## Phase 7 — Characterise overload, soak behaviour, and the frontend

1. Run at two times the expected capacity and observe the response: graceful degradation with load shedding and fast 503s, or collapse with queue growth and timeouts ([Google SRE — Handling Overload](https://sre.google/sre-book/handling-overload/)).
2. Verify retry budgets and jitter exist at the client, because an unjittered retry storm converts a brownout into an outage.
3. Run a soak test at expected load for hours and watch RSS, allocation rate, file descriptors, connection counts, and open handles for monotonic growth.
4. Run a spike test — traffic multiplied sharply and then removed — and check recovery time to the steady-state latency, not just survival.
5. For a web frontend, collect field Core Web Vitals from real users, not only lab numbers: LCP, INP, and CLS ([web.dev — Core Web Vitals](https://web.dev/articles/vitals)).
6. Keep a lab gate in CI with [Lighthouse](https://developer.chrome.com/docs/lighthouse/overview), and treat it as a regression gate rather than a diagnostic under load.
7. Check the page-weight and request-count budget and the number of blocking third-party scripts, since these drive the field metrics more than any single code change.
8. EVIDENCE: the 2x run showing shed/degrade behaviour, the retry-budget configuration, the soak charts for each resource, the spike recovery time, the field vitals report, the CI Lighthouse result.

## Phase 8 — Re-measure with the same command and record the trade

1. Re-run the identical baseline command in the identical environment with the identical dataset and cache state, and record the delta in the same units.
2. Report the after-numbers for every metric in the measurement definition, plus the guardrail metrics.
3. Name what regressed. There is nearly always a trade: write amplification for a read index, staleness for a cache, memory for speed, cost for throughput.
4. Record the new saturation point and whether the bottleneck merely moved: the enlarged pool that now saturates the database has changed the failure mode, not fixed it.
5. Update the capacity model with the measured per-instance ceiling and the headroom required for failure of one instance.
6. State the confidence: which numbers are from a production-like environment, which are lab-only, and which are unmeasured.
7. EVIDENCE: the after-run with the same command, the before/after table, the named regression and its mitigation, the new bottleneck, the updated capacity figure.

## Definition of done

- A baseline with raw output exists for the identical command and environment used for the after-measurement.
- Exactly one saturated resource was identified, or the reason several appear saturated is explained by the dependency path.
- A profile names and quantifies the dominant stack, and the answer is not a guess about which function is slow.
- The database query count per request and the hot-query plans are recorded, not inferred.
- Overload behaviour at two times capacity is characterised with an observed response, not predicted.
- For a frontend asset, Phase 7 is gated too: field LCP/INP/CLS plus the Lighthouse CI delta are recorded, or the browser step is explicitly labelled `UNAVAILABLE` with the command that was missing.
- Every unexecuted check is labelled `PLANNED` or `UNAVAILABLE` with its exact command.

## Evidence to record

| Phase | Artifact |
|---|---|
| 1 | Measurement definition; environment description; pinned revision and config; pass/fail criteria |
| 2 | Baseline raw output and result file; generator resource usage; load profile; dataset size; cache state |
| 3 | Per-resource USE table with the saturated resource flagged and the command per measurement |
| 4 | Profile capture and flame graph with the dominant stack quantified; lock and GC data; wait breakdown |
| 5 | `EXPLAIN (ANALYZE, BUFFERS)` per hot query; top-queries list; queries-per-request count; index audit |
| 6 | Pool arithmetic and exhaustion test; invalidation test; stampede protection; cache bounds; allocation growth |
| 7 | 2x overload run; retry budget config; soak charts; spike recovery time; field vitals; CI Lighthouse result |
| 8 | After-run with the same command; before/after table; named regression and mitigation; new capacity figure |

## Failure modes a naive reviewer misses

1. **Optimising by intuition.** Micro-optimising a function that is two percent of the time while the real cost is a network round trip or a missing index.
2. **Benchmarking warm.** A warm cache and a small dataset hide the I/O path that appears in production; the cache state must be stated for every run.
3. **Averages hiding the tail.** p50 looks excellent while p99 already breaches the SLO, and the incident report quotes the mean.
4. **The generator saturates before the server.** The test measures the load client's CPU, and the "improvement" is a change in the test harness.
5. **Fixing the query but not the N+1** that issues it a thousand times per request; the query is now fast and the request is still slow.
6. **A cache added to hide a leak or a correctness bug**, making both harder to find and adding an invalidation defect on top.
7. **Enlarging the connection pool until the database falls over.** The bottleneck moves from the pool to the database and the outage pattern gets worse.
8. **Measuring in development with debug logging, a profiler attached, and a single-tenant database**, then shipping those numbers as evidence.
9. **Retries without jitter or a budget**, amplifying the original overload and turning degradation into a full outage.
10. **Ignoring GC and allocator pauses**, so the p99 spikes are misdiagnosed as a slow downstream dependency.
11. **No re-measurement.** The change ships, nobody repeats the baseline, and the cost is discovered a quarter later on the bill or in a page.
12. **A uniform synthetic load with no hot keys.** The contended item, the lock, and the single hot partition never appear, so the audit passes and production does not.
13. **Comparing numbers from different environments or dataset sizes.** The delta is an artifact of the setup, not of the change.

## Sources

- [Brendan Gregg — The USE Method](https://www.brendangregg.com/usemethod.html) — utilisation, saturation, errors per resource.
- [Brendan Gregg — The TSA Method](https://www.brendangregg.com/tsamethod.html) — thread state and the on-resource versus waiting distinction.
- [Brendan Gregg — Flame Graphs](https://www.brendangregg.com/flamegraphs.html) and the [FlameGraph tooling](https://github.com/brendangregg/FlameGraph) — reading the dominant stack.
- [Google SRE Book — Handling Overload](https://sre.google/sre-book/handling-overload/) — load shedding, criticality, and retry-storm behaviour.
- [Google SRE Book — Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — golden signals and percentile pitfalls.
- [PostgreSQL — EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html) and [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — the plan inspection commands.
- [web.dev — Core Web Vitals](https://web.dev/articles/vitals) and [Lighthouse overview](https://developer.chrome.com/docs/lighthouse/overview) — field metrics and the lab regression gate.
- [Python — cProfile](https://docs.python.org/3/library/profile.html) and [tracemalloc](https://docs.python.org/3/library/tracemalloc.html) — deterministic profiling and allocation tracking.
- [async-profiler](https://github.com/async-profiler/async-profiler) — low-overhead JVM profiling for the dominant stack.
- [k6 documentation](https://k6.io/docs/), [Locust](https://locust.io/), [Vegeta](https://github.com/tsenart/vegeta) — the load tools used for the baseline, soak, and spike runs.
- [MDN — Web performance](https://developer.mozilla.org/en-US/docs/Web/Performance) — the frontend measurement vocabulary alongside the vitals above.
