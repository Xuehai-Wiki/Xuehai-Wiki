import { describe, it, expect } from 'vitest';
import { bounds, layout, seedPositions, step, type LayoutEdge } from './layout';

const AREA = { width: 800, height: 600 };

describe('seedPositions', () => {
  it('places every node inside the area', () => {
    const nodes = seedPositions(['a', 'b', 'c'], AREA);

    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(AREA.width);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(AREA.height);
    }
  });

  it('gives distinct starting positions', () => {
    const nodes = seedPositions(['a', 'b', 'c', 'd'], AREA);
    const keys = new Set(nodes.map((node) => `${node.x.toFixed(3)},${node.y.toFixed(3)}`));

    expect(keys.size).toBe(4);
  });

  it('is deterministic', () => {
    const a = seedPositions(['x', 'y'], AREA);
    const b = seedPositions(['x', 'y'], AREA);

    expect(a).toEqual(b);
  });

  it('handles a single node', () => {
    expect(seedPositions(['only'], AREA)).toHaveLength(1);
  });

  it('handles no nodes', () => {
    expect(seedPositions([], AREA)).toEqual([]);
  });
});

describe('step', () => {
  it('does nothing with no nodes', () => {
    expect(() => step([], [], AREA, 1)).not.toThrow();
  });

  it('pushes unconnected nodes apart', () => {
    const nodes = [
      { id: 'a', x: 400, y: 300, vx: 0, vy: 0 },
      { id: 'b', x: 410, y: 300, vx: 0, vy: 0 },
    ];
    const before = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);

    step(nodes, [], AREA, 1);

    const after = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y);
    expect(after).toBeGreaterThan(before);
  });

  it('pulls connected nodes together when they are far apart', () => {
    const nodes = [
      { id: 'a', x: 50, y: 300, vx: 0, vy: 0 },
      { id: 'b', x: 750, y: 300, vx: 0, vy: 0 },
    ];
    const edges: LayoutEdge[] = [{ from: 'a', to: 'b' }];
    const before = Math.abs(nodes[0].x - nodes[1].x);

    for (let i = 0; i < 20; i++) step(nodes, edges, AREA, 1);

    expect(Math.abs(nodes[0].x - nodes[1].x)).toBeLessThan(before);
  });

  it('separates coincident nodes instead of producing NaN', () => {
    const nodes = [
      { id: 'a', x: 400, y: 300, vx: 0, vy: 0 },
      { id: 'b', x: 400, y: 300, vx: 0, vy: 0 },
    ];

    step(nodes, [], AREA, 1);

    for (const node of nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(nodes[0].x !== nodes[1].x || nodes[0].y !== nodes[1].y).toBe(true);
  });

  it('leaves fixed nodes in place', () => {
    const nodes = [
      { id: 'a', x: 100, y: 100, vx: 0, vy: 0, fixed: true },
      { id: 'b', x: 110, y: 100, vx: 0, vy: 0 },
    ];

    step(nodes, [], AREA, 1);

    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(100);
  });

  it('ignores edges referencing unknown nodes', () => {
    const nodes = [{ id: 'a', x: 400, y: 300, vx: 0, vy: 0 }];

    expect(() => step(nodes, [{ from: 'a', to: 'ghost' }], AREA, 1)).not.toThrow();
    expect(Number.isFinite(nodes[0].x)).toBe(true);
  });

  it('ignores self-links', () => {
    const nodes = [{ id: 'a', x: 400, y: 300, vx: 0, vy: 0 }];

    step(nodes, [{ from: 'a', to: 'a' }], AREA, 1);

    expect(Number.isFinite(nodes[0].x)).toBe(true);
  });
});

describe('layout', () => {
  it('produces finite positions for a connected graph', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const edges: LayoutEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'd', to: 'e' },
    ];

    for (const node of layout(ids, edges, AREA)) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('is deterministic across runs', () => {
    const ids = ['a', 'b', 'c'];
    const edges: LayoutEdge[] = [{ from: 'a', to: 'b' }];

    expect(layout(ids, edges, AREA)).toEqual(layout(ids, edges, AREA));
  });

  it('places linked nodes closer than unlinked ones', () => {
    const nodes = layout(['a', 'b', 'far'], [{ from: 'a', to: 'b' }], AREA);
    const byId = new Map(nodes.map((node) => [node.id, node]));

    const linked = Math.hypot(
      byId.get('a')!.x - byId.get('b')!.x,
      byId.get('a')!.y - byId.get('b')!.y,
    );
    const unlinked = Math.hypot(
      byId.get('a')!.x - byId.get('far')!.x,
      byId.get('a')!.y - byId.get('far')!.y,
    );

    expect(linked).toBeLessThan(unlinked);
  });

  it('handles a graph with no edges', () => {
    expect(layout(['a', 'b'], [], AREA)).toHaveLength(2);
  });
});

describe('bounds', () => {
  it('covers every node with padding', () => {
    const box = bounds(
      [
        { id: 'a', x: 100, y: 100, vx: 0, vy: 0 },
        { id: 'b', x: 300, y: 200, vx: 0, vy: 0 },
      ],
      10,
    );

    expect(box.x).toBe(90);
    expect(box.y).toBe(90);
    expect(box.width).toBe(220);
    expect(box.height).toBe(120);
  });

  it('never returns a zero-size box for a single node', () => {
    const box = bounds([{ id: 'a', x: 5, y: 5, vx: 0, vy: 0 }], 0);

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('returns a usable box for no nodes', () => {
    const box = bounds([]);

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});
