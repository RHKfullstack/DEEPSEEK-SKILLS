---
name: motion-and-video
description: Add motion and produce video with a tool that actually exists here - the transition rules for UI, the ffmpeg recipes that cut, join, caption, crossfade and export, the difference between an animated component and a rendered file, and the frame check that proves the result. Use when a page needs a transition, when an icon or a card must animate, when someone asks for a video, a GIF, a screen recording or a demo clip, and when a model does not know which tool to reach for. Verified against the tools installed on this machine.
---

# Motion and Video

**Motion is a property of the thing, not a layer added at the end.** A card that slides in because "something should happen" is noise; a lid that pops because a gift lid pops is description. And a video is not a design decision plus wishes — it is a file produced by a specific tool, and the first question is always *which tool exists here*.

Two failure modes this skill exists for: the animation that animates the wrong property and janks, and the model that says "here is how you would make a video" without producing a file.

## Phase 0 — Which medium is this actually?

| What the owner wants | What to build | Not this |
|---|---|---|
| A page or component feels alive | CSS transition / WAAPI on `transform` and `opacity` | a `<video>` of the UI |
| An icon reacts to a press | per-icon motion in the icon's own parts (`icon-design` §4) | a GIF of the icon |
| A short demo of a flow | screen capture (`ffmpeg` capture or Playwright video) | 40 hand-placed frames |
| A shareable clip, GIF or reel | `ffmpeg` from frames or a recording | a screen recording of a screen recording |
| A title card, lower third, caption | `ffmpeg` overlay/drawtext, or an SVG rendered to PNG | a slide deck export |
| A looping illustration | SVG + WAAPI, or a sprite sheet | a 4 MB GIF |

Decide this before writing anything. Building a CSS animation when the owner asked for a video is the most common wasted effort in this area.

**EVIDENCE: the medium chosen, and why the others were rejected.**

## Phase 1 — UI transitions that do not jank

The three base timings live in one place — `creative-designer`'s universal system (`120/200/320`). This skill applies them to a running UI and adds the computed envelope for spring motion; it does not redefine the scale.

- **Animate `transform` and `opacity` only.** Width, height, `top`, `left`, `margin` force layout on every frame; that is the difference between smooth and "laggy on a real phone".
- **Durations:** `120ms` micro (hover, press, focus), `200ms` standard (expand, open), `320ms` enter/exit (modal, drawer, route). Nothing over `400ms` unless it is a deliberate scene change. When the duration has to be computed rather than picked: clamp it to `200–1200ms` with `560ms` as the default, and set the exit to `min(240ms, 0.4 × duration)` - a spring that settles into that envelope reads as physical rather than decorative (the envelope this workspace solved for before, at a 1/480s integration step).
- **Easing:** ease-out entering (`cubic-bezier(0, 0, .2, 1)`), ease-in leaving (`cubic-bezier(.4, 0, 1, 1)`). Linear reads as mechanical.
- **Exit is faster than enter** — leaving should not feel like waiting.
- **One moving element per view.** Three simultaneous animations mean nothing is emphasised.
- **Stagger 30–60ms** when a list enters, and cap the total under ~500ms regardless of item count.
- **`prefers-reduced-motion: reduce`** → no transform, no travel; a cross-fade at most. This is a correctness requirement, not a courtesy.
- **Never animate on scroll without a reason**, and never hijack scroll.
- **Layout stability:** reserve the space; an animation that reflows the page around it is worse than no animation.

**EVIDENCE: the property list animated, the durations, and a reduced-motion path.**

## Phase 2 — The tool, chosen by what is installed

Verified on this machine 2026-11-25. **A tool that is not on this list is not available — do not claim it.**

| Need | Tool | State here |
|---|---|---|
| mp4 / webm / GIF from frames or a clip | `ffmpeg` | **present, 8.1** (`Gyan.FFmpeg …\ffmpeg-8.1-full_build\bin\ffmpeg.exe`) |
| probe a file (duration, fps, resolution, codec) | `ffprobe` | **present** |
| cut, concat, trim, scale, crossfade, caption, overlay | `ffmpeg` | present |
| contact sheet, thumbnail, frame extraction | `ffmpeg` + `ffmpeg -vf tile` | present |
| raster compose, text on an image, image diff | Pillow | **present, 12.3.0** (`python -c "import PIL"`) |
| in-page UI animation | CSS / WAAPI | the browser |
| record a UI interaction | Playwright video / screencast, or `ffmpeg -f gdigrab` | Playwright MCP is available |
| SVG → PNG without a browser | ImageMagick or Inkscape | **absent at the time of writing** - install with `winget install ImageMagick.ImageMagick` or `Inkscape.Inkscape` (Phase 2b), then verify |
| SVG optimise | svgo | **absent at the time of writing** - `npm install -g svgo` (Phase 2b); `npx --yes svgo` also works and is a download, so say so |
| programmatic video in React | — | **absent as a package**: no `remotion` in any `node_modules` here. `npx --yes remotion` cannot work (the package ships no `bin`); the CLI is reachable only as `npm exec --yes --package=@remotion/cli -- remotion --version`, and a render additionally needs its own Chrome Headless Shell download - so do not propose it as ready |

