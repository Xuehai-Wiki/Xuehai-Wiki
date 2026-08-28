/**
 * Force-directed graph layout.
 *
 * A small Fruchterman–Reingold implementation rather than a charting library:
 * published pages must be self-contained, and a graph of this size does not
 * justify shipping a general-purpose layout engine to every reader.
 *
 * Pure and isomorphic — no DOM access — so it can be unit-tested directly.
 */

/** A node being laid out. */
export interface LayoutNode {
  /** Stable identifier, matching edge endpoints */
  id: string;
  /** Current position, mutated in place as the simulation runs */
  x: number;
  y: number;
  /** Velocity carried between steps */
  vx: number;
  vy: number;
  /** Pinned nodes are not moved by forces */
  fixed?: boolean;
}

/** An edge between two node ids. */
export interface LayoutEdge {
  from: string;
  to: string;
}

/** Tunable simulation parameters. */
export interface LayoutOptions {
  /** Width of the layout area */
  width: number;
  /** Height of the layout area */
  height: number;
  /** Multiplier on the natural spring length; higher spreads nodes further */
  spacing?: number;
}

/** Fraction of velocity retained each step. */
const DAMPING = 0.9;

/** Pull toward the centre, keeping disconnected nodes from drifting away. */
const GRAVITY = 0.03;

/**
 * Largest distance a node may move in one step, as a fraction of `k`.
 *
 * Connected nodes settle at roughly `k` apart, so a step anywhere near that
 * distance overshoots the equilibrium and the pair oscillates instead of
 * converging. Keeping it well below `k` is what makes the layout settle.
 */
const MAX_STEP = 0.1;

/** Minimum separation used in force calculations, avoiding division by zero. */
const MIN_DISTANCE = 0.01;

/**
 * Deterministically spreads nodes around a circle as a starting position.
 *
 * A random start would relayout differently on every render — and would not be
 * reproducible in tests — so positions are seeded from each node's index.
 *
 * @param ids - Node ids, in a stable order
 * @param options - Layout area
 * @returns Nodes positioned on a circle around the centre
 */
export function seedPositions(ids: string[], options: LayoutOptions): LayoutNode[] {
  const { width, height } = options;
  const radius = Math.min(width, height) * 0.35;

  return ids.map((id, index) => {
    const angle = (index / Math.max(1, ids.length)) * Math.PI * 2;

    return {
      id,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
}

/**
 * Advances the simulation by one step.
 *
 * Every pair of nodes repels; connected pairs also attract. `alpha` scales the
 * whole step and is decayed by the caller, which is what lets the layout settle
 * instead of oscillating forever.
 *
 * @param nodes - Nodes to move, mutated in place
 * @param edges - Edges providing attraction
 * @param options - Layout area
 * @param alpha - Step scale, from 1 down toward 0
 */
export function step(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
  alpha: number,
): void {
  const { width, height, spacing = 1 } = options;
  if (nodes.length === 0) return;

  // Natural distance between connected nodes for the available area.
  const k = spacing * Math.sqrt((width * height) / nodes.length);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    node.vx *= DAMPING;
    node.vy *= DAMPING;
  }

  // Repulsion: every pair pushes apart, strongest when close.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];

      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let distance = Math.hypot(dx, dy);

      if (distance < MIN_DISTANCE) {
        // Coincident nodes have no direction to separate along; nudge them
        // apart deterministically using their index so the layout stays stable.
        dx = (i - j) * MIN_DISTANCE;
        dy = MIN_DISTANCE;
        distance = Math.hypot(dx, dy);
      }

      const force = (k * k) / distance;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Attraction along edges.
  for (const edge of edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || a === b) continue;

    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy));

    const force = (distance * distance) / k;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;

    a.vx -= fx;
    a.vy -= fy;
    b.vx += fx;
    b.vy += fy;
  }

  const maxStep = k * MAX_STEP;

  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    // Displacement-based pull toward the centre.
    node.vx += (width / 2 - node.x) * GRAVITY;
    node.vy += (height / 2 - node.y) * GRAVITY;

    const speed = Math.hypot(node.vx, node.vy);
    const scale = speed > maxStep ? maxStep / speed : 1;

    node.x += node.vx * scale * alpha;
    node.y += node.vy * scale * alpha;
  }
}

/**
 * Runs the simulation to completion and returns the settled positions.
 *
 * @param ids - Node ids
 * @param edges - Edges between them
 * @param options - Layout area
 * @param iterations - Number of steps to run
 * @returns Settled node positions
 *
 * @example
 * ```typescript
 * const nodes = layout(['a', 'b'], [{ from: 'a', to: 'b' }], { width: 800, height: 600 });
 * ```
 */
export function layout(
  ids: string[],
  edges: LayoutEdge[],
  options: LayoutOptions,
  iterations = 300,
): LayoutNode[] {
  const nodes = seedPositions(ids, options);

  for (let i = 0; i < iterations; i++) {
    step(nodes, edges, options, 1 - i / iterations);
  }

  return nodes;
}

/**
 * Computes the bounding box of laid-out nodes.
 *
 * Used to fit the result into the viewport regardless of how far the simulation
 * spread things.
 *
 * @param nodes - Positioned nodes
 * @param padding - Margin added on every side
 * @returns The bounding box
 */
export function bounds(
  nodes: LayoutNode[],
  padding = 40,
): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);

  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;

  return {
    x: minX,
    y: minY,
    // A single node produces a zero-size box, which would make the SVG
    // viewBox degenerate.
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
