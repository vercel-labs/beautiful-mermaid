// ============================================================================
// Parsed graph — logical structure extracted from Mermaid text
// ============================================================================

export interface MermaidGraph {
  direction: Direction
  nodes: Map<string, MermaidNode>
  edges: MermaidEdge[]
  subgraphs: MermaidSubgraph[]
  classDefs: Map<string, Record<string, string>>
  /** Maps node IDs to their class names (from `class X className` or `:::className` shorthand) */
  classAssignments: Map<string, string>
  /** Maps node IDs to inline styles (from `style X fill:#f00,stroke:#333`) */
  nodeStyles: Map<string, Record<string, string>>
}

export type Direction = 'TD' | 'TB' | 'LR' | 'BT' | 'RL'

export interface MermaidNode {
  id: string
  label: string
  shape: NodeShape
}

export type NodeShape =
  | 'rectangle'
  | 'rounded'
  | 'diamond'
  | 'stadium'
  | 'circle'
  // Batch 1 additions
  | 'subroutine'     // [[text]]  — double-bordered rectangle
  | 'doublecircle'   // (((text))) — concentric circles
  | 'hexagon'        // {{text}}  — six-sided polygon
  // Batch 2 additions
  | 'cylinder'       // [(text)]  — database cylinder
  | 'asymmetric'     // >text]    — flag/banner shape
  | 'trapezoid'      // [/text\]  — wider bottom
  | 'trapezoid-alt'  // [\text/]  — wider top
  // Batch 3 state diagram pseudostates
  | 'state-start'    // filled circle (start pseudostate)
  | 'state-end'      // bullseye circle (end pseudostate)

export interface MermaidEdge {
  source: string
  target: string
  label?: string
  style: EdgeStyle
  /** Whether to render an arrowhead at the start (source end) of the edge */
  hasArrowStart: boolean
  /** Whether to render an arrowhead at the end (target end) of the edge */
  hasArrowEnd: boolean
}

export type EdgeStyle = 'solid' | 'dotted' | 'thick'

export interface MermaidSubgraph {
  id: string
  label: string
  nodeIds: string[]
  children: MermaidSubgraph[]
  /** Optional direction override for this subgraph's internal layout */
  direction?: Direction
}

// ============================================================================
// Positioned graph — after dagre layout, ready for SVG rendering
// ============================================================================

export interface PositionedGraph {
  width: number
  height: number
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  groups: PositionedGroup[]
}

export interface PositionedNode {
  id: string
  label: string
  shape: NodeShape
  x: number
  y: number
  width: number
  height: number
  /** Inline styles resolved from classDef + explicit `style` statements — override theme defaults */
  inlineStyle?: Record<string, string>
  /** Dagre rank (0 = first layer). Used for animation sequencing. */
  rank?: number
}

export interface PositionedEdge {
  source: string
  target: string
  label?: string
  style: EdgeStyle
  hasArrowStart: boolean
  hasArrowEnd: boolean
  /** Full path including bends — array of {x, y} points */
  points: Point[]
  /** Layout-computed label center position (avoids label-label collisions) */
  labelPosition?: Point
  /** Source node rank. Used for animation sequencing. */
  sourceRank?: number
  /** Target node rank. Used for animation sequencing. */
  targetRank?: number
}

export interface Point {
  x: number
  y: number
}

export interface PositionedGroup {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  children: PositionedGroup[]
  /** Min rank of contained nodes. Used for animation sequencing. */
  rank?: number
}

// ============================================================================
// Render options — user-facing configuration
//
// Color theming uses CSS custom properties: --bg and --fg are required,
// optional enrichment variables (--line, --accent, --muted, --surface,
// --border) add richer color from Shiki themes or custom palettes.
// See src/theme.ts for the full variable system.
// ============================================================================

export interface RenderOptions {
  /** Background color → CSS variable --bg. Default: '#FFFFFF' */
  bg?: string
  /** Foreground / primary text color → CSS variable --fg. Default: '#27272A' */
  fg?: string

  // -- Optional enrichment colors (fall back to color-mix from bg/fg) --