**The Windows trap:** `convert` on this machine is the `convert.exe` that ships in `System32` — Windows' own NTFS volume-conversion tool, not ImageMagick. Running it on a PNG does nothing useful and can be destructive. Check `Get-Command` before believing a tutorial.

**Translating a tutorial that assumes ImageMagick or Inkscape:** render SVG with a headless browser instead (Playwright: open the SVG, screenshot), and do the rest with `ffmpeg` and Pillow.

**EVIDENCE: `Get-Command <tool>` for every tool the plan uses, showing the real path.**

## Phase 2b — Install what the job needs

The tool table above describes this machine at the time it was written, not the limit of what is possible. When a job needs a tool that is missing, **install it, verify it, then use it** - and say so in the report, because the machine has changed.

| Tool | Install | Verify |
|---|---|---|
| ImageMagick (`magick`) | `winget install --id ImageMagick.ImageMagick --accept-package-agreements --accept-source-agreements` | `magick -version` |
| Inkscape - SVG to PNG without a browser | `winget install --id Inkscape.Inkscape --accept-package-agreements --accept-source-agreements` | `inkscape --version` |
| svgo | `npm install -g svgo` | `svgo --version` |
| ffmpeg, if even that is missing | `winget install --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements` | `ffmpeg -version` |

- **One install, verified, beats three proposed.** Do not list alternatives you did not install.
- **A refused install is a result**: quote the error, label the step `UNAVAILABLE`, and give the command the owner can run.
- **Never claim a tool from memory** - the version command is the only proof that it is there.

**EVIDENCE: the install command, its exit code, and the version output.**

## Phase 3 — The ffmpeg recipes

Copy these; they are the ones that come up. Quote the real invocation in the report, not a paraphrase. This ffmpeg has already produced a real H.264 clip on this machine (1440x900 at 12fps, muxer tag `Lavc62.28.100 libx264`), so the pipeline is proven here, not assumed.

```powershell
# probe first, always: duration, fps, size, codecs
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 "$in"

# PNG sequence -> mp4 (H.264, web-safe, even dimensions required)
ffmpeg -y -framerate 30 -i "frame-%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "$out.mp4"

# trim without re-encoding where possible, otherwise re-encode
ffmpeg -y -ss 00:00:02.5 -to 00:00:08 -i "$in" -c:v libx264 -crf 18 -c:a aac "$out.mp4"

# crossfade two clips (1.5s), audio included
ffmpeg -y -i a.mp4 -i b.mp4 -filter_complex "[0][1]xfade=transition=fade:duration=1.5:offset=4.5[v]" -map "[v]" "$out.mp4"

# scale to 1080p, keep aspect, even numbers
ffmpeg -y -i "$in" -vf "scale=-2:1080" -c:v libx264 -crf 20 "$out.mp4"

# a caption that fades in at 1s and out at 4s.
# fontfile is NOT optional here: this Windows build has no fontconfig default, and drawtext without it
# crashes ffmpeg with an access violation (0xC0000005) instead of failing. Escape the drive colon.
ffmpeg -y -i "$in" -vf "drawtext=fontfile='<drive>\:/Windows/Fonts/arial.ttf':text='Sample':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-140:alpha='if(lt(t,1),0,if(lt(t,4),1,0))'" "$out.mp4"

# high-quality GIF: palette first, then map it (the two-pass is not optional)
ffmpeg -y -i "$in" -vf "fps=15,scale=640:-1:flags=lanczos,palettegen" palette.png
ffmpeg -y -i "$in" -i palette.png -lavfi "fps=15,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse" "$out.gif"

# contact sheet: one frame every 2s, 4 columns
ffmpeg -y -i "$in" -vf "fps=0.5,scale=320:-1,tile=4x3" sheet.png

# record the screen on Windows (gdigrab), 30fps, capped at 20s
ffmpeg -y -f gdigrab -framerate 30 -i desktop -t 20 -c:v libx264 -crf 20 "$out.mp4"
```

Rules that prevent the usual damage:

- **Even dimensions** for H.264 (`scale=-2:…` keeps them even). An odd height fails the encode with a confusing error.
- **`-movflags +faststart`** so the file plays before it finishes downloading.
- **`-crf 18–23`** for H.264; below 18 is wasted bytes for screen content, above 23 shows banding.
- **Audio:** `-c:a aac -b:a 128k`; for web delivery normalise to about `-14 LUFS` rather than guessing per file.
- **Never scale up** a recording; re-record at the target size.

**EVIDENCE: the exact command, its exit code, and the probe output of the produced file.**

