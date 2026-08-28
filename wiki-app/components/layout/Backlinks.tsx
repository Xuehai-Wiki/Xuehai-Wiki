import Link from 'next/link';
import { CornerUpLeft } from 'lucide-react';
import type { GraphNode } from '@/lib/graph/build';

/**
 * Lists the pages that link to the current one.
 *
 * Backlinks are what turn a set of documents into a wiki: they show how a page
 * is reached and what context it sits in, which forward links alone never
 * reveal. Computed at build time, so this is a plain server component.
 */
export function Backlinks({ links }: { links: GraphNode[] }) {
  if (links.length === 0) return null;

  return (
    <section
      aria-labelledby="backlinks-heading"
      className="mt-16 border-t border-gray-200 pt-6 dark:border-gray-800"
    >
      <h2
        id="backlinks-heading"
        className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        <CornerUpLeft className="h-3.5 w-3.5" />
        Linked from {links.length} {links.length === 1 ? 'page' : 'pages'}
      </h2>

      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.path}>
            <Link
              href={link.url}
              className="inline-block rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 no-underline transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800/50"
            >
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
