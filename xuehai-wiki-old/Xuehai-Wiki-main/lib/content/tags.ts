import { getContentRegistry, type ContentDoc } from './registry';
import { getSite } from '../site';
import { docPathToUrl } from '../navigation/url';
import { cached } from '../cache';

/**
 * Subjects, gathered across the folder tree.
 *
 * A file lives in one directory, so the sidebar can only ever show one way of
 * organising a wiki. Tags are the other way: a page sits in one section and
 * touches as many subjects as it touches. Where the graph says which pages
 * mention each other, tags say which are about the same thing whether or not
 * anyone thought to link them.
 *
 * Server-only: reads the content registry.
 */

/** Route segment the tag pages live under. */
export const TAGS_SEGMENT = 'tags';

/** A page carrying a tag. */
export interface TaggedPage {
  /** Content path */
  path: string;
  /** Display title */
  title: string;
  /** Href, in the site's configured URL form */
  url: string;
  /** Short summary, when the page has one */
  description?: string;
}

/** A subject and the pages about it. */
export interface Tag {
  /** The tag as first written by an author */
  name: string;
  /** Lowercased form, used in URLs and for comparison */
  slug: string;
  /** Pages carrying it, in reading order */
  pages: TaggedPage[];
}

let memo: Tag[] | null = null;

/**
 * Converts a page to the shape a listing needs.
 */
function toTaggedPage(doc: ContentDoc): TaggedPage | null {
  const url = docPathToUrl(getSite().urlMap, doc.path);
  if (!url) return null;

  return { path: doc.path, title: doc.title, url: `/${url}/`, description: doc.description };
}

/**
 * Collects every tag and the pages carrying it.
 *
 * Hidden pages are left out. A page kept off the sidebar on purpose should not
 * reappear in a tag listing, which would make the tag index a way of
 * enumerating exactly what was meant to stay unlisted.
 *
 * @returns Tags sorted by name, each with its pages
 *
 * @example
 * ```typescript
 * getTags().map((tag) => `${tag.name} (${tag.pages.length})`);
 * ```
 */
export function getTags(): Tag[] {
  const hit = cached(memo);
  if (hit) return hit;

  const { docs } = getContentRegistry();
  const { hiddenPaths } = getSite();
  const bySlug = new Map<string, Tag>();

  for (const doc of docs) {
    if (hiddenPaths.has(doc.path)) continue;

    const page = toTaggedPage(doc);
    if (!page) continue;

    for (const name of doc.tags) {
      const slug = name.toLowerCase();
      const existing = bySlug.get(slug);

      // The first spelling wins, so a wiki that writes `Setup` once and `setup`
      // thereafter still shows one tag rather than two.
      if (existing) existing.pages.push(page);
      else bySlug.set(slug, { name, slug, pages: [page] });
    }
  }

  memo = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  return memo;
}

/**
 * Finds one tag by its slug.
 *
 * @param slug - Lowercased tag name from the URL
 * @returns The tag, or null when nothing carries it
 */
export function getTag(slug: string): Tag | null {
  const wanted = decodeURIComponent(slug).toLowerCase();
  return getTags().find((tag) => tag.slug === wanted) ?? null;
}

/**
 * Returns the tags on one page, in the order they were written.
 *
 * @param path - Content path
 * @returns The page's tags, empty when it has none
 */
export function getTagsFor(path: string): Tag[] {
  return getTags().filter((tag) => tag.pages.some((page) => page.path === path));
}

/**
 * Reports a content page whose URL the tag routes would shadow.
 *
 * `/tags/…` is a route of its own, and Next resolves it before the catch-all
 * that serves content, so a page published at that address would become
 * unreachable. Surfacing it is better than letting a page quietly disappear;
 * the fix is to rename the file or the directory.
 *
 * @returns Paths that collide, empty when none do
 */
export function findTagRouteCollisions(): string[] {
  const { docs } = getContentRegistry();
  const { urlMap } = getSite();

  return docs
    .filter((doc) => {
      const url = docPathToUrl(urlMap, doc.path);
      return url === TAGS_SEGMENT || url?.startsWith(`${TAGS_SEGMENT}/`);
    })
    .map((doc) => doc.path);
}
