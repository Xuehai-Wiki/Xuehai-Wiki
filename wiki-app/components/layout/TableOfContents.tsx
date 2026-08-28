'use client';

import { useEffect, useState } from 'react';
import type { Heading } from '@/lib/markdown/rehype-plugins';

/**
 * On-page table of contents with scroll tracking.
 *
 * Headings are collected during the build, so the list is server-rendered and
 * present in the HTML; the only client-side work is highlighting whichever
 * section the reader is currently looking at.
 */

interface TableOfContentsProps {
  /** Headings for the current document, in order */
  headings: Heading[];
}

/**
 * Top offset used when deciding which heading is "current".
 *
 * Matches the sticky header, so a heading counts as active once it reaches the
 * point where it becomes visible rather than when it touches the viewport edge.
 */
const SCROLL_OFFSET = 96;

/**
 * Tracks which heading the reader is currently under.
 *
 * Chosen by position rather than by intersection ratio: a long section whose
 * heading has scrolled off should stay active, which observer-visibility alone
 * does not express.
 *
 * @param headings - Headings to track
 * @returns The id of the active heading
 */
function useActiveHeading(headings: Heading[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;

    let frame = 0;

    const update = () => {
      frame = 0;

      const positions = headings
        .map((heading) => {
          const element = document.getElementById(heading.id);
          return element ? { id: heading.id, top: element.getBoundingClientRect().top } : null;
        })
        .filter((entry): entry is { id: string; top: number } => entry !== null);

      if (positions.length === 0) return;

      // The last heading at or above the offset line is the one being read.
      const passed = positions.filter((entry) => entry.top <= SCROLL_OFFSET);

      // Near the bottom of the page the final section may never reach the
      // offset line, so pin the last heading once the page is scrolled to end.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

      if (atBottom) {
        setActive(positions[positions.length - 1].id);
      } else {
        setActive(passed.length > 0 ? passed[passed.length - 1].id : positions[0].id);
      }
    };

    const onScroll = () => {
      // Scroll fires far more often than the display refreshes; coalescing to
      // one measurement per frame keeps layout reads off the scroll path.
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [headings]);

  return active;
}

/**
 * Renders the table of contents rail.
 *
 * Returns nothing for documents with fewer than two headings — a contents list
 * with one entry is noise.
 *
 * @param props.headings - Headings for the current document
 */
export function TableOfContents({ headings }: TableOfContentsProps) {
  const active = useActiveHeading(headings);

  if (headings.length < 2) return null;

  // Normalise depth so a document starting at h3 is not indented as if nested.
  const minDepth = Math.min(...headings.map((heading) => heading.depth));

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        On this page
      </p>

      <ul className="space-y-1 border-l border-gray-200 dark:border-gray-800">
        {headings.map((heading) => {
          const isActive = heading.id === active;

          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                aria-current={isActive ? 'location' : undefined}
                className={`-ml-px block border-l py-1 pr-2 transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
                style={{ paddingLeft: `${(heading.depth - minDepth) * 12 + 12}px` }}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
