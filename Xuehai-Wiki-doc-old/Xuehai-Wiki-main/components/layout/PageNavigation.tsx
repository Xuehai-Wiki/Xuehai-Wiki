import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Adjacent } from '@/lib/navigation/sequence';

/**
 * Links to the pages either side of this one in reading order.
 *
 * A guide is written to be read through, and until now the only way onwards was
 * back to the sidebar to find where you had got to. The order is the sidebar's
 * own, flattened, so the two cannot drift apart.
 *
 * `rel="prev"` and `rel="next"` say the same thing to a crawler, which is how a
 * sequence of pages is declared to be one.
 *
 * @param props - Component props
 * @param props.adjacent - Neighbours from `getAdjacentPages()`
 */
export function PageNavigation({ adjacent }: { adjacent: Adjacent }) {
  const { previous, next } = adjacent;

  // The first and last pages have one neighbour; a page outside the sequence
  // has none, and gets nothing rather than an empty bar.
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="Page navigation"
      className="mt-12 flex items-stretch gap-4 border-t border-gray-200 pt-6 dark:border-gray-800"
    >
      {previous ? (
        <Link
          href={previous.url}
          rel="prev"
          className="group flex flex-1 items-center gap-3 rounded-lg border border-gray-200 p-4 no-underline transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/50"
        >
          <ChevronLeft className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:-translate-x-0.5" />
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Previous
            </span>
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {previous.title}
            </span>
          </span>
        </Link>
      ) : (
        // Holds the column so a lone "next" stays on the right, where it is
        // when there is a pair.
        <div className="flex-1" />
      )}

      {next ? (
        <Link
          href={next.url}
          rel="next"
          className="group flex flex-1 items-center justify-end gap-3 rounded-lg border border-gray-200 p-4 text-right no-underline transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/50"
        >
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Next
            </span>
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {next.title}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
