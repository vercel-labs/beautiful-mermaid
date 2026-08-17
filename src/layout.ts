// @ts-expect-error — dagre types are declared for the package root, not the dist path;
// importing the pre-built browser bundle avoids Bun.build hanging on 30+ CJS file resolution
import dagre from '@dagrejs/dagre/dist/dagre.js'
import type { MermaidGraph, MermaidSubgraph, PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, Point, RenderOptions } from './types.ts'
import { estimateTextWidth, titleCaseEdgeLabel, FONT_SIZES, FONT_WEIGHTS, NODE_PADDING, GROUP_HEADER_CONTENT_PAD, EDGE_LABEL_SPACING, ARROW_HEAD } from './styles.ts'
import { centerToTopLeft, snapToOrthogonal, clipToDiamondBoundary, clipToCircleBoundary, clipEndpointsToNodes, centerZBends } from './dagre-adapter.ts'

/** Shapes that render as circles — need edge endpoint clipping to the circle boundary */
const CIRCULAR_SHAPES = new Set(['circle', 'doublecircle'])

/** Non-rectangular shapes — skip rectangular endpoint clipping for these because
 * they use their own diamond, circle, or triangle boundary equation. */
const NON_RECT_SHAPES = new Set(['diamond', 'circle', 'doublecircle', 'state-start', 'state-end'])

// ============================================================================
// Layout engine — converts MermaidGraph to PositionedGraph via dagre
//
// Pipeline:
//   1. Estimate node sizes from label text + shape padding
//   2. Build dagre graph (nodes, edges, compound parents for subgraphs)
//   3. Run dagre.layout() synchronously
//   4. Extract positions back into our PositionedGraph format
//
// Dagre differences from ELK:
//   - Synchronous (no web worker / WASM)
//   - Node coords are center-based (converted to top-left via adapter)
//   - Edge points may not be orthogonal (post-processed via adapter)
//   - Compound nodes use setParent() instead of nested children JSON
//   - All coordinates are absolute (no container-relative offsets)
// ============================================================================

/** Default render options (layout-only — color defaults are in theme.ts) */
const DEFAULTS: Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing' | 'fontSize' | 'edgeFontSize' | 'fontWeight' | 'nodePaddingX' | 'nodePaddingY' | 'groupPaddingX' | 'groupPaddingY'>> = {
  font: 'Geist',
  padding: 80,
  nodeSpacing: 40,
  layerSpacing: 50,
  fontSize: FONT_SIZES.nodeLabel,
  edgeFontSize: FONT_SIZES.edgeLabel,
  fontWeight: FONT_WEIGHTS.nodeLabel,
  nodePaddingX: NODE_PADDING.horizontal,
  nodePaddingY: NODE_PADDING.vertical,
  groupPaddingX: 32,
  groupPaddingY: 32,
}

// ============================================================================
// Two-pass layout for subgraph direction overrides
//
// Dagre only supports a single global rankdir. When a subgraph has a different
// direction (e.g. `direction LR` inside a `graph TD`), we pre-compute its
// internal layout in a separate dagre pass, then inject the result as a
// fixed-size placeholder in the main layout.
// ============================================================================

/** Pre-computed layout data for a direction-overridden subgraph */
interface PreComputedSubgraph {
  id: string
  label: string
  /** Bounding box for the placeholder node in the main layout */
  width: number
  height: number
  /** Internal nodes positioned relative to (0,0) of the bounding box */
  nodes: PositionedNode[]
  /** Internal edges positioned relative to (0,0) of the bounding box */
  edges: PositionedEdge[]
  /** Nested subgroup boxes positioned relative to (0,0) */
  groups: PositionedGroup[]
  /** All node IDs contained in this subgraph */
  nodeIds: Set<string>
  /** Indices of edges in graph.edges[] that are internal to this subgraph */
  internalEdgeIndices: Set<number>
}

/**
 * Size Dagre should reserve for an edge label.
 *
 * The rendered pill occupies the text plus padding. An invisible clearance
 * envelope guarantees breathing room around straight connections, bends, and
 * neighboring branches without using Dagre's coarse, rank-based `minlen`.
 */
function estimateEdgeLabelLayoutSize(
  label: string,
  fontSize: number,
): { width: number; height: number } {
  const displayLabel = titleCaseEdgeLabel(label)
  const renderedWidth =
    estimateTextWidth(displayLabel, fontSize, FONT_WEIGHTS.edgeLabel) +
    EDGE_LABEL_SPACING.paddingX * 2
  const renderedHeight = fontSize + EDGE_LABEL_SPACING.paddingY * 2
  const clearance = EDGE_LABEL_SPACING.clearance * 2

  return {
    width: renderedWidth + clearance,
    height: renderedHeight + clearance,
  }
}

/**
 * Pre-compute the internal layout of a subgraph that has a direction override.
 *
 * Runs a separate dagre layout using the subgraph's direction as rankdir,
 * with only the subgraph's internal nodes and edges. Returns positioned
 * elements relative to a (0,0) origin, plus the overall bounding box.
 */
function preComputeSubgraphLayout(
  sg: MermaidSubgraph,
  graph: MermaidGraph,
  opts: Required<Pick<RenderOptions, 'font' | 'padding' | 'nodeSpacing' | 'layerSpacing'>>,
): PreComputedSubgraph {
  const subG = new dagre.graphlib.Graph({ directed: true, compound: true })
  subG.setGraph({
    rankdir: directionToDagre(sg.direction!),
    acyclicer: 'greedy',
    nodesep: opts.nodeSpacing,
    ranksep: opts.layerSpacing,
    // Tighter margins for subgraph internals — the parent group provides outer padding
    marginx: opts.groupPaddingX,
    marginy: opts.groupPaddingY,
  })
  subG.setDefaultEdgeLabel(() => ({}))

  // Collect all node IDs in this subgraph (including nested children)
  const nodeIds = new Set<string>()
  nodeIds.add(sg.id)
  collectSubgraphNodeIds(sg, nodeIds)

  // Add direct child nodes
  for (const nodeId of sg.nodeIds) {
    const node = graph.nodes.get(nodeId)
    if (node) {
      const size = estimateNodeSize(nodeId, node.label, node.shape, opts.fontSize, opts.fontWeight, opts.nodePaddingX, opts.nodePaddingY)
      subG.setNode(nodeId, { label: node.label, width: size.width, height: size.height })
    }
  }

  // Add nested subgraphs as compound nodes (they keep the parent's direction)
  for (const child of sg.children) {
    addSubgraphToDagre(subG, child, graph, opts, sg.id)
  }

  // Identify and add internal edges (both endpoints inside this subgraph)
  const internalEdgeIndices = new Set<number>()
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      internalEdgeIndices.add(i)
      const edgeLabel: Record<string, unknown> = { _index: i }
      if (edge.label) {
        const size = estimateEdgeLabelLayoutSize(edge.label, opts.edgeFontSize)
        edgeLabel.label = edge.label
        edgeLabel.width = size.width
        edgeLabel.height = size.height
        edgeLabel.labelpos = 'c'
      }
      subG.setEdge(edge.source, edge.target, edgeLabel)
    }
  }

  // Run layout on the isolated subgraph
  dagre.layout(subG)

  // Determine orthogonal bend direction for the overridden direction
  const verticalFirst = sg.direction === 'TD' || sg.direction === 'TB' || sg.direction === 'BT'

  // Build a set of subgraph IDs within this subgraph for node/group separation
  const nestedSubgraphIds = new Set<string>()
  for (const child of sg.children) {
    collectAllSubgraphIds(child, nestedSubgraphIds)
  }

  // Extract positioned nodes (skip nested subgraph compound nodes)
  const nodes: PositionedNode[] = []
  for (const nodeId of subG.nodes()) {
    if (nestedSubgraphIds.has(nodeId)) continue
    const mNode = graph.nodes.get(nodeId)
    if (!mNode) continue
    const dagreNode = subG.node(nodeId)
    if (!dagreNode) continue
    const topLeft = centerToTopLeft(dagreNode.x, dagreNode.y, dagreNode.width, dagreNode.height)
    nodes.push({
      id: nodeId,
      label: mNode.label,
      shape: mNode.shape,
      x: topLeft.x,
      y: topLeft.y,
      width: dagreNode.width,
      height: dagreNode.height,
      inlineStyle: resolveNodeStyle(graph, nodeId),
    })
  }

  // Extract positioned edges
  const edges: PositionedEdge[] = subG.edges().map(edgeObj => {
    const dagreEdge = subG.edge(edgeObj)
    const originalEdge = graph.edges[dagreEdge._index as number]!
    const rawPoints: Point[] = dagreEdge.points ?? []

    // Clip edge endpoints to non-rectangular shape boundaries.
    // Dagre computes endpoints on the rectangular bounding box, but diamonds
    // and circles are inscribed within the rectangle — endpoints float in the air.
    if (rawPoints.length > 0) {
      const srcShape = graph.nodes.get(edgeObj.v)?.shape
      if (srcShape === 'diamond') {
        const sn = subG.node(edgeObj.v)
        rawPoints[0] = clipToDiamondBoundary(rawPoints[0]!, sn.x, sn.y, sn.width / 2, sn.height / 2)
      } else if (srcShape && CIRCULAR_SHAPES.has(srcShape)) {
        const sn = subG.node(edgeObj.v)
        rawPoints[0] = clipToCircleBoundary(rawPoints[0]!, sn.x, sn.y, Math.min(sn.width, sn.height) / 2)
      }
      const tgtShape = graph.nodes.get(edgeObj.w)?.shape
      if (tgtShape === 'diamond') {
        const tn = subG.node(edgeObj.w)
        const last = rawPoints.length - 1
        rawPoints[last] = clipToDiamondBoundary(rawPoints[last]!, tn.x, tn.y, tn.width / 2, tn.height / 2)
      } else if (tgtShape && CIRCULAR_SHAPES.has(tgtShape)) {
        const tn = subG.node(edgeObj.w)
        const last = rawPoints.length - 1
        rawPoints[last] = clipToCircleBoundary(rawPoints[last]!, tn.x, tn.y, Math.min(tn.width, tn.height) / 2)
      }
    }

    const orthoPoints = snapToOrthogonal(rawPoints, verticalFirst)

    // Clip rectangular endpoints to the correct side after orthogonalization.
    // Non-rectangular shapes (diamond, circle) are already handled above.
    const srcShape = graph.nodes.get(edgeObj.v)?.shape
    const tgtShape = graph.nodes.get(edgeObj.w)?.shape
    const srcRect = (srcShape && !NON_RECT_SHAPES.has(srcShape)) || !srcShape
      ? (() => { const sn = subG.node(edgeObj.v); return sn ? { cx: sn.x, cy: sn.y, hw: sn.width / 2, hh: sn.height / 2 } : null })()
      : null
    const tgtRect = (tgtShape && !NON_RECT_SHAPES.has(tgtShape)) || !tgtShape
      ? (() => { const tn = subG.node(edgeObj.w); return tn ? { cx: tn.x, cy: tn.y, hw: tn.width / 2, hh: tn.height / 2 } : null })()
      : null
    const points = clipEndpointsToNodes(orthoPoints, srcRect, tgtRect)

    let labelPosition: Point | undefined
    if (originalEdge.label && dagreEdge.x != null && dagreEdge.y != null) {
      labelPosition = { x: dagreEdge.x, y: dagreEdge.y }
    }

    return {
      source: originalEdge.source,
      target: originalEdge.target,
      label: originalEdge.label,
      style: originalEdge.style,
      hasArrowStart: originalEdge.hasArrowStart,
      hasArrowEnd: originalEdge.hasArrowEnd,
      points,
      labelPosition,
    }
  })

  // Extract nested subgroup positions
  const groups: PositionedGroup[] = sg.children.map(child => extractGroup(subG, child))

  const graphInfo = subG.graph()
  return {
    id: sg.id,
    label: sg.label,
    width: graphInfo.width ?? 200,
    height: graphInfo.height ?? 100,
    nodes,
    edges,
    groups,
    nodeIds,
    internalEdgeIndices,
  }
}