  /** Edge/connector color → CSS variable --line */
  line?: string
  /** Arrow heads, highlights → CSS variable --accent */
  accent?: string
  /** Secondary text, edge labels → CSS variable --muted */
  muted?: string
  /** Node/box fill tint → CSS variable --surface */
  surface?: string
  /** Node/group stroke color → CSS variable --border */
  border?: string

  /** Font family for all text. Default: 'Inter' */
  font?: string
  /** Canvas padding in px. Default: 40 */
  padding?: number
  /** Horizontal spacing between sibling nodes. Default: 24 */
  nodeSpacing?: number
  /** Vertical spacing between layers. Default: 40 */
  layerSpacing?: number
  /** Render with transparent background (no background style on SVG). Default: false */
  transparent?: boolean

  // -- Typography overrides (override hardcoded FONT_SIZES) --

  /** Node label font size in px. Default: 13 */
  fontSize?: number
  /** Edge label font size in px. Default: 11 */
  edgeFontSize?: number
  /** Node label font weight. Default: 500 */
  fontWeight?: number
  /** Letter spacing in px (e.g. -0.384). Default: 0 */
  letterSpacing?: number

  // -- Node padding overrides (override hardcoded NODE_PADDING) --

  /** Horizontal padding inside node shapes in px. Default: 16 */
  nodePaddingX?: number
  /** Vertical padding inside node shapes in px. Default: 10 */
  nodePaddingY?: number
  /** Corner radius for rectangular node shapes in px. Default: 0 */
  cornerRadius?: number
  /** Stroke width for edge/connector lines in px. Default: 0.75 */
  lineWidth?: number
  /** Radius for rounded corners on edge bends in px. 0 = sharp corners. Default: 0 */
  edgeBendRadius?: number
  /** Subgraph header font size in px. Default: 12 */
  groupFontSize?: number
  /** Subgraph header font weight. Default: 600 */
  groupFontWeight?: number
  /** Subgraph header font family override (e.g. 'Geist Mono'). Falls back to main font. */
  groupFont?: string
  /** Subgraph header text transform (e.g. 'uppercase'). Default: none */
  groupTextTransform?: string
  /** Subgraph corner radius in px. Default: 0 */
  groupCornerRadius?: number
  /** Subgraph border color. Default: var(--_node-stroke) */
  groupBorderColor?: string
  /** Subgraph vertical (block) padding in px. Default: 12 */
  groupPaddingY?: number
  /** Subgraph horizontal (inline) padding in px. Default: 16 */
  groupPaddingX?: number

  /** Animation configuration. Pass `true` for defaults or an object to customize. */
  animate?: boolean | AnimationOptions
}

// ============================================================================
// Animation options
// ============================================================================

export interface AnimationOptions {
  /** Duration of each element's animation in ms. Default: 600 */
  duration?: number
  /** Delay between consecutive elements in ms. Within-rank stagger is derived as stagger * 0.5. Default: 80 */
  stagger?: number
  /** Extra offset for when group container appears in ms. Default: -60 */
  groupDelay?: number
  /** How early a node starts appearing before its incoming edge finishes, as a fraction of duration (0 = wait for edge, 0.5 = start halfway through edge, 1 = start with edge). Default: 0.3 */
  nodeOverlap?: number
  /** Easing for node/group enter animations. Default: 'cubic-bezier(0.16, 1, 0.3, 1)' (expo-out — fast appear, gentle settle) */
  nodeEasing?: string
  /** Easing for edge draw-in + arrow travel. Must be a cubic-bezier for arrow sync. Default: 'cubic-bezier(0.65, 0, 0.35, 1)' (smooth flow) */
  edgeEasing?: string
  /** Node entrance animation. Default: 'fade' */
  nodeAnimation?: 'fade' | 'fade-up' | 'scale' | 'none'
  /** Edge entrance animation. Default: 'draw' */
  edgeAnimation?: 'draw' | 'fade' | 'none'
  /** Respect prefers-reduced-motion. Default: true */
  reducedMotion?: boolean
}
