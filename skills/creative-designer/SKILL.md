---
name: creative-designer
description: Universal design method for any medium - web, desktop app, mobile, print/PDF, slides, social graphics, and anything else. Use when the ask is to design, redesign, art-direct, or judge visual work in a medium other than a browser page, or when the owner wants a design decision that must hold across several mediums at once. Supplies the medium-agnostic method, the shared system, the per-medium constraints, and the critique rubric.
---

# Creative Designer

Design is a decision system, not decoration. Every professional-looking artifact is the same eight decisions applied to different constraints. The medium changes the constraints — never the method.

That is why one skill can cover everything: **you do not learn six design disciplines, you learn one method and six constraint sets.**

> **Routing:** for a website or web app, use `ui-design` (it owns web craft) plus `senior-frontend-engineering` for the implementation. This skill covers every other medium, and the cross-medium decisions (brand, type, colour, hierarchy) that web also obeys.

## The method — the same eight steps in every medium

1. **Brief.** One sentence: whose problem, what job, what the viewer must notice in three seconds. If the brief has two primary jobs, split it into two artifacts.
2. **Reference.** One to three real references. Extract *rhythm and hierarchy*, never brand or colour. Write down what specifically you are copying: "12-column grid, 8pt rhythm, 2 type sizes" — not "looks premium".
3. **System.** Fix type scale, spacing scale, colour roles, radius, elevation, motion timing **before** composing. In print and slides these are points and millimetres; on screen they are rem and px. The ratios are identical.
4. **Compose.** Place by hierarchy order: size → weight → colour → space. One primary focal point per frame. Everything else supports it.
5. **Craft.** Icons, imagery, alignment, optical corrections, empty states, edge cases.
6. **Brand.** One accent. Consistent logo clear-space. The same voice. A second accent colour is a finding, not a choice.
7. **Critique.** Run the rubric (§ rubric). Fix the smallest thing that removes the failure. Repeat until zero fails.
8. **Hand-off.** Name the type sizes, colours, spacing, and export settings explicitly, so the artifact can be reproduced.

## Universal system — values that hold in every medium

**Type scale (1.25):** `12 14 16 20 25 31 39 49`. Ratios are medium-independent; the unit is not.
**Max sizes per artifact:** 4 in a screen or slide, 5 in a print spread. More is a finding.
**Weights:** `400` body, `500` labels, `600` headings. One `700+` hero line maximum.
**Spacing (4-unit base):** `4 8 12 16 24 32 48 64 96`. Every margin, padding, and gap comes from this set.
**Line height:** body `1.5`, UI `1.25`, headings `1.15`. Never `1` on wrapped text.
**Colour roles:** `bg`, `surface`, `surface-2`, `border`, `text`, `text-muted`, `accent`, `accent-contrast`, `success`, `warning`, `danger`. One accent.
**Neutrals are tinted**, never pure `#000`/`#fff` and never five near-identical greys.
**Radius:** one family per artifact (`6/10/16`). Mixed radii read as unfinished.
**Elevation:** three levels maximum, tinted by the background hue, never pure black.
**Motion:** `120ms` micro (hover/press), `200ms` standard, `320ms` enter/exit. Ease-out entering, ease-in leaving. Nothing over `400ms` unless it is a deliberate scene change.

## Medium constraints — the router

### Web / browser
Delegate: `ui-design` (visual craft, tokens, 8 states, screenshot loop) + `senior-frontend-engineering` (a11y, CWV, browser proof). Do not re-derive it here. Use this skill only for the brand/type/colour decisions that must match other mediums.

### Desktop app — Electron, Tauri, native window
- **Window controls are the OS's job.** macOS traffic lights sit left (`~78px` reserved); Windows caption buttons sit right (`~140px` reserved). Your titlebar must pad for both, or use a native titlebar.
- **Drag regions:** `-webkit-app-region: drag` on the bar, `no-drag` on every button, input, and menu inside it. A button that cannot be clicked because the bar drags it is a defect.
- **Minimum window:** test at `800×600` and `1280×800`. Below the minimum, the layout must reflow, not clip.
- **Menus and shortcuts:** a real application menu, accelerators (`Cmd` on macOS, `Ctrl` elsewhere), and every action reachable by keyboard. A desktop app driven only by mouse reads as a website in a frame.
- **Native dialogs** for open/save/confirm. An HTML `<input type=file>` in a desktop app is a tell.
- **System theme:** follow the OS (`nativeTheme.shouldUseDarkColors`), not a manual toggle that ignores the system.
- **Scaling:** test at `125%` and `150%`. 1px hairlines disappear or double; use `1px` borders only where the OS draws them consistently.
- **Multi-window and state:** which window owns a modal; what happens when the second window closes.
- **Offline and update states** are designed surfaces, not error dialogs.

### Mobile app — React Native, Flutter, native
- **Touch targets:** `44pt` iOS, `48dp` Android. Anything smaller is a finding.
- **Safe areas:** the notch, the home indicator, and the status bar are part of the layout. Content under them is a defect.
- **Platform navigation:** iOS pushes and back-swipe; Android has a hardware/gesture back. One screen design cannot ignore both.
- **Sheets over modals** for secondary actions. Full-screen modals are for first-run flows.
- **Thumb zone:** primary actions in the bottom third. Top-right is the hardest place to reach.
- **Keyboard:** the on-screen keyboard covers the lower half. Inputs must scroll above it.
- **Network states:** slow, offline, and retry are designs, not spinners.

