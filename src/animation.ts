// ============================================================================
// Animation system — CSS + SMIL animation for SVG diagrams
//
// Timing model:
//   - `duration`: how long each element animates
//   - `stagger`: delay between consecutive elements
//   - `groupDelay`: extra offset for group container reveal
//
// Easing model:
//   - `nodeEasing`: expo-out for elements entering (fast appear, gentle settle)
//   - `edgeEasing`: ease-in-out for lines drawing (accelerate from source, decelerate into target)
//   - Arrow SMIL keySplines auto-derived from edgeEasing to stay perfectly synced
//
// Cascade: source node → edge draws → target node appears
// ============================================================================

import type { PositionedGraph, PositionedNode, PositionedGroup, AnimationOptions } from './types.ts'

/** Fully resolved animation options with all defaults applied */
export type ResolvedAnimation = Required<AnimationOptions>

const DEFAULTS: ResolvedAnimation = {
  duration: 650,
  stagger: 0,
  groupDelay: 110,
  nodeOverlap: 0.35,
  nodeEasing: 'ease',
  edgeEasing: 'ease-in-out',
  nodeAnimation: 'fade',
  edgeAnimation: 'draw',
  reducedMotion: true,
}

/** Resolve animate option to full AnimationOptions or null (disabled) */
export function resolveAnimation(
  animate: boolean | AnimationOptions | undefined
): ResolvedAnimation | null {
  if (!animate) return null
  if (animate === true) return { ...DEFAULTS }
  return { ...DEFAULTS, ...animate }
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
  groups: Map<string, number>  // groupId → delay ms
}

/** Compute animation delay for each element based on the cascade:
 *  source node visible → edge draws → edge finishes → target node appears */
export function computeDelays(
  graph: PositionedGraph,
  opts: ResolvedAnimation,
): ElementDelays {
  const nodes = new Map<string, number>()
  const edges = new Map<number, number>()
  const groups = new Map<string, number>()

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
  // Nodes with no incoming edges use rank-based stagger.
  // Nodes with incoming edges wait for the latest incoming edge to finish.
  for (const rank of sortedRanks) {
    const bucket = rankBuckets.get(rank)!
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i]!
      const incoming = incomingEdges.get(node.id)

      if (!incoming || incoming.length === 0) {
        // Root node: use rank-based stagger
        nodes.set(node.id, rank * opts.stagger + i * withinRankStagger)
      } else {
        // Start appearing before incoming edge finishes (overlap)
        // nodeOverlap=0 means wait for edge to finish, 0.5 means start halfway through
        const overlap = opts.duration * opts.nodeOverlap
        let latestEdgeEnd = 0
        for (const edgeIdx of incoming) {
          const edgeDelay = edges.get(edgeIdx) ?? 0
          latestEdgeEnd = Math.max(latestEdgeEnd, edgeDelay + opts.duration)
        }
        nodes.set(node.id, latestEdgeEnd - overlap + i * withinRankStagger)
      }

      // Now compute outgoing edge delays for this node
      const nodeDelay = nodes.get(node.id)!
      for (let ei = 0; ei < graph.edges.length; ei++) {
        if (graph.edges[ei]!.source === node.id) {
          edges.set(ei, nodeDelay + opts.duration)
        }
      }
    }
  }

  // Group delays: appear when children are mostly visible
  collectGroupDelays(graph.groups, graph.nodes, opts, nodes, groups)

  return { nodes, edges, groups }
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

  return `
  /* Animation keyframes */
  @keyframes a-fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes a-fade-up { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
  @keyframes a-scale { from { opacity: 0; transform: scale(0.85) } to { opacity: 1; transform: scale(1) } }
  @keyframes a-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }

  /* Animated nodes — expo-out: fast appear, gentle settle */
  .an { opacity: 0; animation: ${nodeKeyframe} ${opts.duration}ms ${opts.nodeEasing} var(--d) forwards; transform-box: fill-box; transform-origin: center; }

  /* Animated groups — same easing as nodes */
  .ag { opacity: 0; animation: a-fade ${opts.duration}ms ${opts.nodeEasing} var(--d) forwards; }

  /* Animated edges — smooth flow: accelerate from source, decelerate into target */
  .ae { stroke-dasharray: 1; stroke-dashoffset: 1; animation: a-draw ${opts.duration}ms ${opts.edgeEasing} var(--d) forwards; }

  /* Animated edge labels — fade with node easing */
  .ael { opacity: 0; animation: a-fade ${opts.duration}ms ${opts.nodeEasing} var(--d) forwards; }

  /* Arrow hidden until animateMotion begins */
  .aa { opacity: 0; }
  .aa.aa-active { opacity: 1; }
${opts.reducedMotion ? `
  /* Accessibility: disable animations for users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .an, .ag, .ae, .ael, .aa { animation: none !important; opacity: 1 !important; stroke-dashoffset: 0 !important; }
  }` : ''}`
}
