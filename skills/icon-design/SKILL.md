---
name: icon-design
description: Design an icon set that reads as one family - a 24px grid, one geometric language, named layers, four treatments derived from a single drawing, and motion authored per icon instead of applied to it. Use when a product needs its own icons, when emoji or a mixed library is standing in for an icon system, when icons look muddy at 16px or inconsistent beside each other, when a set needs outline/solid/duotone variants, and when an icon must animate. Covers the model-independent path - geometry first, then render and check at 16, 24 and 48 - so a model that cannot draw curves can still produce a consistent set.
---

# Icon Design

**An icon is a drawing constrained to a grid. A set is one drawing system applied a thousand times.** The failure mode is almost never "an ugly icon" — it is a family that is not a family: three stroke weights, four corner radii, two optical centres, all at 24px, and none of it legible at 16.

This skill is the method for building that system from nothing, for choosing an existing one when the model cannot draw, and for proving the result at the size it will actually be used.

## Phase 0 — The grid, the stroke, the unit

Non-negotiables, because every later inconsistency traces back to these:

- **Canvas `24 × 24`.** Artboard and viewBox both `0 0 24 24`.
- **Live area `20 × 20`**, centred — a 2px margin on every side. An icon that runs to the edge of the viewBox looks larger than its neighbours.
- **Stroke `1.5` at 24px** (2px only if the set is drawn heavier on purpose). `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"` on the outline form.
- **Half-pixel coordinates.** On a 24 grid, snap to `0.5` increments so a 1.5px stroke lands on pixel centres at 1× and 2×. A stroke on an integer coordinate at 1.5px blurs at 24px and again at 16px.
- **Corner radius is one value** (`1` for joins, `2` for boxes) — a second radius is a finding.
- **Optical centre, not geometric.** A triangle and a circle on the same centre do not look centred. Nudge by eye, then check at 24 and 16.
- **Redraw below 20px; never scale.** A 24px icon multiplied to 16 loses its stroke; a 16px icon is a separate drawing with thicker relative strokes. Decide which sizes ship.

**EVIDENCE: the grid, the stroke, and one icon's coordinates, written down before the second icon exists.**

## Phase 1 — One geometry, repeated

Every icon in a family is built from the same six primitives. Drawing with them — instead of freehand curves — is what makes a set look designed, and it is also the path that a model with weak vector output can actually follow:

| Primitive | SVG | Use for |
|---|---|---|
| line | `<line x1 y1 x2 y2>` | strokes, dividers, arrows |
| circle | `<circle cx cy r>` | dials, heads, dots, lenses |
| rounded rect | `<rect x y width height rx>` | bodies, cards, screens, windows |
| arc | `<path d="M…A{r} {r} 0 0 1 …">` | bells, moons, smiles, dials |
| polyline | `<polyline points>` | charts, chevrons, waves |
| closed path | `<path d="M…Z">` | silhouettes that need a fill |

Rules: **no freehand bezier chains** unless the shape cannot be made from the six (a leaf, a flame); **no stroke under 1.25**; **no shape smaller than 2px** (it turns to mush at 16); and every icon gets the same visual weight — compare them side by side at 16px, not one at a time at 96px.

**EVIDENCE: every icon in the set uses only the six primitives, or names why it cannot.**

## Phase 2 — Named layers, decided before motion

The set that animates well is designed for it: **each icon is built from 2–5 named parts**, not one merged path.

```
bell        → body, clapper
gift        → box, lid, ribbon, bow
heart       → heart, sparkles
rocket      → body, window, fins, flame
search      → ring, handle
```

A part is a `<g id="…">` with its own transform origin. Merging a bell into one path is a decision to never animate its clapper — so make that decision now, not when the motion is requested.

**EVIDENCE: the part list per icon, and the pivot point of any part that rotates.**

## Phase 3 — Four treatments from one drawing

One geometry, four renderers. If a treatment needs a second drawing, the set doubles in size forever:

| Treatment | How it is made | Watch out |
|---|---|---|
| **outline** | stroke only, `fill="none"` | the default; blurriest at 16px, so check first |
| **solid** | the same paths closed and filled; negative space carries the detail | detail must be cut out with `fill-rule="evenodd"`, not drawn as a second colour |
| **duotone** | the solid form in the accent at ~20% alpha behind the outline | two colours max; the tint must survive dark mode |
| **glass** | solid + inner highlight + a soft bloom at 8–12% white | fixed light colours: only readable on a dark or tinted surface, so state that |

`currentColor` on every stroke and fill — an icon that cannot inherit the text colour is a bitmap in disguise.

**EVIDENCE: one icon rendered in all four treatments from the same source paths.**

## Phase 4 — Motion belongs to the icon, not to the set

A stock wiggle applied to every icon is the tell. The motion is **what the thing does**: a bell swings and its clapper lags behind it; a heart thumps twice; a gift lid pops up and lands; a rocket lifts and its flame fades.

| Motion | The move | Typical parts |
|---|---|---|
| **swing** | rotate ±12° around a top pivot, overshoot 2°, settle | bell, hanging objects |
| **thump** | scale 1 → 1.12 → 1, twice, 90ms apart | heart, notification badge |
| **pop** | translate −2px + rotate 6°, then settle | lid, cursor, tooltip arrow |
| **rise** | translate −3px, fade the trailing part out | rocket, arrow, send |
| **shake** | ±1px horizontal, 3 cycles, decaying | error, denied, wrong code |
| **draw** | `stroke-dashoffset` from length to 0 | sparkle, check, underline |

