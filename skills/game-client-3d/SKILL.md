---
name: game-client-3d
description: Build a 3D game client to a professional bar - draw-call and triangle budgets, unit and import scale, material and lighting strategy, LOD and culling, physics layers and the frame profile. Use when implementing 3D rendering, importing models, setting up lighting or shadows, debugging frame drops in 3D, or taking a 3D prototype toward a shippable build. Load after game-design; the frame-time threshold is owned by game-quality-gate.
---

# Game Client 3D

3D performance is not "the GPU is fast enough". It is **draw calls, overdraw, texture memory and frame time**, each with a budget, each measurable. The engine's default scene — one camera, one light, one imported model at the wrong scale — hides all four.

## Phase 1 — The budget, per platform

| Budget | Desktop | Mobile / low-end |
|---|---|---|
| Frame time | 16.6 ms (60 fps) | 33.3 ms (30 fps) |
| Draw calls | ≤ 1,000–2,000 | ≤ 200–400 |
| Triangles on screen | 1–3 M | 100–300 k |
| Texture memory | 1–2 GB VRAM | 200–400 MB on a mid-range phone; under 150 MB on a low-end device |
| Real-time shadow-casting lights | 1–2 | 1, or baked |

The numbers are a starting point to measure against, not a target to assume. Record the actual counts for the slice.

The shipping threshold and its measurement method are owned by `game-quality-gate` Phase 1 - this table allocates that budget across draw calls, triangles, texture memory and shadows. EVIDENCE: the renderer's draw-call, triangle and texture-memory counters for the slice, against the table.

## Phase 2 — Units and import scale

- **One unit = one metre**, declared once. Physics, audio attenuation, camera near/far and animation root motion all assume it.
- **Import scale** set at the importer, not by scaling the node: a model scaled ×0.01 in the scene breaks physics, shadows and LOD thresholds.
- **Origin at the feet**, forward axis consistent across every model — a mixed-axis asset pack is a bug generator.
- **Camera near/far** derived from the world size; a 0.01 near plane costs depth precision everywhere.

**EVIDENCE: the unit convention, one imported model with its import settings, and the camera near/far values.**

## Phase 3 — Materials and lighting

- **Shared materials**, one per surface type. A unique material per object means a draw call per object.
- **Lighting strategy chosen**: baked for static, real-time for dynamic, or a hybrid with an explicit split. Not "add a light and see".
- **Shadow budget**: one shadow-casting directional light maximum on mobile, cascades measured, and shadows off for anything the player cannot see.
- **Fog and sky** are atmosphere, not a way to hide the far plane.
- **Post-processing is a cost**, ordered and measured; a 4K bloom pass can cost several milliseconds — measure it in the frame capture.

**EVIDENCE: the material count, the lighting split (baked vs dynamic), and the shadow cascade settings with their frame cost.**

## Phase 4 — LOD and culling

- **LOD chain** per hero asset (L0–L3), with the switch distance derived from screen coverage, not guessed.
- **Occlusion culling** enabled and proven: stand in the busiest corner and record the draw calls.
- **Frustum culling** works by default; verify it is not defeated by one giant merged mesh.
- **Instancing** for repeated props: 200 trees are one instanced draw, not 200.
- **Streaming** for open worlds: cell size, load radius, memory ceiling.

**EVIDENCE: the LOD switch distances, a screenshot of the busiest corner with draw calls, and the streaming radius.**

## Phase 5 — Physics

- **Fixed timestep**, independent of render rate; state the rate.
- **Collision layers** named and used: player, world, prop, trigger, projectile. A single default layer means everything collides with everything.
- **Simple colliders** (box, capsule, convex) — a triangle mesh collider for a dynamic body is a performance and stability defect.
- **Rigid bodies sleep**; a thousand awake props is a frame.
- **Raycast budget** per frame, with a maximum distance.

**EVIDENCE: the physics tick rate, the layer table, and the collider type per dynamic object class.**

## Anti-default table

| Engine default | The shipped answer |
|---|---|
| Imported model scaled by the node | import scale set at the importer |
| A material per object | shared materials per surface type |
| One light, shadows on everything | lighting strategy + shadow budget |
| No LOD | LOD chain with screen-coverage thresholds |
| Non-instanced props | instanced meshes for repeats |
| Everything on one collision layer | named layers with a collision matrix |
| Mesh collider on a moving body | primitive collider |
| "It runs at 60 on my machine" | measured on the low-end target |

## Definition of done

- The budget table is filled with measured numbers for the slice.
- Unit, origin and forward axis are consistent across assets.
- Materials are shared; lighting and shadow strategy is stated.
- LOD and instancing are in place for repeated or hero assets.
- Physics runs on a fixed timestep with named layers.

## Failure modes

1. **Scaled nodes** — physics, shadows and LOD silently wrong.
2. **Material per object** — thousands of draw calls at 30 objects on screen.
3. **Unbaked static lighting** — the frame is spent on shadows that never change.
4. **No LOD** — the hero asset is fine on a 4090 and unplayable on integrated graphics.
5. **One collision layer** — the projectile hits the player's own capsule.
6. **Mesh colliders on physics bodies** — jitter, tunnelling, and a CPU spike per contact.

## Sources — verified live 2026-10-27

- [Godot 3D tutorials](https://docs.godotengine.org/en/stable/tutorials/3d/) — meshes, materials, lighting.
- [Godot transforms](https://docs.godotengine.org/en/stable/tutorials/3d/using_transforms.html) — transform basis and uniform scale; the import-scale and origin conventions are this skill's, not that page's.
- [LearnOpenGL](https://learnopengl.com/) — what the engine is doing underneath.
- [three.js documentation](https://threejs.org/docs/) — the web 3D equivalent; its budgets are the same order, but measure your own scene.
- [RenderDoc](https://renderdoc.org/) — frame capture; the tool that answers "where did the frame go".
- [Nsight Graphics](https://developer.nvidia.com/nsight-graphics) — GPU profiling on NVIDIA.
