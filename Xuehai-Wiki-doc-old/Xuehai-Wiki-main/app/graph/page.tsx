import { GraphView } from '@/components/graph/GraphView';
import { PageTransition } from '@/components/markdown/PageTransition';
import { getLinkGraph } from '@/lib/graph/build';
import { getSite } from '@/lib/site';
import type { Metadata } from 'next';

/**
 * The link graph view.
 *
 * A static route, so it takes precedence over the catch-all content route and
 * cannot be shadowed by a page named `graph`.
 */

export function generateMetadata(): Metadata {
  const { global } = getSite();

  return {
    title: `Graph · ${global.title}`,
    description: 'How the pages in this wiki link to one another.',
    // The graph is navigation, not content; there is nothing here for a search
    // engine to index that the pages themselves do not already provide.
    robots: { index: false, follow: true },
  };
}

export default function GraphPage() {
  const { nodes, edges, broken } = getLinkGraph();
  const linked = nodes.filter((node) => node.degree > 0).length;

  return (
    <PageTransition>
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">Graph</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {nodes.length} pages, {edges.length} links. {linked} pages are connected to at least one
          other. Hover a node to isolate its neighbours; click to open the page.
        </p>
      </div>

      <GraphView nodes={nodes} edges={edges} />

      {broken.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Unresolved links ({broken.length})
          </h2>
          <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {broken.map((link, index) => (
              <li key={`${link.from}-${link.target}-${index}`}>
                <code className="text-red-600 dark:text-red-400">[[{link.target}]]</code> in{' '}
                <span className="text-gray-900 dark:text-gray-200">{link.from}</span>
                {link.reason === 'ambiguous' && link.candidates && (
                  <> — matches {link.candidates.join(', ')}</>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageTransition>
  );
}
