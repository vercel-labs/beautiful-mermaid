import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, Point, RenderOptions } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { svgOpenTag, buildStyleBlock } from './theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD, estimateTextWidth, estimateMonoTextWidth, TEXT_BASELINE_SHIFT } from './styles.ts'
import type { ResolvedAnimation, ElementDelays } from './animation.ts'
import { computeDelays, buildAnimationCSS, cssEasingToSmil } from './animation.ts'

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// When animation is enabled, elements get CSS classes + delay variables,
// edges use pathLength + stroke-dashoffset, and arrows use SMIL animateMotion.
// When disabled, renders identical static SVG as before.
// ============================================================================

export function renderSvg(
  graph: PositionedGraph,
  colors: DiagramColors,
  font: string = 'Geist',
  transparent: boolean = false,
  options: RenderOptions = {},
  anim: ResolvedAnimation | null = null,
): string {
  const nodeFontSize = options.fontSize ?? FONT_SIZES.nodeLabel
  const edgeFontSize = options.edgeFontSize ?? FONT_SIZES.edgeLabel
  const nodeFontWeight = options.fontWeight ?? FONT_WEIGHTS.nodeLabel
  const letterSpacing = options.letterSpacing ?? -0.384
  const cr = options.cornerRadius ?? 6
  const lineWidth = options.lineWidth ?? STROKE_WIDTHS.connector
  const edgeBendRadius = options.edgeBendRadius ?? 8
  const groupFontSize = options.groupFontSize ?? FONT_SIZES.groupHeader
  const groupFontWeight = options.groupFontWeight ?? FONT_WEIGHTS.groupHeader
  const groupFont = options.groupFont ?? 'Geist Mono'
  const groupTextTransform = options.groupTextTransform ?? 'uppercase'
  const groupCornerRadius = options.groupCornerRadius ?? 3
  const groupBorderColor = options.groupBorderColor ?? '#454545'

  // Compute animation delays if animated
  const delays = anim ? computeDelays(graph, anim) : null

  const parts: string[] = []

  // SVG root with CSS variables + style block + defs
  parts.push(svgOpenTag(graph.width, graph.height, colors, transparent))
  parts.push(buildStyleBlock(font, true))
  if (anim) {
    parts.push('<style>')
    parts.push(buildAnimationCSS(anim))
    parts.push('</style>')
  }
  parts.push('<defs>')
  // Only include marker defs when not animated (animated uses animateMotion instead)
  if (!anim) {
    parts.push(arrowMarkerDefs())
  }
  // Diagonal hatching pattern for subgraph backgrounds
  parts.push(
    `  <pattern id="diag-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `\n    <rect width="6" height="6" fill="var(--bg)" />` +
    `\n    <line x1="0" y1="0" x2="0" y2="6" stroke="#171717" stroke-width="3" />` +
    `\n  </pattern>`
  )
  parts.push('</defs>')

  // 1. Group backgrounds
  for (const group of graph.groups) {
    const delay = delays?.groups.get(group.id)
    if (anim && delay != null) {
      parts.push(`<g class="ag" style="--d:${delay}ms">`)
      parts.push(renderGroupBackgroundInner(group, groupCornerRadius, groupBorderColor))
      parts.push('</g>')
    } else {
      parts.push(renderGroupBackground(group, groupCornerRadius, groupBorderColor))
    }
  }

  // 2. Edges
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    const delay = delays?.edges.get(i)
    if (anim && delay != null && anim.edgeAnimation === 'draw') {
      parts.push(renderAnimatedEdge(edge, i, lineWidth, edgeBendRadius, delay, anim))
    } else if (anim && delay != null && anim.edgeAnimation === 'fade') {
      parts.push(`<g class="an" style="--d:${delay}ms">`)
      parts.push(renderEdge(edge, lineWidth, edgeBendRadius))
      parts.push('</g>')
    } else {
      parts.push(renderEdge(edge, lineWidth, edgeBendRadius))
    }
  }

  // 3. Group header labels (on top of edges)
  for (const group of graph.groups) {
    const delay = delays?.groups.get(group.id)
    if (anim && delay != null) {
      parts.push(`<g class="an" style="--d:${delay}ms">`)
      parts.push(renderGroupLabelsInner(group, font, groupFontSize, groupFontWeight, groupFont, groupTextTransform))
      parts.push('</g>')
    } else {
      parts.push(renderGroupLabels(group, font, groupFontSize, groupFontWeight, groupFont, groupTextTransform))
    }
  }

  // 4. Edge labels
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    if (edge.label) {
      const delay = delays?.edges.get(i)
      if (anim && delay != null) {
        parts.push(`<g class="ael" style="--d:${delay}ms">`)
        parts.push(renderEdgeLabel(edge, font, edgeFontSize, lineWidth))
        parts.push('</g>')
      } else {
        parts.push(renderEdgeLabel(edge, font, edgeFontSize, lineWidth))
      }
    }
  }

  // 5+6. Nodes (shape + label together when animated, separate when not)
  if (anim) {
    for (const node of graph.nodes) {
      const delay = delays?.nodes.get(node.id) ?? 0
      parts.push(`<g class="an" style="--d:${delay}ms">`)
      parts.push(renderNodeShape(node, cr))
      parts.push(renderNodeLabel(node, font, nodeFontSize, nodeFontWeight, letterSpacing))
      parts.push('</g>')
    }
  } else {
    for (const node of graph.nodes) {
      parts.push(renderNodeShape(node, cr))
    }
    for (const node of graph.nodes) {
      parts.push(renderNodeLabel(node, font, nodeFontSize, nodeFontWeight, letterSpacing))
    }
  }

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Animated edge rendering
// ============================================================================

function renderAnimatedEdge(
  edge: PositionedEdge,
  edgeIndex: number,
  lineWidth: number,
  bendRadius: number,
  delay: number,
  anim: ResolvedAnimation,
): string {
  if (edge.points.length < 2) return ''

  const strokeWidth = edge.style === 'thick' ? lineWidth * 2 : lineWidth
  // Dotted edges can't use stroke-dashoffset draw animation (conflicts with dasharray)
  // Fall back to fade animation for dotted edges
  if (edge.style === 'dotted') {
    return `<g class="an" style="--d:${delay}ms">${renderEdge(edge, lineWidth, bendRadius)}</g>`
  }

  const pts = edge.points.map(p => ({ ...p }))
  // Pull back endpoint for arrow gap (same as static rendering)
  if (edge.hasArrowEnd && pts.length >= 2) {
    const pullback = ARROW_HEAD.width + 2
    const last = pts[pts.length - 1]!
    const prev = pts[pts.length - 2]!
    const dx = last.x - prev.x
    const dy = last.y - prev.y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d > pullback) {
      last.x -= (dx / d) * pullback
      last.y -= (dy / d) * pullback
    }
  }

  // Always render as <path> for pathLength + animateMotion support
  const pathId = `e${edgeIndex}`
  let pathD: string
  if (bendRadius > 0 && pts.length > 2) {
    pathD = roundedPolylinePath(pts, bendRadius)
  } else {
    pathD = pointsToPathD(pts)
  }

  const parts: string[] = []

  // SMIL timing — shared by edge line + arrowhead so they use the same animation engine
  const smilSplines = cssEasingToSmil(anim.edgeEasing)
  const durS = (anim.duration / 1000).toFixed(3)
  const beginS = (delay / 1000).toFixed(3)

  // Edge line with SMIL draw-in animation (not CSS — SMIL stays synced with arrowhead)
  parts.push(
    `<path id="${pathId}" d="${pathD}" pathLength="1" ` +
    `fill="none" stroke="var(--_line)" stroke-width="${strokeWidth}" ` +
    `stroke-dasharray="1" stroke-dashoffset="1" opacity="0">` +
    `\n  <animate attributeName="stroke-dashoffset" from="1" to="0" ` +
    `dur="${durS}s" begin="${beginS}s" fill="freeze" ` +
    `calcMode="spline" keyTimes="0;1" keySplines="${smilSplines}" />` +
    `\n  <set attributeName="opacity" to="1" begin="${beginS}s" fill="freeze" />` +
    `\n</path>`
  )

  // Animated arrowhead (travels along path via SMIL animateMotion)
  if (edge.hasArrowEnd) {
    const w = ARROW_HEAD.width
    const hh = ARROW_HEAD.height / 2
    parts.push(
      `<polygon points="0 ${-hh}, ${w} 0, 0 ${hh}" fill="var(--_arrow)" opacity="0">` +
      `\n  <animateMotion dur="${durS}s" begin="${beginS}s" fill="freeze" ` +
      `rotate="auto" keyPoints="0;1" keyTimes="0;1" ` +
      `calcMode="spline" keySplines="${smilSplines}">` +
      `\n    <mpath href="#${pathId}" />` +
      `\n  </animateMotion>` +
      `\n  <set attributeName="opacity" to="1" begin="${beginS}s" fill="freeze" />` +
      `\n</polygon>`
    )
  }

  // Animated reverse arrowhead
  if (edge.hasArrowStart) {
    const w = ARROW_HEAD.width
    const hh = ARROW_HEAD.height / 2
    parts.push(
      `<polygon points="${w} ${-hh}, 0 0, ${w} ${hh}" fill="var(--_arrow)" opacity="0">` +
      `\n  <animateMotion dur="${durS}s" begin="${beginS}s" fill="freeze" ` +
      `rotate="auto" keyPoints="1;0" keyTimes="0;1" ` +
      `calcMode="spline" keySplines="${smilSplines}">` +
      `\n    <mpath href="#${pathId}" />` +
      `\n  </animateMotion>` +
      `\n  <set attributeName="opacity" to="1" begin="${beginS}s" fill="freeze" />` +
      `\n</polygon>`
    )
  }

  return parts.join('\n')
}

/** Convert points to SVG path d attribute: "M x1,y1 L x2,y2 L x3,y3" */
function pointsToPathD(points: Point[]): string {
  if (points.length === 0) return ''
  return 'M' + points.map(p => `${p.x},${p.y}`).join(' L')
}

// ============================================================================
// Arrow marker definitions (static / non-animated only)
// ============================================================================

function arrowMarkerDefs(): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  return (
    `  <marker id="arrowhead" markerWidth="${w}" markerHeight="${h}" refX="0" refY="${h / 2}" orient="auto" markerUnits="userSpaceOnUse" overflow="visible">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" fill="var(--_arrow)" />` +
    `\n  </marker>` +
    `\n  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="${w}" refY="${h / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse" overflow="visible">` +
    `\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" fill="var(--_arrow)" />` +
    `\n  </marker>`
  )
}

