<div align="center">

# beautiful-mermaid

**Render Mermaid diagrams as beautiful SVGs or ASCII art**

Ultra-fast, fully themeable, animated, zero DOM dependencies. Built for the AI era.

![beautiful-mermaid sequence diagram example](hero.png)

[![npm version](https://img.shields.io/npm/v/beautiful-mermaid.svg)](https://www.npmjs.com/package/beautiful-mermaid)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[**Live Demo & Samples**](https://agents.craft.do/mermaid)

**[→ Use it live in Craft Agents](https://agents.craft.do)**

</div>

---

## Features

- **5 diagram types** — Flowcharts, State, Sequence, Class, and ER diagrams
- **Dual output** — SVG for rich UIs, ASCII/Unicode for terminals
- **17 built-in themes** — Including Vercel dark/light, and dead simple to add your own
- **Rank-by-rank animation** — Nodes fade in, edges draw in with traveling arrows, CSS + SMIL
- **Full Shiki compatibility** — Use any VS Code theme directly
- **Live theme switching** — CSS custom properties, no re-render needed
- **Mono mode** — Beautiful diagrams from just 2 colors
- **Zero DOM dependencies** — Pure TypeScript, works everywhere
- **Ultra-fast** — Renders 100+ diagrams in under 500ms

## Installation

```bash
npm install beautiful-mermaid
```

## Quick Start

### SVG Output

```typescript
import { renderMermaid } from 'beautiful-mermaid'

const svg = await renderMermaid(`
  graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
    B -->|No| D[End]
`)
```

### With Animation

```typescript
const svg = await renderMermaid(diagram, {
  animate: true,  // rank-by-rank animation with sane defaults
})

// Or customize:
const svg = await renderMermaid(diagram, {
  animate: {
    duration: 650,
    stagger: 0,
    nodeOverlap: 0.35,
    nodeAnimation: 'fade-up',
  },
})
```

### ASCII Output

```typescript
import { renderMermaidAscii } from 'beautiful-mermaid'

const ascii = renderMermaidAscii(`graph LR; A --> B --> C`)
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
<script src="https://unpkg.com/beautiful-mermaid/dist/beautiful-mermaid.browser.global.js"></script>
<script>
  const { renderMermaid, THEMES } = beautifulMermaid;
  renderMermaid('graph TD; A-->B', { ...THEMES['vercel-dark'], animate: true })
    .then(svg => { ... });
</script>
```

---

## Theming

### The Two-Color Foundation

Every diagram needs just two colors: **background** (`bg`) and **foreground** (`fg`):

```typescript
const svg = await renderMermaid(diagram, {
  bg: '#1a1b26',
  fg: '#a9b1d6',
})
```

Everything else is derived via `color-mix()`.

### Enriched Mode

Override specific derived colors:

```typescript
const svg = await renderMermaid(diagram, {
  bg: '#1a1b26',
  fg: '#a9b1d6',
  line: '#3d59a1',    // Edge/connector color
  accent: '#7aa2f7',  // Arrow heads, highlights
  muted: '#565f89',   // Secondary text, labels
  surface: '#292e42', // Node fill tint
  border: '#3d59a1',  // Node stroke
})
```

### Built-in Themes

17 themes ship out of the box:

```typescript
import { renderMermaid, THEMES } from 'beautiful-mermaid'

const svg = await renderMermaid(diagram, THEMES['vercel-dark'])
```

| Theme | Type | Background |
|-------|------|------------|
| `vercel-dark` | Dark | `#0A0A0A` |
| `vercel-light` | Light | `#FFFFFF` |
| `tokyo-night` | Dark | `#1a1b26` |
| `tokyo-night-storm` | Dark | `#24283b` |
| `tokyo-night-light` | Light | `#d5d6db` |
| `catppuccin-mocha` | Dark | `#1e1e2e` |
| `catppuccin-latte` | Light | `#eff1f5` |
| `nord` | Dark | `#2e3440` |
| `nord-light` | Light | `#eceff4` |
| `dracula` | Dark | `#282a36` |
| `github-light` | Light | `#ffffff` |
| `github-dark` | Dark | `#0d1117` |
| `solarized-light` | Light | `#fdf6e3` |
| `solarized-dark` | Dark | `#002b36` |
| `one-dark` | Dark | `#282c34` |
| `zinc-dark` | Dark | `#18181B` |

Default theme (when no colors provided) is Vercel dark (`#0A0A0A` / `#EDEDED`).

### Shiki Compatibility

Use any VS Code theme via Shiki:

```typescript
import { getSingletonHighlighter } from 'shiki'
import { renderMermaid, fromShikiTheme } from 'beautiful-mermaid'

const hl = await getSingletonHighlighter({ themes: ['vitesse-dark'] })
const colors = fromShikiTheme(hl.getTheme('vitesse-dark'))
const svg = await renderMermaid(diagram, colors)
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
  duration?: number        // Each element's animation duration (ms). Default: 650
  stagger?: number         // Delay between consecutive elements (ms). Default: 0
  nodeOverlap?: number     // How early node appears before incoming edge finishes
                           // (0 = wait, 0.5 = halfway, 1 = with edge). Default: 0.35
  groupDelay?: number      // Extra offset for group container (ms). Default: 110
  nodeEasing?: string      // CSS easing for nodes/groups. Default: 'ease'
  edgeEasing?: string      // CSS easing for edge draw-in + arrow travel. Default: 'ease-in-out'
  nodeAnimation?: string   // 'fade' | 'fade-up' | 'scale' | 'none'. Default: 'fade'
  edgeAnimation?: string   // 'draw' | 'fade' | 'none'. Default: 'draw'
  reducedMotion?: boolean  // Respect prefers-reduced-motion. Default: true
}
```

### Easing Design

| Element | Easing | Rationale |
|---------|--------|-----------|
| Nodes/groups | `nodeEasing` | Elements "appear" — deceleration curve |
| Edge lines | `edgeEasing` | Lines "flow" — acceleration/deceleration |
| Arrow tips | auto-derived from `edgeEasing` | SMIL `keySplines` converted from CSS cubic-bezier, guaranteed sync |
| Edge labels | `nodeEasing` | Labels are content, not motion |

### Accessibility

When `reducedMotion: true` (default), a `@media (prefers-reduced-motion: reduce)` block disables all animations, showing the diagram instantly.

---

## Layout & Styling Options

### RenderOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bg` | `string` | `#0A0A0A` | Background color |
| `fg` | `string` | `#EDEDED` | Foreground color |
| `line` | `string?` | — | Edge/connector color |
| `accent` | `string?` | — | Arrow heads, highlights |
| `muted` | `string?` | — | Secondary text, labels |
| `surface` | `string?` | — | Node fill tint |
| `border` | `string?` | — | Node stroke color |
| `font` | `string` | `Geist` | Font family |
| `fontSize` | `number` | `19.2` | Node label font size (px) |
| `fontWeight` | `number` | `400` | Node label font weight |
| `letterSpacing` | `number` | `-0.384` | Node label letter spacing (px) |
| `edgeFontSize` | `number` | `10` | Edge label font size (px) |
| `nodePaddingX` | `number` | `24` | Horizontal padding inside nodes (px) |
| `nodePaddingY` | `number` | `24` | Vertical padding inside nodes (px) |
| `cornerRadius` | `number` | `6` | Node corner radius (px) |
| `lineWidth` | `number` | `1.5` | Edge stroke width (px) |
| `edgeBendRadius` | `number` | `8` | Rounded corners on edge bends (px) |
| `padding` | `number` | `80` | Canvas padding (px) |
| `nodeSpacing` | `number` | `40` | Horizontal spacing between nodes (px) |
| `layerSpacing` | `number` | `50` | Vertical spacing between layers (px) |
| `transparent` | `boolean` | `false` | Transparent background |
| `animate` | `boolean \| AnimationOptions` | `false` | Enable animation |

### Subgraph Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `groupFont` | `string` | `Geist Mono` | Subgraph header font family |
| `groupFontSize` | `number` | `16` | Subgraph header font size (px) |
| `groupFontWeight` | `number` | `600` | Subgraph header font weight |
| `groupTextTransform` | `string` | `uppercase` | Subgraph header text transform |
| `groupCornerRadius` | `number` | `3` | Subgraph corner radius (px) |
| `groupBorderColor` | `string` | `#454545` | Subgraph border color |
| `groupPaddingX` | `number` | `32` | Subgraph horizontal padding (px) |
| `groupPaddingY` | `number` | `32` | Subgraph vertical padding (px) |

Subgraph backgrounds use a diagonal hatching pattern.

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
import { renderMermaidAscii } from 'beautiful-mermaid'

const unicode = renderMermaidAscii(`graph LR; A --> B`)
const ascii = renderMermaidAscii(`graph LR; A --> B`, { useAscii: true })
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useAscii` | `boolean` | `false` | ASCII instead of Unicode |
| `paddingX` | `number` | `5` | Horizontal node spacing |
| `paddingY` | `number` | `5` | Vertical node spacing |
| `boxBorderPadding` | `number` | `1` | Inner box padding |

---

## Attribution

ASCII rendering based on [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) by Alexander Grooff (ported from Go, extended with sequence/class/ER support).

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with care by the team at [Craft](https://craft.do)

</div>
