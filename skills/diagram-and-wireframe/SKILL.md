---
name: diagram-and-wireframe
description: Explain and agree on a change before code - wireframes for layout, flowcharts for process, sequence diagrams for interaction, ERDs for data, state machines for behaviour, C4 for system shape, all as text that lives in the repo. Use when describing how something works, before building a screen or a flow, when a plan needs a picture instead of a paragraph, and whenever the owner asks "how does it work" or "draw it first".
---

# Diagram and Wireframe

A sentence can be agreed with while meaning different things. A diagram cannot — it shows the misunderstanding in a minute, before it costs a day of code.

This is the step **before** `live-preview-gate`: the preview proves it runs; the diagram proves it is the right thing.

## Phase 1 — Pick the artifact from the question

| The question | The artifact | Tool |
|---|---|---|
| What does it look like? | **wireframe** — boxes and labels, no styling | ASCII, Excalidraw, draw.io |
| How does the process flow? | **flowchart** | Mermaid `flowchart`, D2 |
| Who talks to whom, in what order? | **sequence diagram** | Mermaid `sequenceDiagram` |
| What data exists and how does it relate? | **ERD** | Mermaid `erDiagram` |
| What states can it be in? | **state machine** | Mermaid `stateDiagram-v2` |
| How is the system split into parts? | **C4 context / container** | Structurizr, D2 |
| Where does it run? | **deployment diagram** | C4 deployment, D2 |

**One diagram answers one question.** If it needs a ten-item legend, it is three diagrams.

## Phase 2 — Text first, so the diagram lives in the repo

Mermaid, D2, Graphviz and PlantUML are **text**: diffable, reviewable in a pull request, renderable in GitHub and in most editors.

```text
docs/diagrams/
├── checkout-flow.mmd          the source
├── data-model.mmd
├── system-context.d2
└── out/                       rendered svg/png, per project policy
```

- **Commit the source.** A PNG alone cannot be edited, reviewed or diffed.
- **ASCII** for anything that must survive a terminal, a plain README, or a paste into a chat.
- Name the file after the question it answers, not after the system (`checkout-flow`, not `diagram2`).

**EVIDENCE: the source file path, committed.**

## Phase 3 — Render it and show it inline

```bash
# Mermaid
npx @mermaid-js/mermaid-cli -i docs/diagrams/checkout-flow.mmd -o docs/diagrams/out/checkout-flow.svg
# D2
d2 docs/diagrams/system-context.d2 docs/diagrams/out/system-context.svg
# Graphviz
dot -Tsvg docs/diagrams/graph.dot -o docs/diagrams/out/graph.svg
# PlantUML
plantuml -tsvg docs/diagrams/sequence.puml
```

- **Show the rendered image in the reply** (`![checkout flow](docs/diagrams/out/checkout-flow.svg)`), not only the path.
- If a renderer is unavailable, show the **Mermaid source in a fenced block** — GitHub and most chat clients render it — and say that it was not rendered locally.
- Never describe a diagram you did not produce.

**EVIDENCE: the rendered image inline, or the source block plus the reason it is not rendered.**

## Phase 4 — The wireframe rule — before any UI code

A wireframe answers **structure**, not taste. That is why it is deliberately plain:

- **Boxes and labels.** No color, no shadows, no fonts, no images.
- **Every box is labeled** with what the user sees there.
- **The three states that always get skipped**: empty, loading, error.
- **The primary action** marked, one per screen.
- **Approved before the first line of UI code.** A structural change after the build is a rewrite; after the wireframe it is a redraw.

```text
┌──────────────────────────────────────────────┐
│ Invoices                      [New invoice]  │
├──────────────────────────────────────────────┤
│ Search [__________]  Status: [All ▾]         │
├──────────────────────────────────────────────┤
│ #1042  Acme Ltd      ₱12,400   Overdue       │
│ #1041  Blue Corp     ₱ 3,900   Paid          │
│ …                                            │
├──────────────────────────────────────────────┤
│ empty: "No invoices yet — create the first"  │
│ loading: 5 skeleton rows                     │
│ error: "Could not load — retry"              │
└──────────────────────────────────────────────┘
```

**EVIDENCE: the wireframe, and the owner's approval of the structure before code.**

## Phase 5 — Diagram standards

- **One question per diagram**, and the title is that question.
- **At most nine nodes** on one diagram; split beyond that.
- **Boxes are nouns, arrows are verbs.** An unlabeled arrow is a defect.
- **No crossing lines** where it can be avoided; no diagonal spaghetti.
- **Legend** whenever a shape, color or border carries meaning.
- **External systems labeled** with what they are, not just a grey box.
- **Version and date** in a comment at the top of the source — a diagram without one lies eventually.

**EVIDENCE: the source header, and a read-back of every arrow label.**

## Phase 6 — The diagram as the instruction

For "how it works" documentation, a diagram plus a numbered walkthrough beats three paragraphs:

> **1.** The client posts to `/checkout` **(1)**. **2.** The API validates and creates the order **(2)**. **3.** The payment provider authorises **(3)**, and a webhook confirms **(4)**. **4.** On confirmation the order is settled and the receipt is queued **(5)**.

The numbers refer to nodes in the diagram. A reader who has the picture can follow the prose; without it, the prose is a puzzle.

**EVIDENCE: the numbered walkthrough plus the matching diagram.**

## Anti-default table

| Default | The shipped answer |
|---|---|
| A prose paragraph describing an architecture | a C4 container diagram |
| A screenshot of a slide | a text diagram committed to the repo |
| A hi-fi mockup before the structure is agreed | a low-fidelity wireframe first |
| One giant diagram of everything | one diagram per question |
| Unlabeled arrows | verbs on every edge |
| PNG only | source + export, both committed |
| "Here is the design" in chat | the image inline, before code |
| States described in prose | empty, loading and error drawn |

## Definition of done

- The artifact matches the question (wireframe, flow, sequence, ERD, state, C4).
- The text source is committed under `docs/diagrams/`.
- The rendered image is shown inline in the reply.
- A wireframe was approved before UI code, with empty, loading and error drawn.
- Every box is labeled and every arrow has a verb.

## Failure modes

1. **Prose instead of a diagram** — agreed with, misunderstood, rebuilt.
2. **One diagram, three questions** — unreadable, and nobody notices which part is wrong.
3. **Hi-fi mockup first** — the feedback is about color, and the structure ships broken.
4. **PNG only** — nobody can edit it, so it goes stale immediately.
5. **Unlabeled arrows** — the reader invents the meaning, and the code follows the invention.
6. **A diagram with no date or version** — it is trusted long after it stopped being true.

## Sources — verified live 2026-10-30

- [Mermaid](https://github.com/mermaid-js/mermaid) — text-to-diagram syntax that renders in GitHub.
- [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli) — the render command used in Phase 3.
- [D2](https://d2lang.com/) — declarative diagrams aimed at architecture.
- [Graphviz](https://graphviz.org/) — the DOT language and layout engines.
- [PlantUML](https://plantuml.com/) — UML sequence, class and state diagrams from text.
- [C4 model](https://c4model.com/) — the context/container/component levels used for system shape.
- [Structurizr](https://www.structurizr.com/) — C4 as a model, with exported views.
- [Excalidraw](https://excalidraw.com/) and [draw.io](https://www.drawio.com/) — hand-drawn and precise wireframing, both export SVG.
- [ASCIIFlow](https://asciiflow.com/) — wireframes that survive a terminal or a chat message.