// ============================================================================
// Group rendering
// ============================================================================

function renderGroupBackground(
  group: PositionedGroup,
  groupCornerRadius = 0,
  groupBorderColor = 'var(--_node-stroke)',
): string {
  const parts: string[] = []
  parts.push(renderGroupBackgroundInner(group, groupCornerRadius, groupBorderColor))
  for (const child of group.children) {
    parts.push(renderGroupBackground(child, groupCornerRadius, groupBorderColor))
  }
  return parts.join('\n')
}

function renderGroupBackgroundInner(
  group: PositionedGroup,
  groupCornerRadius: number,
  groupBorderColor: string,
): string {
  return (
    `<rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" ` +
    `rx="${groupCornerRadius}" ry="${groupCornerRadius}" fill="url(#diag-hatch)" stroke="${groupBorderColor}" stroke-width="${STROKE_WIDTHS.outerBox}" />`
  )
}

function renderGroupLabels(
  group: PositionedGroup,
  font: string,
  groupFontSize: number,
  groupFontWeight: number,
  groupFont: string,
  groupTextTransform: string,
): string {
  const parts: string[] = []
  parts.push(renderGroupLabelsInner(group, font, groupFontSize, groupFontWeight, groupFont, groupTextTransform))
  for (const child of group.children) {
    parts.push(renderGroupLabels(child, font, groupFontSize, groupFontWeight, groupFont, groupTextTransform))
  }
  return parts.join('\n')
}

