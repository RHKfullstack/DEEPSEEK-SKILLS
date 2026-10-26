---
name: game-assets
description: Run a game asset pipeline that ships legally and reproducibly - license records, source-to-import separation, naming, atlases, audio buses and loudness, fonts and localization. Use when adding art, audio or fonts to a game, when an asset pack arrives with unclear licensing, before a store build, or when the repo has no record of where an asset came from.
---

# Game Assets

An asset without a license record is a liability. An asset without import settings is a bug that appears on a different platform. Both arrive through the same door: someone downloaded a pack and put it in the project.

## Phase 1 — The license chain

Every asset has a row in `assets/CREDITS.md`:

| Column | Required |
|---|---|
| File or folder | the exact path |
| License | `CC0`, `CC-BY 4.0`, `MIT`, `OGA-BY`, purchased, commissioned |
| Source URL | where it came from |
| Attribution text | required for CC-BY, verbatim |
| Modified | yes/no, and what changed |

Rules:

- **CC0** needs no attribution, but the record is still kept — it proves the provenance in a store review.
- **CC-BY** requires the credit in the game's credits screen, with the license named and linked.
- **Purchased/commissioned** keeps the license document next to the asset, not in an email inbox.
- **No row, no ship.** An asset that cannot be traced is removed or replaced.
- **Never** a ripped or leaked asset, regardless of modification. Renaming a file does not change a derivative work.
- **CC-BY-SA / GPL — do not adapt.** Ship unmodified only with the licence and attribution kept with the asset, and get legal review for the distribution model; share-alike can reach your own game files.
- **OFL fonts** — include the licence text; a modified font may not keep a Reserved Font Name.

**EVIDENCE: `assets/CREDITS.md` with one row per asset, and the credits screen showing the CC-BY entries.**

## Phase 2 — Source, import, build — three separate things

```
assets/source/       the .aseprite, .blend, .psd — large, editable, may be out of the build
assets/imported/     what the engine imports (png, glb, ogg) with settings
assets/build/        generated atlases, compressed textures, packed audio — never committed
```

- **Import settings live in the repo** (`.import` files, `.meta`, importer config), not in a person's editor.
- **Compression and format per platform** decided in the import preset: texture compression per target, audio format per target.
- **Generated artifacts are rebuilt**, never hand-edited — a committed atlas goes stale the moment a sprite changes.

**EVIDENCE: the three folder roots, the committed import settings, and a clean rebuild producing identical output.**

## Phase 3 — Naming and structure

```
assets/imported/sprites/<category>/<name>_<state>_<index>.png
assets/imported/models/<category>/<name>.glb
assets/imported/audio/sfx/<category>/<name>.ogg
assets/imported/audio/music/<name>.ogg
```

- **No spaces, no capitals, no version suffixes** (`hero_final_v2_fixed.png` is a defect).
- **States in the name** (`hero_run_03`) so the atlas region and the animation are discoverable.
- **One category per folder**, matching the game's systems, not the artist's convenience.

**EVIDENCE: a file listing that matches the convention, and the rule written where an artist will read it.**

## Phase 4 — Audio

- **Bus structure:** master → music / sfx / ui / voice, each with its own volume and a ducking rule (music ducks under voice).
- **Loudness target**, stated: streaming/broadcast platforms normalise, so a loud master is attenuated and a quiet one is raised with a limiter. Set the game's own integrated target and a true-peak ceiling (e.g. <= -1 dBTP), and measure one track. Spotify and YouTube normalise toward about -14 LUFS integrated; EBU R128 broadcast toward -23 LUFS.
- **Loops** are authored to loop seamlessly, with the loop points recorded in the metadata.
- **Format per target:** compressed for music, short and uncompressed for latency-critical sfx.
- **Voice count limit** — 32 simultaneous sfx is a budget; the thirty-third is dropped by design, not by luck.

**EVIDENCE: the bus layout, the loudness target with a measured track, and the voice-count limit.**

## Phase 5 — Fonts and localization

- **Font license** recorded like any other asset; a system font in a shipped game is a licensing question, and a missing glyph in a translated build is a crash.
- **Text externalised** from the first line of UI — a hardcoded string is a localization defect, and retrofitting is a sweep of the whole codebase.
- **Pseudo-localization** run early: accented, 40% longer strings reveal every layout that only fits English.
- **RTL** support decided at the layout level (logical properties), not patched later.

**EVIDENCE: the font license row, the string table, and one pseudo-localized screenshot.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| Downloaded pack, no record | a CREDITS row with license and source |
| Editor-only import settings | committed import presets |
| Committed generated atlases | rebuilt in the pipeline |
| `hero_final_v2.png` | `<name>_<state>_<index>.png` |
| One master audio volume | buses with ducking and a voice limit |
| Hardcoded UI strings | externalised string table |
| English-only layout | pseudo-localization run early |
| System font assumed fine | license recorded, glyph coverage checked |

## Definition of done

- Every asset has a CREDITS row with license and source URL.
- Source, imported and build folders are separate; import settings are committed.
- Naming follows the convention; generated artifacts are not committed.
- Audio buses, loudness target and voice limit are stated.
- Strings are externalised and pseudo-localization has run once.

## Failure modes

1. **No provenance** — a store review asks for the license chain and the pack is gone from the internet.
2. **Import settings in someone's editor** — the build on another machine looks different.
3. **Committed atlases** — visual regressions that only appear when the atlas is rebuilt.
4. **Loudness ignored** — the game is quiet on one platform and clipping on another.
5. **Hardcoded strings** — every later translation is a code change.
6. **Glyph coverage untested** — the first translated build renders boxes.

## Sources — verified live 2026-10-27

- [Kenney assets](https://kenney.nl/assets) — CC0 packs, the safe default for placeholders and prototypes.
- [OpenGameArt](https://opengameart.org/) — mixed licenses, each asset states its own.
- [Creative Commons licenses](https://creativecommons.org/licenses/) — what CC0, CC-BY and CC-BY-SA actually require.
- [Quaternius](https://quaternius.com/) — CC0 3D model packs.
- [Godot asset pipeline](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/) — import settings and the source/import split.
