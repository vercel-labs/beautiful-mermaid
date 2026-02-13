interface MermaidGraph {
    direction: Direction;
    nodes: Map<string, MermaidNode>;
    edges: MermaidEdge[];
    subgraphs: MermaidSubgraph[];
    classDefs: Map<string, Record<string, string>>;
    /** Maps node IDs to their class names (from `class X className` or `:::className` shorthand) */
    classAssignments: Map<string, string>;
    /** Maps node IDs to inline styles (from `style X fill:#f00,stroke:#333`) */
    nodeStyles: Map<string, Record<string, string>>;
}
type Direction = 'TD' | 'TB' | 'LR' | 'BT' | 'RL';
interface MermaidNode {
    id: string;
    label: string;
    shape: NodeShape;
}
type NodeShape = 'rectangle' | 'rounded' | 'diamond' | 'stadium' | 'circle' | 'subroutine' | 'doublecircle' | 'hexagon' | 'cylinder' | 'asymmetric' | 'trapezoid' | 'trapezoid-alt' | 'state-start' | 'state-end';
interface MermaidEdge {
    source: string;
    target: string;
    label?: string;
    style: EdgeStyle;
    /** Whether to render an arrowhead at the start (source end) of the edge */
    hasArrowStart: boolean;
    /** Whether to render an arrowhead at the end (target end) of the edge */
    hasArrowEnd: boolean;
}
type EdgeStyle = 'solid' | 'dotted' | 'thick';
interface MermaidSubgraph {
    id: string;
    label: string;
    nodeIds: string[];
    children: MermaidSubgraph[];
    /** Optional direction override for this subgraph's internal layout */
    direction?: Direction;
}
interface PositionedGraph {
    width: number;
    height: number;
    nodes: PositionedNode[];
    edges: PositionedEdge[];
    groups: PositionedGroup[];
}
interface PositionedNode {
    id: string;
    label: string;
    shape: NodeShape;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Inline styles resolved from classDef + explicit `style` statements — override theme defaults */
    inlineStyle?: Record<string, string>;
    /** Dagre rank (0 = first layer). Used for animation sequencing. */
    rank?: number;
}
interface PositionedEdge {
    source: string;
    target: string;
    label?: string;
    style: EdgeStyle;
    hasArrowStart: boolean;
    hasArrowEnd: boolean;
    /** Full path including bends — array of {x, y} points */
    points: Point[];
    /** Layout-computed label center position (avoids label-label collisions) */
    labelPosition?: Point;
    /** Source node rank. Used for animation sequencing. */
    sourceRank?: number;
    /** Target node rank. Used for animation sequencing. */
    targetRank?: number;
}
interface Point {
    x: number;
    y: number;
}
interface PositionedGroup {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    children: PositionedGroup[];
    /** Min rank of contained nodes. Used for animation sequencing. */
    rank?: number;
}
interface RenderOptions {
    /** Background color → CSS variable --bg. Default: '#FFFFFF' */
    bg?: string;
    /** Foreground / primary text color → CSS variable --fg. Default: '#27272A' */
    fg?: string;
    /** Edge/connector color → CSS variable --line */
    line?: string;
    /** Arrow heads, highlights → CSS variable --accent */
    accent?: string;
    /** Secondary text, edge labels → CSS variable --muted */
    muted?: string;
    /** Node/box fill tint → CSS variable --surface */
    surface?: string;
    /** Node/group stroke color → CSS variable --border */
    border?: string;
    /** Font family for all text. Default: 'Inter' */
    font?: string;
    /** Canvas padding in px. Default: 40 */
    padding?: number;
    /** Horizontal spacing between sibling nodes. Default: 24 */
    nodeSpacing?: number;
    /** Vertical spacing between layers. Default: 40 */
    layerSpacing?: number;
    /** Render with transparent background (no background style on SVG). Default: false */
    transparent?: boolean;
    /** Node label font size in px. Default: 13 */
    fontSize?: number;
    /** Edge label font size in px. Default: 11 */
    edgeFontSize?: number;
    /** Node label font weight. Default: 500 */
    fontWeight?: number;
    /** Letter spacing in px (e.g. -0.384). Default: 0 */
    letterSpacing?: number;
    /** Horizontal padding inside node shapes in px. Default: 16 */
    nodePaddingX?: number;
    /** Vertical padding inside node shapes in px. Default: 10 */
    nodePaddingY?: number;
    /** Corner radius for rectangular node shapes in px. Default: 0 */
    cornerRadius?: number;
    /** Stroke width for edge/connector lines in px. Default: 0.75 */
    lineWidth?: number;
    /** Radius for rounded corners on edge bends in px. 0 = sharp corners. Default: 0 */
    edgeBendRadius?: number;
    /** Subgraph header font size in px. Default: 12 */
    groupFontSize?: number;
    /** Subgraph header font weight. Default: 600 */
    groupFontWeight?: number;
    /** Subgraph header font family override (e.g. 'Geist Mono'). Falls back to main font. */
    groupFont?: string;
    /** Subgraph header text transform (e.g. 'uppercase'). Default: none */
    groupTextTransform?: string;
    /** Subgraph corner radius in px. Default: 0 */
    groupCornerRadius?: number;
    /** Subgraph border color. Default: var(--_node-stroke) */
    groupBorderColor?: string;
    /** Subgraph vertical (block) padding in px. Default: 12 */
    groupPaddingY?: number;
    /** Subgraph horizontal (inline) padding in px. Default: 16 */
    groupPaddingX?: number;
    /** Animation configuration. Pass `true` for defaults or an object to customize. */
    animate?: boolean | AnimationOptions;
}
interface AnimationOptions {
    /** Duration of each element's animation in ms. Default: 600 */
    duration?: number;
    /** Delay between consecutive elements in ms. Within-rank stagger is derived as stagger * 0.5. Default: 80 */
    stagger?: number;
    /** Extra offset for when group container appears in ms. Default: -60 */
    groupDelay?: number;
    /** How early a node starts appearing before its incoming edge finishes, as a fraction of duration (0 = wait for edge, 0.5 = start halfway through edge, 1 = start with edge). Default: 0.3 */
    nodeOverlap?: number;
    /** Easing for node/group enter animations. Default: 'cubic-bezier(0.16, 1, 0.3, 1)' (expo-out — fast appear, gentle settle) */
    nodeEasing?: string;
    /** Easing for edge draw-in + arrow travel. Must be a cubic-bezier for arrow sync. Default: 'cubic-bezier(0.65, 0, 0.35, 1)' (smooth flow) */
    edgeEasing?: string;
    /** Node entrance animation. Default: 'fade' */
    nodeAnimation?: 'fade' | 'fade-up' | 'scale' | 'none';
    /** Edge entrance animation. Default: 'draw' */
    edgeAnimation?: 'draw' | 'fade' | 'none';
    /** Respect prefers-reduced-motion. Default: true */
    reducedMotion?: boolean;
}