function renderGroupLabelsInner(
  group: PositionedGroup,
  font: string,
  groupFontSize: number,
  groupFontWeight: number,
  groupFont: string,
  groupTextTransform: string,
): string {
  const headerHeight = groupFontSize + 32
  const ttStyle = groupTextTransform ? `text-transform:${groupTextTransform};` : ''
  const label = escapeXml(group.label)
  const labelWidth = estimateTextWidth(label, groupFontSize, groupFontWeight) * (groupTextTransform === 'uppercase' ? 1.15 : 1)
  const bgPadX = 8
  const bgPadY = 4
  const bgX = group.x + 16 - bgPadX
  const bgY = group.y + headerHeight / 2 - groupFontSize / 2 - bgPadY
  const bgW = labelWidth + bgPadX * 2
  const bgH = groupFontSize + bgPadY * 2

  return (
    `<rect x="${bgX}" y="${bgY}" width="${bgW}" height="${bgH}" fill="var(--bg)" rx="2" ry="2" />` +
    `\n<text x="${group.x + 16}" y="${group.y + headerHeight / 2}" ` +
    `dy="${TEXT_BASELINE_SHIFT}" ` +
    `style="font-family:'${groupFont}',system-ui,sans-serif;font-size:${groupFontSize}px;font-weight:${groupFontWeight};${ttStyle}" ` +
    `fill="rgba(255,255,255,0.92)">${label}</text>`
  )
}

// ============================================================================
// Edge rendering (static)
// ============================================================================

