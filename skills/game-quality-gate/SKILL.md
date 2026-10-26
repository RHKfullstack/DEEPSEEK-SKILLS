---
name: game-quality-gate
description: Build the gate that fails a game build - frame-time percentiles, memory ceiling, build size, load time and a scripted playtest harness - and prove it blocks by feeding it a heavy scene. Use when a game has no CI, when "it runs fine on my machine" is the quality claim, before a release build, or when regressions in frame rate or memory keep reaching players.
---

# Game Quality Gate

A game can pass every unit test and still ship at 22 fps on the target hardware. The gate for a game measures **frames, memory and load time**, because those are the things players feel and tests do not see.

The same law as `senior-quality-gate`: **a gate that has never rejected anything is not a gate.** A performance gate that has never failed a build is a dashboard.

## Phase 1 — Budgets as thresholds

| Metric | Threshold | Where measured |
|---|---|---|
| Frame time p50 | ≤ 16.7 ms (60 fps) | the busiest scene in the build, vsync off |
| Frame time p95 | ≤ 16.7 ms | same scene, 5-minute capture — 20 ms at p95 is 50 fps for 5% of frames |
| Frame time p99 | ≤ 33.3 ms | same scene; one missed vsync, no more |
| Load time to interactive | stated per platform | cold start, packaged build |
| Peak memory | stated per platform | packaged build, not editor |
| Build size | stated per platform | the artifact that ships |

Editor performance is not shipped performance: the editor has a debugger attached and different memory. **Measure the packaged build.**

**EVIDENCE: the threshold table with the measured value for the current build, on the packaged artifact.**

## Phase 2 — Automated capture

1. A **fixed benchmark scene** — deterministic, no random spawns, the busiest content the game has.
2. A **scripted run** that plays the scene for N seconds with recorded input.
3. Capture: frame time histogram, memory peak, GPU counters (draw calls, triangles), and a screenshot at a fixed resolution.
4. Store the capture as an artifact per build, with the build id in the filename.

**EVIDENCE: one capture artifact per build, committed or uploaded, with the numbers parsed.**

## Phase 3 — The playtest harness

- **Scripted input** for the critical path: menu → load → move → combat → save. Recorded once, replayed every build.
- **Golden screenshots** at 3–5 fixed camera points, compared with a perceptual tolerance — this is the only check that catches "the shader broke the UI".
- **Determinism**: same seed, same inputs, same simulation state hash. Nondeterminism is a finding, not a quirk.
- **Crash and error log**: zero crashes, zero unhandled exceptions in the run, asserted by the harness.

**EVIDENCE: the harness command, one green run, and the failure output from a deliberately broken build.**

## Phase 4 — Regression detection

- Compare against the **last green build on the same hardware**, not against a number from a month ago.
- Report the **delta**, and fail when it exceeds the tolerance (e.g. +10% frame time, +15% memory).
- Keep the last N captures so a slow drift over ten builds is visible, not just a single cliff.
- Pin the hardware class in the artifact name; a capture on a different machine is a different measurement.

**EVIDENCE: two captures across builds with the delta, and the CI step that fails on it.**

## Phase 5 — Prove it blocks

Build a deliberately heavy scene — 10× the props, an unbaked light, a 4K texture on a cube — run the gate, and capture the failure. Then revert. A gate that passes the heavy scene is measuring the wrong thing, or measuring the editor.

**EVIDENCE: the failing output for the heavy build, and the green run after reverting.**

## Anti-default table

| Default | The gate's answer |
|---|---|
| "It runs at 60 on my machine" | p50/p95/p99 on the packaged build, hardware named |
| Editor measurements | packaged build only |
| One frame screenshot | 5-minute capture with percentiles |
| No memory ceiling | peak memory threshold per platform |
| Manual playtesting only | scripted input + golden screenshots |
| No build-size check | size threshold on the shipping artifact |
| Crash logs read by eye | zero-crash assertion in the harness |
| Comparing to last month's number | delta against last green build, same hardware |

## Definition of done

- The threshold table exists with measured current values.
- The capture runs headless on the packaged build and stores an artifact.
- The playtest harness replays the critical path and diffs screenshots.
- The gate fails on a deliberate heavy scene, proven.
- The CI step is required, not advisory.

## Failure modes

1. **Editor numbers** — 60 fps in the editor, 28 in the shipped build.
2. **Average frame time only** — the spikes that players feel are in the p99.
3. **No fixed scene** — every run measures different content, so no run is comparable.
4. **Golden screenshots too strict** — flakes on a different GPU driver, then gets deleted.
5. **Hardware not recorded** — the regression was the laptop.
6. **Gate never failed** — nobody knows whether it measures anything.

## Sources — verified live 2026-10-27

- [Godot performance](https://docs.godotengine.org/en/stable/tutorials/performance/) — the engine's own guidance on measuring.
- [RenderDoc](https://renderdoc.org/) — frame capture and the draw-call breakdown.
- [Nsight Graphics](https://developer.nvidia.com/nsight-graphics) — GPU-side profiling.
- [Godot 2D](https://docs.godotengine.org/en/stable/tutorials/2d/) and [3D](https://docs.godotengine.org/en/stable/tutorials/3d/) — implementation reference; the thresholds above are this skill's own targets, not values quoted from that page.