/**
 * Diagram color configuration.
 *
 * Required: bg + fg give you a clean mono diagram.
 * Optional: line, accent, muted, surface, border bring in richer color
 * from Shiki themes or custom palettes. Each falls back to a color-mix()
 * derivation from bg + fg if not set.
 */
interface DiagramColors {
    /** Background color → CSS variable --bg */
    bg: string;
    /** Foreground / primary text color → CSS variable --fg */
    fg: string;
    /** Edge/connector color → CSS variable --line */
    line?: string;
    /** Arrow heads, highlights, special nodes → CSS variable --accent */
    accent?: string;
    /** Secondary text, edge labels → CSS variable --muted */
    muted?: string;
    /** Node/box fill tint → CSS variable --surface */
    surface?: string;
    /** Node/group stroke color → CSS variable --border */
    border?: string;
}
/** Default colors when none provided (Vercel dark) */
declare const DEFAULTS: Readonly<{
    bg: string;
    fg: string;
}>;
declare const THEMES: Record<string, DiagramColors>;
type ThemeName = keyof typeof THEMES;
/**
 * Minimal subset of Shiki's ThemeRegistrationResolved that we need.
 * We don't import from shiki to avoid a hard dependency.
 */
interface ShikiThemeLike {
    type?: string;
    colors?: Record<string, string>;
    tokenColors?: Array<{
        scope?: string | string[];
        settings?: {
            foreground?: string;
        };
    }>;
}
/**
 * Extract diagram colors from a Shiki theme object.
 * Works with any VS Code / TextMate theme loaded by Shiki.
 *
 * Maps editor UI colors to diagram roles:
 *   editor.background         → bg
 *   editor.foreground         → fg
 *   editorLineNumber.fg       → line (optional)
 *   focusBorder / keyword     → accent (optional)
 *   comment token             → muted (optional)
 *   editor.selectionBackground→ surface (optional)
 *   editorWidget.border       → border (optional)
 *
 * @example
 * ```ts
 * import { getSingletonHighlighter } from 'shiki'
 * import { fromShikiTheme } from 'beautiful-mermaid'
 *
 * const hl = await getSingletonHighlighter({ themes: ['tokyo-night'] })
 * const colors = fromShikiTheme(hl.getTheme('tokyo-night'))
 * const svg = await renderMermaid(code, colors)
 * ```
 */
