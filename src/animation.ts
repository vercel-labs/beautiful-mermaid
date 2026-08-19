// ============================================================================
// Animation system — CSS + SMIL animation for SVG diagrams
//
// Timing model:
//   - `duration`: base node duration + reference edge duration
//   - edge duration scales with path distance up to `maxDuration`
//   - `stagger`: delay between consecutive elements
//   - `groupDelay`: extra offset for group container reveal
//
// Easing model:
//   - `nodeEasing`: expo-out for restrained, quick-settling reveals
//   - `edgeEasing`: organic acceleration/deceleration for traveling lines
//   - Arrow SMIL keySplines auto-derived from edgeEasing to stay perfectly synced
//
// Cascade: source node → edge draws → target node appears
// ============================================================================

import type { PositionedGraph, PositionedNode, PositionedGroup, AnimationOptions } from './types.ts'

/** Fully resolved animation options with all defaults applied */
export type ResolvedAnimation = Required<AnimationOptions>

const DEFAULTS: ResolvedAnimation = {
  duration: 500,
  maxDuration: 980,
  stagger: 0,
  groupDelay: 60,
  nodeOverlap: 0.48,
  nodeEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  edgeEasing: 'cubic-bezier(0.3, 0, 0.3, 1)',
  nodeAnimation: 'scale',
  edgeAnimation: 'draw',
  reducedMotion: true,
}

/** Resolve animate option to full AnimationOptions or null (disabled) */
export function resolveAnimation(
  animate: boolean | AnimationOptions | undefined
): ResolvedAnimation | null {
  if (!animate) return null
  if (animate === true) return { ...DEFAULTS }
  const resolved = { ...DEFAULTS, ...animate }
  if (animate.duration != null && animate.maxDuration == null) {
    resolved.maxDuration = Math.round(
      animate.duration * (DEFAULTS.maxDuration / DEFAULTS.duration),
    )
  }
  return resolved
}

// ============================================================================
// CSS easing → SMIL keySplines conversion
//
// SMIL <animateMotion> uses `calcMode="spline"` with `keySplines="x1 y1 x2 y2"`
// which is the same control points as CSS `cubic-bezier(x1, y1, x2, y2)`.
// Named CSS easings are mapped to their cubic-bezier equivalents.
// ============================================================================

const NAMED_EASINGS: Record<string, string> = {
  'ease':        '0.25 0.1 0.25 1',
  'ease-in':     '0.42 0 1 1',
  'ease-out':    '0 0 0.58 1',
  'ease-in-out': '0.42 0 0.58 1',
  'linear':      '0 0 1 1',
}

/** Convert CSS easing to SMIL keySplines value */
export function cssEasingToSmil(easing: string): string {
  // Check named easings
  const named = NAMED_EASINGS[easing]
  if (named) return named

  // Parse cubic-bezier(x1, y1, x2, y2)
  const match = easing.match(/cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)
  if (match) return `${match[1]} ${match[2]} ${match[3]} ${match[4]}`

  // Fallback: ease-out
  return '0 0 0.58 1'
}

// ============================================================================
// Delay computation
// ============================================================================

/** Computed delays for every element in the graph */
export interface ElementDelays {
  nodes: Map<string, number>   // nodeId → delay ms
  edges: Map<number, number>   // edge index → delay ms
  edgeDurations: Map<number, number> // edge index → distance-scaled duration ms
  groups: Map<string, number>  // groupId → delay ms
}

const EDGE_REFERENCE_DISTANCE = 160
const EDGE_MIN_DURATION_RATIO = 0.68
const SOURCE_EDGE_START_PROGRESS = 0.42
const FEEDBACK_EDGE_REST = 100
const INITIAL_HOLD = 120

/** Scale an edge's travel time by geometric distance without letting long
 * exterior routes make the entire diagram feel sluggish. */
export function computeEdgeDuration(
  points: PositionedGraph['edges'][number]['points'],
  opts: ResolvedAnimation,
): number {
  let distance = 0
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!
    const end = points[index]!
    distance += Math.hypot(end.x - start.x, end.y - start.y)
  }

  const minimum = opts.duration * EDGE_MIN_DURATION_RATIO
  const maximum = Math.max(minimum, opts.maxDuration)
  const scaled = opts.duration * Math.sqrt(Math.max(distance, 24) / EDGE_REFERENCE_DISTANCE)
  return Math.round(Math.min(maximum, Math.max(minimum, scaled)))
}

