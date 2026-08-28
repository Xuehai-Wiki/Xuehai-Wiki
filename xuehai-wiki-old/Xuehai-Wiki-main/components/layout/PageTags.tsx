import Link from 'next/link';
import { Tag as TagIcon } from 'lucide-react';
import type { Tag } from '@/lib/content/tags';

/**
 * Shows the subjects a page belongs to.
 *
 * Placed at the top of the article rather than the foot: knowing what a page is
 * about is useful before reading it, and it is the one piece of navigation the
 * sidebar cannot express, since a file sits in exactly one folder.
 *
 * @param props - Component props
 * @param props.tags - Tags on the page, from `getTagsFor()`
 */
export function PageTags({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;

  return (
    <nav aria-label="Tags" className="mb-6 flex flex-wrap items-center gap-2">
      <TagIcon className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
      {tags.map((tag) => (
        <Link
          key={tag.slug}
          href={`/tags/${encodeURIComponent(tag.slug)}/`}
          className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 no-underline transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {tag.name}
        </Link>
      ))}
    </nav>
  );
}