function renderEdge(edge: PositionedEdge, lineWidth: number, bendRadius: number): string {
  if (edge.points.length < 2) return ''

  const dashArray = edge.style === 'dotted' ? ' stroke-dasharray="4 4"' : ''
  const strokeWidth = edge.style === 'thick' ? lineWidth * 2 : lineWidth

  let markers = ''
  if (edge.hasArrowEnd) markers += ' marker-end="url(#arrowhead)"'
  if (edge.hasArrowStart) markers += ' marker-start="url(#arrowhead-start)"'

  const pts = edge.points.map(p => ({ ...p }))
  if (edge.hasArrowEnd && pts.length >= 2) {
    const pullback = ARROW_HEAD.width + 2

    // Remove degenerate trailing segments (< pullback length) by merging
    // them into the previous segment. This happens when endpoint clipping
    // creates very short final segments at subgraph boundaries.
    while (pts.length >= 3) {
      const last = pts[pts.length - 1]!
      const prev = pts[pts.length - 2]!
      const segLen = Math.sqrt((last.x - prev.x) ** 2 + (last.y - prev.y) ** 2)
      if (segLen >= pullback) break
      // Merge: remove the second-to-last point, extending the previous segment to the last point
      pts.splice(pts.length - 2, 1)
    }

    if (pts.length >= 2) {
      const last = pts[pts.length - 1]!
      const prev = pts[pts.length - 2]!
      const dx = last.x - prev.x
      const dy = last.y - prev.y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d > pullback) {
        last.x -= (dx / d) * pullback
        last.y -= (dy / d) * pullback
      }
    }
  }

  if (bendRadius > 0 && pts.length > 2) {
    const d = roundedPolylinePath(pts, bendRadius)
    return (
      `<path d="${d}" fill="none" stroke="var(--_line)" ` +
      `stroke-width="${strokeWidth}"${dashArray}${markers} />`
    )
  }

  const pathData = pointsToPolylinePath(pts)
  return (
    `<polyline points="${pathData}" fill="none" stroke="var(--_line)" ` +
    `stroke-width="${strokeWidth}"${dashArray}${markers} />`
  )
}