- **Spring, not sine.** `cubic-bezier(.34, 1.56, .64, 1)` or a real spring solver; a linear ease reads as a GIF.
- **240–420ms**, with 30–60ms stagger between parts so the lag is visible.
- **Trigger explicitly**: `hover`, `press`, `mount`, or `none`. Random ambient motion is noise.
- **`prefers-reduced-motion: reduce` renders the final pose** — not a slower animation, no animation.
- **Sound is optional and off by default**, and it must be one tap to mute. If the icon has spatial audio, place it along the path the icon travels, not at the button.

**EVIDENCE: the motion named per icon, the trigger, the duration, and the reduced-motion fallback.**

## Phase 5 — The model-independent path

Not every model can produce clean vector output, and none of them should guess. Pick the lane that matches what you can actually verify:

| What you can do | The lane |
|---|---|
| Emit clean SVG paths | hand-author on the grid (§1), one icon at a time, checking each |
| Can emit primitives but curves come out wrong | use only `rect rx`, `circle`, `line`, `polyline` and `M…A…` arcs; no freehand beziers |
| Cannot draw a usable vector at all | **use a licensed library** — Lucide, Tabler, Phosphor, Heroicons, Iconoir — one family only, and record which and why in the hand-off |
| The product already ships its own set | use it and its own package (for Jiggicons, `npx jiggicons add`, see the project's own skill) — never redraw it |
| Cannot see the result | render it: `rsvg-convert`, ImageMagick, or open the SVG in a browser and screenshot at 16/24/48 |

**The rule that overrides all of them: never ship an icon you have not seen rendered at 16px.** An icon is judged at the size it is used, and 16px is where a bad grid shows up.

**EVIDENCE: which lane was taken, and the rendered 16/24/48 images.**

## Phase 6 — The audit

Run this on the set, not on one icon, and count the failures:

- [ ] Every icon is on the 24 grid, inside the 20 live area
- [ ] One stroke width across the set (±0.25 tolerance)
- [ ] One corner radius family
- [ ] Optical centres align when the icons sit in a row
- [ ] Legible at 16px — the test, not a wish
- [ ] Reads in `currentColor` on both light and dark surfaces
- [ ] No icon is visually heavier than its neighbours at the same size
- [ ] The four treatments render from the same source
- [ ] Named parts exist for any icon that animates
- [ ] Nothing traced from another set — the provenance is written down (`client-code-intake` for a supplied set)

**EVIDENCE: the row of icons at 16, 24 and 48, and the count of failed checks.**

## Anti-default table

| Default | The gate |
|---|---|
| Emoji as icons | a real set, or a licensed library with the choice recorded |
| Mixing Lucide + Heroicons + a brand icon | one family only; a second family is a finding |
| Scaling 24px down to 16 | redraw for the small size |
| Stroke 1 on a 24 grid | 1.5, on half-pixel coordinates |
| Merging an icon into one path | named parts, or you have chosen "it never animates" |
| The same wiggle on every icon | motion authored per icon, from what the thing does |
| A 700ms bouncy animation | 240–420ms, spring, respects reduced motion |
| Four styles hand-drawn separately | one geometry, four renderers |
| `fill="#000"` hard-coded | `currentColor` |
| Copying a set from a marketplace | a licence and a record, or a licence refusal |

## Definition of done

- The grid, stroke, radius and live area are written down, and every icon obeys them.
- Each icon is one of the six primitives, or names why not.
- The four treatments render from the same source paths.
- The set was checked as a row at 16, 24 and 48 — with an image, not a claim.
- Any animated icon has named parts, a named motion, a trigger, a duration and a reduced-motion fallback.
- The provenance of every path is known: drawn here, or a named licensed library.
- Unverified items are labelled, never implied done.

## Failure modes

1. **The mixed family** — four libraries and one brand icon, each with its own stroke, pretending to be a set.
2. **The blur at 16** — beautiful at 96, mush in a toolbar.
3. **The merged path** — the icon animates as a rigid blob because the parts were welded together.
4. **The stock wiggle** — the same keyframes on the bell and the rocket; the motion is decoration, not description.
5. **The missing variant** — solid drawn from scratch, so it no longer matches the outline.
6. **The hard-coded fill** — the icon ignores dark mode and the disabled state.
7. **The unverified render** — "it looks right" from source, shipped to a 16px toolbar.
8. **The borrowed set** — a marketplace pack with no licence and no record.

## Overlap — what this skill does not own

- `ui-design` owns layout, tokens, the eight component states and the screenshot loop.
- `creative-designer` owns the cross-medium system; an icon family is one of its signature decisions.
- `game-assets` owns a sprite/atlas pipeline and licensing records for art it did not draw.
- `client-code-intake` owns provenance when a set arrives from a client.
- Where a product ships its own icon system, **use its package and its own skill** rather than redrawing it.

## Sources — verified live 2026-11-25

- [Jiggicons](https://jiggicons.com/) — the reference implementation this method is generalised from: 24px grid, four treatments from one drawing, named layers so each piece moves on its own, motion and spatial audio authored per icon, `prefers-reduced-motion` supported. Match the *method*, not the drawings; the set is licensed.
- [Lucide — icon design guidelines](https://lucide.dev/guide/design/icon-design-guide) — 24px grid, 2px stroke default, rounding rules, and the optical-centre practice.
- [Material Symbols — design guidelines](https://m3.material.io/styles/icons/designing-icons) — grid, keyline shapes, and the four-variable axis approach (weight, fill, grade, optical size) that a treatment system mirrors.
- [Apple Human Interface Guidelines — SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) — optical size behaviour and why a small size is a redraw rather than a scale.
- [Carbon Design System — iconography](https://carbondesignsystem.com/elements/icons/usage/) — one family, one stroke, and the usage rules that go with it.