## Phase 4 — The video bar

- **The first two seconds show the thing.** No logo intro, no slow fade from black; the product is on screen immediately.
- **Resolution and aspect match the destination:** `1920×1080` or `1080×1920`, never a stretched horizontal clip in a vertical slot.
- **Captions** burned in or shipped as `.srt` — every video with speech. Burn-in for social, `.srt` for anything the owner will edit.
- **No audio that autoplays.** One tap to mute, as `icon-design` requires for its sounds.
- **A caption or title for the silent viewer**, since most feeds play muted.
- **End on the state, not on a fade.** The last frame should be the result.

**EVIDENCE: the frame at 0s, the frame at the midpoint, and the last frame, shown.**

## Phase 5 — Prove the file

A video that exists is not a video that works:

1. `ffprobe` it — duration, fps, resolution, codec, audio stream present.
2. **Extract three frames** (0%, 50%, 100%) and look at them: `ffmpeg -y -ss <t> -i out.mp4 -frames:v 1 frame-<t>.png`.
3. **Check for black or frozen frames** — a failed render often produces a correct-looking duration with a black image.
4. **Check the size is sane** — a 30-second screen clip should be a few MB, not 200 MB and not 40 KB.
5. **Show a frame in the reply.** A path the owner has to open is not a preview.

**EVIDENCE: the probe output, three extracted frames, and their file sizes.**

## Anti-default table

| Default | The gate |
|---|---|
| "Here is how you would make a video" with no file | produce the file, or label it UNAVAILABLE with the exact command |
| Proposing ImageMagick, Inkscape, Remotion or svgo here | they are not installed — use the browser + ffmpeg + Pillow |
| Running `convert` on an image on Windows | that is the disk tool; use Pillow for raster work, or a headless browser for SVG |
| Animating `height`, `width` or `left` | `transform` and `opacity` only |
| A 600ms bouncy transition on every hover | 120ms micro, 200ms standard, 320ms enter |
| The same animation on everything | one moving element per view, and it means something |
| Ignoring reduced motion | a real `prefers-reduced-motion` path |
| GIF straight from a video without a palette | the two-pass `palettegen`/`paletteuse` |
| An odd-height H.264 encode | even dimensions, `scale=-2:…` |
| Reporting the file as done without looking at a frame | probe + three frames + a visible image |

## Definition of done

- The medium was chosen explicitly, and the rejected options are named.
- Every tool used was confirmed present with `Get-Command`, and a missing tool was replaced rather than assumed.
- UI motion animates `transform`/`opacity` only, has named durations, and a reduced-motion path.
- The produced file is probed, and three frames were extracted and looked at.
- A frame is shown in the reply, not just its path.
- Anything not produced is labelled `UNAVAILABLE` with the command that would produce it.

## Failure modes

1. **The CSS answer to a video request** — an animation where a file was wanted.
2. **The tutorial tool** — commands copied for a tool this machine does not have.
3. **The Windows `convert`** — the NTFS tool invoked on a PNG.
4. **The jank** — layout properties animated, fine on a desktop, unusable on a phone.
5. **The black video** — correct duration, no image, never frame-checked.
6. **The 200 MB clip** — no `-crf`, no scale, no faststart.
7. **The 40 KB clip** — an encode that failed halfway and was reported as done.
8. **The autoplaying sound** — the one thing that makes an owner close the tab.

## Overlap — what this skill does not own

- `ui-design` owns the token values; this skill owns which properties animate and how long.
- `creative-designer` owns the universal motion timings (`120/200/320`) — this skill applies them to a running UI and a rendered file.
- `icon-design` owns motion inside an icon's parts; this skill owns the page around it and the file that leaves it.
- `senior-frontend-engineering` owns the frame budget and Core Web Vitals; an animation that breaks INP is its finding.
- `game-client-2d` / `game-client-3d` own frame budgets inside a game loop.

## Sources — verified live 2026-11-25

- [MDN — Using CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations) — the property set and the compositing guidance behind "transform and opacity only".
- [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) — the media query and why presence, not a slower animation, is the fallback.
- [web.dev — Animations and performance](https://web.dev/articles/animations-guide) — which properties trigger layout and paint, and the 60fps budget.
- [ffmpeg documentation](https://ffmpeg.org/documentation.html) — the filter graph, `xfade`, `palettegen`, `gdigrab`, and `-crf` semantics used above.
- [ffmpeg Filters — xfade](https://ffmpeg.org/ffmpeg-filters.html#xfade) — the `transition`/`duration`/`offset` arguments the crossfade recipe depends on.
- Local verification: `ffmpeg 8.1` and `ffprobe` present at the WinGet path; `magick`, `inkscape`, `rsvg-convert`, `svgo`, `cairosvg` absent; Pillow 12.3.0 present; `convert` resolves to the Windows `System32` volume-conversion tool.