function pointsToPolylinePath(points: Point[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ')
}

function roundedPolylinePath(points: Point[], radius: number): string {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0]!.x},${points[0]!.y} L${points[1]!.x},${points[1]!.y}`

  const parts: string[] = [`M${points[0]!.x},${points[0]!.y}`]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const next = points[i + 1]!
    const dPrev = dist(prev, curr)
    const dNext = dist(curr, next)
    const r = Math.min(radius, dPrev / 2, dNext / 2)
    const startX = curr.x + (prev.x - curr.x) * (r / dPrev)
    const startY = curr.y + (prev.y - curr.y) * (r / dPrev)
    const endX = curr.x + (next.x - curr.x) * (r / dNext)
    const endY = curr.y + (next.y - curr.y) * (r / dNext)
    parts.push(`L${startX},${startY}`)
    parts.push(`Q${curr.x},${curr.y} ${endX},${endY}`)
  }

  const last = points[points.length - 1]!
  parts.push(`L${last.x},${last.y}`)
  return parts.join(' ')
}

function renderEdgeLabel(edge: PositionedEdge, font: string, edgeFontSize: number, lineWidth: number): string {
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const label = edge.label!
  const textWidth = estimateMonoTextWidth(label, edgeFontSize)
  const paddingX = 12
  const paddingY = 8
  const bgWidth = textWidth + paddingX * 2
  const bgHeight = edgeFontSize + paddingY * 2
  const pillRadius = bgHeight / 2

  return (
    `<rect x="${mid.x - bgWidth / 2}" y="${mid.y - bgHeight / 2}" ` +
    `width="${bgWidth}" height="${bgHeight}" rx="${pillRadius}" ry="${pillRadius}" ` +
    `fill="var(--bg)" stroke="var(--_line)" stroke-width="${lineWidth}" />\n` +
    `<text class="mono" x="${mid.x}" y="${mid.y}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" ` +
    `font-size="${edgeFontSize}" font-weight="${FONT_WEIGHTS.edgeLabel}" ` +
    `fill="var(--_text)">${escapeXml(label)}</text>`
  )
}

function edgeMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    totalLength += dist(points[i - 1]!, points[i]!)
  }
  let remaining = totalLength / 2
  for (let i = 1; i < points.length; i++) {
    const segLen = dist(points[i - 1]!, points[i]!)
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        x: points[i - 1]!.x + t * (points[i]!.x - points[i - 1]!.x),
        y: points[i - 1]!.y + t * (points[i]!.y - points[i - 1]!.y),
      }
    }
    remaining -= segLen
  }
  return points[points.length - 1]!
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

// ============================================================================
// Node rendering
// ============================================================================

function renderNodeShape(node: PositionedNode, cr: number): string {
  const { x, y, width, height, shape, inlineStyle } = node
  const fill = escapeXml(inlineStyle?.fill ?? 'var(--_node-fill)')
  const stroke = escapeXml(inlineStyle?.stroke ?? 'var(--_node-stroke)')
  const sw = escapeXml(inlineStyle?.['stroke-width'] ?? String(STROKE_WIDTHS.innerBox))

  switch (shape) {
    case 'diamond': return renderDiamond(x, y, width, height, fill, stroke, sw)
    case 'rounded': return renderRoundedRect(x, y, width, height, fill, stroke, sw)
    case 'stadium': return renderStadium(x, y, width, height, fill, stroke, sw)
    case 'circle': return renderCircle(x, y, width, height, fill, stroke, sw)
    case 'subroutine': return renderSubroutine(x, y, width, height, fill, stroke, sw)
    case 'doublecircle': return renderDoubleCircle(x, y, width, height, fill, stroke, sw)
    case 'hexagon': return renderHexagon(x, y, width, height, fill, stroke, sw)
    case 'cylinder': return renderCylinder(x, y, width, height, fill, stroke, sw)
    case 'asymmetric': return renderAsymmetric(x, y, width, height, fill, stroke, sw)
    case 'trapezoid': return renderTrapezoid(x, y, width, height, fill, stroke, sw)
    case 'trapezoid-alt': return renderTrapezoidAlt(x, y, width, height, fill, stroke, sw)
    case 'state-start': return renderStateStart(x, y, width, height)
    case 'state-end': return renderStateEnd(x, y, width, height)
    case 'rectangle':
    default: return renderRect(x, y, width, height, fill, stroke, sw, cr)
  }
}

function renderRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, cr = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cr}" ry="${cr}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderRoundedRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderStadium(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const r = h / 2
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderDiamond(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const hw = w / 2
  const hh = h / 2
  const points = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderSubroutine(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = 8
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0" ry="0" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + inset}" y1="${y}" x2="${x + inset}" y2="${y + h}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + w - inset}" y1="${y}" x2="${x + w - inset}" y2="${y + h}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderDoubleCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2
  const innerR = outerR - 5
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderHexagon(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = h / 4
  const points = `${x + inset},${y} ${x + w - inset},${y} ${x + w},${y + h / 2} ${x + w - inset},${y + h} ${x + inset},${y + h} ${x},${y + h / 2}`
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderCylinder(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const ry = 7
  const cx = x + w / 2
  const bodyTop = y + ry
  const bodyH = h - 2 * ry
  return (
    `<rect x="${x}" y="${bodyTop}" width="${w}" height="${bodyH}" fill="${fill}" stroke="none" />` +
    `\n<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + w}" y1="${bodyTop}" x2="${x + w}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<ellipse cx="${cx}" cy="${bodyTop}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderAsymmetric(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const indent = 12
  const points = `${x + indent},${y} ${x + w},${y} ${x + w},${y + h} ${x + indent},${y + h} ${x},${y + h / 2}`
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderTrapezoid(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15
  const points = `${x + inset},${y} ${x + w - inset},${y} ${x + w},${y + h} ${x},${y + h}`
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderTrapezoidAlt(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15
  const points = `${x},${y} ${x + w},${y} ${x + w - inset},${y + h} ${x + inset},${y + h}`
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

function renderStateStart(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2 - 2
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--_text)" stroke="none" />`
}

function renderStateEnd(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2 - 2
  const innerR = outerR - 4
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--_text)" stroke="none" />`
  )
}

// ============================================================================
// Node label rendering
// ============================================================================

function renderNodeLabel(node: PositionedNode, font: string, fontSize: number, fontWeight: number, letterSpacing: number): string {
  if (node.shape === 'state-start' || node.shape === 'state-end') {
    if (!node.label) return ''
  }
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const textColor = escapeXml(node.inlineStyle?.color ?? 'var(--_text)')
  const lsAttr = letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''
  return (
    `<text x="${cx}" y="${cy}" text-anchor="middle" dy="${TEXT_BASELINE_SHIFT}" ` +
    `font-size="${fontSize}" font-weight="${fontWeight}"${lsAttr} ` +
    `fill="${textColor}">${escapeXml(node.label)}</text>`
  )
}

// ============================================================================
// Utilities
// ============================================================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