/**
 * Lay out a parsed mermaid graph using dagre.
 * Returns a fully positioned graph ready for SVG rendering.
 *
 * Kept async for API compatibility — dagre itself is synchronous.
 */
export async function layoutGraph(
  graph: MermaidGraph,
  options: RenderOptions = {}
): Promise<PositionedGraph> {
  const opts = { ...DEFAULTS, ...options }

  // -------------------------------------------------------------------------
  // Phase 1: Pre-compute layouts for subgraphs with direction overrides.
  //
  // Dagre only supports a single global rankdir. Subgraphs with a different
  // direction (e.g. `direction LR` inside `graph TD`) get their own dagre
  // layout pass. The result is injected as a fixed-size placeholder in the
  // main layout, then composited back after positioning.
  // -------------------------------------------------------------------------
  const preComputed = new Map<string, PreComputedSubgraph>()
  for (const sg of graph.subgraphs) {
    if (sg.direction && sg.direction !== graph.direction) {
      preComputed.set(sg.id, preComputeSubgraphLayout(sg, graph, opts))
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Build the main dagre graph.
  // Pre-computed subgraphs become fixed-size leaf nodes instead of compound nodes.
  // -------------------------------------------------------------------------
  const g = new dagre.graphlib.Graph({ directed: true, compound: true })
  g.setGraph({
    rankdir: directionToDagre(graph.direction),
    acyclicer: 'greedy',
    nodesep: opts.nodeSpacing,
    ranksep: opts.layerSpacing,
    marginx: opts.padding,
    marginy: opts.padding,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // Collect node IDs that belong to subgraphs (to exclude from root level).
  // Also exclude the subgraph IDs themselves — in state diagrams, a composite
  // state like "Processing" exists as both a node (from transition references)
  // and a subgraph (from the composite definition). Without this exclusion,
  // dagre receives a duplicate node for the same ID.
  const subgraphNodeIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    subgraphNodeIds.add(sg.id)
    collectSubgraphNodeIds(sg, subgraphNodeIds)
  }

  // Add top-level nodes (those not in any subgraph)
  for (const [id, node] of graph.nodes) {
    if (!subgraphNodeIds.has(id)) {
      const size = estimateNodeSize(id, node.label, node.shape, opts.fontSize, opts.fontWeight, opts.nodePaddingX, opts.nodePaddingY)
      g.setNode(id, { label: node.label, width: size.width, height: size.height })
    }
  }

  // Add subgraph compound nodes and their children recursively.
  // Pre-computed subgraphs are added as fixed-size leaf nodes instead.
  for (const sg of graph.subgraphs) {
    if (preComputed.has(sg.id)) {
      const pc = preComputed.get(sg.id)!
      g.setNode(sg.id, { width: pc.width, height: pc.height })
    } else {
      addSubgraphToDagre(g, sg, graph, opts)
    }
  }

  // Build redirect maps for edges that target/originate from compound nodes.
  // Dagre crashes when edges connect directly to compound parent nodes (known bug
  // in its ranking algorithm). Workaround: redirect edges to the first/last child
  // of the subgraph — "first" for incoming edges, "last" for outgoing.
  const subgraphEntryNode = new Map<string, string>()
  const subgraphExitNode = new Map<string, string>()
  for (const sg of graph.subgraphs) {
    if (!preComputed.has(sg.id)) {
      buildSubgraphRedirects(sg, subgraphEntryNode, subgraphExitNode)
    }
  }

  // For pre-computed subgraphs, redirect all internal node references to the
  // placeholder leaf node. External edges to/from internal nodes get routed
  // to the placeholder boundary; endpoints are fixed up after compositing.
  for (const [sgId, pc] of preComputed) {
    for (const nodeId of pc.nodeIds) {
      subgraphEntryNode.set(nodeId, sgId)
      subgraphExitNode.set(nodeId, sgId)
    }
  }

  // Add edges — skip internal edges of pre-computed subgraphs (handled by pre-computation).
  // Track cross-boundary edges for post-layout endpoint fixup.
  const allInternalIndices = new Set<number>()
  for (const pc of preComputed.values()) {
    for (const idx of pc.internalEdgeIndices) allInternalIndices.add(idx)
  }

  // Weight heuristic for stable rank ordering in cyclic graphs (e.g. state diagrams).
  //
  // Dagre's acyclicer reverses feedback edges to break cycles, but equal-weight edges
  // give the ranking algorithm freedom to collapse nodes onto the same rank.
  // Fix: "spine" edges (those that introduce a node as a target for the first time)
  // get higher weight, biasing dagre to keep them short (1 rank apart). Feedback
  // edges (target already introduced) keep default weight, allowing them to stretch.
  const introducedTargets = new Set<string>()

  for (let i = 0; i < graph.edges.length; i++) {
    if (allInternalIndices.has(i)) continue

    const edge = graph.edges[i]!
    const source = subgraphExitNode.get(edge.source) ?? edge.source
    const target = subgraphEntryNode.get(edge.target) ?? edge.target
    const edgeLabel: Record<string, unknown> = { _index: i }
    if (edge.label) {
      const size = estimateEdgeLabelLayoutSize(edge.label, opts.edgeFontSize)
      edgeLabel.label = edge.label
      edgeLabel.width = size.width
      edgeLabel.height = size.height
      edgeLabel.labelpos = 'c'
    }

    // Spine edges get higher weight to maintain sequential ordering
    if (!introducedTargets.has(target)) {
      edgeLabel.weight = 2
      introducedTargets.add(target)
    }

    g.setEdge(source, target, edgeLabel)
  }

  // -------------------------------------------------------------------------
  // Phase 3: Run synchronous layout — mutates g in place.
  // -------------------------------------------------------------------------
  try {
    dagre.layout(g)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Dagre layout failed: ${message}`)
  }

  // -------------------------------------------------------------------------
  // Phase 4: Extract positions and compose pre-computed layouts.
  // -------------------------------------------------------------------------
  return extractPositionedGraph(
    g,
    graph,
    opts.padding,
    preComputed,
    opts.groupPaddingX,
    opts.groupPaddingY,
    opts.edgeFontSize,
  )
}

// ============================================================================
// Dagre graph construction helpers
// ============================================================================

/** Convert mermaid direction to dagre rankdir value */
function directionToDagre(dir: MermaidGraph['direction']): string {
  switch (dir) {
    case 'LR': return 'LR'
    case 'RL': return 'RL'
    case 'BT': return 'BT'
    case 'TD':
    case 'TB':
    default: return 'TB'
  }
}

/** Estimate node size based on label text + shape padding */
function estimateNodeSize(
  id: string,
  label: string,
  shape: string,
  fontSize = FONT_SIZES.nodeLabel,
  fontWeight = FONT_WEIGHTS.nodeLabel,
  padX = NODE_PADDING.horizontal,
  padY = NODE_PADDING.vertical,
): { width: number; height: number } {
  const textWidth = estimateTextWidth(label, fontSize, fontWeight)

  let width = textWidth + padX * 2
  let height = fontSize + padY * 2

  // Diamonds need extra space because text is inside a rotated square
  if (shape === 'diamond') {
    const side = Math.max(width, height) + NODE_PADDING.diamondExtra
    width = side
    height = side
  }

  // Circles and double circles: bounding box must be square, diameter must fit text rect
  // For a rect (w x h) inscribed in a circle: diameter >= sqrt(w^2 + h^2)
  if (shape === 'circle' || shape === 'doublecircle') {
    const diameter = Math.ceil(Math.sqrt(width * width + height * height)) + 8
    width = shape === 'doublecircle' ? diameter + 12 : diameter
    height = width
  }

  // Stadium/pill shapes: the rounded ends (rx = height/2) eat into horizontal space,
  // so add extra inline padding equal to the corner radius
  if (shape === 'stadium') {
    width += height / 2
  }

  // Hexagons need extra horizontal padding for the angled sides
  if (shape === 'hexagon') {
    width += NODE_PADDING.horizontal
  }

  // Trapezoids need extra horizontal padding for angled edges
  if (shape === 'trapezoid' || shape === 'trapezoid-alt') {
    width += NODE_PADDING.horizontal
  }

  // Asymmetric flag shape needs left padding for the pointed end
  if (shape === 'asymmetric') {
    width += 12
  }

  // Cylinder needs extra vertical space for the ellipse cap
  if (shape === 'cylinder') {
    height += 14
  }

  // State pseudostates are semantic layout anchors, not visible nodes.
  if (shape === 'state-start' || shape === 'state-end') {
    return { width: 1, height: 1 }
  }

  // Minimum sizes for aesthetics
  width = Math.max(width, 60)
  height = Math.max(height, 36)

  return { width, height }
}

/**
 * Recursively add a subgraph and its children to the dagre graph.
 *
 * Dagre compound nodes work via setParent(child, parent) — unlike ELK's
 * nested children[] JSON tree. We set padding on compound nodes so dagre
 * allocates space for children plus the subgraph header label.
 */
function addSubgraphToDagre(
  g: dagre.graphlib.Graph,
  sg: MermaidSubgraph,
  graph: MermaidGraph,
  opts: { fontSize: number; fontWeight: number; nodePaddingX: number; nodePaddingY: number },
  parentId?: string,
): void {
  // Register the subgraph as a compound node.
  // Note: dagre ignores paddingX/paddingY/clusterLabelPos on compound nodes —
  // they're not in dagre's nodeNumAttrs. Header space is handled by post-processing
  // in extractPositionedGraph() via expandGroupsForHeaders().
  g.setNode(sg.id, { label: sg.label })

  // Set parent if this is a nested subgraph
  if (parentId) {
    g.setParent(sg.id, parentId)
  }

  // Add direct child nodes inside this subgraph
  for (const nodeId of sg.nodeIds) {
    const node = graph.nodes.get(nodeId)
    if (node) {
      const size = estimateNodeSize(nodeId, node.label, node.shape, opts.fontSize, opts.fontWeight, opts.nodePaddingX, opts.nodePaddingY)
      g.setNode(nodeId, { label: node.label, width: size.width, height: size.height })
      g.setParent(nodeId, sg.id)
    }
  }

  // Add nested subgraphs recursively
  for (const child of sg.children) {
    addSubgraphToDagre(g, child, graph, opts, sg.id)
  }
}

/**
 * Build redirect maps for subgraph entry/exit nodes.
 *
 * Dagre's ranking algorithm crashes when edges connect to compound parent nodes.
 * This maps each subgraph ID to its first child (entry) and last child (exit),
 * so edges targeting a subgraph get redirected to a real leaf node inside it.
 * Handles nested subgraphs by recursing into children.
 */
function buildSubgraphRedirects(
  sg: MermaidSubgraph,
  entryMap: Map<string, string>,
  exitMap: Map<string, string>,
): void {
  // Recurse into nested subgraphs FIRST so their entries are available
  // for transitive resolution when we set this subgraph's redirects.
  for (const child of sg.children) {
    buildSubgraphRedirects(child, entryMap, exitMap)
  }

  // Collect all direct child IDs (both leaf nodes and nested subgraphs)
  const childIds = [...sg.nodeIds, ...sg.children.map(c => c.id)]

  if (childIds.length === 0) {
    // Empty subgraph — no children to redirect to.
    // Dagre treats it as a regular node (no setParent calls) so edges
    // targeting it won't trigger the compound-node ranking crash.
    // Map it to itself so consumers of the redirect maps always get a result.
    entryMap.set(sg.id, sg.id)
    exitMap.set(sg.id, sg.id)
    return
  }

  // For nested subgraphs as entry/exit: resolve transitively to a leaf node
  const firstChild = childIds[0]!
  const lastChild = childIds[childIds.length - 1]!
  entryMap.set(sg.id, entryMap.get(firstChild) ?? firstChild)
  exitMap.set(sg.id, exitMap.get(lastChild) ?? lastChild)
}

/**
 * Resolve the final inline style for a node by merging classDef base styles
 * with any explicit `style` overrides. The renderer only reads inlineStyle,
 * so class-based styles must be folded in at construction time.
 */
function resolveNodeStyle(graph: MermaidGraph, nodeId: string): Record<string, string> | undefined {
  const className = graph.classAssignments.get(nodeId)
  const classProps = className ? graph.classDefs.get(className) : undefined
  const inlineProps = graph.nodeStyles.get(nodeId)
  if (!classProps && !inlineProps) return undefined
  // Class styles as base, explicit inline `style` overrides on top
  return { ...classProps, ...inlineProps }
}

/** Recursively collect all node IDs that belong to any subgraph */
function collectSubgraphNodeIds(sg: MermaidSubgraph, out: Set<string>): void {
  for (const id of sg.nodeIds) {
    out.add(id)
  }
  for (const child of sg.children) {
    collectSubgraphNodeIds(child, out)
  }
}

// ============================================================================
// Position extraction — convert dagre layout results to our PositionedGraph
// ============================================================================

function extractPositionedGraph(
  g: dagre.graphlib.Graph,
  graph: MermaidGraph,
  padding: number,
  preComputed?: Map<string, PreComputedSubgraph>,
  groupPaddingX = 16,
  groupPaddingY = 12,
  edgeFontSize = FONT_SIZES.edgeLabel,
): PositionedGraph {
  const nodes: PositionedNode[] = []
  const groups: PositionedGroup[] = []

  // Build a set of subgraph IDs for distinguishing compound nodes from leaf nodes
  const subgraphIds = new Set<string>()
  for (const sg of graph.subgraphs) {
    collectAllSubgraphIds(sg, subgraphIds)
  }

  // Collect all pre-computed internal node IDs (they're not in the dagre graph)
  const preComputedNodeIds = new Set<string>()
  if (preComputed) {
    for (const pc of preComputed.values()) {
      for (const nodeId of pc.nodeIds) preComputedNodeIds.add(nodeId)
    }
  }

  // Extract leaf nodes (non-subgraph nodes, non-pre-computed-internal nodes)
  for (const nodeId of g.nodes()) {
    if (subgraphIds.has(nodeId)) continue

    const mNode = graph.nodes.get(nodeId)
    if (!mNode) continue

    const dagreNode = g.node(nodeId)
    if (!dagreNode) continue

    const topLeft = centerToTopLeft(dagreNode.x, dagreNode.y, dagreNode.width, dagreNode.height)

    nodes.push({
      id: nodeId,
      label: mNode.label,
      shape: mNode.shape,
      x: topLeft.x,
      y: topLeft.y,
      width: dagreNode.width,
      height: dagreNode.height,
      inlineStyle: resolveNodeStyle(graph, nodeId),
      rank: dagreNode.rank,
    })
  }

  // Extract subgraph groups recursively from the original subgraph tree structure.
  // For pre-computed subgraphs, the dagre leaf node position provides the group box.
  for (const sg of graph.subgraphs) {
    groups.push(extractGroup(g, sg))
  }

  // Vertical-first bends for TD/BT layouts; horizontal-first for LR/RL
  const verticalFirst = graph.direction === 'TD' || graph.direction === 'TB' || graph.direction === 'BT'

  // Extract edges — dagre gives us flat points arrays (no sections/container offsets)
  const edges: PositionedEdge[] = g.edges().map(edgeObj => {
    const dagreEdge = g.edge(edgeObj)
    // Retrieve the original edge index stored during graph construction
    const originalEdge = graph.edges[dagreEdge._index as number]!
    const rawPoints: Point[] = dagreEdge.points ?? []

    // Clip edge endpoints to non-rectangular shape boundaries.
    // Dagre computes endpoints on the rectangular bounding box, but diamonds
    // and circles are inscribed within the rectangle — endpoints float in the air.
    if (rawPoints.length > 0) {
      const srcShape = graph.nodes.get(edgeObj.v)?.shape
      if (srcShape === 'diamond') {
        const sn = g.node(edgeObj.v)
        rawPoints[0] = clipToDiamondBoundary(rawPoints[0]!, sn.x, sn.y, sn.width / 2, sn.height / 2)
      } else if (srcShape && CIRCULAR_SHAPES.has(srcShape)) {
        const sn = g.node(edgeObj.v)
        rawPoints[0] = clipToCircleBoundary(rawPoints[0]!, sn.x, sn.y, Math.min(sn.width, sn.height) / 2)
      }
      const tgtShape = graph.nodes.get(edgeObj.w)?.shape
      if (tgtShape === 'diamond') {
        const tn = g.node(edgeObj.w)
        const last = rawPoints.length - 1
        rawPoints[last] = clipToDiamondBoundary(rawPoints[last]!, tn.x, tn.y, tn.width / 2, tn.height / 2)
      } else if (tgtShape && CIRCULAR_SHAPES.has(tgtShape)) {
        const tn = g.node(edgeObj.w)
        const last = rawPoints.length - 1
        rawPoints[last] = clipToCircleBoundary(rawPoints[last]!, tn.x, tn.y, Math.min(tn.width, tn.height) / 2)
      }
    }

    // Post-process to orthogonal segments (direction-aware bend order)
    const orthoPoints = snapToOrthogonal(rawPoints, verticalFirst)

    // Clip rectangular endpoints to the correct side after orthogonalization.
    // Non-rectangular shapes (diamond, circle) are already handled above.
    const srcShapeForClip = graph.nodes.get(edgeObj.v)?.shape
    const tgtShapeForClip = graph.nodes.get(edgeObj.w)?.shape
    const srcRect = (srcShapeForClip && !NON_RECT_SHAPES.has(srcShapeForClip)) || !srcShapeForClip
      ? (() => { const sn = g.node(edgeObj.v); return sn ? { cx: sn.x, cy: sn.y, hw: sn.width / 2, hh: sn.height / 2 } : null })()
      : null
    const tgtRect = (tgtShapeForClip && !NON_RECT_SHAPES.has(tgtShapeForClip)) || !tgtShapeForClip
      ? (() => { const tn = g.node(edgeObj.w); return tn ? { cx: tn.x, cy: tn.y, hw: tn.width / 2, hh: tn.height / 2 } : null })()
      : null
    const points = clipEndpointsToNodes(orthoPoints, srcRect, tgtRect)

    // Dagre returns edge label center position directly as edge.x, edge.y
    let labelPosition: Point | undefined
    if (originalEdge.label && dagreEdge.x != null && dagreEdge.y != null) {
      labelPosition = { x: dagreEdge.x, y: dagreEdge.y }
    }

    return {
      source: originalEdge.source,
      target: originalEdge.target,
      label: originalEdge.label,
      style: originalEdge.style,
      hasArrowStart: originalEdge.hasArrowStart,
      hasArrowEnd: originalEdge.hasArrowEnd,
      points,
      labelPosition,
    }
  })

  // ---------------------------------------------------------------------------
  // Compose pre-computed subgraph layouts into the main layout.
  //
  // The main dagre graph positioned each pre-computed subgraph as a leaf node.
  // Now we inject the internal elements at the correct offset and fix cross-
  // boundary edge endpoints so they connect to actual internal nodes.
  // ---------------------------------------------------------------------------
  if (preComputed && preComputed.size > 0) {
    // Build a map of all composed node positions for endpoint fixup
    const nodePositionMap = new Map<string, { cx: number; cy: number }>()
    for (const n of nodes) {
      nodePositionMap.set(n.id, { cx: n.x + n.width / 2, cy: n.y + n.height / 2 })
    }

    for (const [sgId, pc] of preComputed) {
      // Get the placeholder's position from dagre (center-based)
      const placeholder = g.node(sgId)
      if (!placeholder) continue
      const topLeft = centerToTopLeft(placeholder.x, placeholder.y, placeholder.width, placeholder.height)

      // Inject internal nodes at the correct offset
      for (const pcNode of pc.nodes) {
        const composed = {
          ...pcNode,
          x: pcNode.x + topLeft.x,
          y: pcNode.y + topLeft.y,
        }
        nodes.push(composed)
        nodePositionMap.set(composed.id, {
          cx: composed.x + composed.width / 2,
          cy: composed.y + composed.height / 2,
        })
      }

      // Inject internal edges at the correct offset
      for (const pcEdge of pc.edges) {
        edges.push({
          ...pcEdge,
          points: pcEdge.points.map(p => ({ x: p.x + topLeft.x, y: p.y + topLeft.y })),
          labelPosition: pcEdge.labelPosition
            ? { x: pcEdge.labelPosition.x + topLeft.x, y: pcEdge.labelPosition.y + topLeft.y }
            : undefined,
        })
      }

      // Update the group's nested children positions (from pre-computation)
      const group = findGroupById(groups, sgId)
      if (group && pc.groups.length > 0) {
        group.children = pc.groups.map(cg => offsetGroup(cg, topLeft.x, topLeft.y))
      }
    }

    // Fix cross-boundary edge endpoints.
    // Edges that originally connected to internal nodes were redirected to the
    // placeholder during main layout. Now replace the endpoint with the actual
    // composed node position and re-run orthogonal snapping.
    for (const edge of edges) {
      // Skip edges that are from pre-computed layouts (already correctly routed)
      if (preComputedNodeIds.has(edge.source) && preComputedNodeIds.has(edge.target)) continue

      let modified = false

      // Fix source endpoint — if the source is inside a pre-computed subgraph
      if (preComputedNodeIds.has(edge.source)) {
        const pos = nodePositionMap.get(edge.source)
        if (pos && edge.points.length > 0) {
          edge.points[0] = { x: pos.cx, y: pos.cy }
          modified = true
        }
      }

      // Fix target endpoint — if the target is inside a pre-computed subgraph
      if (preComputedNodeIds.has(edge.target)) {
        const pos = nodePositionMap.get(edge.target)
        if (pos && edge.points.length > 0) {
          edge.points[edge.points.length - 1] = { x: pos.cx, y: pos.cy }
          modified = true
        }
      }

      // Re-snap to orthogonal after modifying endpoints
      if (modified) {
        edge.points = snapToOrthogonal(edge.points, verticalFirst)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Post-process: add header space to subgraph groups.
  //
  // Dagre's compound node bounds tightly wrap children — it ignores paddingX/paddingY
  // (those aren't in dagre's nodeNumAttrs). This means the subgraph header label
  // overlaps with the first child node.
  //
  // Fix: expand each labeled group upward by headerHeight so the header band
  // occupies its own space above the children. Process depth-first so child
  // expansions are incorporated before parent bounds are recalculated.
  // ---------------------------------------------------------------------------
  const headerHeight = FONT_SIZES.groupHeader + 16
  expandGroupsForHeaders(groups, headerHeight)

  // Expand group boxes by extra padding (left, right, bottom) beyond dagre's tight bounds
  const extraPadX = Math.max(0, groupPaddingX - 16) // 16 is dagre's default marginx
  const extraPadY = Math.max(0, groupPaddingY - 12) // 12 is dagre's default marginy
  if (extraPadX > 0 || extraPadY > 0) {
    const allGroups = flattenAllGroups(groups)
    for (const grp of allGroups) {
      grp.x -= extraPadX
      grp.width += extraPadX * 2
      grp.height += extraPadY
    }
  }

  // After expanding groups upward, some may extend above dagre's original margins.
  // Compute the global minimum Y and shift everything down uniformly if needed.
  const flatGroups = flattenAllGroups(groups)
  const allYs = [
    ...nodes.map(n => n.y),
    ...flatGroups.map(g => g.y),
  ]
  const currentMinY = allYs.length > 0 ? Math.min(...allYs) : padding
  let graphWidth = g.graph().width ?? 800
  let graphHeight = g.graph().height ?? 600

  if (currentMinY < padding) {
    const dy = padding - currentMinY
    for (const n of nodes) n.y += dy
    for (const e of edges) {
      for (const p of e.points) p.y += dy
      if (e.labelPosition) e.labelPosition.y += dy
    }
    for (const fg of flatGroups) fg.y += dy
    graphHeight += dy
  }

  // With explicit final markers hidden, place their predecessor on the final
  // rank so terminal states remain visibly lower than sibling leaf states.
  promoteImplicitTerminalNodes(nodes, edges, graph.direction)

  // Also expand graph height if any group extends beyond the original bottom margin
  const maxBottom = Math.max(
    ...nodes.map(n => n.y + n.height),
    ...flatGroups.map(g => g.y + g.height),
    ...edges.flatMap(e => e.points.map(p => p.y)),
  )
  if (maxBottom + padding > graphHeight) {
    graphHeight = maxBottom + padding
  }

  // Assign rank info to edges and groups for animation sequencing
  const nodeRankMap = new Map<string, number>()
  for (const n of nodes) {
    if (n.rank != null) nodeRankMap.set(n.id, n.rank)
  }
  for (const edge of edges) {
    edge.sourceRank = nodeRankMap.get(edge.source)
    edge.targetRank = nodeRankMap.get(edge.target)
  }

  // Straight, one-to-one spine transitions should align their nodes instead
  // of paying for a corrective bend near the destination.
  alignLinearSpineNodes(edges, nodes, graph.direction)

  // Center ordinary Z-bends, then move feedback and node-crossing edges onto
  // exterior lanes so connectors cannot create false junctions through nodes.
  for (const edge of edges) {
    edge.points = centerZBends(edge.points, verticalFirst)
  }
  routeExteriorEdges(edges, nodes, graph.direction)
  mergeSharedEdgePorts(edges, nodes, graph.direction)
  centerSingleIncomingTargets(edges, nodes, graph.direction)
  positionEdgeLabels(edges, edgeFontSize)

  // Shared trunks and exterior lanes are post-layout geometry. Refit the
  // canvas after routing so labels and connectors retain the outer padding.
  const routedBounds = fitRoutedContentToCanvas(
    nodes,
    edges,
    flatGroups,
    padding,
    edgeFontSize,
  )
  graphWidth += routedBounds.shiftX
  graphHeight += routedBounds.shiftY

  // Exterior lanes can extend beyond Dagre's original bounds.
  const maxEdgeX = Math.max(0, ...edges.flatMap(edge => edge.points.map(point => point.x)))
  const maxEdgeY = Math.max(0, ...edges.flatMap(edge => edge.points.map(point => point.y)))
  graphWidth = Math.max(graphWidth, maxEdgeX + padding, routedBounds.maxX + padding)
  graphHeight = Math.max(graphHeight, maxEdgeY + padding, routedBounds.maxY + padding)

  assignGroupRanks(groups, nodeRankMap, nodes)

  return {
    width: graphWidth,
    height: graphHeight,
    nodes,
    edges,
    groups,
  }
}

const SHARED_EDGE_STEM = 24
const MAX_SHARED_EDGE_STEM = 96
const ARROW_PULLBACK = ARROW_HEAD.width + 2

function promoteImplicitTerminalNodes(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  direction: MermaidGraph['direction'],
): void {
  const verticalFlow = direction === 'TD' || direction === 'TB' || direction === 'BT'
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const finalNodeIds = new Set(
    nodes.filter(node => node.shape === 'state-end').map(node => node.id),
  )
  const moved = new Set<string>()

  for (const terminalEdge of edges) {
    if (!finalNodeIds.has(terminalEdge.target) || moved.has(terminalEdge.source)) continue
    const source = nodeById.get(terminalEdge.source)
    const terminal = nodeById.get(terminalEdge.target)
    if (!source || !terminal) continue

    const sourceCenter = verticalFlow
      ? source.y + source.height / 2
      : source.x + source.width / 2
    const terminalCenter = verticalFlow
      ? terminal.y + terminal.height / 2
      : terminal.x + terminal.width / 2
    const delta = terminalCenter - sourceCenter
    if (Math.abs(delta) < 1) continue

    if (verticalFlow) source.y += delta
    else source.x += delta
    source.rank = terminal.rank
    moved.add(source.id)

    for (const edge of edges) {
      if (edge.target === source.id && edge.points.length > 0) {
        const endpoint = edge.points[edge.points.length - 1]!
        if (verticalFlow) endpoint.y += delta
        else endpoint.x += delta
      }
      if (edge.source === source.id && edge.points.length > 0) {
        const endpoint = edge.points[0]!
        if (verticalFlow) endpoint.y += delta
        else endpoint.x += delta
      }
    }
  }

  for (const edge of edges) {
    edge.points = snapToOrthogonal(edge.points, verticalFlow)
  }
}

/**
 * Align uncomplicated spine nodes on the flow axis.
 *
 * Moving a node a short distance is visually cheaper than adding a dogleg to
 * an otherwise straight transition. Only unlabeled, forward, one-to-one edges
 * qualify; branching, merging, feedback, and collision cases keep Dagre's
 * placement.
 */
function alignLinearSpineNodes(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  direction: MermaidGraph['direction'],
): void {
  const verticalFlow = direction === 'TD' || direction === 'TB' || direction === 'BT'
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const incomingCount = new Map<string, number>()
  const outgoingCount = new Map<string, number>()

  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1)
  }

  const candidates = edges
    .filter(edge =>
      !edge.label &&
      (incomingCount.get(edge.target) ?? 0) === 1 &&
      (outgoingCount.get(edge.source) ?? 0) === 1 &&
      !(edge.sourceRank != null && edge.targetRank != null && edge.sourceRank > edge.targetRank)
    )
    .sort((a, b) => (a.targetRank ?? 0) - (b.targetRank ?? 0))

  for (const edge of candidates) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue

    const delta = verticalFlow
      ? source.x + source.width / 2 - (target.x + target.width / 2)
      : source.y + source.height / 2 - (target.y + target.height / 2)
    if (Math.abs(delta) < 1 || Math.abs(delta) > 64) continue

    const nextX = verticalFlow ? target.x + delta : target.x
    const nextY = verticalFlow ? target.y : target.y + delta
    if (nodeWouldOverlap(target, nextX, nextY, nodes)) continue

    if (verticalFlow) target.x = nextX
    else target.y = nextY

    // Keep attached endpoints with the moved node. The routing passes below
    // normalize any affected intermediate segment.
    for (const attached of edges) {
      if (attached.target === target.id && attached.points.length > 0) {
        const last = attached.points.length - 1
        if (verticalFlow) attached.points[last]!.x += delta
        else attached.points[last]!.y += delta
      }
      if (attached.source === target.id && attached.points.length > 0) {
        if (verticalFlow) attached.points[0]!.x += delta
        else attached.points[0]!.y += delta
      }
    }
  }

  for (const edge of edges) {
    edge.points = snapToOrthogonal(edge.points, verticalFlow)
  }
}

function nodeWouldOverlap(
  target: PositionedNode,
  nextX: number,
  nextY: number,
  nodes: PositionedNode[],
): boolean {
  const gap = 16
  const left = nextX - gap
  const right = nextX + target.width + gap
  const top = nextY - gap
  const bottom = nextY + target.height + gap

  return nodes.some(node =>
    node.id !== target.id &&
    right > node.x &&
    left < node.x + node.width &&
    bottom > node.y &&
    top < node.y + node.height
  )
}

/**
 * Collapse compatible fan-outs and fan-ins into shared orthogonal trunks.
 *
 * Each shared segment is owned by one representative edge. Other branches
 * begin/end at the split or join, preventing overlapping paths from painting
 * over the single terminal arrowhead.
 */
function mergeSharedEdgePorts(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  direction: MermaidGraph['direction'],
): void {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const verticalFlow = direction === 'TD' || direction === 'TB' || direction === 'BT'
  const reverseFlow = direction === 'BT' || direction === 'RL'
  const flowSign = reverseFlow ? -1 : 1

  const outgoing = groupCompatibleEdges(edges, 'source')
  for (const group of outgoing.values()) {
    if (group.length < 2) continue
    const node = nodeById.get(group[0]!.source)
    if (!node) continue

    const port = verticalFlow
      ? {
          x: node.x + node.width / 2,
          y: flowSign > 0 ? node.y + node.height : node.y,
        }
      : {
          x: flowSign > 0 ? node.x + node.width : node.x,
          y: node.y + node.height / 2,
        }
    const split = verticalFlow
      ? { x: port.x, y: port.y + flowSign * SHARED_EDGE_STEM }
      : { x: port.x + flowSign * SHARED_EDGE_STEM, y: port.y }
    const owner = chooseSharedSegmentOwner(group)

    for (const edge of group) {
      const branch = replaceEdgeStartWithJoin(edge.points, split, verticalFlow)
      edge.points = edge === owner
        ? normalizeOrthogonalPoints([port, split, ...branch.slice(1)])
        : branch
    }
  }

  const incoming = groupCompatibleEdges(edges, 'target')
  for (const group of incoming.values()) {
    if (group.length < 2) continue
    const node = nodeById.get(group[0]!.target)
    if (!node) continue

    const port = verticalFlow
      ? {
          x: node.x + node.width / 2,
          y: flowSign > 0 ? node.y : node.y + node.height,
        }
      : {
          x: flowSign > 0 ? node.x : node.x + node.width,
          y: node.y + node.height / 2,
        }
    const owner = chooseSharedSegmentOwner(group)
    const defaultJoin = getOpticallyCenteredIncomingJoin(
      nodeById.get(owner.source),
      port,
      verticalFlow,
      flowSign,
    )
    const join = chooseIncomingJoin(
      group,
      port,
      defaultJoin,
      verticalFlow,
      flowSign,
    )

    for (const edge of group) {
      const branch = replaceEdgeEndWithJoin(edge.points, join, verticalFlow)
      if (edge === owner) {
        edge.points = normalizeOrthogonalPoints([...branch, port])
      } else {
        edge.points = branch
        edge.hasArrowEnd = false
      }
    }
  }
}

/**
 * Center a fan-in junction in the visible gap between the owning source and
 * target. The terminal arrow pulls the final segment back, so its visible end
 * — not the target boundary — defines the optical midpoint.
 */
function getOpticallyCenteredIncomingJoin(
  source: PositionedNode | undefined,
  port: Point,
  verticalFlow: boolean,
  flowSign: number,
): Point {
  const fallbackStem = SHARED_EDGE_STEM + ARROW_PULLBACK / 2
  if (!source) {
    return verticalFlow
      ? { x: port.x, y: port.y - flowSign * fallbackStem }
      : { x: port.x - flowSign * fallbackStem, y: port.y }
  }

  const sourceBoundary = verticalFlow
    ? (flowSign > 0 ? source.y + source.height : source.y)
    : (flowSign > 0 ? source.x + source.width : source.x)
  const portCoordinate = verticalFlow ? port.y : port.x
  const availableGap = (portCoordinate - sourceBoundary) * flowSign
  const centeredStem = availableGap > 0
    ? (availableGap + ARROW_PULLBACK) / 2
    : fallbackStem
  const stem = Math.max(SHARED_EDGE_STEM, Math.min(MAX_SHARED_EDGE_STEM, centeredStem))

  return verticalFlow
    ? { x: port.x, y: port.y - flowSign * stem }
    : { x: port.x - flowSign * stem, y: port.y }
}

/**
 * Reuse a nearby branch lane for the fan-in bus when possible.
 *
 * A fixed bus offset can introduce a needless down-up dogleg when one branch
 * already runs across the target at a clean height. Snapping the join to that
 * lane removes bends while retaining a sufficiently long final ingress stem.
 */
function chooseIncomingJoin(
  edges: PositionedEdge[],
  port: Point,
  fallback: Point,
  verticalFlow: boolean,
  flowSign: number,
): Point {
  const candidates: number[] = []

  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index++) {
      const start = edge.points[index - 1]!
      const end = edge.points[index]!
      const isCrossFlowSegment = verticalFlow
        ? Math.abs(start.y - end.y) < 1 && Math.abs(start.x - end.x) >= 1
        : Math.abs(start.x - end.x) < 1 && Math.abs(start.y - end.y) >= 1
      if (!isCrossFlowSegment) continue

      const coordinate = verticalFlow ? start.y : start.x
      const stemLength = verticalFlow
        ? (port.y - coordinate) * flowSign
        : (port.x - coordinate) * flowSign
      if (stemLength >= SHARED_EDGE_STEM && stemLength <= MAX_SHARED_EDGE_STEM) {
        candidates.push(coordinate)
      }
    }
  }

  if (candidates.length === 0) return fallback
  const closest = candidates.sort((a, b) => {
    const distanceA = verticalFlow ? Math.abs(port.y - a) : Math.abs(port.x - a)
    const distanceB = verticalFlow ? Math.abs(port.y - b) : Math.abs(port.x - b)
    return distanceA - distanceB
  })[0]!

  return verticalFlow
    ? { x: port.x, y: closest }
    : { x: closest, y: port.y }
}

/**
 * A lone forward transition should meet the center of its target's ingress
 * side. Reuse an existing bend when possible so centering does not increase
 * the path's bend count.
 */
function centerSingleIncomingTargets(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  direction: MermaidGraph['direction'],
): void {
  const verticalFlow = direction === 'TD' || direction === 'TB' || direction === 'BT'
  const reverseFlow = direction === 'BT' || direction === 'RL'
  const flowSign = reverseFlow ? -1 : 1
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const incomingCount = new Map<string, number>()

  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
  }

  for (const edge of edges) {
    if (
      !edge.hasArrowEnd ||
      (incomingCount.get(edge.target) ?? 0) !== 1 ||
      (edge.sourceRank != null && edge.targetRank != null && edge.sourceRank > edge.targetRank)
    ) continue

    const target = nodeById.get(edge.target)
    if (!target) continue
    const port = verticalFlow
      ? {
          x: target.x + target.width / 2,
          y: flowSign > 0 ? target.y : target.y + target.height,
        }
      : {
          x: flowSign > 0 ? target.x : target.x + target.width,
          y: target.y + target.height / 2,
        }
    edge.points = routeToCenteredIngress(edge.points, port, verticalFlow, flowSign)
  }
}

function routeToCenteredIngress(
  points: Point[],
  port: Point,
  verticalFlow: boolean,
  flowSign: number,
): Point[] {
  if (points.length < 2) return points
  const routed = points.map(point => ({ ...point }))
  const last = routed.length - 1
  const previous = routed[last - 1]!
  const beforePrevious = routed[last - 2]

  if (verticalFlow) {
    if (Math.abs(previous.x - port.x) < 1) {
      routed[last] = port
    } else if (beforePrevious && Math.abs(beforePrevious.y - previous.y) < 1) {
      // Slide the existing terminal vertical run to the node center. This
      // preserves the bend count and only changes the preceding run's length.
      routed[last - 1] = { x: port.x, y: previous.y }
      routed[last] = port
    } else {
      const approachY = port.y - flowSign * SHARED_EDGE_STEM
      routed.splice(last, 1,
        { x: previous.x, y: approachY },
        { x: port.x, y: approachY },
        port,
      )
    }
  } else if (Math.abs(previous.y - port.y) < 1) {
    routed[last] = port
  } else if (beforePrevious && Math.abs(beforePrevious.x - previous.x) < 1) {
    routed[last - 1] = { x: previous.x, y: port.y }
    routed[last] = port
  } else {
    const approachX = port.x - flowSign * SHARED_EDGE_STEM
    routed.splice(last, 1,
      { x: approachX, y: previous.y },
      { x: approachX, y: port.y },
      port,
    )
  }

  return normalizeOrthogonalPoints(routed)
}

/** Group edges only when their visual semantics can share a connector. */
function groupCompatibleEdges(
  edges: PositionedEdge[],
  endpoint: 'source' | 'target',
): Map<string, PositionedEdge[]> {
  const groups = new Map<string, PositionedEdge[]>()

  for (const edge of edges) {
    if (edge.points.length < 2 || edge.source === edge.target) continue
    if (endpoint === 'source' && edge.hasArrowStart) continue
    if (endpoint === 'target' && (!edge.hasArrowEnd || edge.hasArrowStart)) continue

    const nodeId = endpoint === 'source' ? edge.source : edge.target
    const key = `${nodeId}:${edge.style}:${edge.hasArrowStart}:${edge.hasArrowEnd}`
    const group = groups.get(key) ?? []
    group.push(edge)
    groups.set(key, group)
  }

  return groups
}

/** Prefer a forward, short edge to own a shared trunk and its arrowhead. */
function chooseSharedSegmentOwner(edges: PositionedEdge[]): PositionedEdge {
  return [...edges].sort((a, b) => {
    const aFeedback = a.sourceRank != null && a.targetRank != null && a.sourceRank > a.targetRank
    const bFeedback = b.sourceRank != null && b.targetRank != null && b.sourceRank > b.targetRank
    if (aFeedback !== bFeedback) return aFeedback ? 1 : -1
    return polylineLength(a.points) - polylineLength(b.points)
  })[0]!
}

function replaceEdgeStartWithJoin(
  points: Point[],
  split: Point,
  verticalFlow: boolean,
): Point[] {
  const anchor = points[1] ?? points[0] ?? split
  const connector = snapToOrthogonal([split, anchor], !verticalFlow)
  return normalizeOrthogonalPoints([...connector, ...points.slice(2)])
}

function replaceEdgeEndWithJoin(
  points: Point[],
  join: Point,
  verticalFlow: boolean,
): Point[] {
  // If the chosen bus coincides with an existing branch lane, trim the old
  // tail at that lane instead of preserving a redundant out-and-back dogleg.
  for (let index = points.length - 2; index >= 0; index--) {
    const point = points[index]!
    const aligned = verticalFlow
      ? Math.abs(point.y - join.y) < 1
      : Math.abs(point.x - join.x) < 1
    if (!aligned) continue
    const connector = snapToOrthogonal([point, join], verticalFlow)
    return normalizeOrthogonalPoints([
      ...points.slice(0, index + 1),
      ...connector.slice(1),
    ])
  }

  const anchor = points[points.length - 2] ?? points[0] ?? join
  const connector = snapToOrthogonal([anchor, join], verticalFlow)
  return normalizeOrthogonalPoints([...points.slice(0, -2), ...connector])
}

function normalizeOrthogonalPoints(points: Point[]): Point[] {
  const deduped: Point[] = []
  for (const point of points) {
    const previous = deduped[deduped.length - 1]
    if (previous && Math.abs(previous.x - point.x) < 1 && Math.abs(previous.y - point.y) < 1) continue
    deduped.push({ ...point })
  }

  if (deduped.length < 3) return deduped
  const normalized: Point[] = [deduped[0]!]
  for (let index = 1; index < deduped.length - 1; index++) {
    const previous = normalized[normalized.length - 1]!
    const point = deduped[index]!
    const next = deduped[index + 1]!
    const sameX = Math.abs(previous.x - point.x) < 1 && Math.abs(point.x - next.x) < 1
    const sameY = Math.abs(previous.y - point.y) < 1 && Math.abs(point.y - next.y) < 1
    if (!sameX && !sameY) normalized.push(point)
  }
  normalized.push(deduped[deduped.length - 1]!)
  return normalized
}

/** Place labels on the longest straight run that satisfies their clearance. */
function positionEdgeLabels(edges: PositionedEdge[], edgeFontSize: number): void {
  for (const edge of edges) {
    if (!edge.label || edge.points.length < 2) continue
    const displayLabel = titleCaseEdgeLabel(edge.label)
    const width =
      estimateTextWidth(displayLabel, edgeFontSize, FONT_WEIGHTS.edgeLabel) +
      EDGE_LABEL_SPACING.paddingX * 2
    const height = edgeFontSize + EDGE_LABEL_SPACING.paddingY * 2
    let best: { start: Point; end: Point; score: number } | undefined
    let fallback: { start: Point; end: Point; score: number } | undefined

    for (let index = 1; index < edge.points.length; index++) {
      const start = edge.points[index - 1]!
      const end = edge.points[index]!
      const horizontal = Math.abs(start.y - end.y) < 1
      const vertical = Math.abs(start.x - end.x) < 1
      if (!horizontal && !vertical) continue
      const length = Math.abs(horizontal ? end.x - start.x : end.y - start.y)
      const required =
        (horizontal ? width : height) + EDGE_LABEL_SPACING.clearance * 2
      const candidate = { start, end, score: length - required }
      if (!fallback || length > fallback.score) {
        fallback = { start, end, score: length }
      }
      if (candidate.score >= 0 && (!best || candidate.score > best.score)) {
        best = candidate
      }
    }

    const segment = best ?? fallback
    if (segment) {
      edge.labelPosition = {
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      }
    }
  }
}

function polylineLength(points: Point[]): number {
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += Math.abs(points[index]!.x - points[index - 1]!.x) +
      Math.abs(points[index]!.y - points[index - 1]!.y)
  }
  return length
}

/** Keep routed connectors and label pills inside the requested canvas padding. */
function fitRoutedContentToCanvas(
  nodes: PositionedNode[],
  edges: PositionedEdge[],
  groups: PositionedGroup[],
  padding: number,
  edgeFontSize: number,
): { shiftX: number; shiftY: number; maxX: number; maxY: number } {
  const xs: number[] = []
  const ys: number[] = []

  for (const node of nodes) {
    xs.push(node.x, node.x + node.width)
    ys.push(node.y, node.y + node.height)
  }
  for (const group of groups) {
    xs.push(group.x, group.x + group.width)
    ys.push(group.y, group.y + group.height)
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      xs.push(point.x)
      ys.push(point.y)
    }
    if (edge.label && edge.labelPosition) {
      const displayLabel = titleCaseEdgeLabel(edge.label)
      const labelWidth =
        estimateTextWidth(displayLabel, edgeFontSize, FONT_WEIGHTS.edgeLabel) +
        EDGE_LABEL_SPACING.paddingX * 2
      const labelHeight = edgeFontSize + EDGE_LABEL_SPACING.paddingY * 2
      xs.push(edge.labelPosition.x - labelWidth / 2, edge.labelPosition.x + labelWidth / 2)
      ys.push(edge.labelPosition.y - labelHeight / 2, edge.labelPosition.y + labelHeight / 2)
    }
  }

  const minX = xs.length > 0 ? Math.min(...xs) : padding
  const minY = ys.length > 0 ? Math.min(...ys) : padding
  const shiftX = Math.max(0, padding - minX)
  const shiftY = Math.max(0, padding - minY)

  if (shiftX > 0 || shiftY > 0) {
    for (const node of nodes) {
      node.x += shiftX
      node.y += shiftY
    }
    for (const edge of edges) {
      for (const point of edge.points) {
        point.x += shiftX
        point.y += shiftY
      }
      if (edge.labelPosition) {
        edge.labelPosition.x += shiftX
        edge.labelPosition.y += shiftY
      }
    }
    for (const group of groups) {
      group.x += shiftX
      group.y += shiftY
    }
  }

  return {
    shiftX,
    shiftY,
    maxX: (xs.length > 0 ? Math.max(...xs) : 0) + shiftX,
    maxY: (ys.length > 0 ? Math.max(...ys) : 0) + shiftY,
  }
}

/**
 * Route long feedback edges and any connector that intersects an unrelated
 * node around the outside of all nodes in its span.
 */
function routeExteriorEdges(
  edges: PositionedEdge[],
  nodes: PositionedNode[],
  direction: MermaidGraph['direction'],
): void {
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const verticalFlow = direction === 'TD' || direction === 'TB' || direction === 'BT'
  const laneGap = 24
  const laneStep = 16
  let firstLaneCount = 0
  let secondLaneCount = 0
  const routedEdges: PositionedEdge[] = []

  for (const edge of edges) {
    const isLongFeedback =
      edge.sourceRank != null &&
      edge.targetRank != null &&
      edge.sourceRank > edge.targetRank &&
      edge.points.length >= 4
    const crossesNode = edgeCrossesUnrelatedNode(edge, nodes)
    if (!isLongFeedback && !crossesNode) continue

    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue

    const sourceCx = source.x + source.width / 2
    const sourceCy = source.y + source.height / 2
    const targetCx = target.x + target.width / 2
    const targetCy = target.y + target.height / 2

    if (verticalFlow) {
      const spanTop = Math.min(sourceCy, targetCy)
      const spanBottom = Math.max(sourceCy, targetCy)
      const blockers = nodes.filter(node => {
        const cy = node.y + node.height / 2
        return cy >= spanTop && cy <= spanBottom
      })
      const minX = Math.min(...blockers.map(node => node.x))
      const maxX = Math.max(...blockers.map(node => node.x + node.width))
      const currentMinX = Math.min(...edge.points.map(point => point.x))
      const currentMaxX = Math.max(...edge.points.map(point => point.x))
      const centerX = (sourceCx + targetCx) / 2
      const useLeft = centerX - currentMinX >= currentMaxX - centerX
      const leftLaneX = minX - laneGap - firstLaneCount * laneStep

      if (useLeft && leftLaneX >= 0) {
        const laneX = leftLaneX
        firstLaneCount++
        edge.points = [
          { x: source.x, y: sourceCy },
          { x: laneX, y: sourceCy },
          { x: laneX, y: targetCy },
          { x: target.x, y: targetCy },
        ]
        if (edge.label) edge.labelPosition = { x: laneX, y: (sourceCy + targetCy) / 2 }
      } else {
        const laneX = maxX + laneGap + secondLaneCount++ * laneStep
        edge.points = [
          { x: source.x + source.width, y: sourceCy },
          { x: laneX, y: sourceCy },
          { x: laneX, y: targetCy },
          { x: target.x + target.width, y: targetCy },
        ]
        if (edge.label) edge.labelPosition = { x: laneX, y: (sourceCy + targetCy) / 2 }
      }
      routedEdges.push(edge)
    } else {
      const spanLeft = Math.min(sourceCx, targetCx)
      const spanRight = Math.max(sourceCx, targetCx)
      const blockers = nodes.filter(node => {
        const cx = node.x + node.width / 2
        return cx >= spanLeft && cx <= spanRight
      })
      const minY = Math.min(...blockers.map(node => node.y))
      const maxY = Math.max(...blockers.map(node => node.y + node.height))
      const currentMinY = Math.min(...edge.points.map(point => point.y))
      const currentMaxY = Math.max(...edge.points.map(point => point.y))
      const centerY = (sourceCy + targetCy) / 2
      const useTop = centerY - currentMinY >= currentMaxY - centerY
      const topLaneY = minY - laneGap - firstLaneCount * laneStep

      if (useTop && topLaneY >= 0) {
        const laneY = topLaneY
        firstLaneCount++
        edge.points = [
          { x: sourceCx, y: source.y },
          { x: sourceCx, y: laneY },
          { x: targetCx, y: laneY },
          { x: targetCx, y: target.y },
        ]
        if (edge.label) edge.labelPosition = { x: (sourceCx + targetCx) / 2, y: laneY }
      } else {
        const laneY = maxY + laneGap + secondLaneCount++ * laneStep
        edge.points = [
          { x: sourceCx, y: source.y + source.height },
          { x: sourceCx, y: laneY },
          { x: targetCx, y: laneY },
          { x: targetCx, y: target.y + target.height },
        ]
        if (edge.label) edge.labelPosition = { x: (sourceCx + targetCx) / 2, y: laneY }
      }
      routedEdges.push(edge)
    }
  }

  separateExteriorPorts(routedEdges, nodeById, verticalFlow, 'source')
  separateExteriorPorts(routedEdges, nodeById, verticalFlow, 'target')
}

/** Whether any orthogonal segment runs through a node it does not connect to. */
function edgeCrossesUnrelatedNode(edge: PositionedEdge, nodes: PositionedNode[]): boolean {
  const blockers = nodes.filter(node => node.id !== edge.source && node.id !== edge.target)
  const inset = 1

  for (let index = 1; index < edge.points.length; index++) {
    const start = edge.points[index - 1]!
    const end = edge.points[index]!
    const segmentLeft = Math.min(start.x, end.x)
    const segmentRight = Math.max(start.x, end.x)
    const segmentTop = Math.min(start.y, end.y)
    const segmentBottom = Math.max(start.y, end.y)
    const vertical = Math.abs(start.x - end.x) < 1
    const horizontal = Math.abs(start.y - end.y) < 1

    for (const node of blockers) {
      const left = node.x + inset
      const right = node.x + node.width - inset
      const top = node.y + inset
      const bottom = node.y + node.height - inset

      if (
        (vertical && start.x > left && start.x < right && segmentBottom > top && segmentTop < bottom) ||
        (horizontal && start.y > top && start.y < bottom && segmentRight > left && segmentLeft < right)
      ) return true
    }
  }

  return false
}

/** Keep multiple exterior routes sharing a node side from overlapping. */
function separateExteriorPorts(
  edges: PositionedEdge[],
  nodeById: Map<string, PositionedNode>,
  verticalFlow: boolean,
  endpoint: 'source' | 'target',
): void {
  const groups = new Map<string, PositionedEdge[]>()

  for (const edge of edges) {
    const nodeId = endpoint === 'source' ? edge.source : edge.target
    const node = nodeById.get(nodeId)
    const point = endpoint === 'source' ? edge.points[0] : edge.points[edge.points.length - 1]
    if (!node || !point) continue

    const side = verticalFlow
      ? (Math.abs(point.x - node.x) < 1 ? 'left' : 'right')
      : (Math.abs(point.y - node.y) < 1 ? 'top' : 'bottom')
    const key = `${nodeId}:${side}`
    const group = groups.get(key) ?? []
    group.push(edge)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const nodeId = endpoint === 'source' ? group[0]!.source : group[0]!.target
    const node = nodeById.get(nodeId)!
    const step = 16
    const maxOffset = Math.max(0, (verticalFlow ? node.height : node.width) / 2 - 12)

    for (let index = 0; index < group.length; index++) {
      const edge = group[index]!
      const offset = Math.max(
        -maxOffset,
        Math.min(maxOffset, (index - (group.length - 1) / 2) * step),
      )
      const pointIndex = endpoint === 'source' ? 0 : edge.points.length - 1
      const adjacentIndex = endpoint === 'source' ? 1 : pointIndex - 1

      if (verticalFlow) {
        const y = node.y + node.height / 2 + offset
        edge.points[adjacentIndex] = { ...edge.points[adjacentIndex]!, y }
        edge.points[pointIndex] = { ...edge.points[pointIndex]!, y }
      } else {
        const x = node.x + node.width / 2 + offset
        edge.points[adjacentIndex] = { ...edge.points[adjacentIndex]!, x }
        edge.points[pointIndex] = { ...edge.points[pointIndex]!, x }
      }
    }
  }
}

/**
 * Extract a positioned group from a subgraph in the dagre layout.
 * Dagre gives compound nodes absolute coordinates (center-based),
 * so no container-relative offset math is needed.
 */
function extractGroup(
  g: dagre.graphlib.Graph,
  sg: MermaidSubgraph,
): PositionedGroup {
  const dagreNode = g.node(sg.id)
  const topLeft = dagreNode
    ? centerToTopLeft(dagreNode.x, dagreNode.y, dagreNode.width, dagreNode.height)
    : { x: 0, y: 0 }

  return {
    id: sg.id,
    label: sg.label,
    x: topLeft.x,
    y: topLeft.y,
    width: dagreNode?.width ?? 0,
    height: dagreNode?.height ?? 0,
    children: sg.children.map(child => extractGroup(g, child)),
  }
}

/** Assign rank to groups based on the min rank of nodes geometrically inside them */
function assignGroupRanks(groups: PositionedGroup[], nodeRankMap: Map<string, number>, allNodes: PositionedNode[]): void {
  for (const group of groups) {
    assignGroupRanks(group.children, nodeRankMap, allNodes)
    let minRank = Infinity
    // Check child group ranks
    for (const child of group.children) {
      if (child.rank != null && child.rank < minRank) minRank = child.rank
    }
    // Check nodes inside this group's bounding box
    for (const node of allNodes) {
      if (node.rank == null) continue
      if (node.x >= group.x && node.x + node.width <= group.x + group.width &&
          node.y >= group.y && node.y + node.height <= group.y + group.height) {
        if (node.rank < minRank) minRank = node.rank
      }
    }
    group.rank = minRank === Infinity ? 0 : minRank
  }
}

// ============================================================================
// Header space post-processing
//
// Dagre ignores paddingX/paddingY on compound nodes (not in nodeNumAttrs).
// These helpers expand group boxes upward to create space for header labels.
// ============================================================================

/**
 * Expand all groups upward to make room for header labels.
 * Processes depth-first so child expansions are accounted for when
 * parent bounds are recalculated.
 */
function expandGroupsForHeaders(groups: PositionedGroup[], headerHeight: number): void {
  for (const group of groups) {
    expandGroupForHeader(group, headerHeight)
  }
}

/**
 * Recursively expand a single group and its children for header space.
 *
 * Algorithm (depth-first):
 *   1. Expand all children first
 *   2. Re-fit this group's bounds to encompass any expanded children
 *   3. Expand this group upward by headerHeight for its own header
 */
function expandGroupForHeader(group: PositionedGroup, headerHeight: number): void {
  // Step 1: process children first
  for (const child of group.children) {
    expandGroupForHeader(child, headerHeight)
  }

  // Step 2: re-fit bounds to encompass expanded children.
  // After children expand upward, they may extend above this group's dagre-computed top.
  if (group.children.length > 0) {
    let minY = group.y
    let maxY = group.y + group.height
    for (const child of group.children) {
      minY = Math.min(minY, child.y)
      maxY = Math.max(maxY, child.y + child.height)
    }
    group.height = maxY - minY
    group.y = minY
  }

  // Step 3: expand upward for this group's own header band + content padding.
  // The content padding (GROUP_HEADER_CONTENT_PAD) creates a gap between the header
  // band bottom and the content area, preventing nested subgraph headers from being
  // flush against their parent's header band.
  if (group.label) {
    const expansion = headerHeight + GROUP_HEADER_CONTENT_PAD
    group.y -= expansion
    group.height += expansion
  }
}

/** Flatten a group tree into a flat array of all groups (including nested). */
function flattenAllGroups(groups: PositionedGroup[]): PositionedGroup[] {
  const result: PositionedGroup[] = []
  for (const g of groups) {
    result.push(g)
    result.push(...flattenAllGroups(g.children))
  }
  return result
}

/** Find a group by ID in a nested group tree (depth-first). */
function findGroupById(groups: PositionedGroup[], id: string): PositionedGroup | undefined {
  for (const g of groups) {
    if (g.id === id) return g
    const found = findGroupById(g.children, id)
    if (found) return found
  }
  return undefined
}

/** Create a copy of a positioned group with all positions offset by (dx, dy). */
function offsetGroup(group: PositionedGroup, dx: number, dy: number): PositionedGroup {
  return {
    ...group,
    x: group.x + dx,
    y: group.y + dy,
    children: group.children.map(c => offsetGroup(c, dx, dy)),
  }
}

/** Recursively collect all subgraph IDs (including nested) */
function collectAllSubgraphIds(sg: MermaidSubgraph, out: Set<string>): void {
  out.add(sg.id)
  for (const child of sg.children) {
    collectAllSubgraphIds(child, out)
  }
}
