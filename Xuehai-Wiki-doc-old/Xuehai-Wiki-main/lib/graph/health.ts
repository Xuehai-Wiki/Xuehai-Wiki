import { getLinkGraph, type GraphNode } from './build';
import { getReadingOrder } from '../navigation/sequence';
import { cached } from '../cache';

/**
 * What the link graph says about the state of the wiki.
 *
 * A broken link is an error and already reported. These are not errors — a
 * wiki can be perfectly correct and still have them — but they are the shapes
 * a collection of documents falls into when it stops being a wiki: pages
 * nothing leads to, and pages nothing leads on from. Neither is visible from
 * inside a single document, and neither shows up in a link check, which only
 * asks whether the links that exist resolve.
 *
 * Server-only.
 */

/** Pages the graph flags as worth a second look. */
export interface WikiHealth {
  /** Pages nothing links to, so a reader can only arrive through the sidebar */
  orphans: GraphNode[];
  /** Pages with no links out, where a reader arrives and has nowhere to go */
  deadEnds: GraphNode[];
}

let memo: WikiHealth | null = null;

/**
 * Finds pages that are disconnected from the rest of the wiki.
 *
 * The first page in reading order is never an orphan. It is where a reader
 * starts, so nothing needs to point at it, and reporting it every build would
 * teach everyone to ignore the report.
 *
 * @returns The pages worth looking at
 *
 * @example
 * ```typescript
 * const { orphans, deadEnds } = getWikiHealth();
 * orphans.map((page) => page.path); // ['examples/api-docs', …]
 * ```
 */
export function getWikiHealth(): WikiHealth {
  const hit = cached(memo);
  if (hit) return hit;

  const graph = getLinkGraph();
  const [entry] = getReadingOrder();

  const orphans = graph.nodes.filter(
    (node) => node.path !== entry && (graph.backlinks.get(node.path) ?? []).length === 0,
  );

  const deadEnds = graph.nodes.filter((node) => (graph.outbound.get(node.path) ?? []).length === 0);

  memo = { orphans, deadEnds };
  return memo;
}
