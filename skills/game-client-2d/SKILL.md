---
name: game-client-2d
description: Build a 2D game client to a professional bar - sprite atlases, tilemaps, camera, input buffering, animation state machines, pixel-perfect rendering and the frame budget. Use when implementing 2D movement, animation, tilemaps, cameras, or UI in a game, and when a 2D prototype must become a shipped client rather than an engine demo.
---

# Game Client 2D

A 2D game feels good or bad in the first three seconds, and that feel is made of four measurable things: **input latency, animation commitment, camera response, and collision honesty.** Everything else is content.

The engine's default player scene has none of them decided.

## Phase 1 — The frame budget

| Target | Budget |
|---|---|
| 60 fps | 16.6 ms total |
| 30 fps (mobile/heavy) | 33.3 ms total |
| Update (logic) | ≤ 4 ms at 60 fps |
| Render submit | ≤ 8 ms at 60 fps |
| Headroom for GC / audio / physics | the remainder, measured not assumed |

State the target before the first sprite. A game with no budget tunes by vibes and ships stutter.

**EVIDENCE: a measured frame time for the vertical slice, with the profiler capture.**

## Phase 2 — Input

1. **Poll once per frame** into an input state; never read raw events inside gameplay code.
2. **Buffer input** for 100–150 ms: a jump pressed one frame before landing should still jump. This is the single largest "feel" win in the genre.
3. **Coyote time** for platformers: ~80–120 ms of grace after leaving a ledge.
4. **Rebindable actions**, not raw keys — the engine's input map, not `if (key == KEY_SPACE)`.
5. **Buffered release** as well as press, for charge and hold mechanics.

**EVIDENCE: the input map, the buffer implementation, and a recorded jump that succeeds at 1 frame before landing.**

## Phase 3 — Animation as a state machine, not a sprite swap

States: `idle → run → jump → fall → land → hurt → die`, with **transitions and exit conditions** written down.

- **Commitment:** an attack animation has startup, active and recovery frames. Cancelling recovery is a design decision, not an accident.
- **Frame data in the repo:** a table of startup / active / recovery per action, not hidden in the animation timeline.
- **Hitbox and hurtbox** keyed to frames, not to the whole sprite.
- **Never tie logic to animation completion** without a fallback: if the clip is missing, the state must still exit.

**EVIDENCE: `anim/state-machine.md` with states, transitions, exit conditions, and the frame-data table for combat actions.**

## Phase 4 — Tilemaps and collision

- **Tile size and grid origin** decided once; a half-tile offset discovered later is a rewrite.
- **Layers:** background, decoration, collision, foreground. Collision never derived from the visual layer.
- **Collision shape:** capsule or AABB by design; a sprite-shaped collider is a bug generator.
- **One-way platforms and slopes** are explicit tile properties, not special-cased code paths.
- **Streaming:** chunk radius, unload rule, and the memory ceiling per chunk.

**EVIDENCE: the tilemap layers, the collision layer, and the chunk radius with its memory cost.**

## Phase 5 — Camera and rendering

- **Camera follow** with a deadzone and a look-ahead, then a smoothing constant — three numbers, not "attach to player".
- **Camera bounds** clamped to the level, and a shake that respects the user's reduced-motion setting.
- **Pixel-perfect** only when the art is pixel art: integer scaling, a fixed internal resolution, and no sub-pixel movement for sprites.
- **Atlas everything:** one texture page per material, sprites packed, and a named region per animation frame.
- **Sort order** explicit (y-sort in top-down, layer in side-on), never file order.

**EVIDENCE: camera constants, the atlas with its page count, and a screenshot at the internal resolution scaled to 1080p.**

## Anti-default table

| Engine default | The shipped answer |
|---|---|
| Raw key checks | an input map with buffered actions |
| Animation plays, logic waits on `finished` | a state machine with explicit exit conditions |
| Sprite-shaped collider | capsule/AABB by design |
| Camera attached to the player | deadzone + look-ahead + smoothing + bounds |
| One texture per sprite | a packed atlas with named regions |
| Sub-pixel movement on pixel art | integer scaling, fixed internal resolution |
| Tiles at whatever size the tileset came with | tile size and origin decided in Phase 0 |
| Sound on every hit with no mix | an audio bus with ducking and a volume ceiling |

## Definition of done

- Frame budget stated and measured on the slice.
- Input buffering and coyote time implemented and demonstrated.
- Animation state machine written down with frame data.
- Collision layer separate from visuals; collider shape chosen.
- Camera constants and pixel-perfect policy fixed.

## Failure modes

1. **Logic tied to animation events** — a missing clip freezes the player state.
2. **Unbuffered input** — the game drops one in five jumps and the player calls it "clunky".
3. **Sprite collider** — collisions catch on decorative pixels.
4. **Sub-pixel camera on pixel art** — shimmer on every edge, everywhere, forever.
5. **Unpacked textures** — a draw call per sprite: 200 unbatched sprites can exhaust a mobile render budget, and on desktop it is pure waste.
6. **Tile half-offset** — discovered at level 12, after 40 tilesets are authored.

## Sources — verified live 2026-10-27

- [Godot 2D tutorials](https://docs.godotengine.org/en/stable/tutorials/2d/) — canvas, sprites, animation.
- [Godot tilesets](https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html) — tile layers, terrain, collision.
- [Tiled documentation](https://doc.mapeditor.org/) — map authoring and export formats.
- [Aseprite docs](https://www.aseprite.org/docs/) — pixel-art pipeline and sprite sheets.
- [Red Blob Games — hexagons](https://www.redblobgames.com/grids/hexagons/) — grid maths done correctly.
- [Kenney assets](https://kenney.nl/assets) and [OpenGameArt](https://opengameart.org/) — licensed placeholders while the art pipeline is built.
