<div align="center">

# @vercel/beautiful-mermaid

**Render Mermaid diagrams as beautiful SVGs or ASCII art**

Ultra-fast, fully themeable, zero DOM dependencies. Vercel-themed by default.

![beautiful-mermaid sequence diagram example](hero.png)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Vercel's fork of [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) by [Craft](https://craft.do). Adds rank-by-rank animation (CSS + SMIL), Vercel dark/light themes, Geist typography, and fully configurable styling.

</div>

---

## Features

- **5 diagram types** — Flowcharts, State, Sequence, Class, and ER diagrams
- **Dual output** — SVG for rich UIs, ASCII/Unicode for terminals
- **16 built-in themes** — Vercel dark/light default, plus 14 community themes
- **Rank-by-rank animation** — Nodes fade in, edges draw in with traveling arrows, CSS + SMIL
- **Full Shiki compatibility** — Use any VS Code theme directly
- **Live theme switching** — CSS custom properties, no re-render needed
- **Mono mode** — Beautiful diagrams from just 2 colors
- **Zero DOM dependencies** — Pure TypeScript, works everywhere
- **Ultra-fast** — Renders 100+ diagrams in under 500ms

## Installation

```bash
npm install @vercel/beautiful-mermaid
```

## Quick Start

### SVG Output

Renders with Vercel dark theme (`#0A0A0A` / `#EDEDED`) and Geist font by default — no configuration needed.

```typescript
import { renderMermaid } from "@vercel/beautiful-mermaid";

const svg = await renderMermaid(`
  graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
`);
```

### With Animation

```typescript
const svg = await renderMermaid(diagram, {
  animate: true, // rank-by-rank animation with sane defaults
});

// Or customize:
const svg = await renderMermaid(diagram, {
  animate: {
    duration: 650,
    stagger: 0,
    nodeOverlap: 0.35,
    nodeAnimation: "fade-up",
  },
});
```

### ASCII Output

```typescript
import { renderMermaidAscii } from "@vercel/beautiful-mermaid";

const ascii = renderMermaidAscii(`graph LR; A --> B --> C`);
```

```
┌───┐     ┌───┐     ┌───┐
│   │     │   │     │   │
│ A │────►│ B │────►│ C │
│   │     │   │     │   │
└───┘     └───┘     └───┘
```

### Browser (Script Tag)

```html
<script src="https://unpkg.com/@vercel/beautiful-mermaid/dist/beautiful-mermaid.browser.global.js"></script>
<script>
  const { renderMermaid, THEMES } = beautifulMermaid;
  renderMermaid('graph TD; A-->B', { ...THEMES['vercel-dark'], animate: true })
    .then(svg => { ... });
</script>
```

---

## Theming

### The Two-Color Foundation

Every diagram needs just two colors: **background** (`bg`) and **foreground** (`fg`). Everything else is derived via `color-mix()`:

```typescript
// Vercel dark is the default — this is what you get with no options
const svg = await renderMermaid(diagram);

// Or specify any bg/fg pair for a coherent mono diagram
const svg = await renderMermaid(diagram, {
  bg: "#0A0A0A",
  fg: "#EDEDED",
});
```

### Enriched Mode

Override specific derived colors for richer themes. Vercel dark ships with full enrichment:

```typescript
const svg = await renderMermaid(diagram, {
  bg: "#0A0A0A",
  fg: "#EDEDED",
  line: "#EDEDED", // Edge/connector color
  accent: "#EDEDED", // Arrow heads, highlights
  muted: "#888888", // Secondary text, labels
  surface: "#0A0A0A", // Node fill tint
  border: "#454545", // Node stroke
});
```

### Shiki Compatibility

Use any VS Code theme via Shiki:

```typescript
import { getSingletonHighlighter } from "shiki";
import { renderMermaid, fromShikiTheme } from "@vercel/beautiful-mermaid";

const hl = await getSingletonHighlighter({ themes: ["vitesse-dark"] });
const colors = fromShikiTheme(hl.getTheme("vitesse-dark"));
const svg = await renderMermaid(diagram, colors);
```

