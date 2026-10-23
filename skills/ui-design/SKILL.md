---
name: ui-design
description: Build, restyle, or judge web UI to a professional visual bar. Use whenever creating pages or components, when the user says the UI looks bad, cheap, generic, "pangit", "AI-looking", or asks to redesign/restyle, and before declaring any UI task done. Covers design tokens, layout rhythm, component states, accessibility, the AI-slop rejection list, and the screenshot-critique loop.
---

# UI Design

Models ship "AI-looking" UI because they optimize for *completion* — every element exists, nothing is considered. This skill replaces taste-by-default with a token-driven, reference-driven loop with a pass/fail gate.

The single highest-leverage change is step 1. Skipping it is why the same agent produces the same ugly page twice.

## 0. Non-negotiables

- **No arbitrary values.** Every `padding`, `margin`, `gap`, `font-size`, `radius`, `color`, and `shadow` resolves to a token. A raw hex or a `13px` is a defect.
- **No new component if one exists.** Check the project's component library first.
- **No UI task is done without a screenshot.** See §6.
- **States are the product.** A button with one state is 1/8 of a button.

## 1. Before writing any markup

1. **Find the tokens.** Look for `tokens.css`, `theme.css`, `tailwind.config.*`, `:root { --... }`, a design-system folder. Read them.
2. **If there are none, create `tokens.css` first** and wire it into the entry point. Do not style components before the token file exists — this is the step that makes output consistent instead of random.
3. **Identify the component library.** Tailwind + shadcn/ui, MUI, Chakra, Bootstrap, Laravel Blade components, whatever is installed. Use it. If none is installed and the user has not forbidden dependencies, prefer Tailwind + shadcn/ui for React, or hand-authored primitives driven by the tokens for server-rendered stacks.
4. **Get one reference.** Ask the user for a screenshot of a screen whose quality bar they want matched, or pick one concrete reference (a public product in the same category). Match its *spacing and type rhythm*, not its brand.
5. **Count the surfaces.** List the screens/states you will build. If the user asked for "a dashboard", the deliverable includes empty, loading, and error dashboards — not just the happy path with fake data.

## 2. Tokens — the actual values

Use these unless the project already defines its own. Adapt, do not invent a fourth scale.

**Spacing (4px base):** `4 8 12 16 24 32 48 64 96`. Gaps and padding come from this set only. Default section padding is 24–32; default card padding is 20–24; never below 16 inside a card.

**Type scale (1.25):** `12 14 16 20 25 31 39 49`. Body 16, UI labels 14, captions 12, h1 39/49, h2 31, h3 25, h4 20. **At most 4 sizes on one screen.**

**Line height:** body `1.5`, UI `1.25`, headings `1.15`. Never `1` on wrapped text.

**Weight:** `400` body, `500` labels and buttons, `600` headings. Avoid `700+` except one hero line; avoid `300` below 20px.

**Radius:** `sm 6`, `md 10`, `lg 16`, `full 999`. One family: pick md for controls, lg for cards. **Never mix unrelated radii** (`4px` inputs with `12px` cards is the tell).

**Elevation (3 levels max):** `sm 0 1px 2px rgb(0 0 0 / .06)`, `md 0 4px 12px rgb(0 0 0 / .08)`, `lg 0 12px 32px rgb(0 0 0 / .12)`. Shadows are tinted by the background hue, never pure black. Flat surfaces get no shadow — use a border instead.

**Color roles (not hex names):** `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, `--success`, `--warning`, `--danger`. One accent. Neutrals are *tinted* (a hint of the accent hue) — pure `#000`/`#fff` and pure grays look cheap.

**Dark mode:** never invert. Re-derive: surfaces get lighter as they come forward (`#0b0b0d → #141417 → #1c1c20`), text drops to ~`#e8e8ea` not `#fff`, borders drop to ~10–14% alpha, and shadows are replaced by a lighter border + slightly higher surface.

## 3. Layout and hierarchy

- **8pt rhythm.** Vertical spacing between blocks is a multiple of 8; inside components, 4 is allowed.
- **One primary action per view.** Secondary actions are quiet (ghost/outline), destructive ones are never adjacent to the primary.
- **Hierarchy order is size → weight → color → space.** Do not use color alone to separate two items at the same level.
- **Prose measure:** 60–75 characters (`max-width: 65ch`). Reading column max `720px`; app content max `1200–1280px`.
- **Alignment:** pick left-aligned text for anything longer than a headline. Centered text is for heroes and empty states only.
- **Density:** if a card has fewer than three pieces of information, it is not a card — it is a line of text. **Never nest cards.**
- **Skeletons over layout shift:** reserve space for async content so the page does not jump.

## 4. Components — the eight states

Every interactive element and every data surface ships these or it is incomplete:

| State | Requirement |
|---|---|
| default | token-driven, no ad-hoc overrides |
| hover | surface or border shift, no layout movement |
| active | 1px press translate or darker surface |
| focus-visible | 2px ring + 2px offset, accent colored. **Never `outline: none` without a visible replacement.** |
| disabled | 40–50% opacity, `pointer-events: none`, `aria-disabled` |
| loading | skeleton for content, inline spinner only for actions under ~1s, button label swaps without width jump |
| empty | says what would be here, why it is empty, and offers exactly one action |
| error | human sentence + retry, never a raw stack trace or `Error: undefined` |

