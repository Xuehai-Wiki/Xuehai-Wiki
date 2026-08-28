import { Share2 } from 'lucide-react';
import { GraphView } from '@/components/graph/GraphView';
import type { LocalGraph as LocalGraphData } from '@/lib/graph/build';

/**
 * Shows the pages immediately around the one being read.
 *
 * The whole-site graph on its own page answers what the wiki looks like. This
 * answers what is next to *here*, which is the question a reader has while
 * reading, and which the full graph stops answering once there are more than a
 * few dozen pages to draw.
 *
 * It sits below the backlinks list and covers the same ground from the other
 * side: backlinks name the pages that point here, the graph shows those and the
 * ones this page points at, and how they relate to each other.
 *
 * Computed at build time, so this is a plain server component; only the SVG
 * beneath it is interactive.
 *
 * @param props - Component props
 * @param props.graph - Neighbourhood from `getLocalGraph()`
 * @param props.path - Content path of the page at the centre
 */
export function LocalGraph({ graph, path }: { graph: LocalGraphData; path: string }) {
  // A page with nothing linking either way has no neighbourhood to draw, and an
  // empty box would only be a question the reader cannot answer.
  if (graph.nodes.length < 2) return null;

  const neighbours = graph.nodes.length - 1;

  return (
    <section
      aria-labelledby="local-graph-heading"
      className="mt-10 border-t border-gray-200 pt-6 dark:border-gray-800"
    >
      <h2
        id="local-graph-heading"
        className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        <Share2 className="h-3.5 w-3.5" />
        Connected to {neighbours} {neighbours === 1 ? 'page' : 'pages'}
      </h2>

      <GraphView
        nodes={graph.nodes}
        edges={graph.edges}
        activePath={path}
        heightClass="h-64 sm:h-72"
      />
    </section>
  );
}