declare function fromShikiTheme(theme: ShikiThemeLike): DiagramColors;

/**
 * Parse Mermaid text into a logical graph structure.
 * Auto-detects diagram type (flowchart or state diagram).
 * Throws on invalid/unsupported input.
 */
declare function parseMermaid(text: string): MermaidGraph;

interface AsciiRenderOptions {
    /** true = ASCII chars (+,-,|,>), false = Unicode box-drawing (┌,─,│,►). Default: false */
    useAscii?: boolean;
    /** Horizontal spacing between nodes. Default: 5 */
    paddingX?: number;
    /** Vertical spacing between nodes. Default: 5 */
    paddingY?: number;
    /** Padding inside node boxes. Default: 1 */
    boxBorderPadding?: number;
}
/**
 * Render Mermaid diagram text to an ASCII/Unicode string.
 *
 * Synchronous — no async layout engine needed (unlike the SVG renderer).
 * Auto-detects diagram type from the header line and dispatches to
 * the appropriate renderer.
 *
 * @param text - Mermaid source text (any supported diagram type)
 * @param options - Rendering options
 * @returns Multi-line ASCII/Unicode string
 *
 * @example
 * ```ts
 * const result = renderMermaidAscii(`
 *   graph LR
 *     A --> B --> C
 * `, { useAscii: true })
 *
 * // Output:
 * // +---+     +---+     +---+
 * // |   |     |   |     |   |
 * // | A |---->| B |---->| C |
 * // |   |     |   |     |   |
 * // +---+     +---+     +---+
 * ```
 */
declare function renderMermaidAscii(text: string, options?: AsciiRenderOptions): string;

/**
 * Render Mermaid diagram text to an SVG string.
 *
 * Async because layout engines run asynchronously.
 * Auto-detects diagram type from the header line.
 *
 * Colors are set via CSS custom properties on the <svg> tag:
 *   - bg/fg: Required base colors (default: white/#27272A)
 *   - line/accent/muted/surface/border: Optional enrichment colors
 *     (fall back to color-mix() derivations from bg+fg)
 *
 * @param text - Mermaid source text
 * @param options - Rendering options (colors, font, spacing)
 * @returns A self-contained SVG string
 *
 * @example
 * ```ts
 * // Mono — just defaults, everything derived from bg+fg
 * const svg = await renderMermaid('graph TD\n  A --> B')
 *
 * // Custom colors
 * const svg = await renderMermaid('graph TD\n  A --> B', {
 *   bg: '#1a1b26', fg: '#a9b1d6'
 * })
 *
 * // Enriched — Tokyo Night with accent + line colors
 * const svg = await renderMermaid('graph TD\n  A --> B', {
 *   bg: '#1a1b26', fg: '#a9b1d6',
 *   line: '#3d59a1', accent: '#7aa2f7', muted: '#565f89',
 * })
 * ```
 */
declare function renderMermaid(text: string, options?: RenderOptions): Promise<string>;

export { type AnimationOptions, type AsciiRenderOptions, DEFAULTS, type DiagramColors, type MermaidGraph, type PositionedGraph, type RenderOptions, THEMES, type ThemeName, fromShikiTheme, parseMermaid, renderMermaid, renderMermaidAscii };