/** Compute animation delay for each element based on the cascade:
 *  source node visible → edge draws → edge finishes → target node appears */
export function computeDelays(
  graph: PositionedGraph,
  opts: ResolvedAnimation,
): ElementDelays {
  const nodes = new Map<string, number>()
  const edges = new Map<number, number>()
  const edgeDurations = new Map<number, number>()
  const groups = new Map<string, number>()

  for (let edgeIdx = 0; edgeIdx < graph.edges.length; edgeIdx++) {
    edgeDurations.set(edgeIdx, computeEdgeDuration(graph.edges[edgeIdx]!.points, opts))
  }

  const withinRankStagger = opts.stagger * 0.5

  // Build incoming edges map: nodeId → edge indices that target this node
  const incomingEdges = new Map<string, number[]>()
  for (let i = 0; i < graph.edges.length; i++) {
    const target = graph.edges[i]!.target
    if (!incomingEdges.has(target)) incomingEdges.set(target, [])
    incomingEdges.get(target)!.push(i)
  }

  // Group nodes by rank for within-rank stagger
  const rankBuckets = new Map<number, PositionedNode[]>()
  for (const node of graph.nodes) {
    const rank = node.rank ?? 0
    if (!rankBuckets.has(rank)) rankBuckets.set(rank, [])
    rankBuckets.get(rank)!.push(node)
  }
  for (const bucket of rankBuckets.values()) {
    bucket.sort((a, b) => a.x - b.x)
  }

  // Sort ranks in order
  const sortedRanks = [...rankBuckets.keys()].sort((a, b) => a - b)

  // Cascading delay computation: process ranks in order.
  // Forward edges are coordinated by destination so branches from an early
  // source do not finish and float while waiting for a later source/node.
  for (const rank of sortedRanks) {
    const bucket = rankBuckets.get(rank)!
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i]!
      const incoming = incomingEdges.get(node.id) ?? []
      const readyIncoming = incoming.filter(edgeIdx => {
        const source = graph.edges[edgeIdx]!.source
        return nodes.has(source)
      })

      if (node.shape === 'state-start') {
        // The invisible initial pseudostate creates a short opening breath,
        // then hands off to the ingress edge without animating itself.
        nodes.set(
          node.id,
          INITIAL_HOLD - opts.duration * SOURCE_EDGE_START_PROGRESS,
        )
      } else if (readyIncoming.length === 0) {
        // Root or cycle entry: use rank-based stagger. Edges from sources that
        // appear later are feedback edges and are scheduled after all nodes.
        nodes.set(node.id, rank * opts.stagger + i * withinRankStagger)
      } else {
        // Coordinate incoming edges by arrival rather than departure. Routes
        // with different lengths begin at different times, then land together
        // so the target receives one clear causal beat.
        const sourceReady = new Map<number, number>()
        let coordinatedArrival = 0
        for (const edgeIdx of readyIncoming) {
          const source = graph.edges[edgeIdx]!.source
          const sourceDelay = nodes.get(source) ?? 0
          // Let motion carry through the graph before the source node has fully
          // settled. The first ingress edge still starts at t=0.
          const readyAt = Math.max(
            0,
            sourceDelay + opts.duration * SOURCE_EDGE_START_PROGRESS,
          )
          sourceReady.set(edgeIdx, readyAt)
          coordinatedArrival = Math.max(
            coordinatedArrival,
            readyAt + (edgeDurations.get(edgeIdx) ?? opts.duration),
          )
        }

        coordinatedArrival += i * withinRankStagger
        let latestEdgeStart = 0
        for (const edgeIdx of readyIncoming) {
          const edgeDuration = edgeDurations.get(edgeIdx) ?? opts.duration
          const edgeDelay = Math.max(
            sourceReady.get(edgeIdx) ?? 0,
            coordinatedArrival - edgeDuration,
          )
          edges.set(edgeIdx, edgeDelay)
          latestEdgeStart = Math.max(latestEdgeStart, edgeDelay)
        }

        // `nodeOverlap` is based on node time, not edge percentage, keeping
        // the arrival beat perceptually consistent across short and long edges.
        const arrivalLead = opts.duration * opts.nodeOverlap
        nodes.set(
          node.id,
          Math.max(latestEdgeStart, coordinatedArrival - arrivalLead),
        )
      }
    }
  }

  // Remaining edges point back to an already-visible rank (or laterally to a
  // node processed earlier). A short rest beat separates these return paths
  // from the forward narrative and keeps crossing motion legible.
  for (let edgeIdx = 0; edgeIdx < graph.edges.length; edgeIdx++) {
    if (edges.has(edgeIdx)) continue
    const sourceDelay = nodes.get(graph.edges[edgeIdx]!.source) ?? 0
    edges.set(
      edgeIdx,
      Math.max(0, sourceDelay + opts.duration + FEEDBACK_EDGE_REST),
    )
  }

  // Group delays: appear when children are mostly visible
  collectGroupDelays(graph.groups, graph.nodes, opts, nodes, groups)

  return { nodes, edges, edgeDurations, groups }
}

