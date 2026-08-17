// ============================================================================
// Font metrics — character width estimates for Inter at different sizes.
// Used to approximate text bounding boxes without DOM measurement.
// These are calibrated for Inter's typical glyph widths.
//
// NOTE: Theme/color system has moved to src/theme.ts. This file only
// contains font metrics, spacing constants, and stroke widths.
// ============================================================================

/** Average character width in px at the given font size and weight (proportional font) */
export function estimateTextWidth(text: string, fontSize: number, fontWeight: number): number {
  // Inter average character widths as fraction of fontSize, per weight.
  // Heavier weights are slightly wider.
  const widthRatio = fontWeight >= 600 ? 0.58 : fontWeight >= 500 ? 0.55 : 0.52
  return text.length * fontSize * widthRatio
}

/** Average character width in px for monospace fonts (uniform glyph width) */
export function estimateMonoTextWidth(text: string, fontSize: number): number {
  // Monospace fonts have uniform character width — 0.6 of fontSize matches actual
  // glyph widths for JetBrains Mono / SF Mono / Fira Code at small sizes (11px).
  // Previous value of 0.55 underestimated widths, causing class member labels to
  // extend beyond their box boundaries.
  return text.length * fontSize * 0.6
}

/** Format human-readable edge labels without altering their Mermaid source. */
export function titleCaseEdgeLabel(text: string): string {
  const matches = [...text.matchAll(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)]
  if (matches.length === 0) return text

  const minorWords = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
    'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'vs',
  ])
  let cursor = 0
  let result = ''

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]!
    const word = match[0]
    const start = match.index!
    result += text.slice(cursor, start)

    const hasIntentionalCase = /[A-Z]/.test(word.slice(1)) || /^[A-Z0-9]{2,}$/.test(word)
    const previousText = text.slice(cursor, start).trimEnd()
    const followsStrongSeparator = previousText.endsWith('/') || previousText.endsWith(':')
    const lower = word.toLowerCase()
    const isMinor = minorWords.has(lower) && index > 0 && index < matches.length - 1 && !followsStrongSeparator

    if (hasIntentionalCase) {
      result += word
    } else if (isMinor) {
      result += lower
    } else {
      result += word
        .split('-')
        .map(part => part ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part)
        .join('-')
    }
    cursor = start + word.length
  }

  return result + text.slice(cursor)
}

/** Monospace font family used for code-like text (class members, types) */
export const MONO_FONT = "'JetBrains Mono'" as const

/** Full CSS fallback chain for monospace text */
export const MONO_FONT_STACK = `${MONO_FONT}, 'SF Mono', 'Fira Code', ui-monospace, monospace` as const

/** Fixed font sizes used in the renderer (in px) */
export const FONT_SIZES = {
  /** Node label text */
  nodeLabel: 19.2,
  /** Edge label text */
  edgeLabel: 14,
  /** Subgraph header text */
  groupHeader: 16,
} as const

/** Font weights used per element type */
export const FONT_WEIGHTS = {
  nodeLabel: 400,
  edgeLabel: 400,
  groupHeader: 600,
} as const

// ============================================================================
// Spacing & sizing constants
// ============================================================================

/** Vertical gap between a subgraph header band and the content area below it (px).
 * Without this, nested subgraph headers sit flush against their parent's header band. */
export const GROUP_HEADER_CONTENT_PAD = 8

/** Padding inside node shapes */
export const NODE_PADDING = {
  /** Horizontal padding inside rectangles/rounded/stadium */
  horizontal: 28,
  /** Vertical padding inside rectangles/rounded/stadium */
  vertical: 18,
  /** Extra padding for diamond shapes (they need more space due to rotation) */
  diamondExtra: 24,
} as const

/**
 * Edge-label geometry shared by layout and rendering.
 *
 * Dagre treats an edge label as an obstacle in the graph. The layout box must
 * therefore include the rendered pill plus enough clearance on every side.
 * This protects both straight connections and labels placed at bends, while
 * keeping neighboring branches from grazing a long label.
 */
export const EDGE_LABEL_SPACING = {
  paddingX: 14,
  paddingY: 8,
  /** Minimum visible connector on either side of the label pill. */
  clearance: 24,
} as const

/** Stroke widths per element type (in px) */
export const STROKE_WIDTHS = {
  outerBox: 1,
  innerBox: 0.75,
  connector: 1.5,
} as const

/**
 * Vertical shift applied to all text elements for font-agnostic centering.
 *
 * Instead of relying on `dominant-baseline="central"` (which each font interprets
 * differently based on its own ascent/descent metrics), we use the default alphabetic
 * baseline and shift down by 0.35em. This places the optical center of text at the
 * y coordinate, regardless of font family (Inter, JetBrains Mono, system fallbacks).
 *
 * The 0.35em value approximates the distance from alphabetic baseline to visual
 * center of Latin text. Using `em` units ensures it scales with font size.
 */
export const TEXT_BASELINE_SHIFT = '0.35em' as const

/** Arrow head dimensions */
export const ARROW_HEAD = {
  width: 7,
  height: 7,
} as const