### Print / PDF
- **Resolution:** images at `300dpi` at final size. `72dpi` web images are a finding.
- **Bleed:** `3mm` on every edge, with crop marks, for anything printed. A screen-only PDF needs none — state which it is.
- **Colour:** CMYK for print, RGB for screen-only PDF. Converting one to the other at export changes the result; do not claim a colour match across both.
- **Margins** at least `12mm`; body type `9–10pt` minimum; headings `14–24pt`.
- **Widows and orphans:** no single line stranded at a column or page top.
- **Typography:** real hyphenation, no forced double spaces, no justified text in narrow columns.
- **Furniture:** page numbers, document title, date, and version — every multi-page document.
- **Fonts embedded.** A PDF that substitutes a font on another machine is not the artifact you approved.

### Slides / deck
- **Canvas:** `1920×1080` (16:9). Design at that size, not at a browser width.
- **One idea per slide.** A slide with two ideas is two slides.
- **Text budget:** about six lines, under forty words. Body `24pt` minimum, titles `40–54pt`.
- **Projector contrast:** dark background with light text for rooms with dim projection; the reverse for bright rooms. Test at `50%` zoom, which approximates a projector.
- **Two fonts maximum**, one grid, consistent title position across every slide.
- **No dense tables.** If the audience must read it, it belongs in a handout.
- **Slide numbers**, and alt text on every image.

### Graphics / social
- **Sizes:** `1080×1080` (feed), `1080×1920` (story), `1200×630` (link preview).
- **One focal point, three elements maximum.**
- **Safe zone:** keep the message out of the bottom `~250px` of a story (platform UI) and the outer `5%` on feed crops.
- **Type size:** readable at `30%` scale, because that is the thumbnail size.
- **No more than one accent**, and contrast against the platform's chrome — a white graphic disappears in a light feed.

### Any medium not listed
Derive the constraint set from four questions, and write the answers down:
1. **Physical size** — what are the real dimensions?
2. **Viewing distance** — arm's length, desk, across a room, printed page?
3. **Input method** — touch, mouse, keyboard, none?
4. **Output fidelity** — colour-managed, compressed, projected, printed?
Every medium-specific rule above is a consequence of those four. A video title card, a game HUD, packaging, signage, or a watch face all follow from them.

## Craft details that separate "fine" from "professional"

- **Iconography:** one family, one stroke weight, one optical size. Emoji as icons is a finding.
- **Imagery:** consistent treatment (same crop style, same colour temperature). Mixed stock and illustration needs a stated reason.
- **Alignment:** optical, not mathematical. Text is aligned to the letter's edge, not the box's.
- **Density:** if a block has fewer than three pieces of information, it is not a card — it is a line of text. Never nest containers.
- **Empty states:** explain what would be here, and offer one action.
- **Loading:** skeleton for content, spinner only for actions under a second.
- **Errors:** a human sentence, what to do next, and a retry. Never a raw code.
- **Platform control vs product control:** use the platform's own dialog only where the platform owns the surface — the OS file picker in a desktop build, the action sheet on iOS. Never use a browser dialog (`confirm`, `alert`, `prompt`) for a surface the product owns: confirmation, feedback, selection, validation. It reads as a prototype in every medium.

## Critique rubric

Run this against the artifact itself — a render, a screenshot, a print proof, a slide in presentation mode. Never against your memory of building it.

**Show the artifact inline in the reply, not just its path.** A preview the user has to go find is not a preview: attach the render, the exported page, or the slide image in the answer, and keep the path only as a caption. The critique is the work; the image is the evidence the user can check.

- [ ] One focal point; hierarchy readable at a squint and at `30%` scale
- [ ] Every size/space/colour value resolves to the system (§ universal)
- [ ] ≤4 type sizes per screen/slide, ≤5 per print spread
- [ ] One accent colour; neutrals tinted, not pure grey
- [ ] Contrast ≥ `4.5:1` body, ≥ `3:1` large text and UI edges
- [ ] Spacing rhythm consistent; no cramped block and no accidental void
- [ ] Medium constraints satisfied (the router section for this medium)
- [ ] Empty / loading / error / edge content designed, not omitted
- [ ] Realistic content, not `Lorem ipsum` or a placeholder name
- [ ] No hit on the rejection list: gradient-as-default, emoji icons, everything centred, mixed radii, shadows on bordered flats, 5 near-identical greys, three fonts, placeholder-as-label

## Definition of done

- The artifact exists in its real output format — a rendered page, an exported PDF, a slide in presentation mode, a `1080×1080` PNG — not only in source.
- The rubric was run against that output and every item is pass or an explicitly accepted fail with a reason.
- Medium constraints were verified in the medium: `300dpi` at final size, `44pt` target measured, window tested at `800×600` and `125%` scale.
- The system values are written down so the next artifact can reuse them.
- Unverified items are labelled, never implied done.

## Failure modes a naive reviewer misses

1. **Designing at the wrong canvas.** A slide built at browser width, a print layout built at 96dpi, a mobile screen designed without the keyboard.
2. **Judging the source, not the output.** The CSS looks right; the exported PDF has a substituted font and no bleed.
3. **Copying a reference's brand instead of its rhythm.** The result is a worse version of someone else's identity.
4. **One artifact at one size.** No thumbnail check, no `30%` check, no projector check — the thing only works on the designer's monitor.
5. **Two primary actions.** Every screen has a "main" thing, or nothing is main.
6. **Medium affordances faked.** Custom window buttons that do not behave like the OS's, a web file picker in a desktop app, a hamburger menu on a desktop app with room for a real nav.
7. **Decorative consistency.** The same gradient and radius on every surface, so nothing signals importance.
8. **Edge content untreated.** The empty state, the long name, the zero-result search, the 200-character title.
9. **Print colour claimed from screen.** RGB preview approved for a CMYK run.
10. **"Looks clean" as a verdict.** Clean is not a criterion; a named rubric item is.
