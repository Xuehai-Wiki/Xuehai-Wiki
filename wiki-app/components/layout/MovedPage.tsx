import Link from 'next/link';
import { asset } from '@/lib/basePath';

/**
 * Stands in for a page that has moved, and sends the reader on.
 *
 * A static export has no server to answer with a 301, so the redirect is a
 * `meta refresh` in the document itself. Search engines treat that as a
 * permanent move when the delay is zero, and the canonical link says the same
 * thing again for anything that reads markup rather than following it.
 *
 * The visible text is not decoration. A reader whose browser blocks the refresh
 * — or who arrives with scripting and meta refresh disabled — still needs a way
 * through, so the link is real and focusable rather than a spinner.
 *
 * @param props - Component props
 * @param props.url - Href of the page that superseded this address
 * @param props.title - Title of that page
 */
export function MovedPage({ url, title }: { url: string; title: string }) {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${asset(url)}`} />

      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          This page moved
        </p>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>

        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          You are being taken there now. If nothing happens, follow the link.
        </p>

        <Link
          href={url}
          className="mt-6 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 no-underline transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Continue to {title}
        </Link>
      </div>
    </>
  );
}