Form rules: label above input (not placeholder-as-label), helper text below, error replaces helper and is `aria-describedby`-linked, required is marked in the label not by `*` alone, and the submit button reflects pending state.

## 4b. Never ship the platform default

A browser control is not a design — it is the absence of one, and it is the fastest way for a finished page to read as a prototype.

**The test:** does the platform own this surface, or does the product? The platform owns the OS file picker in a desktop build and the share sheet on mobile. The product owns confirmation, feedback, selection, validation, navigation, and every empty state. On a surface the product owns, the browser default is a defect.

| Never ship | Ship instead |
|---|---|
| `window.confirm()` before a destructive action | the project's modal, naming the object, with a destructive-styled primary and cancel holding the default focus |
| `window.alert()` / `window.prompt()` | an inline message or a toast; a form for input |
| `<select>` with browser chrome | the project's listbox/combobox, or the styled select it already has |
| unstyled `<input type="date">` / `type="file"` | the project's date picker / drop zone, with the chosen filename shown |
| native validation bubbles as the only error UI | inline error text tied by `aria-describedby`; the bubble is a fallback, never the design |
| `title=""` as a tooltip | the project's tooltip |
| a library toast with its default theme | the project's toast: same radius, shadow, type, and placement |
| unstyled `<dialog>` | the project's modal, with focus trap, Escape, and scroll lock |
| default scrollbars inside a designed panel | a styled scrollbar, or no scroll container |

**Before building any interactive surface, inventory the project's components** (`components/`, `ui/`, a design-system folder, or the framework's kit). If one exists, use it — a second modal in one project is a defect. If none exists, build it from the §2 tokens and add it to the shared set; never inline a one-off in one page.

**The default is only correct when it is the platform's own convention** — the OS file picker in Electron, the action sheet on iOS. `confirm()` is Chromium's convention, not the user's, and it belongs to the browser rather than to your product.

## 5. The rejection list — any hit is a fail

- Purple→blue (or any) gradient used as the default surface treatment.
- Emoji standing in for icons.
- Everything centered.
- Mixed radii and mixed grays (5 near-identical grays is the classic tell).
- Drop shadows on flat cards that also have borders.
- Body text below 14px, or captions below 12px.
- Three font families, or a display font used for body copy.
- Placeholder text as the only label.
- Uniform visual weight: no clear h1/h2/body/caption distinction.
- Cramped: no 24px+ breathing room between sections, or `gap: 4px` everywhere.
- `border: 1px solid #e5e7eb` applied indiscriminately to every container.
- Multiple competing CTA styles in one viewport.
- Icon-only buttons with no `aria-label` and no tooltip.
- Fake data that pretends to be real (`Lorem ipsum`, `John Doe`, `$1,234.56`) in a demo that is meant to look finished — use plausible, category-correct content.
- A `confirm()`, `alert()`, or `prompt()` anywhere in the diff (§4b).
- An unstyled native select, date picker, or file input inside a designed form.
- Two different modals, or two toast styles, in one project.

## 6. The loop — mandatory, in this order

1. **Build** against the tokens.
2. **Screenshot** at `1440×900` (desktop) and `390×844` (mobile). Use the Playwright or devtools MCP tools when available; otherwise the project's own screenshot script.
3. **Critique with the image attached** — walk §7 line by line against the actual screenshot, and §5 against the actual code. Do not critique from memory of what you wrote.
4. **Fix**, smallest diff first.
5. **Re-screenshot.** Stop when the rubric has zero failures.

Report the UI as done only after step 5, and quote what the screenshots showed. "Looks good" without a screenshot is not a result.

**Show the screenshot inline in the reply, not just its path.** A preview the user has to go find is not a preview: attach the image in the answer (markdown image or the image tool) and keep the path only as a caption. A report that names `.work/.../raw/shot.png` and never displays it has done the work and hidden the result.

## 7. Acceptance rubric

- [ ] Every spacing/size/color value resolves to a token (§0, §2)
- [ ] ≤4 type sizes on the screen; hierarchy readable at a squint
- [ ] Contrast ≥ `4.5:1` body, ≥ `3:1` large text and UI borders
- [ ] All 8 states present on interactive elements (§4)
- [ ] Focus ring visible on every focusable element, keyboard tab order sane
- [ ] At `390px`: no horizontal scroll, tap targets ≥ `44×44`
- [ ] No hit on the rejection list (§5)
- [ ] Empty / loading / error rendered, not just the happy path
- [ ] One primary action per view
- [ ] Dark mode (if supported) is re-derived, not inverted

## 8. Fast fixes for a page that already looks cheap

In order of impact per line changed:

1. Set a consistent spacing scale and apply it — most "cheap" is inconsistent rhythm.
2. Reduce the number of font sizes from ~7 to 4, and raise body to 16px.
3. Replace 5 grays with 3 semantic roles, and tint the neutrals.
4. Remove all shadows from bordered cards; keep one elevation level for overlays only.
5. Increase section padding to 24–32 and line-height to 1.5.
6. Unify radius to one value per element type.
7. Add a real focus ring and disabled state.
8. Left-align body copy and cap the measure at 65ch.

## 9. Scope discipline

"Make it look better" means **restyle**, not rebuild. Do not change routes, data flow, or component APIs while restyling. If the structure itself is the problem (nested cards, no hierarchy, wrong information density), say so explicitly, propose the structural change, and do it as a separate step after the visual pass — mixing both makes review and rollback impossible.