---

## Animation

Pass `animate: true` for rank-by-rank animation with sane defaults, or customize with `AnimationOptions`.

### How It Works

- **Nodes** fade in rank-by-rank (top → bottom)
- **Edges** draw in via `stroke-dashoffset` with `pathLength="1"`
- **Arrow tips** travel along the path via SMIL `<animateMotion>`, synced with edge easing
- **Subgroups** fade in after their contents are mostly visible
- **Cascade**: source node → edge draws → target node appears (with configurable overlap)

All CSS-based (works in standalone SVG files, no JS runtime needed). SMIL used only for arrow travel.

### AnimationOptions

```typescript
interface AnimationOptions {
  duration?: number; // Each element's animation duration (ms). Default: 650
  stagger?: number; // Delay between consecutive elements (ms). Default: 0
  nodeOverlap?: number; // How early node appears before incoming edge finishes
  // (0 = wait, 0.5 = halfway, 1 = with edge). Default: 0.35
  groupDelay?: number; // Extra offset for group container (ms). Default: 110
  nodeEasing?: string; // CSS easing for nodes/groups. Default: 'ease'
  edgeEasing?: string; // CSS easing for edge draw-in + arrow travel. Default: 'ease-in-out'
  nodeAnimation?: string; // 'fade' | 'fade-up' | 'scale' | 'none'. Default: 'fade'
  edgeAnimation?: string; // 'draw' | 'fade' | 'none'. Default: 'draw'
  reducedMotion?: boolean; // Respect prefers-reduced-motion. Default: true
}
```

### Easing Design

| Element      | Easing                         | Rationale                                                          |
| ------------ | ------------------------------ | ------------------------------------------------------------------ |
| Nodes/groups | `nodeEasing`                   | Elements "appear" — deceleration curve                             |
| Edge lines   | `edgeEasing`                   | Lines "flow" — acceleration/deceleration                           |
| Arrow tips   | auto-derived from `edgeEasing` | SMIL `keySplines` converted from CSS cubic-bezier, guaranteed sync |
| Edge labels  | `nodeEasing`                   | Labels are content, not motion                                     |

### Accessibility

When `reducedMotion: true` (default), a `@media (prefers-reduced-motion: reduce)` block disables all animations, showing the diagram instantly.

---

## Supported Diagrams

### Flowcharts

```
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Process]
  B -->|No| D[End]
```

All directions: `TD`, `LR`, `BT`, `RL`. Subgraphs supported.

### State Diagrams

```
stateDiagram-v2
  [*] --> Idle
  Idle --> Processing: start
  Processing --> Complete: done
  Complete --> [*]
```

### Sequence Diagrams

```
sequenceDiagram
  Alice->>Bob: Hello Bob!
  Bob-->>Alice: Hi Alice!
```

### Class Diagrams

```
classDiagram
  Animal <|-- Duck
  Animal: +int age
  Duck: +swim()
```

### ER Diagrams

```
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
```

---

## ASCII Output

```typescript
import { renderMermaidAscii } from "@vercel/beautiful-mermaid";

const unicode = renderMermaidAscii(`graph LR; A --> B`);
const ascii = renderMermaidAscii(`graph LR; A --> B`, { useAscii: true });
```

| Option             | Type      | Default | Description              |
| ------------------ | --------- | ------- | ------------------------ |
| `useAscii`         | `boolean` | `false` | ASCII instead of Unicode |
| `paddingX`         | `number`  | `5`     | Horizontal node spacing  |
| `paddingY`         | `number`  | `5`     | Vertical node spacing    |
| `boxBorderPadding` | `number`  | `1`     | Inner box padding        |

---

## Attribution

ASCII rendering based on [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) by Alexander Grooff (ported from Go, extended with sequence/class/ER support).

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Based on [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) by [Craft](https://craft.do)

</div>