/** When group container appears relative to last child (0 = start, 1 = fully done) */
const GROUP_REVEAL_PROGRESS = 0.6

function collectGroupDelays(
  groups: PositionedGroup[],
  allNodes: PositionedNode[],
  opts: ResolvedAnimation,
  nodeDelays: Map<string, number>,
  out: Map<string, number>,
): void {
  for (const group of groups) {
    collectGroupDelays(group.children, allNodes, opts, nodeDelays, out)

    // Find the latest node delay inside this group's bounding box
    let maxDelay = 0
    for (const node of allNodes) {
      const nd = nodeDelays.get(node.id)
      if (nd == null) continue
      if (node.x >= group.x && node.x + node.width <= group.x + group.width &&
          node.y >= group.y && node.y + node.height <= group.y + group.height) {
        if (nd > maxDelay) maxDelay = nd
      }
    }
    out.set(group.id, maxDelay + opts.duration * GROUP_REVEAL_PROGRESS + opts.groupDelay)
  }
}

// ============================================================================
// CSS generation
// ============================================================================

/** Build the CSS animation keyframes + class rules for the <style> block */
export function buildAnimationCSS(opts: ResolvedAnimation): string {
  const nodeKeyframe = opts.nodeAnimation === 'fade-up'
    ? 'a-fade-up'
    : opts.nodeAnimation === 'scale'
      ? 'a-scale'
      : 'a-fade'
  const nodeRule = opts.nodeAnimation === 'none'
    ? '.an { opacity: 1; }'
    : `.an { opacity: 0; animation: ${nodeKeyframe} ${opts.duration}ms ${opts.nodeEasing} var(--d) forwards; transform-box: fill-box; transform-origin: center; }`

  return `
  /* Animation keyframes */
  @keyframes a-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes a-label-in {
    0% { opacity: 0 }
    60% { opacity: 0.7 }
    100% { opacity: 1 }
  }
  @keyframes a-fade-up { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: translateY(0) } }
  @keyframes a-scale {
    0% { opacity: 0; transform: scale(0.975); filter: blur(0.6px) }
    55% { opacity: 1; filter: blur(0.12px) }
    100% { opacity: 1; transform: scale(1); filter: blur(0) }
  }

  /* Animated nodes — expo-out: fast appear, gentle settle */
  ${nodeRule}

  /* Animated groups — same easing as nodes */
  .ag { opacity: 0; animation: a-fade ${opts.duration}ms ${opts.nodeEasing} var(--d) forwards; }

  /* Fade-only edges (including dotted lines) use the same restrained cadence. */
  .aeg-fade { opacity: 0; animation: a-fade var(--ed) ${opts.nodeEasing} var(--d) forwards; }

  /* A soft underlay exists only during travel; the resting diagram stays crisp. */
  .aet { filter: blur(0.7px); }
  .aef { filter: blur(1.1px); }

  /* Labels arrive after the moving edge has established direction. */
  .ael { opacity: 0; animation: a-label-in var(--ad, 320ms) linear var(--d) forwards; }

  /* Traveling arrowheads are driven by the same SMIL spline as the edge. */
  .aa { opacity: 0; }
${opts.reducedMotion ? `
  /* Accessibility: disable animations for users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .an, .ag, .aeg-fade, .ael { animation: none !important; opacity: 1 !important; }
    .ae { opacity: 1 !important; stroke-dashoffset: 0 !important; }
    .aet, .aef { display: none !important; }
    .ae.ae-end { marker-end: url(#arrowhead) !important; }
    .ae.ae-start { marker-start: url(#arrowhead-start) !important; }
    .aa { opacity: 0 !important; }
  }` : ''}`
}
