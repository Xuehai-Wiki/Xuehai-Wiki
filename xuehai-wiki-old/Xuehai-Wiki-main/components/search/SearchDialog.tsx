'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Hash, Loader2, Search as SearchIcon } from 'lucide-react';
import { useSearchStore } from '@/lib/store/searchStore';
import { search, type SearchResult } from '@/lib/search/client';

/**
 * Full-text search dialog, opened with ⌘K or from the sidebar.
 *
 * The index is fetched the first time the dialog opens, so search costs nothing
 * until it is used. All matching happens in the browser against a static JSON
 * file, which keeps it working on any static host.
 */

/** Debounce applied to keystrokes before querying. */
const DEBOUNCE_MS = 120;

/**
 * Renders text with the query terms highlighted.
 *
 * Terms are matched case-insensitively and escaped before being put into a
 * pattern, so a query containing regex metacharacters cannot break the match.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return <>{text}</>;

  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'));
  const lowered = terms.map((term) => term.toLowerCase());

  return (
    <>
      {parts.map((part, index) =>
        lowered.includes(part.toLowerCase()) ? (
          <mark
            key={index}
            className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export function SearchDialog() {
  const router = useRouter();
  const { isOpen, close, toggle } = useSearchStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut. Bound on the document so it works regardless of focus.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggle]);

  // Reset and focus each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;

    setQuery('');
    setResults([]);
    setSelected(0);
    setError(null);

    // Focus after paint, or the input is not yet mounted.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Prevent the page behind the dialog from scrolling.
  useEffect(() => {
    if (!isOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Run the query, debounced, discarding responses that arrive out of order.
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const found = await search(trimmed);
        if (cancelled) return;

        setResults(found);
        setSelected(0);
        setError(null);
      } catch {
        if (cancelled) return;
        setError('Search is unavailable. Try reloading the page.');
        setResults([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen]);

  const go = useCallback(
    (result: SearchResult) => {
      close();
      router.push(result.url);
    },
    [close, router],
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;

      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (selected + delta + results.length) % results.length;

      setSelected(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter' && results[selected]) {
      event.preventDefault();
      go(results[selected]);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
      role="presentation"
      onMouseDown={close}
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-gray-900 dark:ring-white/10"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
          <SearchIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documentation…"
            aria-label="Search query"
            aria-controls="search-results"
            className="flex-1 bg-transparent py-3.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          {isLoading && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400" />}
          <kbd className="hidden flex-shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500 sm:block dark:border-gray-700 dark:text-gray-400">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {error && <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>}

          {!error && query.trim() && !isLoading && results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No results for “{query.trim()}”
            </p>
          )}

          {!error && !query.trim() && (
            <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Search titles, headings, and page contents.
            </p>
          )}

          {results.length > 0 && (
            <ul ref={listRef} id="search-results" role="listbox" className="py-2">
              {results.map((result, index) => (
                <li key={result.id} role="option" aria-selected={index === selected}>
                  <button
                    type="button"
                    onClick={() => go(result)}
                    onMouseEnter={() => setSelected(index)}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                      index === selected ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                    }`}
                  >
                    {result.section ? (
                      <Hash className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    ) : (
                      <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        <Highlighted text={result.section ?? result.title} query={query} />
                      </span>

                      {result.section && (
                        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                          {result.title}
                        </span>
                      )}

                      {result.excerpt && (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
                          <Highlighted text={result.excerpt} query={query} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-gray-200 px-4 py-2 text-[11px] text-gray-500 sm:flex dark:border-gray-800 dark:text-gray-400">
          <span>
            <kbd className="font-sans">↑↓</kbd> to navigate
          </span>
          <span>
            <kbd className="font-sans">↵</kbd> to select
          </span>
          <span>
            <kbd className="font-sans">esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
